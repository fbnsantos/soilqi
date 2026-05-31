"""
Sentinel.py — Serviço MQTT para geração de rasters Sentinel Hub / Landsat
=========================================================================
Subscreve o tópico MQTT /soilqi/request (QoS 1, sessão persistente),
processa pedidos de imagens de satélite via Copernicus Data Space / Sentinel Hub
e devolve o resultado PNG ao servidor PHP via HTTP POST.

Tipos de raster suportados:
  — Sentinel-2 L2A (vegetação) —
  ndvi          NDVI padrão
  evi           Enhanced Vegetation Index (vegetação densa)
  msavi         Modified SAVI (correção de solo)
  gndvi         Green NDVI (clorofila)
  ndre          Red-Edge NDVI (stress avançado)
  ndmi          Humidade vegetativa (SWIR)
  ndwi          Água superficial (McFeeters)
  nbr           Áreas ardidas (NIR/SWIR2)
  bsi           Solo exposto (Bare Soil Index)
  ndvi_anomaly  NDVI anomalia vs. período de referência
  ndvi_diff     NDVI diferença entre dois períodos
  — Sentinel-3 SLSTR —
  lst           Temperatura de superfície (~1 km)
  — Open-Meteo ERA5 —
  chuva         Precipitação acumulada (mm)
  — Sentinel-1 GRD (SAR) —
  humidade_solo Proxy de humidade do solo (VV)
  sar_vv        VV backscatter (estrutura superficial)
  sar_vh        VH backscatter (estrutura vegetação)
  sar_ratio     VV/VH ratio (alterações estruturais)
  sar_rvi       Radar Vegetation Index
  sar_agua      Água / Inundação (retroespalhamento baixo)
  — DEM Copernicus GLO-30 (~30 m) —
  altitude      Altitude hipsométrica
  declive       Declive em graus (calculado em Python)
  aspect        Orientação da encosta (calculado em Python)

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

# LST usa Sentinel-3 SLSTR — banda S8 (10.85 µm, ~1 km resolução)
# Disponível em CDSE sem subscrição especial; S8 devolve temperatura de brilho em Kelvin
_EVALSCRIPT_LST = """
//VERSION=3
function setup(){return{input:["S8","dataMask"],output:{bands:4,sampleType:"AUTO"}};}
function evaluatePixel(s){
  if(s.dataMask===0)return[0,0,0,0];
  // S8 = temperatura de brilho em Kelvin; converter para Celsius
  const lst=s.S8-273.15;
  if(lst<-50||lst>80)return[0,0,0,0]; // valor inválido/fora de escala
  // colormap 0–45 °C: azul→ciano→verde→amarelo→vermelho
  const t=Math.max(0,Math.min(1,(lst-0)/45));
  let r,g,b;
  if(t<0.25){r=0;g=t*4;b=1;}
  else if(t<0.5){r=0;g=1;b=1-(t-0.25)*4;}
  else if(t<0.75){r=(t-0.5)*4;g=1;b=0;}
  else{r=1;g=1-(t-0.75)*4;b=0;}
  return[r,g,b,1];
}
"""

# Humidade do solo — Sentinel-1 GRD, VV backscatter (proxy SAR)
# Escala dB: -25 dB (seco/reflexão fraca) → -5 dB (húmido/reflexão intensa)
_EVALSCRIPT_SOIL_MOISTURE = """
//VERSION=3
function setup(){return{input:["VV","VH","dataMask"],output:{bands:4,sampleType:"AUTO"}};}
function evaluatePixel(s){
  if(s.dataMask===0)return[0,0,0,0];
  // VV em unidades lineares → dB
  const vv_db=10*Math.log10(Math.max(s.VV,1e-10));
  // Normalizar -25 dB…-5 dB → 0…1 (seco→húmido)
  const t=Math.max(0,Math.min(1,(vv_db-(-25))/20));
  // Colormap: vermelho(seco)→amarelo→verde→azul(húmido)
  let r,g,b;
  if(t<0.33){r=1;g=t*3;b=0;}
  else if(t<0.66){r=1-(t-0.33)*3;g=1;b=0;}
  else{r=0;g=1-(t-0.66)*3;b=(t-0.66)*3;}
  return[r,g,b,1];
}
"""

# ── Índices Sentinel-2: vegetação avançada ────────────────────────────────────

_EVALSCRIPT_EVI = """
//VERSION=3
// EVI — Enhanced Vegetation Index: menos saturação em vegetação densa
function setup(){return{input:["B02","B04","B08","SCL","dataMask"],output:{bands:4,sampleType:"AUTO"}};}
const BAD=new Set([3,8,9,10,11]);
const rampEVI=[[-0.2,[0.4,0.2,0.1,1]],[0,[0.85,0.8,0.4,1]],[0.2,[0.6,0.85,0.2,1]],[0.5,[0.1,0.6,0.05,1]],[0.8,[0,0.3,0,1]]];
function lerp(a,b,t){return a+t*(b-a);}
function colRamp(v,ramp){for(let i=1;i<ramp.length;i++){if(v<=ramp[i][0]){const t=(v-ramp[i-1][0])/(ramp[i][0]-ramp[i-1][0]);return ramp[i-1][1].map((a,j)=>lerp(a,ramp[i][1][j],t));}}return ramp[ramp.length-1][1];}
function evaluatePixel(s){
  if(s.dataMask===0||BAD.has(s.SCL))return[0,0,0,0];
  const evi=2.5*(s.B08-s.B04)/(s.B08+6*s.B04-7.5*s.B02+1);
  return colRamp(Math.max(-0.2,Math.min(0.8,evi)),rampEVI);
}
"""

_EVALSCRIPT_MSAVI = """
//VERSION=3
// MSAVI — Modified Soil Adjusted Vegetation Index: corrige efeito do solo
function setup(){return{input:["B04","B08","SCL","dataMask"],output:{bands:4,sampleType:"AUTO"}};}
const BAD=new Set([3,8,9,10,11]);
const ramp=[[-0.2,[0.4,0.2,0.1,1]],[0,[0.85,0.8,0.4,1]],[0.2,[0.6,0.85,0.2,1]],[0.5,[0.1,0.6,0.05,1]],[0.8,[0,0.3,0,1]]];
function lerp(a,b,t){return a+t*(b-a);}
function colRamp(v,r){for(let i=1;i<r.length;i++){if(v<=r[i][0]){const t=(v-r[i-1][0])/(r[i][0]-r[i-1][0]);return r[i-1][1].map((a,j)=>lerp(a,r[i][1][j],t));}}return r[r.length-1][1];}
function evaluatePixel(s){
  if(s.dataMask===0||BAD.has(s.SCL))return[0,0,0,0];
  const d=(2*s.B08+1)*(2*s.B08+1)-8*(s.B08-s.B04);
  const msavi=(2*s.B08+1-Math.sqrt(Math.max(0,d)))/2;
  return colRamp(Math.max(-0.2,Math.min(0.8,msavi)),ramp);
}
"""

_EVALSCRIPT_GNDVI = """
//VERSION=3
// GNDVI — Green NDVI: sensível à clorofila e estado fisiológico
function setup(){return{input:["B03","B08","SCL","dataMask"],output:{bands:4,sampleType:"AUTO"}};}
const BAD=new Set([3,8,9,10,11]);
const ramp=[[-1,[0.5,0.3,0.1,1]],[-0.1,[0.9,0.85,0.4,1]],[0.2,[0.5,0.8,0.2,1]],[0.5,[0.05,0.55,0.05,1]],[1,[0,0.25,0,1]]];
function lerp(a,b,t){return a+t*(b-a);}
function colRamp(v,r){for(let i=1;i<r.length;i++){if(v<=r[i][0]){const t=(v-r[i-1][0])/(r[i][0]-r[i-1][0]);return r[i-1][1].map((a,j)=>lerp(a,r[i][1][j],t));}}return r[r.length-1][1];}
function evaluatePixel(s){
  if(s.dataMask===0||BAD.has(s.SCL))return[0,0,0,0];
  return colRamp((s.B08-s.B03)/(s.B08+s.B03+1e-10),ramp);
}
"""

_EVALSCRIPT_NDRE = """
//VERSION=3
// NDRE — Red-Edge NDVI: stress e clorofila em vegetação desenvolvida
function setup(){return{input:["B05","B8A","SCL","dataMask"],output:{bands:4,sampleType:"AUTO"}};}
const BAD=new Set([3,8,9,10,11]);
const ramp=[[-0.2,[0.5,0.25,0.1,1]],[0,[0.9,0.8,0.4,1]],[0.1,[0.6,0.85,0.2,1]],[0.3,[0.1,0.6,0.05,1]],[0.5,[0,0.3,0,1]]];
function lerp(a,b,t){return a+t*(b-a);}
function colRamp(v,r){for(let i=1;i<r.length;i++){if(v<=r[i][0]){const t=(v-r[i-1][0])/(r[i][0]-r[i-1][0]);return r[i-1][1].map((a,j)=>lerp(a,r[i][1][j],t));}}return r[r.length-1][1];}
function evaluatePixel(s){
  if(s.dataMask===0||BAD.has(s.SCL))return[0,0,0,0];
  return colRamp((s.B8A-s.B05)/(s.B8A+s.B05+1e-10),ramp);
}
"""

_EVALSCRIPT_NDWI = """
//VERSION=3
// NDWI (McFeeters) — água superficial e zonas húmidas
function setup(){return{input:["B03","B08","SCL","dataMask"],output:{bands:4,sampleType:"AUTO"}};}
const BAD=new Set([3,8,9,10,11]);
const ramp=[[-1,[0.6,0.4,0.1,1]],[-0.3,[0.9,0.9,0.6,1]],[0,[0.7,0.95,0.7,1]],[0.2,[0.2,0.75,0.9,1]],[1,[0,0.25,0.8,1]]];
function lerp(a,b,t){return a+t*(b-a);}
function colRamp(v,r){for(let i=1;i<r.length;i++){if(v<=r[i][0]){const t=(v-r[i-1][0])/(r[i][0]-r[i-1][0]);return r[i-1][1].map((a,j)=>lerp(a,r[i][1][j],t));}}return r[r.length-1][1];}
function evaluatePixel(s){
  if(s.dataMask===0||BAD.has(s.SCL))return[0,0,0,0];
  return colRamp((s.B03-s.B08)/(s.B03+s.B08+1e-10),ramp);
}
"""

_EVALSCRIPT_NBR = """
//VERSION=3
// NBR — Normalized Burn Ratio: áreas ardidas e severidade do fogo
function setup(){return{input:["B08","B12","SCL","dataMask"],output:{bands:4,sampleType:"AUTO"}};}
const BAD=new Set([3,8,9,10,11]);
// Alto NBR = saudável (verde); baixo = ardido (vermelho/preto)
const ramp=[[-1,[0.05,0.02,0.02,1]],[-0.3,[0.55,0.1,0.05,1]],[-0.1,[0.95,0.35,0.05,1]],[0.1,[0.95,0.75,0.1,1]],[0.3,[0.6,0.88,0.2,1]],[1,[0,0.4,0,1]]];
function lerp(a,b,t){return a+t*(b-a);}
function colRamp(v,r){for(let i=1;i<r.length;i++){if(v<=r[i][0]){const t=(v-r[i-1][0])/(r[i][0]-r[i-1][0]);return r[i-1][1].map((a,j)=>lerp(a,r[i][1][j],t));}}return r[r.length-1][1];}
function evaluatePixel(s){
  if(s.dataMask===0||BAD.has(s.SCL))return[0,0,0,0];
  return colRamp((s.B08-s.B12)/(s.B08+s.B12+1e-10),ramp);
}
"""

_EVALSCRIPT_BSI = """
//VERSION=3
// BSI — Bare Soil Index: solo exposto vs. vegetado
function setup(){return{input:["B02","B04","B08","B11","SCL","dataMask"],output:{bands:4,sampleType:"AUTO"}};}
const BAD=new Set([3,8,9,10,11]);
// Alto BSI = solo exposto (castanho/laranja); baixo = vegetado (verde)
const ramp=[[-1,[0,0.4,0.1,1]],[-0.1,[0.4,0.7,0.2,1]],[0,[0.85,0.85,0.35,1]],[0.2,[0.75,0.5,0.1,1]],[0.5,[0.85,0.62,0.28,1]]];
function lerp(a,b,t){return a+t*(b-a);}
function colRamp(v,r){for(let i=1;i<r.length;i++){if(v<=r[i][0]){const t=(v-r[i-1][0])/(r[i][0]-r[i-1][0]);return r[i-1][1].map((a,j)=>lerp(a,r[i][1][j],t));}}return r[r.length-1][1];}
function evaluatePixel(s){
  if(s.dataMask===0||BAD.has(s.SCL))return[0,0,0,0];
  const bsi=(s.B11+s.B04-s.B08-s.B02)/(s.B11+s.B04+s.B08+s.B02+1e-10);
  return colRamp(bsi,ramp);
}
"""

# ── Radar SAR (Sentinel-1 GRD) ─────────────────────────────────────────────────

_EVALSCRIPT_SAR_VV = """
//VERSION=3
// VV — Retroespalhamento vertical: estrutura superficial e solo
function setup(){return{input:["VV","dataMask"],output:{bands:4,sampleType:"AUTO"}};}
function evaluatePixel(s){
  if(s.dataMask===0)return[0,0,0,0];
  const db=10*Math.log10(Math.max(s.VV,1e-10));
  const t=Math.max(0,Math.min(1,(db+25)/25)); // -25..0 dB
  return[t*0.92,t*0.92,t,1];
}
"""

_EVALSCRIPT_SAR_VH = """
//VERSION=3
// VH — Retroespalhamento cruzado: estrutura da vegetação e biomassa
function setup(){return{input:["VH","dataMask"],output:{bands:4,sampleType:"AUTO"}};}
function evaluatePixel(s){
  if(s.dataMask===0)return[0,0,0,0];
  const db=10*Math.log10(Math.max(s.VH,1e-10));
  const t=Math.max(0,Math.min(1,(db+30)/25)); // -30..-5 dB
  return[t*0.25,t*0.65,t,1];
}
"""

_EVALSCRIPT_SAR_RATIO = """
//VERSION=3
// VV/VH — Relação entre polarizações: deteção de alterações estruturais
function setup(){return{input:["VV","VH","dataMask"],output:{bands:4,sampleType:"AUTO"}};}
function evaluatePixel(s){
  if(s.dataMask===0)return[0,0,0,0];
  const vv_db=10*Math.log10(Math.max(s.VV,1e-10));
  const vh_db=10*Math.log10(Math.max(s.VH,1e-10));
  const ratio=vv_db-vh_db; // 5..15 dB típico
  const t=Math.max(0,Math.min(1,(ratio-4)/12));
  return[t,0.3*(1-t),1-t,1];
}
"""

_EVALSCRIPT_SAR_RVI = """
//VERSION=3
// RVI — Radar Vegetation Index: complemento ao NDVI em períodos nublados
function setup(){return{input:["VV","VH","dataMask"],output:{bands:4,sampleType:"AUTO"}};}
function evaluatePixel(s){
  if(s.dataMask===0)return[0,0,0,0];
  const rvi=4*s.VH/(s.VV+s.VH+1e-10); // 0=solo, 1=vegetação densa
  const t=Math.max(0,Math.min(1,rvi));
  // castanho (solo) → amarelo → verde (vegetação)
  let r,g,b;
  if(t<0.4){r=0.6+t;g=0.3+t*1.5;b=0.05;}
  else{r=1-(t-0.4)*2;g=0.9;b=0.05+t*0.2;}
  return[Math.max(0,r),Math.max(0,g),b,1];
}
"""

_EVALSCRIPT_SAR_WATER = """
//VERSION=3
// Água/Inundação SAR: retroespalhamento muito baixo = superfície de água calma
function setup(){return{input:["VV","VH","dataMask"],output:{bands:4,sampleType:"AUTO"}};}
function evaluatePixel(s){
  if(s.dataMask===0)return[0,0,0,0];
  const vv_db=10*Math.log10(Math.max(s.VV,1e-10));
  const vh_db=10*Math.log10(Math.max(s.VH,1e-10));
  if(vv_db<-14&&vh_db<-21){
    // azul saturado = água
    const i=Math.max(0,Math.min(1,(-14-vv_db)/8));
    return[0,0.15+i*0.25,0.65+i*0.35,1];
  }
  // terra: cinzento neutro
  const g=Math.max(0,Math.min(0.7,(vv_db+25)/22));
  return[g,g,g,0.7];
}
"""

# ── DEM — Topografia (Copernicus DEM GLO-30, ~30 m) ──────────────────────────

_EVALSCRIPT_ALTITUDE = """
//VERSION=3
// Altitude — hipsometria 0..3000 m
function setup(){return{input:["DEM"],output:{bands:4,sampleType:"AUTO"}};}
const ramp=[[0,[0.18,0.47,0.13,1]],[200,[0.5,0.73,0.28,1]],[500,[0.68,0.62,0.32,1]],[800,[0.6,0.47,0.28,1]],[1200,[0.55,0.43,0.33,1]],[1800,[0.72,0.72,0.72,1]],[3000,[1,1,1,1]]];
function lerp(a,b,t){return a+t*(b-a);}
function colRamp(v,r){v=Math.max(0,Math.min(3000,v));for(let i=1;i<r.length;i++){if(v<=r[i][0]){const t=(v-r[i-1][0])/(r[i][0]-r[i-1][0]);return r[i-1][1].map((a,j)=>lerp(a,r[i][1][j],t));}}return r[r.length-1][1];}
function evaluatePixel(s){return colRamp(s.DEM,ramp);}
"""

# DEM raw (para cálculo de declive/aspect em Python — 1 banda FLOAT)
_EVALSCRIPT_DEM_RAW = """
//VERSION=3
function setup(){return{input:["DEM"],output:{bands:1,sampleType:"AUTO"}};}
function evaluatePixel(s){return[s.DEM];}
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


