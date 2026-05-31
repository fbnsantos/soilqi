#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# install_service.sh — Instala Sentinel.py e Zonation.py como serviços systemd
# Uso: sudo bash install_service.sh [--user UTILIZADOR]
#
# Nota: a parte do serviço systemd requer um VPS/servidor dedicado com systemd.
# Em hosting partilhado (cPanel/Plesk), corre sem sudo para instalar só as
# dependências Python: bash install_service.sh --deps-only
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail   # sem -e para não sair silenciosamente em erros systemd

# ── Configuração ──────────────────────────────────────────────────────────────
SENTINEL_SERVICE="sentinel"
ZONATION_SERVICE="zonation"
PRESCRIPTION_SERVICE="prescription"

# Detectar utilizador: argumento --user, ou SUDO_USER, ou utilizador actual
TARGET_USER="${SUDO_USER:-$USER}"
DEPS_ONLY=false
while [[ $# -gt 0 ]]; do
    case "$1" in
        --user)       TARGET_USER="$2"; shift 2 ;;
        --deps-only)  DEPS_ONLY=true;   shift ;;
        *)            shift ;;
    esac
done

TARGET_HOME=$(eval echo "~$TARGET_USER")
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SENTINEL_SCRIPT="$SCRIPT_DIR/Sentinel.py"
ZONATION_SCRIPT="$SCRIPT_DIR/Zonation.py"
PRESCRIPTION_SCRIPT="$SCRIPT_DIR/Prescription.py"
REQUIREMENTS="$SCRIPT_DIR/requirements.txt"

# ── Validações ────────────────────────────────────────────────────────────────
if [[ "$DEPS_ONLY" == false && $EUID -ne 0 ]]; then
    echo "❌  Para instalar os serviços systemd este script precisa de sudo."
    echo "    Uso: sudo bash install_service.sh"
    echo ""
    echo "    Para instalar apenas as dependências Python (sem systemd):"
    echo "    bash install_service.sh --deps-only"
    exit 1
fi

if [[ ! -f "$SENTINEL_SCRIPT" && ! -f "$ZONATION_SCRIPT" && ! -f "$PRESCRIPTION_SCRIPT" ]]; then
    echo "❌  Nenhum script Python encontrado em: $SCRIPT_DIR"
    echo "    (Sentinel.py, Zonation.py e/ou Prescription.py devem estar presentes)"
    exit 1
fi

echo ""
echo "══════════════════════════════════════════════════════════"
echo "  Instalador SoilQI — serviços systemd"
echo "══════════════════════════════════════════════════════════"
echo "  Utilizador : $TARGET_USER"
echo "  Home       : $TARGET_HOME"
echo "  Diretório  : $SCRIPT_DIR"
[[ -f "$SENTINEL_SCRIPT"     ]] && echo "  Sentinel     : $SENTINEL_SCRIPT  ✅" \
                                || echo "  Sentinel     : não encontrado    ⚠️"
[[ -f "$ZONATION_SCRIPT"     ]] && echo "  Zonation     : $ZONATION_SCRIPT  ✅" \
                                || echo "  Zonation     : não encontrado    ⚠️"
[[ -f "$PRESCRIPTION_SCRIPT" ]] && echo "  Prescription : $PRESCRIPTION_SCRIPT  ✅" \
                                || echo "  Prescription : não encontrado    ⚠️"
echo "══════════════════════════════════════════════════════════"
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
VENV_PYTHON="$VENV_DIR/bin/python"

VENV_OK=false
if [[ -x "$VENV_PYTHON" ]] && "$VENV_PYTHON" -m pip --version &>/dev/null; then
    VENV_OK=true
fi

if [[ "$VENV_OK" == false ]]; then
    if [[ -d "$VENV_DIR" ]]; then
        echo "⚠️   Ambiente virtual corrompido/incompleto. A recriar …"
        rm -rf "$VENV_DIR"
    else
        echo "⚙️   A criar ambiente virtual em $VENV_DIR …"
    fi
    if [[ "$DEPS_ONLY" == true ]]; then
        "$PYTHON_BIN" -m venv "$VENV_DIR"
    else
        sudo -u "$TARGET_USER" "$PYTHON_BIN" -m venv "$VENV_DIR"
    fi
    echo "✅  Ambiente virtual criado."
else
    echo "✅  Ambiente virtual válido: $VENV_DIR"
fi

# ── Instalar dependências ──────────────────────────────────────────────────────
if [[ -f "$REQUIREMENTS" ]]; then
    echo "📦  A instalar dependências de $REQUIREMENTS …"
    if [[ "$DEPS_ONLY" == true ]]; then
        "$VENV_PYTHON" -m pip install --upgrade pip -q
        "$VENV_PYTHON" -m pip install -r "$REQUIREMENTS" -q
    else
        sudo -u "$TARGET_USER" "$VENV_PYTHON" -m pip install --upgrade pip -q
        sudo -u "$TARGET_USER" "$VENV_PYTHON" -m pip install -r "$REQUIREMENTS" -q
    fi
    echo "✅  Dependências instaladas."
