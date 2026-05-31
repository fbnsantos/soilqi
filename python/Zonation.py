from __future__ import annotations  # permite X | Y type hints em Python < 3.10

"""
Zonation.py — Serviço MQTT para geração de mapas de zonagem
============================================================
Subscreve o tópico MQTT /soilqi/zonation (QoS 1, sessão persistente).
Para cada pedido:
  1. Busca os PNGs das camadas via HTTP (api/zonation_data.php)
  2. Calcula a zonagem com o método pedido
  3. Envia o PNG resultado de volta ao servidor via HTTP POST (api/zonation_result.php)

Métodos suportados:
  kmeans    — K-means clustering (sklearn)
  fcm       — Fuzzy C-means (scikit-fuzzy)
  gmm       — Gaussian Mixture Models (sklearn)
  quantiles — Classificação por quantis (numpy)
  weighted  — Índice composto ponderado (numpy)

Configuração — adicionar ao módulo soilqi (2 níveis acima):
  MQTT_HOST          = "..."
  MQTT_PORT          = 1883
  MQTT_USER          = ""
  MQTT_PASS          = ""
  ZONATION_TOPIC     = "/soilqi/zonation"    # opcional, este é o default
  RASTER_API_KEY     = "..."                 # chave partilhada com o PHP
"""

from pathlib import Path
import sys

BASE_DIR = Path(__file__).resolve().parents[2]
sys.path.append(str(BASE_DIR))

try:
    import soilqi  # noqa: E402
except ImportError:
    soilqi = None  # fallback para variáveis de ambiente

import os
import json
import time
import base64
import io
import logging
import signal
import threading
import warnings

import numpy as np
import requests
import paho.mqtt.client as mqtt
from PIL import Image

warnings.filterwarnings("ignore")

# ─────────────────────────────────────────────────────────────────────────────
# LOGGING
# ─────────────────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("zonation")

# ─────────────────────────────────────────────────────────────────────────────
# CONFIGURAÇÃO
# ─────────────────────────────────────────────────────────────────────────────

def _cfg(attr: str, env: str, default: str = "") -> str:
    try:
        v = getattr(soilqi, attr, None) if soilqi else None
        return str(v) if v is not None else os.environ.get(env, default)
    except Exception:
        return os.environ.get(env, default)


CFG = {
    "MQTT_HOST":        _cfg("MQTT_HOST",    "MQTT_HOST",    "localhost"),
    "MQTT_PORT":        int(_cfg("MQTT_PORT", "MQTT_PORT",   "1883")),
    "MQTT_USER":        _cfg("MQTT_USER",    "MQTT_USER",    ""),
    "MQTT_PASS":        _cfg("MQTT_PASS",    "MQTT_PASS",    ""),
    "ZONATION_TOPIC":   _cfg("ZONATION_TOPIC", "ZONATION_TOPIC", "/soilqi/zonation"),
    "MQTT_CLIENT_ID":   "zonation_worker",
    "API_KEY":          _cfg("RASTER_API_KEY", "RASTER_API_KEY", ""),
}

log.info("MQTT: %s:%s  tópico: %s", CFG["MQTT_HOST"], CFG["MQTT_PORT"], CFG["ZONATION_TOPIC"])

# ─────────────────────────────────────────────────────────────────────────────
# CONSTANTES DE RENDERIZAÇÃO
# ─────────────────────────────────────────────────────────────────────────────

TARGET_W, TARGET_H = 256, 256

# Paleta semântica: vermelho(baixo) → laranja → amarelo → verde → azul(alto)
ZONE_COLORS = [
    (215,  25,  28),  # Z1 Muito Baixo  – vermelho
    (253, 141,  60),  # Z2 Baixo        – laranja
    (255, 255, 153),  # Z3 Médio-baixo  – amarelo
    (166, 217, 106),  # Z4 Médio-alto   – verde claro
    ( 26, 150,  65),  # Z5 Alto         – verde escuro
    ( 69, 117, 180),  # Z6              – azul
    (118,  42, 131),  # Z7              – roxo
    (140,  81,  10),  # Z8              – castanho
]
ZONE_LABELS = [
    "Muito Baixo", "Baixo", "Médio-Baixo", "Médio",
    "Médio-Alto",  "Alto",  "Muito Alto",  "Máximo",
]