def _build_slstr_data(date_from: str, date_to: str) -> dict:
    """Bloco de dados Sentinel-3 SLSTR para temperatura de superfície (LST)."""
    return {
        "type": "sentinel-3-slstr",
        "dataFilter": {
            "timeRange": {
                "from": date_from + "T00:00:00Z",
                "to":   date_to   + "T23:59:59Z",
            },
        }
    }


def _build_s1_data(date_from: str, date_to: str) -> dict:
    """Bloco de dados Sentinel-1 GRD para humidade do solo (SAR backscatter)."""
    return {
        "type": "sentinel-1-grd",
        "dataFilter": {
            "timeRange": {
                "from": date_from + "T00:00:00Z",
                "to":   date_to   + "T23:59:59Z",
            },
        }
    }


def _build_dem_data(date_from: str, date_to: str) -> dict:
    """Bloco de dados DEM (Copernicus GLO-30, ~30 m resolução, colecção estática)."""
    return {
        "type": "dem",
        "dataFilter": {
            "timeRange": {
                "from": date_from + "T00:00:00Z",
                "to":   date_to   + "T23:59:59Z",
            },
        }
    }


def _fetch_dem_array(bounds_obj: dict, out_size: dict, date_from: str, date_to: str) -> np.ndarray:
    """Descarrega DEM como TIFF e devolve array 2D float32 em metros."""
    import tifffile
    body = {
        "input":  {"bounds": bounds_obj, "data": [_build_dem_data(date_from, date_to)]},
        "output": {**out_size, "responses": [{"identifier": "default", "format": {"type": "image/tiff"}}]},
        "evalscript": _EVALSCRIPT_DEM_RAW,
    }
    raw = _call_process_api(body, "image/tiff")
    arr = tifffile.imread(io.BytesIO(raw))
    if arr.ndim == 3:
        arr = arr[0] if arr.shape[0] == 1 else arr[:, :, 0]
    return arr.astype(np.float32)


