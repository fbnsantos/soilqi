"""
Sentinel.py — Serviço MQTT para geração de rasters Sentinel Hub / Landsat
=========================================================================
Subscreve o tópico MQTT /soilqi/request (QoS 1, sessão persistente),
processa pedidos de imagens de satélite via Copernicus Data Space / Sentinel Hub
e devolve o resultado PNG ao servidor PHP via HTTP POST.

Tipos de raster suportados:
  ndvi          — NDVI atual (Sentinel-2 L2A)
  ndmi          — NDMI / Humidade vegetativa (Sentinel-2 L2A)
  lst           — LST / Temperatura de superfície (Landsat 8/9 L2)
  ndvi_anomaly  — NDVI anomalia vs período de referência (dois períodos S-2)
  ndvi_diff     — NDVI diferença entre dois períodos (dois períodos S-2)

Instalação:
  pip install -r requirements.txt

Configuração — adicionar ao módulo soilqi (2 níveis acima):
  CLIENT_ID              = "..."   # Copernicus / Sentinel Hub OAuth client ID
  CLIENT_SECRET          = "..."   # Copernicus / Sentinel Hub OAuth client secret
  MQTT_HOST              = "..."   # broker MQTT (ex: "localhost")
  MQTT_PORT              = 1883
  MQTT_USER              = ""      # deixar vazio se sem autenticação
  MQTT_PASS              = ""
  MQTT_TOPIC             = "/soilqi/request"
  RASTER_CALLBACK_URL    = "https://soilqi.com/api/raster_result.php"
  RASTER_API_KEY         = "..."   # chave partilhada com o PHP
"""

from pathlib import Path
import sys

# Sentinel.py está dentro de <projecto>/python/ — subir 2 níveis para chegar
# ao directório que contém o módulo soilqi (ex: /Users/fbnsantos/).
BASE_DIR = Path(__file__).resolve().parents[2]
sys.path.append(str(BASE_DIR))

import soilqi  # noqa: E402 — importado depois de ajustar o path

import os
import json
import time
import logging
import io
import signal
import threading
from typing import Optional

import numpy as np
import requests
from oauthlib.oauth2 import BackendApplicationClient
from requests_oauthlib import OAuth2Session
import paho.mqtt.client as mqtt
from PIL import Image

# ─────────────────────────────────────────────────────────────────────────────
# CONFIGURAÇÃO — lida do módulo soilqi; variáveis de ambiente como fallback
# ─────────────────────────────────────────────────────────────────────────────

def _cfg(attr: str, env: str, default: str = "") -> str:
    """Lê primeiro do módulo soilqi, depois da variável de ambiente, depois usa o default."""
    return str(getattr(soilqi, attr, None) or os.getenv(env) or default)

CFG = {
    # ── Sentinel Hub (Copernicus Data Space) ──────────────────────────────────
    "SENTINEL_CLIENT_ID":     _cfg("CLIENT_ID",           "SENTINEL_CLIENT_ID"),
    "SENTINEL_CLIENT_SECRET": _cfg("CLIENT_SECRET",       "SENTINEL_CLIENT_SECRET"),

    # ── MQTT ──────────────────────────────────────────────────────────────────
    "MQTT_HOST":  _cfg("MQTT_HOST",  "MQTT_HOST",  "localhost"),
    "MQTT_PORT":  int(_cfg("MQTT_PORT",  "MQTT_PORT",  "1883")),
    "MQTT_USER":  _cfg("MQTT_USER",  "MQTT_USER",  ""),
    "MQTT_PASS":  _cfg("MQTT_PASS",  "MQTT_PASS",  ""),
    "MQTT_TOPIC": _cfg("MQTT_TOPIC", "MQTT_TOPIC", "/soilqi/request"),

    # ── Callback PHP ─────────────────────────────────────────────────────────
    "CALLBACK_URL": _cfg("RASTER_CALLBACK_URL", "RASTER_CALLBACK_URL", ""),
    "API_KEY":      _cfg("RASTER_API_KEY",      "RASTER_API_KEY",      ""),

    # ── ID MQTT persistente (não mudar — garante recepção offline) ───────────
    "MQTT_CLIENT_ID": "sentinel_worker",

    # ── Qualidade de imagem ───────────────────────────────────────────────────
    "MAX_CLOUD_COVERAGE": int(_cfg("MAX_CLOUD_COVERAGE", "MAX_CLOUD_COVERAGE", "30")),
    "OUTPUT_WIDTH":       int(_cfg("OUTPUT_WIDTH",       "OUTPUT_WIDTH",       "512")),
    "OUTPUT_HEIGHT":      int(_cfg("OUTPUT_HEIGHT",      "OUTPUT_HEIGHT",      "512")),
}