# ─────────────────────────────────────────────────────────────────────────────
# CARREGAMENTO E PRÉ-PROCESSAMENTO DE LAYERS
# ─────────────────────────────────────────────────────────────────────────────

def load_layer(layer: dict) -> np.ndarray:
    """PNG base64 → array float32 [H, W] ∈ [0,1]. NaN onde sem dados."""
    png_bytes = base64.b64decode(layer["png"])
    img  = Image.open(io.BytesIO(png_bytes)).convert("RGBA")
    img  = img.resize((TARGET_W, TARGET_H), Image.BILINEAR)
    arr  = np.array(img, dtype=np.float32)
    alpha = arr[:, :, 3]
    lum   = (0.299 * arr[:, :, 0] + 0.587 * arr[:, :, 1]
             + 0.114 * arr[:, :, 2]) / 255.0
    return np.where(alpha >= 10, lum, np.nan)


def stack_layers(arrays, weights=None, invert=None):
    """
    Empilha os arrays normaliz. → (n_valid, n_features) + máscara (H, W).
    Aplica pesos e inversão opcionais.
    """
    H, W = TARGET_H, TARGET_W
    n = len(arrays)

    valid = np.ones((H, W), dtype=bool)
    for a in arrays:
        valid &= ~np.isnan(a)

    normed = []
    for i, a in enumerate(arrays):
        vals = a[valid]
        mn, mx = vals.min(), vals.max()
        rng = (mx - mn) if (mx - mn) > 1e-9 else 1.0
        ln = np.where(valid, (a - mn) / rng, 0.0)
        if invert and i < len(invert) and invert[i]:
            ln = np.where(valid, 1.0 - ln, 0.0)
        normed.append(ln)

    flat = np.stack([n_.flatten() for n_ in normed], axis=1).astype(np.float32)
    X = flat[valid.flatten()]

    if weights is not None:
        w = np.array(weights[:n] + [1.0] * max(0, n - len(weights)), dtype=np.float32)
        w /= (w.sum() if w.sum() > 0 else 1.0)
        X = X * w

    return X, valid


def reorder_by_composite(labels, X_orig, n):
    means = [X_orig[labels == c].mean() if np.any(labels == c) else 0.0
             for c in range(n)]
    order = np.argsort(means)
    remap = np.empty(n, dtype=np.int32)
    for new_idx, old_c in enumerate(order):
        remap[old_c] = new_idx
    return remap[labels]

# ─────────────────────────────────────────────────────────────────────────────
# MÉTODOS DE ZONAGEM
# ─────────────────────────────────────────────────────────────────────────────

def method_quantiles(X, valid, params, arrays_raw):
    n_zones = max(2, min(8, int(params.get("n_zones", 3))))
    score   = X.mean(axis=1)
    breaks  = np.percentile(score, np.linspace(0, 100, n_zones + 1))
    breaks[-1] += 1e-9
    labels = np.clip(np.digitize(score, breaks[1:]).astype(np.int32), 0, n_zones - 1)
    return labels, n_zones


def method_weighted(X, valid, params, arrays_raw):
    n_zones     = max(2, min(8, int(params.get("n_zones", 3))))
    classify_by = params.get("classify_by", "quantile")
    score       = X.sum(axis=1)
    if classify_by == "equal":
        mn, mx = score.min(), score.max()
        bins   = np.linspace(mn, mx + 1e-9, n_zones + 1)
        labels = np.clip(np.digitize(score, bins[1:]).astype(np.int32), 0, n_zones - 1)
    else:
        breaks = np.percentile(score, np.linspace(0, 100, n_zones + 1))
        breaks[-1] += 1e-9
        labels = np.clip(np.digitize(score, breaks[1:]).astype(np.int32), 0, n_zones - 1)
    return labels, n_zones


