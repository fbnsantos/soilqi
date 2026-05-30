/**
 * Map Tab — funções específicas (rasters de satélite)
 * Carregado antes de app.js; depende do objecto `map` inicializado em app.js.
 */

// id (int) → L.imageOverlay actualmente visível no mapa
const mapRasterOverlays = {};

const MAP_RASTER_LABELS = {
    ndvi:          '🌿 NDVI Atual',
    ndvi_anomaly:  '📊 NDVI Anomalia',
    ndvi_diff:     '📈 NDVI Diferença',
    ndmi:          '💧 NDMI Humidade',
    lst:           '🌡️ LST Temperatura',
    chuva:         '🌧️ Chuva / Precipitação',
    humidade_solo: '🌱 Humidade do Solo',
};

// ── Carregar lista ────────────────────────────────────────────────────────────

function loadMapRasterLayers(terrainId) {
    const listEl = document.getElementById('map-raster-list');
    if (!listEl) return;
    listEl.innerHTML = '<div style="text-align:center;padding:10px;color:#9ca3af;">A carregar…</div>';

    const fd = new FormData();
    fd.append('action',     'get_raster_layers');
    fd.append('terrain_id', terrainId || '');

    fetch('index.php?tab=map', { method: 'POST', body: fd })
        .then(r => r.json())
        .then(data => {
            if (!data.success) {
                listEl.innerHTML = `<div style="color:#ef4444;font-size:12px;">❌ ${data.message || 'Erro'}</div>`;
                return;
            }
            _renderMapRasterList(data.rasters || []);
        })
        .catch(() => {
            listEl.innerHTML = '<div style="color:#ef4444;font-size:12px;">❌ Erro de rede.</div>';
        });
}

function _renderMapRasterList(rasters) {
    const listEl = document.getElementById('map-raster-list');
    if (!listEl) return;

    if (!rasters.length) {
        listEl.innerHTML = `
            <div style="text-align:center;padding:16px;color:#9ca3af;font-size:12px;">
                Nenhum raster disponível para este terreno.<br>
                Gere um no separador <strong>📊 Medições de Campo</strong>.
            </div>`;
        return;
    }

    listEl.innerHTML = rasters.map(r => {
        const label   = MAP_RASTER_LABELS[r.raster_type] || r.raster_type;
        const dt      = new Date(r.created_at).toLocaleDateString('pt-PT');
        const visible = !!mapRasterOverlays[r.id];
        const terrain = r.terrain_name ? `<span style="color:#0ea5e9;font-size:10px;">📍 ${_esc(r.terrain_name)}</span><br>` : '';

        return `
            <div style="display:flex;align-items:center;gap:8px;padding:7px 0;
                        border-bottom:1px solid #f1f5f9;font-size:12px;" id="raster-row-${r.id}">
                <div style="flex:1;min-width:0;">
                    ${terrain}
                    <div style="font-weight:600;color:#1f2937;white-space:nowrap;
                                overflow:hidden;text-overflow:ellipsis;" title="${_esc(r.name)}">
                        ${label}
                    </div>
                    <div style="font-size:10px;color:#9ca3af;">
                        ${r.date_from ? r.date_from + ' → ' + r.date_to : ''}  ${dt}
                    </div>
                </div>
                <button id="raster-map-btn-${r.id}"
                        onclick="toggleRasterOnMap(${r.id})"
                        class="btn btn-sm ${visible ? 'btn-primary' : 'btn-secondary'}"
                        style="font-size:11px;padding:3px 8px;white-space:nowrap;">
                    ${visible ? '🛰️ Visível' : '👁️ Mostrar'}
                </button>
            </div>`;
    }).join('');
}

// ── Mostrar / ocultar no mapa ────────────────────────────────────────────────

function toggleRasterOnMap(id) {
    if (mapRasterOverlays[id]) {
        _hideRasterOnMap(id);
    } else {
        _showRasterOnMap(id);
    }
}

function _showRasterOnMap(id) {
    const btn = document.getElementById(`raster-map-btn-${id}`);
    if (btn) { btn.textContent = '⏳'; btn.disabled = true; }

    const fd = new FormData();
    fd.append('action', 'get_raster_png');
    fd.append('id',     id);

    fetch('index.php?tab=map', { method: 'POST', body: fd })
        .then(r => r.json())
        .then(data => {
            if (btn) btn.disabled = false;
            if (!data.success) {
                showAlert('❌ ' + (data.message || 'Erro ao carregar raster.'), 'error');
                if (btn) { btn.textContent = '👁️ Mostrar'; btn.className = 'btn btn-sm btn-secondary'; }
                return;
            }

            const opacity = (parseInt(document.getElementById('map-raster-opacity')?.value || 80) / 100);
            const bounds  = [[data.min_lat, data.min_lng], [data.max_lat, data.max_lng]];
            const overlay = L.imageOverlay(data.png, bounds, { opacity, zIndex: 400 }).addTo(map);

            mapRasterOverlays[id] = overlay;

            // Adicionar ao control de layers se disponível
            if (typeof mapLayersControl !== 'undefined' && mapLayersControl) {
                mapLayersControl.addOverlay(overlay, `🛰️ ${data.name}`);
            }

            map.fitBounds(bounds, { padding: [40, 40] });

            if (btn) {
                btn.textContent        = '🛰️ Visível';
                btn.className          = 'btn btn-sm btn-primary';
            }
        })
        .catch(() => {
            if (btn) { btn.textContent = '👁️ Mostrar'; btn.disabled = false; btn.className = 'btn btn-sm btn-secondary'; }
            showAlert('Erro de rede ao carregar raster.', 'error');
        });
}

function _hideRasterOnMap(id) {
    const overlay = mapRasterOverlays[id];
    if (overlay) {
        map.removeLayer(overlay);
        if (typeof mapLayersControl !== 'undefined' && mapLayersControl) {
            mapLayersControl.removeLayer(overlay);
        }
        delete mapRasterOverlays[id];
    }
    const btn = document.getElementById(`raster-map-btn-${id}`);
    if (btn) {
        btn.textContent = '👁️ Mostrar';
        btn.className   = 'btn btn-sm btn-secondary';
    }
}

// ── Opacidade global ─────────────────────────────────────────────────────────

function setMapRasterOpacity(val) {
    const opEl = document.getElementById('map-raster-opacity-val');
    if (opEl) opEl.textContent = val + '%';
    const opacity = parseInt(val) / 100;
    Object.values(mapRasterOverlays).forEach(ov => ov.setOpacity(opacity));
}

// ── Util ─────────────────────────────────────────────────────────────────────

function _esc(s) {
    return String(s)
        .replace(/&/g,'&amp;').replace(/</g,'&lt;')
        .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
