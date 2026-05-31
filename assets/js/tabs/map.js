/**
 * Map Tab — funções específicas
 * Rasters de satélite, interpolações de campo, camadas GeoJSON, notas, PDF.
 * Carregado antes de app.js; depende do objecto `map` inicializado em app.js.
 */

// ── Estado global ─────────────────────────────────────────────────────────────

let reportTerrainId = null;

// id → L.imageOverlay  /  dados para PDF
// Nomes com prefixo "rpt" para não colidir com variáveis homónimas de app.js
const rptInterpOverlays = {};   // id → L.imageOverlay
const rptInterpData     = {};   // id → {name, png, bounds}

const rptGeoJSONLayers  = {};   // id → L.geoJSON layer
const rptGeoJSONData    = {};   // id → {name}

const mapRasterOverlays = {};   // id → L.imageOverlay  (rasters satélite)
const mapRasterData     = {};   // id → {name, png, bounds, type}

let mapNotesCache = [];         // notas carregadas (para PDF)

// ── Labels de raster ──────────────────────────────────────────────────────────

const MAP_RASTER_LABELS = {
    ndvi:          '🌿 NDVI',
    ndmi:          '💧 NDMI',
    evi:           '🌿 EVI',
    msavi:         '🌿 MSAVI',
    gndvi:         '🌿 GNDVI',
    ndre:          '🌿 NDRE',
    ndwi:          '💧 NDWI',
    nbr:           '🔥 NBR',
    bsi:           '🟤 BSI',
    ndvi_anomaly:  '📊 NDVI Anomalia',
    ndvi_diff:     '📈 NDVI Diferença',
    lst:           '🌡️ LST Temperatura',
    chuva:         '🌧️ Chuva',
    humidade_solo: '🌱 Humidade Solo',
    sar_vv:        '📡 SAR VV',
    sar_vh:        '📡 SAR VH',
    sar_ratio:     '📡 SAR VV/VH',
    sar_rvi:       '📡 SAR RVI',
    sar_agua:      '💧 SAR Água',
    altitude:      '🗻 Altitude',
    declive:       '📐 Declive',
    aspect:        '🧭 Orientação',
};

// ── Selector de terreno (controla todos os layers) ────────────────────────────

function onReportTerrainChange(val) {
    reportTerrainId = val ? parseInt(val) : null;

    const layersDiv = document.getElementById('report-layers');
    const opCtrl    = document.getElementById('opacity-ctrl');

    if (!reportTerrainId) {
        if (layersDiv) layersDiv.style.display = 'none';
        if (opCtrl)    opCtrl.style.display    = 'none';
        return;
    }

    if (layersDiv) layersDiv.style.display = '';
    if (opCtrl)    opCtrl.style.display    = '';

    _loadInterpLayers(reportTerrainId);
    _loadGeoJSONLayers(reportTerrainId);
    _loadRasterLayers(reportTerrainId);
    loadMapNotes(reportTerrainId);
}

// ── Grupos colapsáveis ────────────────────────────────────────────────────────

function toggleLayerGroup(name) {
    const body  = document.getElementById('lg-' + name);
    const arrow = document.getElementById(name + '-arrow');
    if (!body) return;
    const opening = body.style.display === 'none';
    body.style.display = opening ? '' : 'none';
    if (arrow) arrow.textContent = opening ? '▼' : '▶';
}

// ── Opacidade global ──────────────────────────────────────────────────────────

function setGlobalOpacity(val) {
    const lbl = document.getElementById('global-opacity-val');
    if (lbl) lbl.textContent = val + '%';
    const opacity = parseInt(val) / 100;
    Object.values(rptInterpOverlays).forEach(ov => ov.setOpacity(opacity));
    Object.values(mapRasterOverlays).forEach(ov => ov.setOpacity(opacity));
}

// ─────────────────────────────────────────────────────────────────────────────
// LAYERS DE CAMPO — Interpolações
// ─────────────────────────────────────────────────────────────────────────────