def method_kmeans(X, valid, params, arrays_raw):
    from sklearn.cluster import KMeans
    from sklearn.preprocessing import StandardScaler
    k       = max(2, min(8, int(params.get("n_clusters", 4))))
    n_init  = max(1, min(20,  int(params.get("n_init",   10))))
    max_iter= max(50, min(500, int(params.get("max_iter", 300))))
    Xs      = StandardScaler().fit_transform(X)
    km      = KMeans(n_clusters=k, n_init=n_init, max_iter=max_iter, random_state=42)
    raw     = km.fit_predict(Xs).astype(np.int32)
    return reorder_by_composite(raw, X, k), k


def method_fcm(X, valid, params, arrays_raw):
    try:
        import skfuzzy as fuzz
    except ImportError:
        raise ImportError("scikit-fuzzy não instalado — execute: pip install scikit-fuzzy")
    from sklearn.preprocessing import StandardScaler
    k       = max(2, min(8, int(params.get("n_clusters", 4))))
    m       = max(1.1, min(5.0, float(params.get("m",       2.0))))
    maxiter = max(50,  min(2000, int(params.get("maxiter", 1000))))
    error   = float(params.get("error", 0.005))
    Xs      = StandardScaler().fit_transform(X).astype(np.float64)
    _, u, _, _, _, _, _ = fuzz.cluster.cmeans(
        Xs.T, k, m, error=error, maxiter=maxiter, init=None, seed=42
    )
    raw = np.argmax(u, axis=0).astype(np.int32)
    return reorder_by_composite(raw, X, k), k


def method_gmm(X, valid, params, arrays_raw):
    from sklearn.mixture import GaussianMixture
    from sklearn.preprocessing import StandardScaler
    k   = max(2, min(8, int(params.get("n_components",   4))))
    cov = params.get("covariance_type", "full")
    if cov not in ("full", "tied", "diag", "spherical"):
        cov = "full"
    ni  = max(1, min(10, int(params.get("n_init", 3))))
    Xs  = StandardScaler().fit_transform(X)
    gmm = GaussianMixture(n_components=k, covariance_type=cov,
                          n_init=ni, max_iter=200, random_state=42)
    raw = gmm.fit_predict(Xs).astype(np.int32)
    return reorder_by_composite(raw, X, k), k


METHOD_MAP = {
    "quantiles": method_quantiles,
    "weighted":  method_weighted,
    "kmeans":    method_kmeans,
    "fcm":       method_fcm,
    "gmm":       method_gmm,
}

# ─────────────────────────────────────────────────────────────────────────────
# RENDERIZAÇÃO
# ─────────────────────────────────────────────────────────────────────────────

def render_zones(labels_valid, valid, n_zones):
    H, W   = valid.shape
    full   = np.full(H * W, -1, dtype=np.int32)
    full[valid.flatten()] = labels_valid
    full   = full.reshape(H, W)
    rgba   = np.zeros((H, W, 4), dtype=np.uint8)
    for z in range(n_zones):
        mask = full == z
        if not mask.any():
            continue
        r, g, b = ZONE_COLORS[z % len(ZONE_COLORS)]
        rgba[mask, 0] = r; rgba[mask, 1] = g
        rgba[mask, 2] = b; rgba[mask, 3] = 210
    return rgba


def build_legend(labels_valid, n_zones):
    total = len(labels_valid)
    legend = []
    for z in range(n_zones):
        cnt   = int(np.sum(labels_valid == z))
        r, g, b = ZONE_COLORS[z % len(ZONE_COLORS)]
        lbl   = ZONE_LABELS[z] if z < len(ZONE_LABELS) else f"Zona {z+1}"
        legend.append({
            "zone":     z + 1,
            "color":    f"#{r:02x}{g:02x}{b:02x}",
            "label":    f"Zona {z+1} — {lbl}",
            "area_pct": round(100.0 * cnt / total, 1) if total else 0.0,
        })
    return legend


