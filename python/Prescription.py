from __future__ import annotations  # permite X | Y type hints em Python < 3.10

"""
Prescription.py — Serviço MQTT para geração de mapas de prescrição (VRA)
=========================================================================
Subscreve o tópico MQTT /soilqi/prescription (QoS 1).
Para cada pedido:
  1. Busca PNG da zonagem + legenda + prescrições via HTTP (api/prescription_data.php)
  2. Gera shapefile grid-based com atributos de pulverização/fertilização por zona
  3. Envia ZIP do shapefile ao servidor via HTTP POST (api/prescription_result.php)

Dependências: numpy, Pillow, requests, paho-mqtt, pyshp
"""

from pathlib import Path
import sys

BASE_DIR = Path(__file__).resolve().parents[2]
sys.path.append(str(BASE_DIR))

try:
    import soilqi  # noqa: E402
except ImportError:
    soilqi = None

import os
import io
import re
import json
import base64
import time
import zipfile
import logging
import signal
import threading
import warnings

import numpy as np
import requests
import paho.mqtt.client as mqtt
from PIL import Image, ImageDraw, ImageFont

try:
    import shapefile          # pyshp
except ImportError:
    raise RuntimeError("Instala pyshp: pip install pyshp")

warnings.filterwarnings("ignore")

# ─────────────────────────────────────────────────────────────────────────────
# LOGGING
# ─────────────────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("Prescription")

# ─────────────────────────────────────────────────────────────────────────────
# CONFIGURAÇÃO
# ─────────────────────────────────────────────────────────────────────────────

def _cfg(attr: str, env: str, default: str = "") -> str:
    if soilqi and hasattr(soilqi, attr):
        return str(getattr(soilqi, attr))
    return os.environ.get(env, default)

CFG = {
    "MQTT_HOST":           _cfg("MQTT_HOST",           "MQTT_HOST",           "localhost"),
    "MQTT_PORT":           int(_cfg("MQTT_PORT",        "MQTT_PORT",           "1883")),
    "MQTT_USER":           _cfg("MQTT_USER",           "MQTT_USER",           ""),
    "MQTT_PASS":           _cfg("MQTT_PASS",           "MQTT_PASS",           ""),
    "PRESCRIPTION_TOPIC":  _cfg("PRESCRIPTION_TOPIC",  "PRESCRIPTION_TOPIC",  "/soilqi/prescription"),
    "MQTT_CLIENT_ID":      "prescription_worker",
    "API_KEY":             _cfg("RASTER_API_KEY",      "RASTER_API_KEY",      ""),
}

HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; SoilQI-Prescription/1.0)",
    "Accept":     "application/json",
}

# WGS84 PRJ string para os shapefiles
WGS84_PRJ = (
    'GEOGCS["GCS_WGS_1984",'
    'DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],'
    'PRIMEM["Greenwich",0.0],'
    'UNIT["Degree",0.0174532925199433]]'
)

# ─────────────────────────────────────────────────────────────────────────────
# GERAÇÃO DO PNG DE VISUALIZAÇÃO
# ─────────────────────────────────────────────────────────────────────────────