# Log de arranque — confirma as credenciais carregadas
print(f"[soilqi] CLIENT_ID        = {CFG['SENTINEL_CLIENT_ID']}")
print(f"[soilqi] CLIENT_SECRET    = {'***' if CFG['SENTINEL_CLIENT_SECRET'] else '(vazio)'}")
print(f"[soilqi] MQTT_HOST        = {CFG['MQTT_HOST']}:{CFG['MQTT_PORT']}")
print(f"[soilqi] MQTT_TOPIC       = {CFG['MQTT_TOPIC']}")
print(f"[soilqi] CALLBACK_URL     = {CFG['CALLBACK_URL']}")

TOKEN_URL    = "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token"
PROCESS_URL  = "https://sh.dataspace.copernicus.eu/api/v1/process"
REQUEST_TIMEOUT = 120  # segundos para Sentinel Hub

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)]
)
log = logging.getLogger("Sentinel")

# ─────────────────────────────────────────────────────────────────────────────
# EVALSCRIPTS — Sentinel Hub JavaScript
# ─────────────────────────────────────────────────────────────────────────────

_EVALSCRIPT_NDVI = """
//VERSION=3
function setup() {
  return { input: ["B04","B08","SCL","dataMask"], output: { bands:4, sampleType:"AUTO" } };
}
const ramp=[[-1,[0.2,0.1,0.05,1]],[-0.1,[0.6,0.4,0.2,1]],[0,[0.85,0.8,0.4,1]],
            [0.15,[0.7,0.9,0.2,1]],[0.35,[0.2,0.75,0.1,1]],[0.6,[0.0,0.5,0.0,1]],[1,[0,0.3,0,1]]];
function lerp(a,b,t){return a+t*(b-a);}
function col(v){for(let i=1;i<ramp.length;i++){if(v<=ramp[i][0]){const t=(v-ramp[i-1][0])/(ramp[i][0]-ramp[i-1][0]);return ramp[i-1][1].map((a,j)=>lerp(a,ramp[i][1][j],t));}}return ramp[ramp.length-1][1];}
const BAD=new Set([3,8,9,10,11]);
function evaluatePixel(s){
  if(s.dataMask===0||BAD.has(s.SCL))return[0,0,0,0];
  const v=(s.B08-s.B04)/(s.B08+s.B04+1e-10);
  return col(v);
}
"""

_EVALSCRIPT_NDMI = """
//VERSION=3
function setup(){return{input:["B08","B11","SCL","dataMask"],output:{bands:4,sampleType:"AUTO"}};}
const ramp=[[-1,[0.6,0.4,0.1,1]],[-0.3,[0.95,0.95,0.7,1]],[0,[0.6,0.85,0.95,1]],[0.4,[0.1,0.5,0.9,1]],[1,[0,0.1,0.7,1]]];
function lerp(a,b,t){return a+t*(b-a);}
function col(v){for(let i=1;i<ramp.length;i++){if(v<=ramp[i][0]){const t=(v-ramp[i-1][0])/(ramp[i][0]-ramp[i-1][0]);return ramp[i-1][1].map((a,j)=>lerp(a,ramp[i][1][j],t));}}return ramp[ramp.length-1][1];}
const BAD=new Set([3,8,9,10,11]);
function evaluatePixel(s){
  if(s.dataMask===0||BAD.has(s.SCL))return[0,0,0,0];
  const v=(s.B08-s.B11)/(s.B08+s.B11+1e-10);
  return col(v);
}
"""