def _apply_colormap_ramp(arr_norm: np.ndarray, ramp: list) -> np.ndarray:
    """Aplica ramp de cores (lista de (t, [R,G,B]) com t em 0-1) a um array normalizado 2D.
    Devolve array RGBA uint8 (H×W×4)."""
    h, w = arr_norm.shape
    r_ch = np.zeros((h, w), dtype=np.float32)
    g_ch = np.zeros((h, w), dtype=np.float32)
    b_ch = np.zeros((h, w), dtype=np.float32)
    for k in range(1, len(ramp)):
        t0, c0 = ramp[k - 1]
        t1, c1 = ramp[k]
        mask = (arr_norm >= t0) & (arr_norm <= t1)
        if not np.any(mask):
            continue
        f = (arr_norm[mask] - t0) / max(t1 - t0, 1e-10)
        r_ch[mask] = c0[0] + f * (c1[0] - c0[0])
        g_ch[mask] = c0[1] + f * (c1[1] - c0[1])
        b_ch[mask] = c0[2] + f * (c1[2] - c0[2])
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    rgba[:, :, 0] = np.clip(r_ch * 255, 0, 255).astype(np.uint8)
    rgba[:, :, 1] = np.clip(g_ch * 255, 0, 255).astype(np.uint8)
    rgba[:, :, 2] = np.clip(b_ch * 255, 0, 255).astype(np.uint8)
    rgba[:, :, 3] = 255
    return rgba


