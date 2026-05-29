import requests
from oauthlib.oauth2 import BackendApplicationClient
from requests_oauthlib import OAuth2Session


from pathlib import Path
import sys
# script.py está duas pastas abaixo de projeto/
BASE_DIR = Path(__file__).resolve().parents[2]
# adiciona projeto/ ao caminho de imports
sys.path.append(str(BASE_DIR))
import soilqi
# ==========================
# 1. CREDENCIAIS
# ==========================
# Criar OAuth client no Copernicus Data Space / Sentinel Hub dashboard
print(soilqi.CLIENT_ID)
TOKEN_URL = "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token"
PROCESS_URL = "https://sh.dataspace.copernicus.eu/api/v1/process"


# ==========================
# 2. ÁREA DE INTERESSE
# ==========================
# Exemplo: bounding box aproximada no Norte de Portugal
# Formato: [minLon, minLat, maxLon, maxLat]
bbox = [-8.65, 41.10, -8.55, 41.20]

# Sistema de coordenadas WGS84
crs = "http://www.opengis.net/def/crs/EPSG/0/4326"


# ==========================
# 3. INTERVALO TEMPORAL
# ==========================
date_from = "2026-05-01T00:00:00Z"
date_to = "2026-05-29T23:59:59Z"


# ==========================
# 4. EVALSCRIPT PARA NDVI
# ==========================
# Sentinel-2:
# B04 = Red
# B08 = Near Infrared
# SCL = Scene Classification Layer, útil para filtrar nuvens/sombras
evalscript = """
//VERSION=3

function setup() {
  return {
    input: ["B04", "B08", "SCL", "dataMask"],
    output: {
      bands: 1,
      sampleType: "FLOAT32"
    }
  };
}

function evaluatePixel(sample) {
  // Máscara simples de nuvens/sombras usando SCL
  // SCL classes:
  // 3 = cloud shadow
  // 8 = cloud medium probability
  // 9 = cloud high probability
  // 10 = thin cirrus
  // 11 = snow/ice
  if (
    sample.dataMask === 0 ||
    sample.SCL === 3 ||
    sample.SCL === 8 ||
    sample.SCL === 9 ||
    sample.SCL === 10 ||
    sample.SCL === 11
  ) {
    return [NaN];
  }

  let ndvi = (sample.B08 - sample.B04) / (sample.B08 + sample.B04);
  return [ndvi];
}
"""


# ==========================
# 5. AUTENTICAÇÃO
# ==========================
client = BackendApplicationClient(client_id=soilqi.CLIENT_ID)
oauth = OAuth2Session(client=client)

token = oauth.fetch_token(
    token_url=TOKEN_URL,
    client_secret=CLIENT_SECRET,
    include_client_id=True
)

access_token = token["access_token"]


# ==========================
# 6. PEDIDO À PROCESS API
# ==========================
request_body = {
    "input": {
        "bounds": {
            "bbox": bbox,
            "properties": {
                "crs": crs
            }
        },
        "data": [
            {
                "type": "sentinel-2-l2a",
                "dataFilter": {
                    "timeRange": {
                        "from": date_from,
                        "to": date_to
                    },
                    "maxCloudCoverage": 30,
                    "mosaickingOrder": "leastCC"
                }
            }
        ]
    },
    "output": {
        "width": 1024,
        "height": 1024,
        "responses": [
            {
                "identifier": "default",
                "format": {
                    "type": "image/tiff"
                }
            }
        ]
    },
    "evalscript": evalscript
}

headers = {
    "Authorization": f"Bearer {access_token}",
    "Content-Type": "application/json",
    "Accept": "image/tiff"
}

response = requests.post(
    PROCESS_URL,
    headers=headers,
    json=request_body,
    timeout=120
)

if response.status_code != 200:
    print("Erro:", response.status_code)
    print(response.text)
    raise SystemExit


# ==========================
# 7. GUARDAR NDVI GEOTIFF
# ==========================
output_file = "ndvi_sentinel2_copernicus.tif"

with open(output_file, "wb") as f:
    f.write(response.content)

print(f"NDVI guardado em: {output_file}")