function _loadInterpLayers(terrainId) {
    const listEl = document.getElementById('report-interp-list');
    if (listEl) listEl.innerHTML = '<div class="layer-empty">A carregar…</div>';

    const fd = new FormData();
    fd.append('action',     'get_terrain_interpolations');
    fd.append('terrain_id', terrainId || '');

    fetch('index.php?tab=map', { method: 'POST', body: fd })
        .then(r => r.json())
        .then(data => {
            const items = data.interpolations || [];
            _setBadge('interp', items.length);
            _renderInterpList(items);
        })
        .catch(() => {
            if (listEl) listEl.innerHTML = '<div class="layer-empty" style="color:#ef4444;">Erro de rede.</div>';
        });
}

function _renderInterpList(items) {
    const listEl = document.getElementById('report-interp-list');
    if (!listEl) return;
    if (!items.length) {
        listEl.innerHTML = '<div class="layer-empty">Nenhuma interpolação para este terreno.</div>';
        return;
    }
    listEl.innerHTML = items.map(it => {
        const on  = !!rptInterpOverlays[it.id];
        const dt  = new Date(it.created_at).toLocaleDateString('pt-PT');
        return `
        <div class="layer-row" id="interp-row-${it.id}">
            <div class="layer-row-info">
                <div class="layer-row-name" title="${_esc(it.name)}">${_esc(it.name)}</div>
                <div class="layer-row-meta">${_esc(it.param || '')}  ${dt}</div>
            </div>
            <button id="interp-btn-${it.id}"
                    onclick="toggleInterpOnMap(${it.id})"
                    class="layer-toggle-btn ${on ? 'layer-toggle-on' : 'layer-toggle-off'}">
                ${on ? '✅ ON' : '👁 Ver'}
            </button>
        </div>`;
    }).join('');
}

function toggleInterpOnMap(id) {
    rptInterpOverlays[id] ? _hideInterpOnMap(id) : _showInterpOnMap(id);
}

function _showInterpOnMap(id) {
    const btn = document.getElementById('interp-btn-' + id);
    if (btn) { btn.textContent = '⏳'; btn.disabled = true; }

    const fd = new FormData();
    fd.append('action', 'get_interpolation_png');
    fd.append('id', id);

    fetch('index.php?tab=map', { method: 'POST', body: fd })
        .then(r => r.json())
        .then(data => {
            if (btn) btn.disabled = false;
            if (!data.success) {
                _showAlert('❌ ' + (data.message || 'Erro ao carregar interpolação.'), 'error');
                if (btn) { btn.textContent = '👁 Ver'; btn.className = 'layer-toggle-btn layer-toggle-off'; }
                return;
            }
            const opacity = _globalOpacity();
            const bounds  = [[data.min_lat, data.min_lng], [data.max_lat, data.max_lng]];
            const overlay = L.imageOverlay(data.png, bounds, { opacity, zIndex: 350 }).addTo(map);
            rptInterpOverlays[id] = overlay;
            rptInterpData[id]     = { name: data.name, png: data.png, bounds };
            map.fitBounds(bounds, { padding: [30, 30] });
            if (btn) { btn.textContent = '✅ ON'; btn.className = 'layer-toggle-btn layer-toggle-on'; }
        })
        .catch(() => {
            if (btn) { btn.textContent = '👁 Ver'; btn.disabled = false; btn.className = 'layer-toggle-btn layer-toggle-off'; }
            _showAlert('Erro de rede ao carregar interpolação.', 'error');
        });
}

function _hideInterpOnMap(id) {
    const ov = rptInterpOverlays[id];
    if (ov) { map.removeLayer(ov); delete rptInterpOverlays[id]; }
    delete rptInterpData[id];
    const btn = document.getElementById('interp-btn-' + id);
    if (btn) { btn.textContent = '👁 Ver'; btn.className = 'layer-toggle-btn layer-toggle-off'; }
}