def _generate_slope_raster(bbox: list, bounds_obj: dict, out_size: dict, date_from: str, date_to: str) -> bytes:
    """Calcula declive em graus a partir do DEM e gera PNG."""
    dem = _fetch_dem_array(bounds_obj, out_size, date_from, date_to)
    h, w = dem.shape
    lat_c = (bbox[1] + bbox[3]) / 2
    px_m_y = (bbox[3] - bbox[1]) / h * 111320
    px_m_x = (bbox[2] - bbox[0]) / w * 111320 * np.cos(np.radians(lat_c))
    dz_dy, dz_dx = np.gradient(dem, px_m_y, px_m_x)
    slope_deg = np.degrees(np.arctan(np.sqrt(dz_dx ** 2 + dz_dy ** 2)))
    norm = np.clip(slope_deg / 45.0, 0, 1)  # 0°..45° → 0..1
    ramp = [(0.0, [1.0, 1.0, 1.0]), (0.25, [1.0, 0.9, 0.0]),
            (0.5, [1.0, 0.47, 0.0]), (0.75, [0.78, 0.08, 0.0]), (1.0, [0.08, 0.0, 0.0])]
    rgba = _apply_colormap_ramp(norm, ramp)
    img  = Image.fromarray(rgba, "RGBA")
    buf  = io.BytesIO(); img.save(buf, "PNG"); return buf.getvalue()