# LST usa Landsat 8/9 L2 — colecção diferente
_EVALSCRIPT_LST = """
//VERSION=3
function setup(){return{input:["ST_B10","QA_PIXEL","dataMask"],output:{bands:4,sampleType:"AUTO"}};}
function evaluatePixel(s){
  if(s.dataMask===0)return[0,0,0,0];
  if((s.QA_PIXEL&8)!==0)return[0,0,0,0]; // nuvem
  const lst=s.ST_B10*0.00341802+149.0-273.15; // Kelvin→Celsius
  // colormap 0-45 °C: azul→verde→amarelo→vermelho
  const t=Math.max(0,Math.min(1,(lst-0)/45));
  let r,g,b;
  if(t<0.33){r=0;g=t*3;b=1-(t*3);}
  else if(t<0.66){r=(t-0.33)*3;g=1;b=0;}
  else{r=1;g=1-((t-0.66)*3);b=0;}
  return[r,g,b,1];
}
"""

_EVALSCRIPT_NDVI_TWOPER = """
//VERSION=3
// Multi-datasource: "p1" e "p2"
function setup(){
  return{
    input:[
      {datasource:"p1",bands:["B04","B08","SCL","dataMask"]},
      {datasource:"p2",bands:["B04","B08","SCL","dataMask"]}
    ],
    output:{bands:4,sampleType:"AUTO"}
  };
}
const BAD=new Set([3,8,9,10,11]);
function ndvi(s){if(!s||s.dataMask===0||BAD.has(s.SCL))return null;return(s.B08-s.B04)/(s.B08+s.B04+1e-10);}
function divCol(d){
  // diverging: azul(negativo) → branco(0) → vermelho(positivo), escala ±0.3
  const t=Math.min(1,Math.abs(d)/0.3);
  if(d<0)return[1-t,1-t,1,1];
  return[1,1-t,1-t,1];
}
function evaluatePixel(samples){
  const a=samples.p1.length?samples.p1[0]:null;
  const b=samples.p2.length?samples.p2[0]:null;
  const n1=ndvi(a), n2=ndvi(b);
  if(n1===null||n2===null)return[0,0,0,0];
  return divCol(n2-n1);
}
"""

# ─────────────────────────────────────────────────────────────────────────────
# AUTENTICAÇÃO SENTINEL HUB
# ─────────────────────────────────────────────────────────────────────────────

_token_cache = {"token": None, "expires": 0}

def get_access_token() -> str:
    now = time.time()
    if _token_cache["token"] and now < _token_cache["expires"] - 60:
        return _token_cache["token"]

    client_id     = CFG["SENTINEL_CLIENT_ID"]
    client_secret = CFG["SENTINEL_CLIENT_SECRET"]
    if not client_id or not client_secret:
        raise ValueError("SENTINEL_CLIENT_ID / SENTINEL_CLIENT_SECRET não configurados.")

    client = BackendApplicationClient(client_id=client_id)
    oauth  = OAuth2Session(client=client)
    token  = oauth.fetch_token(token_url=TOKEN_URL, client_secret=client_secret, include_client_id=True)

    _token_cache["token"]   = token["access_token"]
    _token_cache["expires"] = now + token.get("expires_in", 3600)
    log.info("Token Sentinel Hub obtido (expira em %ds).", token.get("expires_in", 3600))
    return _token_cache["token"]

# ─────────────────────────────────────────────────────────────────────────────
# PROCESSAMENTO POR TIPO
# ─────────────────────────────────────────────────────────────────────────────