def encode_png(rgba):
    img = Image.fromarray(rgba, "RGBA")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")

# ─────────────────────────────────────────────────────────────────────────────
# HTTP: BUSCAR DADOS + ENVIAR RESULTADO
# ─────────────────────────────────────────────────────────────────────────────

HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; SoilQI-Zonation/1.0)",
    "Accept":     "application/json",
}


def fetch_layer_data(data_url: str, api_key: str, request_id: str) -> list:
    """Chama zonation_data.php e devolve lista de layers com PNG base64."""
    r = requests.post(
        data_url,
        json={"api_key": api_key, "request_id": request_id},
        headers=HEADERS,
        timeout=60,
    )
    r.raise_for_status()
    body = r.json()
    if not body.get("success"):
        raise RuntimeError(f"zonation_data.php: {body.get('message','erro desconhecido')}")
    layers = body.get("layers", [])
    if not layers:
        raise RuntimeError("Nenhuma camada devolvida pelo servidor.")
    return layers


def post_result(job: dict, png_b64: str | None, bounds: dict | None,
                legend: list | None, error_msg: str | None = None) -> None:
    """Envia o resultado (ou erro) ao callback PHP."""
    url     = job.get("callback_url", "")
    api_key = job.get("api_key") or CFG["API_KEY"]
    if not url:
        log.warning("[%s] callback_url em falta — resultado não enviado.", job.get("request_id"))
        return

    if error_msg:
        payload = {
            "api_key":    api_key,
            "request_id": job["request_id"],
            "status":     "error",
            "error_msg":  error_msg,
        }
    else:
        payload = {
            "api_key":    api_key,
            "request_id": job["request_id"],
            "status":     "done",
            "png_data":   png_b64,
            "min_lat":    bounds["min_lat"],
            "max_lat":    bounds["max_lat"],
            "min_lng":    bounds["min_lng"],
            "max_lng":    bounds["max_lng"],
            "legend":     legend,
        }

    try:
        r = requests.post(url, json=payload, headers=HEADERS, timeout=60)
        if r.status_code == 200 and r.json().get("success"):
            log.info("[%s] Resultado entregue.", job["request_id"])
        else:
            log.error("[%s] Falha ao entregar: %s — %s",
                      job["request_id"], r.status_code, r.text[:200])
    except Exception as ex:
        log.error("[%s] Erro HTTP ao entregar: %s", job["request_id"], ex)

# ─────────────────────────────────────────────────────────────────────────────
# PROCESSADOR DE PEDIDOS
# ─────────────────────────────────────────────────────────────────────────────

def process_job(job: dict) -> None:
    rid     = job.get("request_id", "?")
    method  = job.get("method", "?")
    params  = job.get("params", {})
    log.info("[%s] Início: método=%s  terrain=%s", rid, method, job.get("terrain_id"))

    try:
        # 1. Buscar PNGs das camadas ao servidor PHP
        data_url = job.get("data_url", "")
        api_key  = job.get("api_key") or CFG["API_KEY"]
        layers   = fetch_layer_data(data_url, api_key, rid)
        log.info("[%s] %d camadas recebidas.", rid, len(layers))

        # 2. Carregar e empilhar
        arrays = [load_layer(l) for l in layers]
        weights = params.get("weights", None)
        invert  = params.get("invert",  None)
        X, valid = stack_layers(arrays, weights=weights, invert=invert)

        if X.shape[0] < 20:
            raise RuntimeError("Pixels válidos insuficientes — verifica sobreposição das camadas.")

        # 3. Executar método
        if method not in METHOD_MAP:
            raise ValueError(f"Método desconhecido: '{method}'")
        fn = METHOD_MAP[method]
        labels, n_zones = fn(X, valid, params, arrays)
        log.info("[%s] Zonagem concluída: %d zonas.", rid, n_zones)

        # 4. Renderizar
        rgba    = render_zones(labels, valid, n_zones)
        png_b64 = encode_png(rgba)
        legend  = build_legend(labels, n_zones)

        # Bounds: usa o primeiro layer como referência (mesmo terreno = mesma bbox)
        b0 = layers[0]["bounds"]
        bounds = {
            "min_lat": b0["min_lat"], "max_lat": b0["max_lat"],
            "min_lng": b0["min_lng"], "max_lng": b0["max_lng"],
        }

        # 5. Enviar resultado
        post_result(job, png_b64, bounds, legend)

    except ImportError as ex:
        log.error("[%s] Biblioteca em falta: %s", rid, ex)
        post_result(job, None, None, None, error_msg=str(ex))
    except Exception as ex:
        log.error("[%s] Erro: %s", rid, ex, exc_info=True)
        post_result(job, None, None, None, error_msg=str(ex))