// ─────────────────────────────────────────────────────────────────────────────
// CAMADAS GEOJSON
// ─────────────────────────────────────────────────────────────────────────────

function _loadGeoJSONLayers(terrainId) {
    const listEl = document.getElementById('report-geojson-list');
    if (listEl) listEl.innerHTML = '<div class="layer-empty">A carregar…</div>';

    const fd = new FormData();
    fd.append('action',     'get_geojson_layers');
    fd.append('terrain_id', terrainId || '');

    fetch('index.php?tab=map', { method: 'POST', body: fd })
        .then(r => r.json())
        .then(data => {
            const items = data.layers || [];
            _setBadge('geojson', items.length);
            _renderGeoJSONList(items);
        })
        .catch(() => {
            if (listEl) listEl.innerHTML = '<div class="layer-empty" style="color:#ef4444;">Erro de rede.</div>';
        });
}

function _renderGeoJSONList(items) {
    const listEl = document.getElementById('report-geojson-list');
    if (!listEl) return;
    if (!items.length) {
        listEl.innerHTML = '<div class="layer-empty">Nenhuma camada GeoJSON para este terreno.</div>';
        return;
    }
    listEl.innerHTML = items.map(it => {
        const on   = !!rptGeoJSONLayers[it.id];
        const dt   = new Date(it.created_at).toLocaleDateString('pt-PT');
        const feat = it.feature_count ? it.feature_count + ' feat.' : '';
        return `
        <div class="layer-row" id="geojson-row-${it.id}">
            <div class="layer-row-info">
                <div class="layer-row-name" title="${_esc(it.name)}">${_esc(it.name)}</div>
                <div class="layer-row-meta">${feat}  ${dt}</div>
            </div>
            <button id="geojson-btn-${it.id}"
                    onclick="toggleGeoJSONOnMap(${it.id})"
                    class="layer-toggle-btn ${on ? 'layer-toggle-on' : 'layer-toggle-off'}">
                ${on ? '✅ ON' : '👁 Ver'}
            </button>
        </div>`;
    }).join('');
}

function toggleGeoJSONOnMap(id) {
    rptGeoJSONLayers[id] ? _hideGeoJSONOnMap(id) : _showGeoJSONOnMap(id);
}

function _showGeoJSONOnMap(id) {
    const btn = document.getElementById('geojson-btn-' + id);
    if (btn) { btn.textContent = '⏳'; btn.disabled = true; }

    const fd = new FormData();
    fd.append('action', 'get_geojson_data');
    fd.append('id', id);

    fetch('index.php?tab=map', { method: 'POST', body: fd })
        .then(r => r.json())
        .then(data => {
            if (btn) btn.disabled = false;
            if (!data.success) {
                _showAlert('❌ ' + (data.message || 'Erro ao carregar GeoJSON.'), 'error');
                if (btn) { btn.textContent = '👁 Ver'; btn.className = 'layer-toggle-btn layer-toggle-off'; }
                return;
            }
            let gj;
            try { gj = typeof data.geojson === 'string' ? JSON.parse(data.geojson) : data.geojson; }
            catch (e) {
                _showAlert('❌ GeoJSON inválido.', 'error');
                if (btn) { btn.textContent = '👁 Ver'; btn.className = 'layer-toggle-btn layer-toggle-off'; }
                return;
            }
            const layer = L.geoJSON(gj, {
                style: { color: '#667eea', weight: 2.5, fillOpacity: 0.12, fillColor: '#667eea' },
                pointToLayer: (f, ll) => L.circleMarker(ll, {
                    radius: 6, fillColor: '#667eea', color: '#fff', weight: 1.5, fillOpacity: 0.85
                }),
                onEachFeature: (f, layer) => {
                    if (f.properties && Object.keys(f.properties).length) {
                        const props = Object.entries(f.properties)
                            .filter(([,v]) => v !== null && v !== undefined)
                            .map(([k,v]) => `<b>${k}:</b> ${v}`)
                            .join('<br>');
                        if (props) layer.bindPopup(props);
                    }
                }
            }).addTo(map);
            rptGeoJSONLayers[id] = layer;
            rptGeoJSONData[id]   = { name: data.name };
            try { map.fitBounds(layer.getBounds(), { padding: [30, 30] }); } catch(e) {}
            if (btn) { btn.textContent = '✅ ON'; btn.className = 'layer-toggle-btn layer-toggle-on'; }
        })
        .catch(() => {
            if (btn) { btn.textContent = '👁 Ver'; btn.disabled = false; btn.className = 'layer-toggle-btn layer-toggle-off'; }
            _showAlert('Erro de rede ao carregar GeoJSON.', 'error');
        });
}

