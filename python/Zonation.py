#!/usr/bin/env python3
"""
Zonation.py — Motor de zonagem agrícola a partir de rasters existentes
======================================================================
Lê um JSON de stdin com os PNGs em base64, aplica o método escolhido
pixel-a-pixel e devolve um PNG de zonagem + legenda via stdout (JSON).

Input stdin (JSON):
{
  "method":  "kmeans" | "fcm" | "gmm" | "quantiles" | "weighted",
  "params":  { ... específico por método ... },
  "layers": [
    {
      "id": 42,
      "name": "NDVI 2024-01 → 2024-03",
      "type": "ndvi",
      "png":  "<base64 do PNG>",
      "bounds": {"min_lat":38.5, "max_lat":38.7, "min_lng":-8.2, "max_lng":-8.0}
    },
    ...
  ]
}

Output stdout (JSON):
{
  "success": true,
  "png":    "<base64 PNG RGBA semi-transparente>",
  "bounds": {"min_lat":..., "max_lat":..., "min_lng":..., "max_lng":...},
  "legend": [
    {"zone":1, "color":"#d73027", "label":"Zona 1 (Baixo)", "area_pct":28.3},
    ...
  ]
}
"""

import sys
import json
import base64
import io
import warnings

import numpy as np
from PIL import Image

warnings.filterwarnings("ignore")

# ── Resolução interna (compromisso velocidade/detalhe) ────────────────────────
TARGET_W, TARGET_H = 256, 256

# ── Paleta categórica para zonas (até 8) ─────────────────────────────────────
# Gradiente semântico: vermelho(baixo) → laranja → amarelo → verde-claro → azul(alto)
# Zonas extras: roxo, teal, castanho
ZONE_COLORS = [
    (215,  25,  28),   # Z1 Muito Baixo  – vermelho
    (253, 141,  60),   # Z2 Baixo        – laranja
    (255, 255, 153),   # Z3 Médio-baixo  – amarelo
    (166, 217, 106),   # Z4 Médio-alto   – verde claro
    ( 26, 150,  65),   # Z5 Alto         – verde escuro
    ( 69, 117, 180),   # Z6              – azul
    (118,  42, 131),   # Z7              – roxo
    (140,  81,  10),   # Z8              – castanho
]

ZONE_LABELS_LOW_HIGH = [
    "Muito Baixo", "Baixo", "Médio-Baixo", "Médio",
    "Médio-Alto", "Alto", "Muito Alto", "Máximo"
]


# ─────────────────────────────────────────────────────────────────────────────
#  CARREGAMENTO E NORMALIZAÇÃO
# ─────────────────────────────────────────────────────────────────────────────

def load_layer(layer: dict) -> np.ndarray:
    """
    Descodifica o PNG base64 → array float32 [H, W] normalizado [0..1].
    Pixels transparentes (alpha < 10) ficam NaN.
    """
    png_bytes = base64.b64decode(layer["png"])
    img = Image.open(io.BytesIO(png_bytes)).convert("RGBA")
    img = img.resize((TARGET_W, TARGET_H), Image.BILINEAR)
    arr = np.array(img, dtype=np.float32)        # (H, W, 4)

    alpha  = arr[:, :, 3]
    r, g, b = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2]

    # Luminância percetual — bom proxy para índices com colormaps monotónicos
    lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0  # [0..1]

    # Máscara sem-dados
    valid = alpha >= 10
    return np.where(valid, lum, np.nan)