else
    echo "⚠️   requirements.txt não encontrado — dependências não instaladas."
fi

# Em modo --deps-only terminar aqui (sem systemd)
if [[ "$DEPS_ONLY" == true ]]; then
    echo ""
    echo "✅  Dependências Python instaladas com sucesso!"
    echo "   Venv: $VENV_DIR"
    echo "   Para instalar os serviços systemd: sudo bash install_service.sh"
    exit 0
fi

# ── Função para criar um ficheiro de serviço systemd ─────────────────────────
create_service() {
    local SERVICE_NAME="$1"
    local PYTHON_SCRIPT="$2"
    local DESCRIPTION="$3"
    local SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

    echo ""
    echo "──────────────────────────────────────────────────────────"
    echo "  Serviço: $SERVICE_NAME"
    echo "──────────────────────────────────────────────────────────"
    echo "⚙️   A criar $SERVICE_FILE …"

    cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=$DESCRIPTION
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

# Variáveis de ambiente
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
EOF

    echo "✅  Ficheiro de serviço criado: $SERVICE_FILE"

    echo "⚙️   A activar serviço (arranque automático no boot) …"
    systemctl enable "$SERVICE_NAME"

    if systemctl is-active --quiet "$SERVICE_NAME"; then
        echo "⚙️   A parar instância anterior de $SERVICE_NAME …"
        systemctl stop "$SERVICE_NAME"
    fi

    echo "🚀  A iniciar $SERVICE_NAME …"
    systemctl start "$SERVICE_NAME"

    sleep 2

    echo ""
    systemctl status "$SERVICE_NAME" --no-pager -l
}

# ── Recarregar systemd ────────────────────────────────────────────────────────
echo "⚙️   A recarregar systemd …"
systemctl daemon-reload

# ── Instalar Sentinel.py ──────────────────────────────────────────────────────
if [[ -f "$SENTINEL_SCRIPT" ]]; then
    create_service \
        "$SENTINEL_SERVICE" \
        "$SENTINEL_SCRIPT" \
        "SoilQI Sentinel.py — Geração de rasters de satélite via MQTT"
else
    echo "⚠️   Sentinel.py não encontrado — serviço $SENTINEL_SERVICE não instalado."
fi

# ── Instalar Zonation.py ──────────────────────────────────────────────────────
if [[ -f "$ZONATION_SCRIPT" ]]; then
    create_service \
        "$ZONATION_SERVICE" \
        "$ZONATION_SCRIPT" \
        "SoilQI Zonation.py — Geração de mapas de zonagem via MQTT"
else
    echo "⚠️   Zonation.py não encontrado — serviço $ZONATION_SERVICE não instalado."
fi

# ── Instalar Prescription.py ──────────────────────────────────────────────────
if [[ -f "$PRESCRIPTION_SCRIPT" ]]; then
    create_service \
        "$PRESCRIPTION_SERVICE" \
        "$PRESCRIPTION_SCRIPT" \
        "SoilQI Prescription.py — Geração de ShapeFiles VRA via MQTT"
else
    echo "⚠️   Prescription.py não encontrado — serviço $PRESCRIPTION_SERVICE não instalado."
fi

# ── Estado final ──────────────────────────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════════════════════"
echo "✅  Instalação concluída!"
echo ""
echo "  Comandos úteis:"
echo "  ┌─────────────────────────────────────────────────────"
echo "  │ Ver logs em tempo real:"
echo "  │   journalctl -u $SENTINEL_SERVICE -f"
echo "  │   journalctl -u $ZONATION_SERVICE -f"
echo "  │   journalctl -u $PRESCRIPTION_SERVICE -f"
echo "  │"
echo "  │ Reiniciar serviços:"
echo "  │   sudo systemctl restart $SENTINEL_SERVICE $ZONATION_SERVICE $PRESCRIPTION_SERVICE"
echo "  │"
echo "  │ Estado dos serviços:"
echo "  │   sudo systemctl status $SENTINEL_SERVICE $ZONATION_SERVICE $PRESCRIPTION_SERVICE"
echo "  │"
echo "  │ Parar serviços:"
echo "  │   sudo systemctl stop $SENTINEL_SERVICE $ZONATION_SERVICE $PRESCRIPTION_SERVICE"
echo "  │"
echo "  │ Desactivar arranque automático:"
echo "  │   sudo systemctl disable $SENTINEL_SERVICE $ZONATION_SERVICE $PRESCRIPTION_SERVICE"
echo "  └─────────────────────────────────────────────────────"
echo ""