def generate_png_visualization(
    png_b64: str,
    legend: list,
    prescriptions: list,
    name: str,
) -> str:
    """
    Gera um PNG de visualização combinando o mapa de zonagem com uma legenda
    lateral que mostra os valores de prescrição por zona.
    Retorna o PNG em base64.
    """
    # Decode base64 PNG
    png_bytes = base64.b64decode(png_b64)
    map_img   = Image.open(io.BytesIO(png_bytes)).convert("RGBA")
    map_w, map_h = map_img.size

    # Tentar carregar fonte do sistema; fallback para fonte bitmap
    _font_paths = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "C:/Windows/Fonts/arial.ttf",
    ]
    _bold_paths = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "C:/Windows/Fonts/arialbd.ttf",
    ]

    def _try_font(paths, size):
        for p in paths:
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                pass
        return ImageFont.load_default()

    fnt_sm   = _try_font(_font_paths, 10)
    fnt_md   = _try_font(_font_paths, 12)
    fnt_hdr  = _try_font(_bold_paths, 14)

    # Construir lookup prescrição por zona
    presc_by_zone: dict[int, dict] = {}
    for p in prescriptions:
        try:
            presc_by_zone[int(p["zone_id"])] = p
        except (KeyError, TypeError, ValueError):
            pass

    # Dimensões do painel de legenda
    legend_w = 290
    hdr_h    = 58
    col_h    = 22
    row_h    = 38
    footer_h = 26
    n_zones  = len(legend)
    panel_h  = hdr_h + col_h + n_zones * row_h + footer_h + 8

    total_h = max(map_h, panel_h)
    total_w = map_w + legend_w

    # Criar imagem composta
    out_img = Image.new("RGB", (total_w, total_h), (255, 255, 255))

    # Colar mapa (centrado verticalmente, fundo branco para áreas transparentes)
    map_rgb = Image.new("RGB", map_img.size, (255, 255, 255))
    map_rgb.paste(map_img, mask=map_img.split()[3])
    map_offset_y = (total_h - map_h) // 2
    out_img.paste(map_rgb, (0, map_offset_y))

    draw = ImageDraw.Draw(out_img)

    # Painel de legenda — fundo
    draw.rectangle([map_w, 0, total_w - 1, total_h - 1], fill=(248, 250, 252))
    draw.line([map_w, 0, map_w, total_h - 1], fill=(203, 213, 225), width=2)

    # Cabeçalho verde
    draw.rectangle([map_w, 0, total_w - 1, hdr_h - 1], fill=(5, 150, 105))
    x0 = map_w + 12
    draw.text((x0, 10), "PRESCRICAO VRA", fill=(255, 255, 255), font=fnt_hdr)
    name_disp = name[:38] if len(name) > 38 else name
    draw.text((x0, 32), name_disp, fill=(167, 243, 208), font=fnt_sm)

    # Cabeçalhos das colunas
    y = hdr_h
    draw.rectangle([map_w, y, total_w - 1, y + col_h - 1], fill=(241, 245, 249))
    draw.line([map_w, y + col_h - 1, total_w - 1, y + col_h - 1], fill=(226, 232, 240))
    for col_lbl, col_x in [
        ("ZONA",  map_w + 8),
        ("Spray", map_w + 150),
        ("N",     map_w + 198),
        ("P",     map_w + 228),
        ("K",     map_w + 258),
    ]:
        draw.text((col_x, y + 5), col_lbl, fill=(100, 116, 139), font=fnt_sm)
    y += col_h

    # Linhas de zona
    for i, z in enumerate(legend):
        zone_id = int(z.get("zone_id", i + 1))
        label   = str(z.get("label", f"Zona {zone_id}"))[:26]
        try:
            rgb = _parse_hex_color(str(z.get("color", "#808080")))
        except Exception:
            rgb = (128, 128, 128)
        p    = presc_by_zone.get(zone_id, {})
        area = float(z.get("area_pct", 0))

        row_bg = (255, 255, 255) if i % 2 == 0 else (249, 250, 251)
        draw.rectangle([map_w, y, total_w - 1, y + row_h - 1], fill=row_bg)
        draw.line([map_w, y + row_h - 1, total_w - 1, y + row_h - 1], fill=(243, 244, 246))

        # Swatch de cor
        sw_x = map_w + 8
        sw_y = y + (row_h - 16) // 2
        draw.rectangle([sw_x, sw_y, sw_x + 16, sw_y + 16], fill=rgb, outline=(180, 180, 180))

        # Label + percentagem
        draw.text((sw_x + 22, y + 5),  label,        fill=(31, 41, 55),    font=fnt_md)
        draw.text((sw_x + 22, y + 21), f"{area:.1f}%", fill=(156, 163, 175), font=fnt_sm)

        # Valores de prescrição
        spray  = float(p.get("spray",  0) or 0)
        fert_n = float(p.get("fert_n", 0) or 0)
        fert_p = float(p.get("fert_p", 0) or 0)
        fert_k = float(p.get("fert_k", 0) or 0)
        val_color = (37, 99, 235) if (spray + fert_n + fert_p + fert_k) > 0 else (156, 163, 175)
        for val, vx in [
            (f"{spray:.0f}",  map_w + 150),
            (f"{fert_n:.0f}", map_w + 198),
            (f"{fert_p:.0f}", map_w + 228),
            (f"{fert_k:.0f}", map_w + 258),
        ]:
            draw.text((vx, y + 12), val, fill=val_color, font=fnt_md)

        y += row_h

    # Rodapé
    draw.rectangle([map_w, y, total_w - 1, y + footer_h - 1], fill=(241, 245, 249))
    draw.text((map_w + 8, y + 7), "Spray: L/ha   N, P, K: kg/ha", fill=(107, 114, 128), font=fnt_sm)

    # Converter para PNG
    out_buf = io.BytesIO()
    out_img.save(out_buf, format="PNG", optimize=True)
    return base64.b64encode(out_buf.getvalue()).decode("ascii")