def stack_layers(arrays: list[np.ndarray], weights=None, invert=None
                 ) -> tuple[np.ndarray, np.ndarray]:
    """
    Empilha os arrays numa matriz de características.
    Aplica peso e/ou inversão se fornecidos.

    Devolve:
      X     : (n_valid, n_features) float32 — apenas pixels com dados em TODOS os layers
      valid : (H, W) bool
    """
    H, W = TARGET_H, TARGET_W
    n = len(arrays)

    # Máscara global: pixel válido em TODOS os layers
    valid = np.ones((H, W), dtype=bool)
    for a in arrays:
        valid &= ~np.isnan(a)

    # Normalizar cada layer para [0,1] (min-max global)
    normed = []
    for i, a in enumerate(arrays):
        vals = a[valid]
        mn, mx = vals.min(), vals.max()
        rng = mx - mn if (mx - mn) > 1e-9 else 1.0
        layer_norm = np.where(valid, (a - mn) / rng, 0.0)

        if invert and i < len(invert) and invert[i]:
            layer_norm = np.where(valid, 1.0 - layer_norm, 0.0)

        normed.append(layer_norm)

    # Construir matriz (H*W, n_features)
    flat = np.stack([n_.flatten() for n_ in normed], axis=1).astype(np.float32)
    X = flat[valid.flatten()]  # (n_valid, n_features)

    # Aplicar pesos (apenas escala — não afeta clustering, mas afeta índice composto)
    if weights is not None:
        w = np.array(weights[:n] + [1.0] * max(0, n - len(weights)), dtype=np.float32)
        w = w / (w.sum() if w.sum() > 0 else 1.0)
        X = X * w  # broadcast sobre features

    return X, valid


def reorder_by_composite(labels: np.ndarray, X_orig: np.ndarray, n: int) -> np.ndarray:
    """Re-mapeia labels de forma que zona 0 = menor valor médio composto."""
    cluster_means = [
        X_orig[labels == c].mean() if np.any(labels == c) else 0.0
        for c in range(n)
    ]
    order = np.argsort(cluster_means)  # índice[i] = cluster original com i-ésimo menor
    remap = np.empty(n, dtype=np.int32)
    for new_idx, old_cluster in enumerate(order):
        remap[old_cluster] = new_idx
    return remap[labels]


# ─────────────────────────────────────────────────────────────────────────────
#  RENDERIZAÇÃO
# ─────────────────────────────────────────────────────────────────────────────

def render_zones(labels_valid: np.ndarray, valid: np.ndarray, n_zones: int
                 ) -> np.ndarray:
    """Converte labels (para pixels válidos) → array RGBA (H, W, 4)."""
    H, W = valid.shape
    full = np.full(H * W, -1, dtype=np.int32)
    full[valid.flatten()] = labels_valid
    full = full.reshape(H, W)

    rgba = np.zeros((H, W, 4), dtype=np.uint8)
    for z in range(n_zones):
        mask = full == z
        if not mask.any():
            continue
        r, g, b = ZONE_COLORS[z % len(ZONE_COLORS)]
        rgba[mask, 0] = r
        rgba[mask, 1] = g
        rgba[mask, 2] = b
        rgba[mask, 3] = 210   # semi-transparente

    return rgba


def build_legend(labels_valid: np.ndarray, n_zones: int) -> list:
    total = len(labels_valid)
    legend = []
    for z in range(n_zones):
        cnt = int(np.sum(labels_valid == z))
        r, g, b = ZONE_COLORS[z % len(ZONE_COLORS)]
        label_str = ZONE_LABELS_LOW_HIGH[z] if z < len(ZONE_LABELS_LOW_HIGH) else f"Zona {z+1}"
        legend.append({
            "zone":     z + 1,
            "color":    f"#{r:02x}{g:02x}{b:02x}",
            "label":    f"Zona {z+1} — {label_str}",
            "area_pct": round(100.0 * cnt / total, 1) if total else 0.0,
        })
    return legend


def encode_png(rgba: np.ndarray) -> str:
    img = Image.fromarray(rgba, "RGBA")
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=False)
    return base64.b64encode(buf.getvalue()).decode("ascii")


# ─────────────────────────────────────────────────────────────────────────────
#  MÉTODOS DE ZONAGEM
# ─────────────────────────────────────────────────────────────────────────────