def _generate_aspect_raster(bbox: list, bounds_obj: dict, out_size: dict, date_from: str, date_to: str) -> bytes:
    """Calcula orientação da encosta (aspect) a partir do DEM e gera PNG (rosa-dos-ventos)."""
    dem    = _fetch_dem_array(bounds_obj, out_size, date_from, date_to)
    dz_dy, dz_dx = np.gradient(dem)
    aspect = np.degrees(np.arctan2(-dz_dy, dz_dx)) % 360  # 0°=E, horário
    h, w   = dem.shape
    rgba   = np.zeros((h, w, 4), dtype=np.uint8)
    # Mapear aspect 0-360° → hue HSV → RGB
    hue  = aspect / 360.0
    h6   = hue * 6
    i_v  = np.floor(h6).astype(int) % 6
    f    = h6 - np.floor(h6)
    s, v = 0.85, 0.88
    p = v * (1 - s)
    q = v * (1 - s * f)
    t_v = v * (1 - s * (1 - f))
    rc = np.select([i_v==0,i_v==1,i_v==2,i_v==3,i_v==4,i_v==5],[v,q,p,p,t_v,v], default=v)
    gc = np.select([i_v==0,i_v==1,i_v==2,i_v==3,i_v==4,i_v==5],[t_v,v,v,q,p,p], default=p)
    bc = np.select([i_v==0,i_v==1,i_v==2,i_v==3,i_v==4,i_v==5],[p,p,t_v,v,v,q], default=p)
    rgba[:, :, 0] = np.clip(rc * 255, 0, 255).astype(np.uint8)
    rgba[:, :, 1] = np.clip(gc * 255, 0, 255).astype(np.uint8)
    rgba[:, :, 2] = np.clip(bc * 255, 0, 255).astype(np.uint8)
    rgba[:, :, 3] = 255
    img = Image.fromarray(rgba, "RGBA")
    buf = io.BytesIO(); img.save(buf, "PNG"); return buf.getvalue()


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


