# Sentinel.py — Serviço de Rasters de Satélite

Subscreve um tópico MQTT, gera imagens raster via Copernicus Data Space (Sentinel Hub) e devolve o PNG ao servidor PHP via HTTP callback.

## Tipos de raster suportados

| Tipo | Fonte | Descrição |
|------|-------|-----------|
| `ndvi` | Sentinel-2 L2A | NDVI atual |
| `ndmi` | Sentinel-2 L2A | Humidade vegetativa |
| `lst` | Sentinel-3 SLSTR | Temperatura de superfície (~1 km) |
| `chuva` | Open-Meteo / ERA5 | Precipitação acumulada (mm) |
| `humidade_solo` | Sentinel-1 GRD | Humidade do solo (SAR proxy) |
| `ndvi_anomaly` | Sentinel-2 L2A | NDVI anomalia vs. período de referência |
| `ndvi_diff` | Sentinel-2 L2A | NDVI diferença entre dois períodos |

---

## Pré-requisitos

```bash
# Python 3.8+ e venv
sudo apt-get install -y python3 python3-venv

# Em Debian 10/11 pode ser necessário:
sudo apt-get install -y python3.9-venv
```

---

## Instalação como serviço systemd

```bash
cd ~/soilqi/python
sudo bash install_service.sh
```

O script faz automaticamente:
1. Detecta o Python 3 disponível no sistema
2. Cria ambiente virtual em `python/venv/`
3. Instala as dependências de `requirements.txt`
4. Cria `/etc/systemd/system/sentinel.service`
5. Activa e arranca o serviço

### Opções do instalador

```bash
# Correr como utilizador específico (em vez do SUDO_USER detectado)
sudo bash install_service.sh --user fbnsantos
```

---

## Gestão do serviço

### Ver estado

```bash
sudo systemctl status sentinel
```

### Ver logs em tempo real

```bash
journalctl -u sentinel -f
```

### Ver últimas 100 linhas de log

```bash
journalctl -u sentinel -n 100 --no-pager
```

### Reiniciar (ex: após git pull)

```bash
sudo systemctl restart sentinel
```

### Parar

```bash
sudo systemctl stop sentinel
```

### Desactivar arranque automático

```bash
sudo systemctl disable sentinel
```

### Reactivar arranque automático

```bash
sudo systemctl enable sentinel
```

---

## Actualizar o serviço após git pull

```bash
cd ~/soilqi
git pull
sudo systemctl restart sentinel

# Verificar que arrancou sem erros
journalctl -u sentinel -n 30 --no-pager
```

---

## Configuração

As credenciais são lidas do módulo `soilqi` (dois níveis acima de `python/`), tipicamente em `~/soilqi.py` ou `~/soilqi/__init__.py`:

```python
CLIENT_ID           = "..."   # Copernicus Data Space OAuth client ID
CLIENT_SECRET       = "..."   # Copernicus Data Space OAuth client secret

MQTT_HOST           = "localhost"
MQTT_PORT           = 1883
MQTT_USER           = ""      # deixar vazio se sem autenticação
MQTT_PASS           = ""
MQTT_TOPIC          = "/soilqi/request"

RASTER_CALLBACK_URL = "https://soilqi.com/api/raster_result.php"
RASTER_API_KEY      = "..."   # chave partilhada com o PHP
```

---

## Resolução de problemas

### `python3-venv` em falta

```
The virtual environment was not created successfully because ensurepip is not available.
```

**Solução:**
```bash
sudo apt-get install -y python3-venv
sudo bash install_service.sh
```

### Serviço falha ao arrancar

```bash
# Ver o erro completo
journalctl -u sentinel -n 50 --no-pager

# Testar manualmente (fora do serviço)
cd ~/soilqi/python
./venv/bin/python Sentinel.py
```

### Credenciais não carregadas

```bash
# Ver logs de arranque — mostra CLIENT_ID e MQTT_HOST
journalctl -u sentinel -n 10 --no-pager | grep soilqi
```

### MQTT recusa ligação

Verificar que o broker está activo e a porta está acessível:

```bash
sudo systemctl status mosquitto
nc -zv localhost 1883
```