def _build_s2_data(date_from: str, date_to: str, ds_id: Optional[str] = None) -> dict:
    """Bloco de dados Sentinel-2 L2A para o corpo do pedido."""
    entry = {
        "type": "sentinel-2-l2a",
        "dataFilter": {
            "timeRange": {
                "from": date_from + "T00:00:00Z",
                "to":   date_to   + "T23:59:59Z",
            },
            "maxCloudCoverage": CFG["MAX_CLOUD_COVERAGE"],
            "mosaickingOrder":  "leastCC",
        }
    }
    if ds_id:
        entry["id"] = ds_id
    return entry


def _build_landsat_data(date_from: str, date_to: str) -> dict:
    return {
        "type": "LANDSAT_OT_L2",
        "dataFilter": {
            "timeRange": {
                "from": date_from + "T00:00:00Z",
                "to":   date_to   + "T23:59:59Z",
            },
            "mosaickingOrder": "leastCC",
        }
    }


def _call_process_api(body: dict, accept: str = "image/png") -> bytes:
    """Chama a Process API do Sentinel Hub e devolve os bytes da resposta."""
    token = get_access_token()
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type":  "application/json",
        "Accept":        accept,
    }
    r = requests.post(PROCESS_URL, headers=headers, json=body, timeout=REQUEST_TIMEOUT)
    if r.status_code != 200:
        raise RuntimeError(f"Sentinel Hub HTTP {r.status_code}: {r.text[:400]}")
    return r.content


def _tiff_to_ndvi_array(tiff_bytes: bytes) -> np.ndarray:
    """Lê um GeoTIFF FLOAT32 single-band e devolve um array numpy 2-D."""
    import tifffile
    arr = tifffile.imread(io.BytesIO(tiff_bytes))
    # Normalizar shape: (H,W) ou (1,H,W) ou (H,W,1)
    if arr.ndim == 3:
        arr = arr[0] if arr.shape[0] == 1 else arr[:, :, 0]
    return arr.astype(np.float32)


def _diverging_colormap(diff: np.ndarray, scale: float = 0.3) -> Image.Image:
    """Aplica colormap divergente (azul→branco→vermelho) ao array diff."""
    h, w = diff.shape
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    valid = np.isfinite(diff)
    t = np.clip(np.abs(diff[valid]) / scale, 0, 1)
    neg  = diff[valid] < 0
    rgba[valid, 3] = 255
    # negativo → azul
    rgba_v = rgba[valid]
    rgba_v[neg,  0] = ((1 - t[neg]) * 255).astype(np.uint8)
    rgba_v[neg,  1] = ((1 - t[neg]) * 255).astype(np.uint8)
    rgba_v[neg,  2] = 255
    # positivo → vermelho
    rgba_v[~neg, 0] = 255
    rgba_v[~neg, 1] = ((1 - t[~neg]) * 255).astype(np.uint8)
    rgba_v[~neg, 2] = ((1 - t[~neg]) * 255).astype(np.uint8)
    rgba[valid] = rgba_v
    return Image.fromarray(rgba, "RGBA")