# ─────────────────────────────────────────────────────────────────────────────
# GERAÇÃO DO SHAPEFILE
# ─────────────────────────────────────────────────────────────────────────────

def _parse_hex_color(hex_str: str) -> tuple[int, int, int]:
    """Converte '#rrggbb' em tuplo (R, G, B)."""
    h = hex_str.lstrip("#")
    if len(h) == 6:
        return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    if len(h) == 3:
        return int(h[0]*2, 16), int(h[1]*2, 16), int(h[2]*2, 16)
    return (128, 128, 128)


def generate_shapefile(
    png_b64: str,
    bounds: dict,
    legend: list,
    prescriptions: list,
    name: str,
    grid_size: int = 80,
) -> str:
    """
    Gera um ZIP com shapefile (.shp/.shx/.dbf/.prj) a partir do PNG de zonagem.
    Usa abordagem de grelha: cada célula da grelha torna-se um polígono retangular
    com os atributos de prescrição da zona correspondente.

    Retorna o ZIP em base64.
    """
    # ── Decodificar PNG ───────────────────────────────────────────────────────
    png_bytes = base64.b64decode(png_b64)
    img = Image.open(io.BytesIO(png_bytes)).convert("RGBA")
    arr = np.array(img)          # (H, W, 4) uint8
    H, W = arr.shape[:2]

    min_lat = float(bounds["min_lat"])
    max_lat = float(bounds["max_lat"])
    min_lng = float(bounds["min_lng"])
    max_lng = float(bounds["max_lng"])

    lat_range = max_lat - min_lat
    lng_range = max_lng - min_lng

    # ── Construir mapeamento cor → info da zona ───────────────────────────────
    color_to_zone: dict[tuple, dict] = {}
    for z in legend:
        try:
            rgb = _parse_hex_color(str(z.get("color", "#808080")))
            color_to_zone[rgb] = z
        except Exception:
            pass

    if not color_to_zone:
        raise RuntimeError("Legenda sem cores válidas.")

    # ── Construir mapeamento zone_id → prescrição ─────────────────────────────
    presc_by_zone: dict[int, dict] = {}
    for p in prescriptions:
        try:
            presc_by_zone[int(p["zone_id"])] = p
        except (KeyError, TypeError, ValueError):
            pass

    # ── Criar writer do shapefile em memória ──────────────────────────────────
    shp_io = io.BytesIO()
    shx_io = io.BytesIO()
    dbf_io = io.BytesIO()

    w = shapefile.Writer(shp=shp_io, shx=shx_io, dbf=dbf_io, shapeType=5)
    w.field("ZONE_ID",    "N",  5, 0)
    w.field("ZONA",       "C", 60)
    w.field("SPRAY_LHA",  "N", 10, 2)
    w.field("FERT_N_KG",  "N", 10, 2)
    w.field("FERT_P_KG",  "N", 10, 2)
    w.field("FERT_K_KG",  "N", 10, 2)
    w.field("AREA_PCT",   "N",  6, 1)

    cell_px_h = H / grid_size
    cell_px_w = W / grid_size
    lat_step  = lat_range / grid_size
    lng_step  = lng_range / grid_size

    # Pré-calcular array de cores para matching rápido
    colors_rgb   = np.array(list(color_to_zone.keys()), dtype=np.int32)  # (N, 3)
    colors_zones = list(color_to_zone.values())

    records_added = 0

    for gi in range(grid_size):
        for gj in range(grid_size):
            # Centro da célula em pixels
            py = int((gi + 0.5) * cell_px_h)
            px = int((gj + 0.5) * cell_px_w)
            py = min(py, H - 1)
            px = min(px, W - 1)

            # Ignorar células transparentes (fora do terreno)
            alpha = int(arr[py, px, 3])
            if alpha < 30:
                continue

            # Encontrar zona mais próxima por cor (distância L2 no espaço RGB)
            pixel_rgb = arr[py, px, :3].astype(np.int32)
            diffs  = colors_rgb - pixel_rgb          # (N, 3)
            dists  = (diffs ** 2).sum(axis=1)        # (N,)
            best_i = int(np.argmin(dists))
            if dists[best_i] > 8000:                 # threshold: ~90 por canal
                continue

            zone_info = colors_zones[best_i]
            zone_id   = int(zone_info.get("zone_id", best_i + 1))
            zone_lbl  = str(zone_info.get("label", f"Zona {zone_id}"))[:60]
            area_pct  = float(zone_info.get("area_pct", 0))

            p = presc_by_zone.get(zone_id, {})

            # Coordenadas geográficas da célula
            lng_min_c = min_lng + gj * lng_step
            lng_max_c = lng_min_c + lng_step
            lat_max_c = max_lat - gi * lat_step        # Y invertido (topo = lat máx)
            lat_min_c = lat_max_c - lat_step

            poly = [
                [lng_min_c, lat_max_c],
                [lng_max_c, lat_max_c],
                [lng_max_c, lat_min_c],
                [lng_min_c, lat_min_c],
                [lng_min_c, lat_max_c],
            ]

            w.poly([poly])
            w.record(
                zone_id,
                zone_lbl,
                float(p.get("spray",  0) or 0),
                float(p.get("fert_n", 0) or 0),
                float(p.get("fert_p", 0) or 0),
                float(p.get("fert_k", 0) or 0),
                area_pct,
            )
            records_added += 1

    w.close()

    if records_added == 0:
        raise RuntimeError(
            "Nenhum polígono gerado. Verifique se a imagem de zonagem é válida."
        )

    log.info("Shapefile: %d polígonos gerados.", records_added)

    # ── Empacotar em ZIP ──────────────────────────────────────────────────────
    safe = re.sub(r"[^\w\-]", "_", name)[:40] or "prescription"
    zip_io = io.BytesIO()
    with zipfile.ZipFile(zip_io, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(safe + ".shp", shp_io.getvalue())
        zf.writestr(safe + ".shx", shx_io.getvalue())
        zf.writestr(safe + ".dbf", dbf_io.getvalue())
        zf.writestr(safe + ".prj", WGS84_PRJ)
        # Ficheiro CSV de resumo das prescrições
        csv_lines = ["zone_id,zona,spray_lha,fert_n_kg,fert_p_kg,fert_k_kg,area_pct"]
        for z in legend:
            zid = int(z.get("zone_id", 0))
            p   = presc_by_zone.get(zid, {})
            csv_lines.append(
                f"{zid},{z.get('label','')},{p.get('spray',0)},"
                f"{p.get('fert_n',0)},{p.get('fert_p',0)},{p.get('fert_k',0)},"
                f"{z.get('area_pct',0)}"
            )
        zf.writestr(safe + "_prescricao.csv", "\n".join(csv_lines))

    return base64.b64encode(zip_io.getvalue()).decode("ascii")


# ─────────────────────────────────────────────────────────────────────────────
# HTTP: BUSCAR DADOS + ENVIAR RESULTADO
# ─────────────────────────────────────────────────────────────────────────────

def fetch_job_data(data_url: str, api_key: str, request_id: str) -> dict:
    r = requests.post(
        data_url,
        json={"api_key": api_key, "request_id": request_id},
        headers=HEADERS,
        timeout=60,
    )
    r.raise_for_status()
    body = r.json()
    if not body.get("success"):
        raise RuntimeError(f"prescription_data.php: {body.get('message', 'erro')}")
    return body


def post_result(
    job: dict,
    zip_b64: str | None,
    png_b64: str | None = None,
    error_msg: str | None = None,
) -> None:
    url     = job.get("callback_url", "")
    api_key = job.get("api_key") or CFG["API_KEY"]
    if not url:
        log.warning("[%s] callback_url em falta.", job.get("request_id"))
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
            "zip_data":   zip_b64,
        }
        if png_b64:
            payload["png_data"] = png_b64

    try:
        r = requests.post(url, json=payload, headers=HEADERS, timeout=60)
        if r.status_code == 200 and r.json().get("success"):
            log.info("[%s] Resultado entregue.", job["request_id"])
        else:
            log.error("[%s] Falha HTTP %s: %s", job["request_id"], r.status_code, r.text[:200])
    except Exception as ex:
        log.error("[%s] Erro ao entregar: %s", job["request_id"], ex)