function _hideGeoJSONOnMap(id) {
    const layer = rptGeoJSONLayers[id];
    if (layer) { map.removeLayer(layer); delete rptGeoJSONLayers[id]; }
    delete rptGeoJSONData[id];
    const btn = document.getElementById('geojson-btn-' + id);
    if (btn) { btn.textContent = '👁 Ver'; btn.className = 'layer-toggle-btn layer-toggle-off'; }
}

// ─────────────────────────────────────────────────────────────────────────────
// RASTERS DE SATÉLITE
// ─────────────────────────────────────────────────────────────────────────────

function _loadRasterLayers(terrainId) {
    const listEl = document.getElementById('report-raster-list');
    if (listEl) listEl.innerHTML = '<div class="layer-empty">A carregar…</div>';

    const fd = new FormData();
    fd.append('action',     'get_raster_layers');
    fd.append('terrain_id', terrainId || '');

    fetch('index.php?tab=map', { method: 'POST', body: fd })
        .then(r => r.json())
        .then(data => {
            const items = data.rasters || [];
            _setBadge('raster', items.length);
            _renderRasterList(items);
        })
        .catch(() => {
            if (listEl) listEl.innerHTML = '<div class="layer-empty" style="color:#ef4444;">Erro de rede.</div>';
        });
}

function _renderRasterList(items) {
    const listEl = document.getElementById('report-raster-list');
    if (!listEl) return;
    if (!items.length) {
        listEl.innerHTML = `
            <div class="layer-empty">
                Nenhum raster para este terreno.<br>
                Gere um em <strong>📊 Medições</strong>.
            </div>`;
        return;
    }
    listEl.innerHTML = items.map(r => {
        const label     = MAP_RASTER_LABELS[r.raster_type] || r.raster_type;
        const dt        = new Date(r.created_at).toLocaleDateString('pt-PT');
        const dateRange = r.date_from ? r.date_from + ' → ' + r.date_to : '';
        const on        = !!mapRasterOverlays[r.id];
        return `
        <div class="layer-row" id="raster-row-${r.id}">
            <div class="layer-row-info">
                <div class="layer-row-name" title="${_esc(r.name)}">${label}</div>
                <div class="layer-row-meta">${dateRange}  ${dt}</div>
            </div>
            <button id="raster-btn-${r.id}"
                    onclick="toggleRasterOnMap(${r.id})"
                    class="layer-toggle-btn ${on ? 'layer-toggle-on' : 'layer-toggle-off'}">
                ${on ? '🛰️ ON' : '👁 Ver'}
            </button>
        </div>`;
    }).join('');
}

function toggleRasterOnMap(id) {
    mapRasterOverlays[id] ? _hideRasterOnMap(id) : _showRasterOnMap(id);
}

