#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# install_service.sh — Instala o Sentinel.py como serviço systemd
# Uso: sudo bash install_service.sh [--user UTILIZADOR]
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Configuração ──────────────────────────────────────────────────────────────
SERVICE_NAME="sentinel"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

# Detectar utilizador: argumento --user, ou SUDO_USER, ou utilizador actual
TARGET_USER="${SUDO_USER:-$USER}"
while [[ $# -gt 0 ]]; do
    case "$1" in
        --user) TARGET_USER="$2"; shift 2 ;;
        *)      shift ;;
    esac
done

TARGET_HOME=$(eval echo "~$TARGET_USER")
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PYTHON_SCRIPT="$SCRIPT_DIR/Sentinel.py"
REQUIREMENTS="$SCRIPT_DIR/requirements.txt"

# ── Validações ────────────────────────────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
    echo "❌  Este script precisa de ser corrido com sudo."
    echo "    Uso: sudo bash install_service.sh"
    exit 1
fi

if [[ ! -f "$PYTHON_SCRIPT" ]]; then
    echo "❌  Sentinel.py não encontrado em: $PYTHON_SCRIPT"
    exit 1
fi

echo ""
echo "══════════════════════════════════════════════════"
echo "  Instalador do Sentinel.py como serviço systemd"
echo "══════════════════════════════════════════════════"
echo "  Utilizador : $TARGET_USER"
echo "  Home       : $TARGET_HOME"
echo "  Script     : $PYTHON_SCRIPT"
echo "══════════════════════════════════════════════════"
echo ""

# ── Detectar Python 3 ─────────────────────────────────────────────────────────
PYTHON_BIN=""
for candidate in python3 python3.11 python3.10 python3.9 python3.8; do
    if command -v "$candidate" &>/dev/null; then
        PYTHON_BIN=$(command -v "$candidate")
        break
    fi
done

if [[ -z "$PYTHON_BIN" ]]; then
    echo "❌  Python 3 não encontrado. Instala com: sudo apt install python3"
    exit 1
fi

PYTHON_VERSION=$("$PYTHON_BIN" --version 2>&1)
echo "✅  Python encontrado: $PYTHON_BIN ($PYTHON_VERSION)"

# ── Criar ambiente virtual (venv) ─────────────────────────────────────────────
VENV_DIR="$SCRIPT_DIR/venv"

if [[ ! -d "$VENV_DIR" ]]; then
    echo "⚙️   A criar ambiente virtual em $VENV_DIR …"
    sudo -u "$TARGET_USER" "$PYTHON_BIN" -m venv "$VENV_DIR"
    echo "✅  Ambiente virtual criado."
else
    echo "✅  Ambiente virtual já existe: $VENV_DIR"
fi

VENV_PYTHON="$VENV_DIR/bin/python"
VENV_PIP="$VENV_DIR/bin/pip"

# ── Instalar dependências ──────────────────────────────────────────────────────
if [[ -f "$REQUIREMENTS" ]]; then
    echo "📦  A instalar dependências de $REQUIREMENTS …"
    sudo -u "$TARGET_USER" "$VENV_PIP" install --upgrade pip -q
    sudo -u "$TARGET_USER" "$VENV_PIP" install -r "$REQUIREMENTS" -q
    echo "✅  Dependências instaladas."
else
    echo "⚠️   requirements.txt não encontrado — dependências não instaladas."
fi

# ── Criar ficheiro de serviço systemd ─────────────────────────────────────────
echo "⚙️   A criar $SERVICE_FILE …"

cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=SoilQI Sentinel.py — Geração de rasters de satélite via MQTT
Documentation=https://soilqi.com
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$TARGET_USER
Group=$TARGET_USER
WorkingDirectory=$SCRIPT_DIR

# Usar o Python do ambiente virtual
ExecStart=$VENV_PYTHON $PYTHON_SCRIPT

# Reiniciar automaticamente em caso de falha
Restart=on-failure
RestartSec=10s
StartLimitInterval=120s
StartLimitBurst=5

# Logs via journald (ver com: journalctl -u $SERVICE_NAME -f)
StandardOutput=journal
StandardError=journal
SyslogIdentifier=$SERVICE_NAME

# Variáveis de ambiente (opcional — as credenciais são lidas do módulo soilqi)
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
EOF

echo "✅  Ficheiro de serviço criado: $SERVICE_FILE"

# ── Activar e iniciar o serviço ───────────────────────────────────────────────
echo "⚙️   A recarregar systemd …"
systemctl daemon-reload

echo "⚙️   A activar serviço (arranque automático no boot) …"
systemctl enable "$SERVICE_NAME"

# Parar instância anterior se existir
if systemctl is-active --quiet "$SERVICE_NAME"; then
    echo "⚙️   A parar instância anterior …"
    systemctl stop "$SERVICE_NAME"
fi

echo "🚀  A iniciar $SERVICE_NAME …"
systemctl start "$SERVICE_NAME"

sleep 2

# ── Estado final ──────────────────────────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════════════"
systemctl status "$SERVICE_NAME" --no-pager -l
echo "══════════════════════════════════════════════════"
echo ""
echo "✅  Instalação concluída!"
echo ""
echo "  Comandos úteis:"
echo "  ┌─────────────────────────────────────────────"
echo "  │ Ver logs em tempo real:"
echo "  │   journalctl -u $SERVICE_NAME -f"
echo "  │"
echo "  │ Ver últimas 50 linhas:"
echo "  │   journalctl -u $SERVICE_NAME -n 50 --no-pager"
echo "  │"
echo "  │ Reiniciar serviço:"
echo "  │   sudo systemctl restart $SERVICE_NAME"
echo "  │"
echo "  │ Parar serviço:"
echo "  │   sudo systemctl stop $SERVICE_NAME"
echo "  │"
echo "  │ Desactivar arranque automático:"
echo "  │   sudo systemctl disable $SERVICE_NAME"
echo "  └─────────────────────────────────────────────"
echo ""