# ─────────────────────────────────────────────────────────────────────────────
# CLIENTE MQTT
# ─────────────────────────────────────────────────────────────────────────────

def on_connect(client, userdata, flags, rc):
    if rc == 0:
        topic = CFG["ZONATION_TOPIC"]
        client.subscribe(topic, qos=1)
        log.info("MQTT ligado — subscrito a '%s' (QoS 1).", topic)
    else:
        log.error("MQTT falha de ligação, código=%s", rc)


def on_disconnect(client, userdata, rc):
    if rc != 0:
        log.warning("MQTT desligado inesperadamente (rc=%s). A reconectar…", rc)


def on_message(client, userdata, msg):
    raw = msg.payload.decode("utf-8", errors="replace")
    log.info("Mensagem recebida: %s…", raw[:120])
    try:
        job = json.loads(raw)
    except json.JSONDecodeError as ex:
        log.error("JSON inválido: %s", ex)
        return

    # Validação mínima
    required = ["request_id", "method", "data_url", "callback_url"]
    missing  = [k for k in required if not job.get(k)]
    if missing:
        log.error("Pedido inválido — campos em falta: %s", missing)
        return

    # Thread separada para não bloquear o loop MQTT
    t = threading.Thread(target=process_job, args=(job,), daemon=True)
    t.start()


def build_mqtt_client() -> mqtt.Client:
    client = mqtt.Client(client_id=CFG["MQTT_CLIENT_ID"], clean_session=False)
    client.on_connect    = on_connect
    client.on_disconnect = on_disconnect
    client.on_message    = on_message
    if CFG["MQTT_USER"]:
        client.username_pw_set(CFG["MQTT_USER"], CFG["MQTT_PASS"])
    return client

# ─────────────────────────────────────────────────────────────────────────────
# ENTRADA PRINCIPAL
# ─────────────────────────────────────────────────────────────────────────────

def main() -> None:
    log.info("Zonation.py a iniciar…")
    log.info("Broker: %s:%s  tópico: %s", CFG["MQTT_HOST"], CFG["MQTT_PORT"], CFG["ZONATION_TOPIC"])

    client = build_mqtt_client()
    client.connect(CFG["MQTT_HOST"], CFG["MQTT_PORT"], keepalive=60)

    stop_event = threading.Event()

    def _sigterm(sig, frame):
        log.info("Sinal de paragem — a terminar…")
        stop_event.set()

    signal.signal(signal.SIGINT,  _sigterm)
    signal.signal(signal.SIGTERM, _sigterm)

    client.loop_start()
    log.info("Zonation.py pronto. À espera de pedidos MQTT…")

    try:
        while not stop_event.is_set():
            stop_event.wait(timeout=1)
    finally:
        client.loop_stop()
        client.disconnect()
        log.info("Zonation.py terminado.")


if __name__ == "__main__":
    main()