def method_quantiles(X: np.ndarray, valid: np.ndarray, params: dict,
                     arrays_raw: list) -> tuple[np.ndarray, int]:
    """
    Combina layers por média ponderada → classifica em N zonas por quantis.

    Params:
      n_zones  : int  2-8  (default 3)
      weights  : list[float]  peso por layer (default 1.0)
      invert   : list[bool]   inverter layer antes de combinar (default false)
    """
    n_zones = max(2, min(8, int(params.get("n_zones", 3))))

    # Score = média ponderada das colunas de X (já normalizadas + pesadas em stack_layers)
    score = X.mean(axis=1)   # (n_valid,)

    # Breaks por quantis
    qs = np.linspace(0, 100, n_zones + 1)
    breaks = np.percentile(score, qs)
    breaks[-1] += 1e-9

    labels = np.digitize(score, breaks[1:]).astype(np.int32)
    labels = np.clip(labels, 0, n_zones - 1)
    return labels, n_zones


def method_weighted(X: np.ndarray, valid: np.ndarray, params: dict,
                    arrays_raw: list) -> tuple[np.ndarray, int]:
    """
    Índice composto ponderado: soma ponderada → classifica em N zonas.

    Params:
      n_zones      : int  2-8  (default 3)
      weights      : list[float]
      invert       : list[bool]
      classify_by  : "quantile" | "equal"  (default "quantile")
    """
    n_zones     = max(2, min(8, int(params.get("n_zones", 3))))
    classify_by = params.get("classify_by", "quantile")

    score = X.sum(axis=1)   # pesos já aplicados em stack_layers

    if classify_by == "equal":
        mn, mx = score.min(), score.max()
        bins = np.linspace(mn, mx + 1e-9, n_zones + 1)
        labels = np.digitize(score, bins[1:]).astype(np.int32)
    else:
        qs = np.linspace(0, 100, n_zones + 1)
        breaks = np.percentile(score, qs)
        breaks[-1] += 1e-9
        labels = np.digitize(score, breaks[1:]).astype(np.int32)

    labels = np.clip(labels, 0, n_zones - 1)
    return labels, n_zones


def method_kmeans(X: np.ndarray, valid: np.ndarray, params: dict,
                  arrays_raw: list) -> tuple[np.ndarray, int]:
    """
    K-means clustering (sklearn).

    Params:
      n_clusters : int  2-8   (default 4)
      n_init     : int  1-20  (default 10)
      max_iter   : int  50-500 (default 300)
    """
    from sklearn.cluster import KMeans
    from sklearn.preprocessing import StandardScaler

    k        = max(2, min(8, int(params.get("n_clusters", 4))))
    n_init   = max(1, min(20, int(params.get("n_init", 10))))
    max_iter = max(50, min(500, int(params.get("max_iter", 300))))

    Xs = StandardScaler().fit_transform(X)

    km = KMeans(n_clusters=k, n_init=n_init, max_iter=max_iter, random_state=42)
    raw_labels = km.fit_predict(Xs).astype(np.int32)

    labels = reorder_by_composite(raw_labels, X, k)
    return labels, k


def method_fcm(X: np.ndarray, valid: np.ndarray, params: dict,
               arrays_raw: list) -> tuple[np.ndarray, int]:
    """
    Fuzzy C-means (scikit-fuzzy).

    Params:
      n_clusters : int   2-8    (default 4)
      m          : float 1.1-5  fuzziness coefficient (default 2.0)
      maxiter    : int   50-2000 (default 1000)
      error      : float        convergência (default 0.005)
    """
    try:
        import skfuzzy as fuzz
    except ImportError:
        raise ImportError("scikit-fuzzy não instalado. Execute: pip install scikit-fuzzy")

    k       = max(2, min(8, int(params.get("n_clusters", 4))))
    m       = max(1.1, min(5.0, float(params.get("m", 2.0))))
    maxiter = max(50, min(2000, int(params.get("maxiter", 1000))))
    error   = float(params.get("error", 0.005))

    from sklearn.preprocessing import StandardScaler
    Xs = StandardScaler().fit_transform(X).astype(np.float64)

    # skfuzzy espera (features × samples)
    data = Xs.T
    cntr, u, _, _, _, _, _ = fuzz.cluster.cmeans(
        data, k, m, error=error, maxiter=maxiter, init=None, seed=42
    )

    raw_labels = np.argmax(u, axis=0).astype(np.int32)
    labels = reorder_by_composite(raw_labels, X, k)
    return labels, k