function _showRasterOnMap(id) {
    const btn = document.getElementById('raster-btn-' + id);
    if (btn) { btn.textContent = '⏳'; btn.disabled = true; }

    const fd = new FormData();
    fd.append('action', 'get_raster_png');
    fd.append('id', id);

    fetch('index.php?tab=map', { method: 'POST', body: fd })
        .then(r => r.json())
        .then(data => {
            if (btn) btn.disabled = false;
            if (!data.success) {
                _showAlert('❌ ' + (data.message || 'Erro ao carregar raster.'), 'error');
                if (btn) { btn.textContent = '👁 Ver'; btn.className = 'layer-toggle-btn layer-toggle-off'; }
                return;
            }
            const opacity = _globalOpacity();
            const bounds  = [[data.min_lat, data.min_lng], [data.max_lat, data.max_lng]];
            const overlay = L.imageOverlay(data.png, bounds, { opacity, zIndex: 400 }).addTo(map);
            mapRasterOverlays[id] = overlay;
            // Guardar PNG para gerar PDF sem nova chamada ao servidor
            mapRasterData[id] = {
                name:   data.name,
                png:    data.png,
                bounds: bounds,
                type:   data.raster_type
            };
            map.fitBounds(bounds, { padding: [40, 40] });
            if (btn) { btn.textContent = '🛰️ ON'; btn.className = 'layer-toggle-btn layer-toggle-on'; }
        })
        .catch(() => {
            if (btn) { btn.textContent = '👁 Ver'; btn.disabled = false; btn.className = 'layer-toggle-btn layer-toggle-off'; }
            _showAlert('Erro de rede ao carregar raster.', 'error');
        });
}

function _hideRasterOnMap(id) {
    const ov = mapRasterOverlays[id];
    if (ov) { map.removeLayer(ov); delete mapRasterOverlays[id]; }
    delete mapRasterData[id];
    const btn = document.getElementById('raster-btn-' + id);
    if (btn) { btn.textContent = '👁 Ver'; btn.className = 'layer-toggle-btn layer-toggle-off'; }
}

// ─────────────────────────────────────────────────────────────────────────────
// LISTA DE TERRENOS (grupo "Meus Terrenos")
// ─────────────────────────────────────────────────────────────────────────────

function _loadTerrainList() {
    const listEl = document.getElementById('terrain-list');
    if (!listEl) return;
    listEl.innerHTML = '<div class="layer-empty">A carregar…</div>';

    const fd = new FormData();
    fd.append('action', 'get_terrains');

    fetch('index.php?tab=map', { method: 'POST', body: fd })
        .then(r => r.json())
        .then(data => {
            const terrains = data.terrains || [];
            if (!terrains.length) {
                listEl.innerHTML = '<div class="layer-empty">Nenhum terreno guardado.</div>';
                return;
            }
            listEl.innerHTML = terrains.map(t => {
                const area = t.area ? ' · ' + parseFloat(t.area).toFixed(2) + ' ha' : '';
                return `
                <div class="layer-row" style="cursor:pointer;" onclick="zoomToTerrain(${t.id})">
                    <div class="layer-row-info">
                        <div class="layer-row-name">📍 ${_esc(t.name)}</div>
                        <div class="layer-row-meta">${area}</div>
                    </div>
                    <button class="layer-toggle-btn layer-toggle-off"
                            onclick="event.stopPropagation(); _deleteTerrainFromList(${t.id})"
                            title="Eliminar terreno"
                            style="color:#ef4444; background:#fff0f0;">🗑</button>
                </div>`;
            }).join('');
        })
        .catch(() => {
            if (listEl) listEl.innerHTML = '<div class="layer-empty" style="color:#ef4444;">Erro de rede.</div>';
        });
}

function zoomToTerrain(id) {
    const fd = new FormData();
    fd.append('action',     'get_terrain');
    fd.append('terrain_id', id);
    fetch('index.php?tab=map', { method: 'POST', body: fd })
        .then(r => r.json())
        .then(data => {
            if (!data.success || !data.terrain) return;
            try {
                const coords  = JSON.parse(data.terrain.coordinates);
                const latlngs = coords.map(c => [c.lat, c.lng]);
                if (latlngs.length) map.fitBounds(L.latLngBounds(latlngs), { padding: [40, 40] });
            } catch (e) { /* coordenadas inválidas */ }
        })
        .catch(() => {});
}