# ─────────────────────────────────────────────────────────────────────────────
# PROCESSAMENTO DO JOB
# ─────────────────────────────────────────────────────────────────────────────

def process_job(job: dict) -> None:
    rid = job.get("request_id", "?")
    log.info("[%s] A processar prescrição…", rid)
    try:
        body   = fetch_job_data(job["data_url"], job.get("api_key", CFG["API_KEY"]), rid)
        png    = body["png"]
        bounds = body["bounds"]
        legend = body["legend"]
        prescriptions = body["prescriptions"]
        name   = body.get("name", "prescription")

        zip_b64 = generate_shapefile(png, bounds, legend, prescriptions, name)

        # Gerar PNG de visualização (opcional — não bloqueia se falhar)
        vis_png_b64: str | None = None
        try:
            vis_png_b64 = generate_png_visualization(png, legend, prescriptions, name)
            log.info("[%s] PNG de visualização gerado.", rid)
        except Exception as png_ex:
            log.warning("[%s] PNG de visualização falhou (não crítico): %s", rid, png_ex)

        post_result(job, zip_b64, png_b64=vis_png_b64)
        log.info("[%s] Shapefile gerado com sucesso.", rid)

    except Exception as ex:
        log.error("[%s] Erro: %s", rid, ex)
        post_result(job, None, str(ex))