def generate_raster(job: dict) -> bytes:
    """
    Gera o PNG para o tipo de raster pedido.
    Devolve os bytes PNG.
    """
    rtype     = job["raster_type"]
    bbox      = job["bbox"]            # [minLon, minLat, maxLon, maxLat]
    date_from = job["date_from"]
    date_to   = job["date_to"]
    date_from2 = job.get("date_from2") or ""
    date_to2   = job.get("date_to2")   or ""

    bounds_obj = {
        "bbox": bbox,
        "properties": {"crs": "http://www.opengis.net/def/crs/EPSG/0/4326"}
    }
    out_size = {"width": CFG["OUTPUT_WIDTH"], "height": CFG["OUTPUT_HEIGHT"]}

    # ── Tipos de período único (PNG directo) ─────────────────────────────────
    if rtype in ("ndvi", "ndmi", "lst"):
        if rtype == "lst":
            data_block  = [_build_landsat_data(date_from, date_to)]
            evalscript  = _EVALSCRIPT_LST
        elif rtype == "ndmi":
            data_block  = [_build_s2_data(date_from, date_to)]
            evalscript  = _EVALSCRIPT_NDMI
        else:  # ndvi
            data_block  = [_build_s2_data(date_from, date_to)]
            evalscript  = _EVALSCRIPT_NDVI

        body = {
            "input":  {"bounds": bounds_obj, "data": data_block},
            "output": {**out_size, "responses": [{"identifier": "default", "format": {"type": "image/png"}}]},
            "evalscript": evalscript,
        }
        return _call_process_api(body, "image/png")

    # ── Tipos de dois períodos (diff / anomalia) ─────────────────────────────
    if rtype in ("ndvi_diff", "ndvi_anomaly"):
        if not date_from2 or not date_to2:
            raise ValueError(f"date_from2/date_to2 obrigatório para {rtype}")

        # Tentar multi-datasource num único pedido (mais eficiente)
        body = {
            "input": {
                "bounds": bounds_obj,
                "data": [
                    _build_s2_data(date_from,  date_to,  "p1"),
                    _build_s2_data(date_from2, date_to2, "p2"),
                ]
            },
            "output": {**out_size, "responses": [{"identifier":"default","format":{"type":"image/png"}}]},
            "evalscript": _EVALSCRIPT_NDVI_TWOPER,
        }
        try:
            return _call_process_api(body, "image/png")
        except RuntimeError as e:
            log.warning("Multi-datasource falhou (%s). A tentar dois pedidos separados…", e)

        # Fallback: dois pedidos FLOAT32 + numpy
        import tifffile

        def _fetch_ndvi_tiff(df: str, dt: str) -> np.ndarray:
            es = """
//VERSION=3
function setup(){return{input:["B04","B08","SCL","dataMask"],output:{bands:1,sampleType:"AUTO"}};}
const BAD=new Set([3,8,9,10,11]);
function evaluatePixel(s){
  if(s.dataMask===0||BAD.has(s.SCL))return[NaN];
  return[(s.B08-s.B04)/(s.B08+s.B04+1e-10)];
}
"""
            b = {
                "input":  {"bounds": bounds_obj, "data": [_build_s2_data(df, dt)]},
                "output": {**out_size, "responses":[{"identifier":"default","format":{"type":"image/tiff"}}]},
                "evalscript": es,
            }
            raw = _call_process_api(b, "image/tiff")
            return _tiff_to_ndvi_array(raw)

        arr1 = _fetch_ndvi_tiff(date_from,  date_to)
        arr2 = _fetch_ndvi_tiff(date_from2, date_to2)
        diff = arr2 - arr1
        img  = _diverging_colormap(diff)
        buf  = io.BytesIO()
        img.save(buf, "PNG")
        return buf.getvalue()

    raise ValueError(f"Tipo de raster desconhecido: {rtype}")


# ─────────────────────────────────────────────────────────────────────────────
# ENVIAR RESULTADO AO PHP
# ─────────────────────────────────────────────────────────────────────────────

def post_result(job: dict, png_bytes: Optional[bytes], error_msg: Optional[str] = None) -> None:
    # Preferência: URL/chave que vêm no pedido MQTT; fallback para soilqi / env
    url     = job.get("callback_url") or CFG["CALLBACK_URL"]
    api_key = job.get("api_key")      or CFG["API_KEY"]
    if not url:
        log.warning("callback_url em falta no pedido — resultado não enviado.")
        return

    if error_msg:
        payload = {
            "api_key":    api_key,
            "request_id": job["request_id"],
            "status":     "error",
            "error_msg":  error_msg,
        }
    else:
        import base64
        bbox = job["bbox"]
        payload = {
            "api_key":    api_key,
            "request_id": job["request_id"],
            "status":     "done",
            "png_data":   base64.b64encode(png_bytes).decode(),
            "min_lng":    bbox[0],
            "min_lat":    bbox[1],
            "max_lng":    bbox[2],
            "max_lat":    bbox[3],
        }

    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; SoilQI-Sentinel/1.0)",
        "Accept":     "application/json",
    }
    try:
        r = requests.post(url, json=payload, headers=headers, timeout=30)
        if r.status_code == 200 and r.json().get("success"):
            log.info("Resultado entregue (%s).", job["request_id"])
        else:
            log.error("Falha ao entregar resultado: %s — %s", r.status_code, r.text[:200])
    except Exception as ex:
        log.error("Erro HTTP ao entregar resultado: %s", ex)