def _generate_precipitation_raster(bbox: list, date_from: str, date_to: str) -> bytes:
    """
    Gera raster de precipitação acumulada (mm) via Open-Meteo (ERA5 reanalysis).
    Resolução ERA5 ~0.25° (~28 km) — suficiente para terrenos agrícolas típicos.
    Paleta: branco (0 mm) → azul claro → azul → azul escuro → roxo (≥ 100 mm).
    """
    min_lon, min_lat, max_lon, max_lat = bbox
    cx = (min_lon + max_lon) / 2.0
    cy = (min_lat + max_lat) / 2.0

    url = (
        "https://archive-api.open-meteo.com/v1/archive"
        f"?latitude={cy:.5f}&longitude={cx:.5f}"
        f"&start_date={date_from}&end_date={date_to}"
        "&daily=precipitation_sum&timezone=UTC"
    )
    try:
        resp = requests.get(url, timeout=30)
        resp.raise_for_status()
        daily_vals = resp.json().get("daily", {}).get("precipitation_sum", [])
        total_mm   = sum(v for v in daily_vals if v is not None)
    except Exception as e:
        raise RuntimeError(f"Open-Meteo não disponível: {e}")

    log.info("Precipitação acumulada: %.1f mm (%s → %s)", total_mm, date_from, date_to)

    # ── Colormap em pontos de controlo (mm → [R, G, B]) ──────────────────────
    color_ramp = [
        (0.0,   [255, 255, 255]),   # seco — branco
        (2.0,   [200, 235, 255]),   # vestígios — azul muito claro
        (10.0,  [120, 190, 240]),   # chuva leve
        (30.0,  [40,  130, 210]),   # chuva moderada
        (60.0,  [10,   70, 170]),   # chuva forte
        (100.0, [50,    0, 130]),   # chuva muito intensa — roxo
    ]

    def _interp_color(mm: float) -> tuple:
        if mm <= color_ramp[0][0]:
            return tuple(color_ramp[0][1])
        if mm >= color_ramp[-1][0]:
            return tuple(color_ramp[-1][1])
        for k in range(1, len(color_ramp)):
            t0, c0 = color_ramp[k - 1]
            t1, c1 = color_ramp[k]
            if mm <= t1:
                f = (mm - t0) / (t1 - t0)
                return tuple(int(c0[i] + f * (c1[i] - c0[i])) for i in range(3))
        return tuple(color_ramp[-1][1])

    r, g, b = _interp_color(total_mm)

    # Alpha: quase transparente se sem chuva, opaco com chuva significativa
    alpha = max(60, min(230, int(60 + 170 * min(1.0, total_mm / 50.0))))

    out_w = CFG["OUTPUT_WIDTH"]
    out_h = CFG["OUTPUT_HEIGHT"]

    # Cor uniforme (ERA5 >> resolução típica de campo)
    rgba = np.zeros((out_h, out_w, 4), dtype=np.uint8)
    rgba[:, :, 0] = r
    rgba[:, :, 1] = g
    rgba[:, :, 2] = b
    rgba[:, :, 3] = alpha

    img = Image.fromarray(rgba, "RGBA")
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


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

    # ── Precipitação — Open-Meteo (ERA5), sem Sentinel Hub ───────────────────
    if rtype == "chuva":
        return _generate_precipitation_raster(bbox, date_from, date_to)

    # ── DEM — declive e aspect calculados em Python a partir do TIFF ─────────
    if rtype == "declive":
        return _generate_slope_raster(bbox, bounds_obj, out_size, date_from, date_to)
    if rtype == "aspect":
        return _generate_aspect_raster(bbox, bounds_obj, out_size, date_from, date_to)

    # ── Tipos de período único via Sentinel Hub (PNG directo) ─────────────────
    _S2_MAP = {
        "ndvi":  _EVALSCRIPT_NDVI,
        "ndmi":  _EVALSCRIPT_NDMI,
        "evi":   _EVALSCRIPT_EVI,
        "msavi": _EVALSCRIPT_MSAVI,
        "gndvi": _EVALSCRIPT_GNDVI,
        "ndre":  _EVALSCRIPT_NDRE,
        "ndwi":  _EVALSCRIPT_NDWI,
        "nbr":   _EVALSCRIPT_NBR,
        "bsi":   _EVALSCRIPT_BSI,
    }
    _S1_MAP = {
        "humidade_solo": _EVALSCRIPT_SOIL_MOISTURE,
        "sar_vv":        _EVALSCRIPT_SAR_VV,
        "sar_vh":        _EVALSCRIPT_SAR_VH,
        "sar_ratio":     _EVALSCRIPT_SAR_RATIO,
        "sar_rvi":       _EVALSCRIPT_SAR_RVI,
        "sar_agua":      _EVALSCRIPT_SAR_WATER,
    }
    _DEM_MAP = {
        "altitude": _EVALSCRIPT_ALTITUDE,
    }
    _SLSTR_MAP = {
        "lst": _EVALSCRIPT_LST,
    }

    if rtype in _S2_MAP:
        data_block = [_build_s2_data(date_from, date_to)]
        evalscript = _S2_MAP[rtype]
    elif rtype in _S1_MAP:
        data_block = [_build_s1_data(date_from, date_to)]
        evalscript = _S1_MAP[rtype]
    elif rtype in _DEM_MAP:
        data_block = [_build_dem_data(date_from, date_to)]
        evalscript = _DEM_MAP[rtype]
    elif rtype in _SLSTR_MAP:
        data_block = [_build_slstr_data(date_from, date_to)]
        evalscript = _SLSTR_MAP[rtype]
    else:
        evalscript = None

    if evalscript:
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