# ─────────────────────────────────────────────────────────────────────────────
# MQTT DAEMON
# ─────────────────────────────────────────────────────────────────────────────

_stop_event = threading.Event()


def on_connect(client, userdata, flags, rc):
    if rc == 0:
        log.info("MQTT: %s:%d  tópico: %s",
                 CFG["MQTT_HOST"], CFG["MQTT_PORT"], CFG["PRESCRIPTION_TOPIC"])
        client.subscribe(CFG["PRESCRIPTION_TOPIC"], qos=1)
        log.info("Ligado. A aguardar pedidos de prescrição…")
    else:
        log.error("MQTT: falha na ligação (rc=%d).", rc)


def on_disconnect(client, userdata, rc):
    if rc != 0 and not _stop_event.is_set():
        log.warning("MQTT: desligado (rc=%d). A reconectar…", rc)


def on_message(client, userdata, msg):
    try:
        job = json.loads(msg.payload.decode("utf-8"))
    except Exception:
        log.error("Mensagem MQTT inválida (não é JSON).")
        return

    for field in ("request_id", "data_url", "callback_url"):
        if not job.get(field):
            log.error("Mensagem sem campo obrigatório '%s'. Ignorada.", field)
            return

    threading.Thread(target=process_job, args=(job,), daemon=True).start()


def build_mqtt_client() -> mqtt.Client:
    client = mqtt.Client(
        client_id=CFG["MQTT_CLIENT_ID"],
        clean_session=False,
    )
    if CFG["MQTT_USER"]:
        client.username_pw_set(CFG["MQTT_USER"], CFG["MQTT_PASS"])
    client.on_connect    = on_connect
    client.on_disconnect = on_disconnect
    client.on_message    = on_message
    return client


def main():
    def _sig(signum, frame):
        log.info("Sinal %d recebido — a parar.", signum)
        _stop_event.set()

    signal.signal(signal.SIGTERM, _sig)
    signal.signal(signal.SIGINT,  _sig)

    client = build_mqtt_client()
    try:
        client.connect(CFG["MQTT_HOST"], CFG["MQTT_PORT"], keepalive=60)
    except Exception as ex:
        log.error("Não foi possível ligar ao broker MQTT: %s", ex)
        sys.exit(1)

    client.loop_start()
    _stop_event.wait()
    client.loop_stop()
    client.disconnect()
    log.info("Paragem limpa.")


if __name__ == "__main__":
    main()