# ─────────────────────────────────────────────────────────────────────────────
# PROCESSADOR DE PEDIDOS (thread separada por pedido)
# ─────────────────────────────────────────────────────────────────────────────

def process_job(job: dict) -> None:
    rid   = job.get("request_id", "?")
    rtype = job.get("raster_type", "?")
    log.info("[%s] Início: %s | bbox=%s | %s→%s", rid, rtype, job.get("bbox"), job.get("date_from"), job.get("date_to"))
    try:
        png = generate_raster(job)
        log.info("[%s] PNG gerado (%d bytes).", rid, len(png))
        post_result(job, png)
    except Exception as ex:
        log.error("[%s] Erro: %s", rid, ex, exc_info=True)
        post_result(job, None, error_msg=str(ex))


# ─────────────────────────────────────────────────────────────────────────────
# CLIENTE MQTT
# ─────────────────────────────────────────────────────────────────────────────

def on_connect(client, userdata, flags, rc):
    if rc == 0:
        log.info("MQTT ligado a %s:%s", CFG["MQTT_HOST"], CFG["MQTT_PORT"])
        topic = CFG["MQTT_TOPIC"]
        client.subscribe(topic, qos=1)
        log.info("Subscrito a '%s' (QoS 1, sessão persistente).", topic)
    else:
        log.error("MQTT falha de ligação, código=%s", rc)


def on_disconnect(client, userdata, rc):
    if rc != 0:
        log.warning("MQTT desligado inesperadamente (rc=%s). A tentar reconectar…", rc)


def on_message(client, userdata, msg):
    raw = msg.payload.decode("utf-8", errors="replace")
    log.info("Mensagem recebida no tópico '%s': %s…", msg.topic, raw[:120])
    try:
        job = json.loads(raw)
    except json.JSONDecodeError as ex:
        log.error("JSON inválido: %s", ex)
        return

    # Validação mínima
    required = ["request_id", "bbox", "raster_type", "date_from", "date_to"]
    missing  = [k for k in required if not job.get(k)]
    if missing:
        log.error("Pedido inválido — campos em falta: %s", missing)
        return

    # Lançar numa thread para não bloquear o loop MQTT
    t = threading.Thread(target=process_job, args=(job,), daemon=True)
    t.start()


def build_mqtt_client() -> mqtt.Client:
    cid    = CFG["MQTT_CLIENT_ID"]
    client = mqtt.Client(client_id=cid, clean_session=False)
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
    log.info("Sentinel.py a iniciar…")
    log.info("MQTT broker: %s:%s  tópico: %s", CFG["MQTT_HOST"], CFG["MQTT_PORT"], CFG["MQTT_TOPIC"])

    if not CFG["SENTINEL_CLIENT_ID"]:
        log.error("SENTINEL_CLIENT_ID não definido. Defina as variáveis de ambiente.")
        sys.exit(1)

    client = build_mqtt_client()

    # Ligar com reconexão automática
    client.connect(CFG["MQTT_HOST"], CFG["MQTT_PORT"], keepalive=60)

    # Desligar graciosamente com Ctrl+C
    stop_event = threading.Event()
    def _sigterm(sig, frame):
        log.info("Sinal de paragem recebido — a terminar…")
        stop_event.set()
    signal.signal(signal.SIGINT,  _sigterm)
    signal.signal(signal.SIGTERM, _sigterm)

    client.loop_start()
    log.info("Sentinel.py pronto. À espera de pedidos MQTT…")

    try:
        while not stop_event.is_set():
            stop_event.wait(timeout=1)
    finally:
        client.loop_stop()
        client.disconnect()
        log.info("Sentinel.py terminado.")


if __name__ == "__main__":
    main()