function _deleteTerrainFromList(id) {
    if (!confirm('Eliminar este terreno? Esta acção é irreversível.')) return;
    const fd = new FormData();
    fd.append('action',     'delete_terrain');
    fd.append('terrain_id', id);
    fetch('index.php?tab=map', { method: 'POST', body: fd })
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                _loadTerrainList();
                // Actualizar também o select principal
                const sel = document.getElementById('report-terrain');
                const opt = sel ? sel.querySelector(`option[value="${id}"]`) : null;
                if (opt) opt.remove();
                if (sel && parseInt(sel.value) === id) {
                    sel.value = '';
                    onReportTerrainChange('');
                }
            } else {
                _showAlert('❌ ' + (data.message || 'Erro ao eliminar.'), 'error');
            }
        })
        .catch(() => { _showAlert('Erro de rede.', 'error'); });
}

// ─────────────────────────────────────────────────────────────────────────────
// NOTAS
// ─────────────────────────────────────────────────────────────────────────────

function saveMapNote() {
    const contentEl = document.getElementById('note-content');
    const content   = (contentEl ? contentEl.value : '').trim();
    if (!content) {
        _showAlert('Escreva uma nota antes de guardar.', 'warning');
        return;
    }
    const fd = new FormData();
    fd.append('action',     'save_map_note');
    fd.append('content',    content);
    fd.append('terrain_id', reportTerrainId || '');

    fetch('index.php?tab=map', { method: 'POST', body: fd })
        .then(r => r.json())
        .then(data => {
            if (!data.success) {
                _showAlert('❌ ' + (data.message || 'Erro ao guardar nota.'), 'error');
                return;
            }
            if (contentEl) contentEl.value = '';
            mapNotesCache.unshift({ id: data.id, content, created_at: data.created_at });
            _renderNotesList(mapNotesCache);
            _showAlert('✅ Nota guardada!', 'success');
        })
        .catch(() => { _showAlert('Erro de rede ao guardar nota.', 'error'); });
}

function loadMapNotes(terrainId) {
    const listEl = document.getElementById('notes-list');
    if (listEl) listEl.innerHTML =
        '<div style="text-align:center;padding:10px;color:#9ca3af;font-size:13px;">A carregar…</div>';

    const fd = new FormData();
    fd.append('action',     'get_map_notes');
    fd.append('terrain_id', terrainId || '');

    fetch('index.php?tab=map', { method: 'POST', body: fd })
        .then(r => r.json())
        .then(data => {
            mapNotesCache = data.notes || [];
            _renderNotesList(mapNotesCache);
        })
        .catch(() => {
            if (listEl) listEl.innerHTML =
                '<div style="color:#ef4444;font-size:13px;">Erro ao carregar notas.</div>';
        });
}

function deleteMapNote(id) {
    if (!confirm('Eliminar esta nota?')) return;
    const fd = new FormData();
    fd.append('action',  'delete_map_note');
    fd.append('note_id', id);

    fetch('index.php?tab=map', { method: 'POST', body: fd })
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                mapNotesCache = mapNotesCache.filter(n => n.id !== id);
                _renderNotesList(mapNotesCache);
            } else {
                _showAlert('❌ ' + (data.message || 'Erro ao eliminar nota.'), 'error');
            }
        })
        .catch(() => { _showAlert('Erro de rede.', 'error'); });
}

function _renderNotesList(notes) {
    const listEl = document.getElementById('notes-list');
    if (!listEl) return;
    if (!notes.length) {
        listEl.innerHTML =
            '<div style="text-align:center;padding:10px;color:#9ca3af;font-size:13px;">Nenhuma nota guardada.</div>';
        return;
    }
    listEl.innerHTML = notes.map(n => {
        const dt = new Date(n.created_at).toLocaleString('pt-PT');
        return `
        <div class="note-item" id="note-item-${n.id}">
            <div class="note-item-text">${_esc(n.content)}</div>
            <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0;">
                <span class="note-item-date">${dt}</span>
                <button class="note-delete-btn" onclick="deleteMapNote(${n.id})" title="Eliminar">🗑</button>
            </div>
        </div>`;
    }).join('');
}