def method_gmm(X: np.ndarray, valid: np.ndarray, params: dict,
               arrays_raw: list) -> tuple[np.ndarray, int]:
    """
    Gaussian Mixture Model (sklearn).

    Params:
      n_components    : int  2-8    (default 4)
      covariance_type : str  full|tied|diag|spherical (default "full")
      n_init          : int  1-10   (default 3)
    """
    from sklearn.mixture import GaussianMixture
    from sklearn.preprocessing import StandardScaler

    k    = max(2, min(8, int(params.get("n_components", 4))))
    cov  = params.get("covariance_type", "full")
    if cov not in ("full", "tied", "diag", "spherical"):
        cov = "full"
    ni   = max(1, min(10, int(params.get("n_init", 3))))

    Xs = StandardScaler().fit_transform(X)

    gmm = GaussianMixture(
        n_components=k, covariance_type=cov, n_init=ni,
        max_iter=200, random_state=42
    )
    raw_labels = gmm.fit_predict(Xs).astype(np.int32)

    labels = reorder_by_composite(raw_labels, X, k)
    return labels, k


METHOD_MAP = {
    "quantiles": method_quantiles,
    "weighted":  method_weighted,
    "kmeans":    method_kmeans,
    "fcm":       method_fcm,
    "gmm":       method_gmm,
}


# ─────────────────────────────────────────────────────────────────────────────
#  MAIN
# ─────────────────────────────────────────────────────────────────────────────

def main():
    try:
        data = json.loads(sys.stdin.buffer.read().decode("utf-8"))
    except Exception as e:
        sys.stdout.write(json.dumps({"success": False, "message": f"JSON inválido: {e}"}))
        return

    method_name = data.get("method", "")
    params      = data.get("params", {})
    raw_layers  = data.get("layers", [])

    if method_name not in METHOD_MAP:
        sys.stdout.write(json.dumps({"success": False, "message": f"Método desconhecido: '{method_name}'"}))
        return

    if len(raw_layers) < 1:
        sys.stdout.write(json.dumps({"success": False, "message": "Nenhuma camada fornecida."}))
        return

    # ── Carregar layers ──────────────────────────────────────────────────────
    try:
        arrays = [load_layer(l) for l in raw_layers]
    except Exception as e:
        sys.stdout.write(json.dumps({"success": False, "message": f"Erro ao carregar layers: {e}"}))
        return

    # ── Bounds: usar os bounds do primeiro layer (mesmo terreno = mesma bbox) ─
    b0 = raw_layers[0]["bounds"]
    bounds = {
        "min_lat": b0["min_lat"], "max_lat": b0["max_lat"],
        "min_lng": b0["min_lng"], "max_lng": b0["max_lng"],
    }

    # ── Extrair pesos/inversão dos params ────────────────────────────────────
    weights = params.get("weights", None)
    invert  = params.get("invert",  None)

    # ── Empilhar features ────────────────────────────────────────────────────
    X, valid = stack_layers(arrays, weights=weights, invert=invert)

    if X.shape[0] < 20:
        sys.stdout.write(json.dumps({
            "success": False,
            "message": "Pixels válidos insuficientes. Verifique se as camadas cobrem a mesma área."
        }))
        return

    # ── Executar método ──────────────────────────────────────────────────────
    try:
        fn = METHOD_MAP[method_name]
        labels, n_zones = fn(X, valid, params, arrays)
    except ImportError as e:
        sys.stdout.write(json.dumps({"success": False, "message": str(e)}))
        return
    except Exception as e:
        sys.stdout.write(json.dumps({"success": False, "message": f"Erro em {method_name}: {e}"}))
        return

    # ── Renderizar + codificar ───────────────────────────────────────────────
    rgba    = render_zones(labels, valid, n_zones)
    png_b64 = encode_png(rgba)
    legend  = build_legend(labels, n_zones)

    sys.stdout.write(json.dumps({
        "success": True,
        "png":     png_b64,
        "bounds":  bounds,
        "legend":  legend,
    }))


if __name__ == "__main__":
    main()