// ─────────────────────────────────────────────────────────────────────────────
// GERAR RELATÓRIO PDF (jsPDF)
// ─────────────────────────────────────────────────────────────────────────────

function generateMapReport() {
    if (typeof window.jspdf === 'undefined') {
        _showAlert('⏳ jsPDF ainda a carregar, aguarde e tente de novo.', 'warning');
        return;
    }
    const { jsPDF } = window.jspdf;

    // Nome do terreno seleccionado
    const sel         = document.getElementById('report-terrain');
    const terrainName = (sel && sel.selectedIndex > 0)
        ? sel.options[sel.selectedIndex].text.trim()
        : 'Todos os terrenos';

    const now   = new Date();
    const dtStr = now.toLocaleString('pt-PT');

    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const PW = 210, PH = 297, M = 18;
    const CW = PW - 2 * M;   // largura útil do conteúdo

    // ── Página 1: Resumo ──────────────────────────────────────────────────────

    // Cabeçalho colorido
    doc.setFillColor(102, 126, 234);
    doc.rect(0, 0, PW, 24, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(15); doc.setFont('helvetica', 'bold');
    doc.text('SoilQI — Relatório de Terreno', M, 10);
    doc.setFontSize(9); doc.setFont('helvetica', 'normal');
    doc.text('soilqi.com', PW - M, 10, { align: 'right' });

    // Metadados
    doc.setTextColor(80, 80, 80); doc.setFontSize(10); doc.setFont('helvetica', 'normal');
    let y = 34;
    doc.setFont('helvetica', 'bold');   doc.text('Terreno:', M, y);
    doc.setFont('helvetica', 'normal'); doc.text(terrainName, M + 24, y); y += 6;
    doc.setFont('helvetica', 'bold');   doc.text('Data:', M, y);
    doc.setFont('helvetica', 'normal'); doc.text(dtStr, M + 24, y); y += 12;

    // Lista de layers activos
    doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.setTextColor(31, 41, 55);
    doc.text('Layers activos:', M, y); y += 7;
    doc.setFontSize(10); doc.setFont('helvetica', 'normal'); doc.setTextColor(55, 65, 81);

    const allLayers = [
        ...Object.entries(rptInterpData).map(([, d]) => '🎨 ' + d.name),
        ...Object.entries(rptGeoJSONData).map(([, d]) => '🗺️ ' + d.name),
        ...Object.entries(mapRasterData).map(([, d]) =>
            (MAP_RASTER_LABELS[d.type] || d.type) + ' — ' + d.name),
    ];

    if (allLayers.length === 0) {
        doc.setTextColor(156, 163, 175);
        doc.text('(nenhum layer activo no mapa)', M + 4, y); y += 7;
        doc.setTextColor(55, 65, 81);
    } else {
        allLayers.forEach(txt => {
            if (y > PH - M) { doc.addPage(); y = M; }
            doc.text('• ' + txt, M + 4, y); y += 6;
        });
    }
    y += 6;

    // Notas
    doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.setTextColor(31, 41, 55);
    doc.text('Notas:', M, y); y += 7;
    doc.setFontSize(10); doc.setFont('helvetica', 'normal'); doc.setTextColor(55, 65, 81);

    if (!mapNotesCache.length) {
        doc.setTextColor(156, 163, 175);
        doc.text('(sem notas guardadas)', M + 4, y); y += 7;
    } else {
        mapNotesCache.forEach(n => {
            const noteDt  = new Date(n.created_at).toLocaleString('pt-PT');
            const lines   = doc.splitTextToSize(n.content, CW - 8);
            const needed  = 5 + lines.length * 5 + 6;
            if (y + needed > PH - M) { doc.addPage(); y = M; }
            // Data da nota em cinzento
            doc.setFontSize(8); doc.setTextColor(156, 163, 175);
            doc.text(noteDt, M + 4, y); y += 5;
            // Conteúdo
            doc.setFontSize(10); doc.setTextColor(55, 65, 81);
            lines.forEach(line => {
                if (y > PH - M) { doc.addPage(); y = M; }
                doc.text(line, M + 4, y); y += 5;
            });
            y += 4;
        });
    }

    // Rodapé da página 1
    doc.setFontSize(8); doc.setTextColor(156, 163, 175);
    doc.text('Gerado por SoilQI · ' + dtStr, M, PH - 8);

    // ── Páginas seguintes: imagens de raster ─────────────────────────────────

    Object.entries(mapRasterData).forEach(([, d]) => {
        doc.addPage();
        // Mini-cabeçalho
        doc.setFillColor(102, 126, 234);
        doc.rect(0, 0, PW, 16, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(12); doc.setFont('helvetica', 'bold');
        const typeLabel = MAP_RASTER_LABELS[d.type] || d.type;
        doc.text(typeLabel, M, 11);

        doc.setFontSize(8); doc.setFont('helvetica', 'normal');
        doc.setTextColor(80, 80, 80);
        doc.text(d.name, M, 22);

        // Imagem — proporção aproximada do bbox
        const imgH = Math.min(180, CW * 0.80);
        try {
            doc.addImage(d.png, 'PNG', M, 27, CW, imgH);
        } catch (imgErr) {
            doc.setTextColor(239, 68, 68); doc.setFontSize(10);
            doc.text('Imagem não disponível.', M, 50);
        }
        // Rodapé
        doc.setFontSize(8); doc.setTextColor(156, 163, 175);
        doc.text('SoilQI · ' + dtStr, M, PH - 8);
    });

    // ── Páginas: interpolações de campo ──────────────────────────────────────

    Object.entries(rptInterpData).forEach(([, d]) => {
        doc.addPage();
        doc.setFillColor(52, 211, 153);
        doc.rect(0, 0, PW, 16, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(12); doc.setFont('helvetica', 'bold');
        doc.text('🎨 ' + d.name, M, 11);

        const imgH = Math.min(180, CW * 0.80);
        try {
            doc.addImage(d.png, 'PNG', M, 24, CW, imgH);
        } catch (imgErr) {
            doc.setTextColor(239, 68, 68); doc.setFontSize(10);
            doc.text('Imagem não disponível.', M, 50);
        }
        doc.setFontSize(8); doc.setTextColor(156, 163, 175);
        doc.text('SoilQI · ' + dtStr, M, PH - 8);
    });

    // ── Guardar ───────────────────────────────────────────────────────────────
    const safeName = terrainName.replace(/[^a-zA-Z0-9_\-]/g, '_').toLowerCase();
    doc.save('soilqi_relatorio_' + safeName + '_' + now.toISOString().slice(0, 10) + '.pdf');
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILITÁRIOS
// ─────────────────────────────────────────────────────────────────────────────

function _esc(s) {
    return String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Opacidade actual do slider global (0..1). */
function _globalOpacity() {
    return parseInt(document.getElementById('global-opacity')?.value || 80) / 100;
}

/** Atalho para showAlert (definida em app.js) com fallback seguro. */
function _showAlert(msg, type) {
    if (typeof showAlert === 'function') showAlert(msg, type);
    else console.warn('[map.js]', msg);
}

function _setBadge(name, count) {
    const badge = document.getElementById(name + '-badge');
    if (!badge) return;
    badge.textContent = count;
    badge.className   = count > 0 ? 'layer-badge has-items' : 'layer-badge';
}

// ─────────────────────────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    // Carregar notas (todos os terrenos) na carga inicial da página
    loadMapNotes(null);
    // Pré-carregar lista de terrenos (visível após expandir grupo)
    _loadTerrainList();
});
