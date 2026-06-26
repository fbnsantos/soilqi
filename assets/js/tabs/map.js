/**
 * Map Tab — funções específicas
 * Rasters de satélite, interpolações de campo, camadas GeoJSON, notas, PDF.
 * Carregado antes de app.js; depende do objecto `map` inicializado em app.js.
 */

// ── Estado global ─────────────────────────────────────────────────────────────

let reportTerrainId = null;

// Cache de camadas do terreno actual (partilhada com painel de zonagem)
let _currentTerrainRasters = [];   // rasters de satélite
let _currentTerrainInterps = [];   // interpolações de campo

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
        _loadPosLayers(null);
        return;
    }

    if (layersDiv) layersDiv.style.display = '';
    if (opCtrl)    opCtrl.style.display    = '';

    _loadInterpLayers(reportTerrainId);
    _loadGeoJSONLayers(reportTerrainId);
    _loadPosLayers(reportTerrainId);
    _loadRasterLayers(reportTerrainId);
    loadMapNotes(reportTerrainId);
    loadZonationHistory(reportTerrainId);
    loadPrescriptionZonations(reportTerrainId);
    loadPrescriptionHistory(reportTerrainId);
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
    Object.values(zonationOverlays).forEach(ov => ov.setOpacity(opacity));
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
            _currentTerrainInterps = items;       // actualizar cache para zonagem
            _setBadge('interp', items.length);
            _renderInterpList(items);
            _refreshZonationLayerList();           // rerender com interps incluídas
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
            <a href="api/interpolation_download_png.php?id=${it.id}"
               download title="Download PNG + georeferenciação (.pgw)"
               class="layer-toggle-btn layer-toggle-off"
               style="text-decoration:none;font-size:10px;padding:3px 6px;">⬇</a>
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
// GNSS / .pos LAYERS
// ─────────────────────────────────────────────────────────────────────────────

const rptPosLayers = {};  // id → L.geoJSON layer
const rptPosData   = {};  // id → {name}

function _loadPosLayers(terrainId) {
    const listEl = document.getElementById('report-pos-list');
    if (listEl) listEl.innerHTML = '<div class="layer-empty">A carregar…</div>';

    const fd = new FormData();
    fd.append('action',     'get_pos_layers');
    fd.append('terrain_id', terrainId || '');

    fetch('index.php?tab=map', { method: 'POST', body: fd })
        .then(r => r.json())
        .then(data => {
            const items = data.layers || [];
            _setBadge('pos', items.length);
            _renderPosList(items);
        })
        .catch(() => {
            if (listEl) listEl.innerHTML = '<div class="layer-empty" style="color:#ef4444;">Erro de rede.</div>';
        });
}

function _renderPosList(items) {
    const listEl = document.getElementById('report-pos-list');
    if (!listEl) return;
    if (!items.length) {
        listEl.innerHTML = '<div class="layer-empty">Nenhuma trajectória GNSS.</div>';
        return;
    }
    listEl.innerHTML = items.map(it => {
        const on  = !!rptPosLayers[it.id];
        const dt  = new Date(it.created_at).toLocaleDateString('pt-PT');
        const pts = it.feature_count ? it.feature_count + ' pts' : '';
        return `
        <div class="layer-row" id="pos-row-${it.id}">
            <div class="layer-row-info">
                <div class="layer-row-name" title="${_esc(it.name)}">${_esc(it.name)}</div>
                <div class="layer-row-meta">${pts}  ${dt}${it.terrain_name ? '  · ' + _esc(it.terrain_name) : ''}</div>
            </div>
            <button id="pos-btn-${it.id}"
                    onclick="togglePosOnMap(${it.id})"
                    class="layer-toggle-btn ${on ? 'layer-toggle-on' : 'layer-toggle-off'}">
                ${on ? '✅ ON' : '👁 Ver'}
            </button>
        </div>`;
    }).join('');
}

function togglePosOnMap(id) {
    rptPosLayers[id] ? _hidePosOnMap(id) : _showPosOnMap(id);
}

function _showPosOnMap(id) {
    const btn = document.getElementById('pos-btn-' + id);
    if (btn) { btn.textContent = '⏳'; btn.disabled = true; }

    const fd = new FormData();
    fd.append('action', 'get_geojson_data');
    fd.append('id', id);

    fetch('index.php?tab=map', { method: 'POST', body: fd })
        .then(r => r.json())
        .then(data => {
            if (btn) btn.disabled = false;
            if (!data.success) {
                _showAlert('❌ ' + (data.message || 'Erro ao carregar trajectória.'), 'error');
                if (btn) { btn.textContent = '👁 Ver'; btn.className = 'layer-toggle-btn layer-toggle-off'; }
                return;
            }
            let gj;
            try { gj = typeof data.geojson === 'string' ? JSON.parse(data.geojson) : data.geojson; }
            catch (e) {
                _showAlert('❌ Dados corrompidos.', 'error');
                if (btn) { btn.textContent = '👁 Ver'; btn.className = 'layer-toggle-btn layer-toggle-off'; }
                return;
            }
            const qColors = { 1: '#16a34a', 2: '#ea580c' };
            const layer = L.geoJSON(gj, {
                pointToLayer: (f, ll) => {
                    const q  = f.properties && f.properties.Q;
                    const fc = qColors[q] || '#6b7280';
                    return L.circleMarker(ll, { radius: 5, fillColor: fc, color: '#fff', weight: 1.5, fillOpacity: 0.9 });
                },
                onEachFeature: (f, lyr) => {
                    const p = f.properties || {};
                    const qLabel = {1:'fix',2:'float',3:'sbas',4:'dgps',5:'single',6:'ppp'}[p.Q] || '?';
                    lyr.bindPopup(`
                        <div style="font-size:12px;min-width:160px;">
                            <div style="font-weight:700;margin-bottom:4px;">📡 ${_esc(p.time||'')}</div>
                            <b>Status:</b> ${_esc(qLabel)} (Q=${p.Q??'?'})<br>
                            <b>Satélites:</b> ${p.ns??'?'}<br>
                            <b>Altitude:</b> ${p.height!=null?p.height.toFixed(3)+' m':'?'}<br>
                            <b>σN/σE:</b> ${p.sdn!=null?p.sdn.toFixed(4):''} / ${p.sde!=null?p.sde.toFixed(4):''} m
                            ${p.ratio!=null?`<br><b>Ratio:</b> ${p.ratio.toFixed(1)}`:''}
                        </div>`);
                }
            }).addTo(map);
            rptPosLayers[id] = layer;
            rptPosData[id]   = { name: data.name };
            try { map.fitBounds(layer.getBounds(), { padding: [30, 30] }); } catch(e) {}
            if (btn) { btn.textContent = '✅ ON'; btn.className = 'layer-toggle-btn layer-toggle-on'; }
        })
        .catch(() => {
            if (btn) { btn.textContent = '👁 Ver'; btn.disabled = false; btn.className = 'layer-toggle-btn layer-toggle-off'; }
            _showAlert('Erro de rede ao carregar trajectória.', 'error');
        });
}

function _hidePosOnMap(id) {
    const layer = rptPosLayers[id];
    if (layer) { map.removeLayer(layer); delete rptPosLayers[id]; }
    delete rptPosData[id];
    const btn = document.getElementById('pos-btn-' + id);
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
            _currentTerrainRasters = items;
            _setBadge('raster', items.length);
            _renderRasterList(items);
            _refreshZonationLayerList();
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
            <a href="api/raster_download_png.php?id=${r.id}"
               download title="Download PNG + georeferenciação (.pgw)"
               class="layer-toggle-btn layer-toggle-off"
               style="text-decoration:none;font-size:10px;padding:3px 6px;">⬇</a>
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

/**
 * Remove emoji e outros caracteres fora do Latin-1 que o Helvetica do jsPDF
 * não suporta — evita o lixo "Ø=ÜÊ" no PDF.
 */
function _pdfStr(str) {
    return (str || '')
        // remover sequências de emoji (variante + combinação + ZWJ)
        .replace(/[\u{1F000}-\u{1FFFF}]/gu, '')
        .replace(/[\u{2600}-\u{27BF}]/gu,   '')
        .replace(/[️‍]/g,         '')
        // bullet unicode → hífen simples
        .replace(/[•·]/g, '-')
        .trim();
}

/** Labels de raster SEM emoji (para PDF). */
const MAP_RASTER_LABELS_PLAIN = {
    ndvi:          'NDVI',
    ndmi:          'NDMI',
    evi:           'EVI',
    msavi:         'MSAVI',
    gndvi:         'GNDVI',
    ndre:          'NDRE',
    ndwi:          'NDWI',
    nbr:           'NBR',
    bsi:           'BSI',
    ndvi_anomaly:  'NDVI Anomalia',
    ndvi_diff:     'NDVI Diferenca',
    lst:           'LST Temperatura',
    chuva:         'Chuva',
    humidade_solo: 'Humidade Solo',
    sar_vv:        'SAR VV',
    sar_vh:        'SAR VH',
    sar_ratio:     'SAR VV/VH',
    sar_rvi:       'SAR RVI',
    sar_agua:      'SAR Agua',
    altitude:      'Altitude',
    declive:       'Declive',
    aspect:        'Orientacao',
};

function generateMapReport() {
    // Se jsPDF ainda não foi carregado, injectá-lo dinamicamente e recomeçar
    if (typeof window.jspdf === 'undefined') {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
        s.onload  = () => generateMapReport();
        s.onerror = () => _showAlert('❌ Não foi possível carregar jsPDF (sem ligação à internet?).', 'error');
        document.head.appendChild(s);
        _showAlert('⏳ A carregar gerador de PDF…', 'info');
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
    const CW = PW - 2 * M;

    // ── Helpers internos ──────────────────────────────────────────────────────

    const pdfHdr = (r, g, b, title, subtitle) => {
        doc.setFillColor(r, g, b);
        doc.rect(0, 0, PW, 18, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(12); doc.setFont('helvetica', 'bold');
        doc.text(_pdfStr(title), M, 12);
        if (subtitle) {
            doc.setFontSize(8); doc.setFont('helvetica', 'normal');
            doc.setTextColor(220, 230, 255);
            doc.text(_pdfStr(subtitle), M, 17);
        }
    };
    const pdfFooter = () => {
        doc.setFontSize(8); doc.setTextColor(156, 163, 175);
        doc.text('SoilQI · ' + dtStr, M, PH - 8);
        doc.text('soilqi.com', PW - M, PH - 8, { align: 'right' });
    };
    const pdfImage = (png, yStart) => {
        const imgH = Math.min(PH - yStart - M - 12, CW * 0.80);
        try {
            doc.addImage(png, 'PNG', M, yStart, CW, imgH);
        } catch (_) {
            doc.setTextColor(239, 68, 68); doc.setFontSize(10);
            doc.text('Imagem nao disponivel.', M, yStart + 10);
        }
    };

    // ── Página 1: Resumo ──────────────────────────────────────────────────────

    doc.setFillColor(102, 126, 234);
    doc.rect(0, 0, PW, 24, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(15); doc.setFont('helvetica', 'bold');
    doc.text('SoilQI - Relatorio de Terreno', M, 10);
    doc.setFontSize(9); doc.setFont('helvetica', 'normal');
    doc.text('soilqi.com', PW - M, 10, { align: 'right' });

    doc.setTextColor(80, 80, 80); doc.setFontSize(10); doc.setFont('helvetica', 'normal');
    let y = 34;
    doc.setFont('helvetica', 'bold');   doc.text('Terreno:', M, y);
    doc.setFont('helvetica', 'normal'); doc.text(_pdfStr(terrainName), M + 24, y); y += 6;
    doc.setFont('helvetica', 'bold');   doc.text('Data:', M, y);
    doc.setFont('helvetica', 'normal'); doc.text(dtStr, M + 24, y); y += 12;

    // Lista de layers activos — SEM emoji, só texto ASCII/Latin-1
    doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.setTextColor(31, 41, 55);
    doc.text('Layers activos:', M, y); y += 7;
    doc.setFontSize(10); doc.setFont('helvetica', 'normal'); doc.setTextColor(55, 65, 81);

    const allLayers = [
        ...Object.entries(rptInterpData).map(([, d]) =>
            '[Campo] ' + _pdfStr(d.name)),
        ...Object.entries(rptGeoJSONData).map(([, d]) =>
            '[GeoJSON] ' + _pdfStr(d.name)),
        ...Object.entries(mapRasterData).map(([, d]) =>
            '[' + (MAP_RASTER_LABELS_PLAIN[d.type] || d.type) + '] ' + _pdfStr(d.name)),
        ...Object.entries(zonationData).map(([, d]) =>
            '[Zonagem] ' + _pdfStr(d.name)),
    ];

    if (allLayers.length === 0) {
        doc.setTextColor(156, 163, 175);
        doc.text('(nenhum layer activo no mapa)', M + 4, y); y += 7;
        doc.setTextColor(55, 65, 81);
    } else {
        allLayers.forEach(txt => {
            if (y > PH - M) { doc.addPage(); y = M; }
            doc.text('- ' + txt, M + 4, y); y += 6;
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
            const noteDt = new Date(n.created_at).toLocaleString('pt-PT');
            const lines  = doc.splitTextToSize(_pdfStr(n.content), CW - 8);
            const needed = 5 + lines.length * 5 + 6;
            if (y + needed > PH - M) { doc.addPage(); y = M; }
            doc.setFontSize(8); doc.setTextColor(156, 163, 175);
            doc.text(noteDt, M + 4, y); y += 5;
            doc.setFontSize(10); doc.setTextColor(55, 65, 81);
            lines.forEach(line => {
                if (y > PH - M) { doc.addPage(); y = M; }
                doc.text(line, M + 4, y); y += 5;
            });
            y += 4;
        });
    }

    doc.setFontSize(8); doc.setTextColor(156, 163, 175);
    doc.text('Gerado por SoilQI · ' + dtStr, M, PH - 8);

    // ── Páginas: rasters de satélite ─────────────────────────────────────────

    Object.entries(mapRasterData).forEach(([, d]) => {
        doc.addPage();
        const typeLabel = MAP_RASTER_LABELS_PLAIN[d.type] || d.type;
        pdfHdr(102, 126, 234, typeLabel, _pdfStr(d.name));
        pdfImage(d.png, 24);
        pdfFooter();
    });

    // ── Páginas: interpolações de campo ──────────────────────────────────────

    Object.entries(rptInterpData).forEach(([, d]) => {
        doc.addPage();
        pdfHdr(52, 211, 153, 'Campo: ' + _pdfStr(d.name), '');
        pdfImage(d.png, 24);
        pdfFooter();
    });

    // ── Páginas: mapas de zonagem ─────────────────────────────────────────────

    Object.entries(zonationData).forEach(([, d]) => {
        doc.addPage();
        pdfHdr(118, 75, 162, 'Zonagem: ' + _pdfStr(d.name), '');
        pdfImage(d.png, 24);

        // Legenda das zonas (se existir)
        if (d.legend && d.legend.length) {
            let ly = 24 + Math.min(PH - 24 - M - 12, CW * 0.80) + 6;
            if (ly + d.legend.length * 6 < PH - M) {
                doc.setFontSize(8); doc.setFont('helvetica', 'bold');
                doc.setTextColor(80, 80, 80);
                doc.text('Legenda:', M, ly); ly += 5;
                doc.setFont('helvetica', 'normal');
                d.legend.forEach(z => {
                    if (ly > PH - M) return;
                    doc.text('- ' + _pdfStr(z.label) + '  ' + z.area_pct + '%', M + 4, ly);
                    ly += 5;
                });
            }
        }
        pdfFooter();
    });

    // ── Guardar ───────────────────────────────────────────────────────────────
    const safeName = _pdfStr(terrainName).replace(/[^a-zA-Z0-9_\-]/g, '_').toLowerCase();
    doc.save('soilqi_relatorio_' + safeName + '_' + now.toISOString().slice(0, 10) + '.pdf');
}

// ─────────────────────────────────────────────────────────────────────────────
// MAPA DE ZONAGEM
// ─────────────────────────────────────────────────────────────────────────────

const zonationOverlays = {};  // id → L.imageOverlay  (id negativo = gerado mas ainda não guardado)
const zonationData     = {};  // id → {name, png, bounds, legend}

// ── Painel de layers (checkboxes) ────────────────────────────────────────────

/**
 * Reconstrói a lista de checkboxes mostrando rasters de satélite (🛰️) e
 * interpolações de campo (🎨). Os valores têm prefixo: "r_ID" ou "i_ID".
 */
function _refreshZonationLayerList() {
    const listEl = document.getElementById('zonation-layer-list');
    if (!listEl) return;

    const hasR = _currentTerrainRasters.length > 0;
    const hasI = _currentTerrainInterps.length  > 0;

    if (!hasR && !hasI) {
        listEl.innerHTML = '<div class="layer-empty">Nenhuma camada neste terreno.</div>';
        return;
    }

    const sectionHdr = (icon, label) =>
        `<div style="font-size:10px;font-weight:700;color:#9ca3af;text-transform:uppercase;
                     letter-spacing:.5px;padding:5px 4px 2px;">${icon} ${label}</div>`;

    const rowHtml = (key, accent, name, sub) => `
        <label style="display:flex;align-items:center;gap:8px;padding:5px 4px;
                      border-bottom:1px solid #f8fafc;cursor:pointer;font-size:11px;">
            <input type="checkbox" value="${key}" onchange="_onZonationLayerToggle()"
                   style="width:14px;height:14px;accent-color:${accent};flex-shrink:0;">
            <span style="flex:1;min-width:0;">
                <span style="font-weight:600;color:#1f2937;">${name}</span><br>
                <span style="color:#9ca3af;font-size:10px;">${sub}</span>
            </span>
        </label>`;

    let html = '';

    if (hasR) {
        html += sectionHdr('🛰️', 'Satélite');
        html += _currentTerrainRasters.map(r => {
            const label = MAP_RASTER_LABELS[r.raster_type] || r.raster_type;
            const dt    = r.date_from
                ? r.date_from + ' → ' + r.date_to
                : new Date(r.created_at).toLocaleDateString('pt-PT');
            return rowHtml('r_' + r.id, '#667eea', label, dt);
        }).join('');
    }

    if (hasI) {
        if (hasR) html += '<div style="height:4px;"></div>';
        html += sectionHdr('🎨', 'Campo');
        html += _currentTerrainInterps.map(it => {
            const dt = new Date(it.created_at).toLocaleDateString('pt-PT');
            return rowHtml('i_' + it.id, '#10b981', _esc(it.name),
                           _esc(it.param || '') + (it.param ? '  ' : '') + dt);
        }).join('');
    }

    listEl.innerHTML = html;
}

function _onZonationLayerToggle() {
    _updateWeightPanels();
}

/** Devolve arrays separados {raster_ids, interp_ids} dos checkboxes marcados. */
function _getSelectedLayerIds() {
    const vals = [...document.querySelectorAll('#zonation-layer-list input[type=checkbox]:checked')]
        .map(cb => cb.value);
    return {
        raster_ids: vals.filter(v => v.startsWith('r_')).map(v => parseInt(v.slice(2))),
        interp_ids: vals.filter(v => v.startsWith('i_')).map(v => parseInt(v.slice(2))),
    };
}

/** Devolve a chave prefixada de todas as checkboxes marcadas (para weight panels). */
function _getSelectedLayerKeys() {
    return [...document.querySelectorAll('#zonation-layer-list input[type=checkbox]:checked')]
        .map(cb => cb.value);
}

/** Label legível para uma chave "r_ID" ou "i_ID". */
function _layerLabel(key) {
    if (key.startsWith('r_')) {
        const id = parseInt(key.slice(2));
        const r  = _currentTerrainRasters.find(x => x.id === id);
        return r ? (MAP_RASTER_LABELS[r.raster_type] || r.raster_type) : key;
    }
    if (key.startsWith('i_')) {
        const id = parseInt(key.slice(2));
        const it = _currentTerrainInterps.find(x => x.id === id);
        return it ? it.name : key;
    }
    return key;
}

// ── Mudança de método ─────────────────────────────────────────────────────────

function onZonationMethodChange(method) {
    document.querySelectorAll('.zn-params').forEach(el => el.style.display = 'none');
    const panel = document.getElementById('params-' + method);
    if (panel) panel.style.display = '';
    _updateWeightPanels();
}

// ── Painéis de pesos (Quantis / Índice Composto) ─────────────────────────────

function _updateWeightPanels() {
    const method  = document.getElementById('zonation-method')?.value || 'kmeans';
    const keys    = _getSelectedLayerKeys();   // ["r_42", "i_7", ...]
    const needsWt = (method === 'quantiles' || method === 'weighted');

    ['qt-weights-panel', 'wt-weights-panel'].forEach(panelId => {
        const el = document.getElementById(panelId);
        if (!el) return;
        if (!needsWt || !keys.length) { el.innerHTML = ''; return; }

        // sanitize key for use in element ID (replace _ with -)
        const safeKey = k => k.replace('_', '-');

        el.innerHTML = '<div class="zn-lbl" style="margin-bottom:4px;">Pesos por camada</div>' +
            keys.map(key => {
                const label = _layerLabel(key);
                const wid   = panelId + '-w-' + safeKey(key);
                const iid   = panelId + '-inv-' + safeKey(key);
                return `
                <div class="zn-weight-row">
                    <span title="${_esc(label)}" style="max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${_esc(label)}</span>
                    <input type="range" min="0" max="2" step="0.1" value="1"
                           id="${wid}"
                           oninput="document.getElementById('${wid}-v').textContent=parseFloat(this.value).toFixed(1)">
                    <span class="zn-weight-val" id="${wid}-v">1.0</span>
                    <label title="Inverter" style="display:flex;align-items:center;gap:3px;cursor:pointer;color:#9ca3af;font-size:10px;">
                        <input type="checkbox" id="${iid}" style="width:12px;height:12px;accent-color:#667eea;"> inv
                    </label>
                </div>`;
            }).join('');
    });
}

// ── Gerar zonagem ─────────────────────────────────────────────────────────────

/** Mostra / limpa o painel de estado da zonagem (abaixo do botão). */
function _znStatus(msg, type) {
    const el = document.getElementById('zonation-status');
    if (!el) return;
    if (!msg) { el.style.display = 'none'; el.textContent = ''; return; }
    const colors = {
        info:    { bg: '#eff6ff', border: '#bfdbfe', text: '#1d4ed8' },
        success: { bg: '#f0fdf4', border: '#bbf7d0', text: '#166534' },
        error:   { bg: '#fef2f2', border: '#fecaca', text: '#dc2626' },
        warning: { bg: '#fffbeb', border: '#fde68a', text: '#92400e' },
    };
    const c = colors[type] || colors.info;
    Object.assign(el.style, {
        display: '', background: c.bg,
        border: `1px solid ${c.border}`, color: c.text,
        borderRadius: '6px', padding: '8px 10px',
        fontSize: '11px', marginTop: '8px', lineHeight: '1.5',
    });
    el.textContent = msg;
}

function generateZonation() {
    if (!reportTerrainId) { _znStatus('Selecione um terreno primeiro.', 'warning'); return; }

    const { raster_ids, interp_ids } = _getSelectedLayerIds();
    const keys = _getSelectedLayerKeys();
    if (!keys.length) { _znStatus('Selecione pelo menos uma camada de entrada.', 'warning'); return; }

    const method = document.getElementById('zonation-method')?.value || 'kmeans';
    const safeKey = k => k.replace('_', '-');
    const g = id => document.getElementById(id);

    // Construir params específicos do método
    let params = {};

    if (method === 'kmeans') {
        params = {
            n_clusters: parseInt(g('km-n_clusters')?.value || 4),
            n_init:     parseInt(g('km-n_init')?.value     || 10),
            max_iter:   parseInt(g('km-max_iter')?.value   || 300),
        };
    } else if (method === 'fcm') {
        params = {
            n_clusters: parseInt(g('fcm-n_clusters')?.value || 4),
            m:          parseFloat(g('fcm-m')?.value         || 2.0),
            maxiter:    parseInt(g('fcm-maxiter')?.value     || 1000),
            error:      parseFloat(g('fcm-error')?.value     || 0.005),
        };
    } else if (method === 'gmm') {
        params = {
            n_components:    parseInt(g('gmm-n_components')?.value   || 4),
            covariance_type: g('gmm-covariance_type')?.value         || 'full',
            n_init:          parseInt(g('gmm-n_init')?.value          || 3),
        };
    } else if (method === 'quantiles') {
        params = { n_zones: parseInt(g('qt-n_zones')?.value || 3) };
        params.weights = keys.map(k => { const v = g('qt-weights-panel-w-' + safeKey(k)); return v ? parseFloat(v.value) : 1.0; });
        params.invert  = keys.map(k => { const v = g('qt-weights-panel-inv-' + safeKey(k)); return v ? v.checked : false; });
    } else if (method === 'weighted') {
        params = {
            n_zones:     parseInt(g('wt-n_zones')?.value  || 3),
            classify_by: g('wt-classify_by')?.value        || 'quantile',
        };
        params.weights = keys.map(k => { const v = g('wt-weights-panel-w-' + safeKey(k)); return v ? parseFloat(v.value) : 1.0; });
        params.invert  = keys.map(k => { const v = g('wt-weights-panel-inv-' + safeKey(k)); return v ? v.checked : false; });
    }

    // Feedback visual
    const btn = document.getElementById('zonation-generate-btn');
    const _resetBtn = () => {
        if (btn) { btn.textContent = '🗺️ Gerar Zonagem'; btn.disabled = false; btn.style.opacity = '1'; }
    };
    if (btn) { btn.textContent = '⏳ A enviar…'; btn.disabled = true; btn.style.opacity = '0.7'; }
    _znStatus('⏳ A enviar pedido ao servidor…', 'info');

    const fd = new FormData();
    fd.append('action',     'generate_zonation');
    fd.append('terrain_id', reportTerrainId);
    fd.append('method',     method);
    fd.append('params',     JSON.stringify(params));
    fd.append('raster_ids', JSON.stringify(raster_ids));
    fd.append('interp_ids', JSON.stringify(interp_ids));

    fetch('index.php?tab=map', { method: 'POST', body: fd })
        .then(r => r.json())
        .then(data => {
            if (!data.success) {
                _resetBtn();
                _znStatus('❌ ' + (data.message || 'Erro ao criar pedido.'), 'error');
                return;
            }

            // Se MQTT não está configurado, o job nunca será processado — informar imediatamente
            if (data.mqtt_warning) {
                _resetBtn();
                _znStatus('⚠️ MQTT não configurado: o serviço Python não irá receber o pedido.\n' + data.mqtt_warning, 'warning');
                return;
            }

            // Pedido aceite e MQTT publicado — iniciar polling
            const requestId = data.request_id;
            if (btn) { btn.textContent = '⏳ A processar…'; }
            _znStatus('📡 Pedido enviado. A aguardar processamento pelo serviço Python…', 'info');

            _pollZonationStatus(requestId, _resetBtn);
        })
        .catch(err => {
            _resetBtn();
            _znStatus('❌ Erro de rede: ' + err.message, 'error');
        });
}

// ── Polling de estado da zonagem ──────────────────────────────────────────────

function _pollZonationStatus(requestId, onDone) {
    const MAX_ATTEMPTS = 60;   // 60 × 3 s = 3 minutos
    let   attempts     = 0;

    const timer = setInterval(() => {
        attempts++;

        if (attempts > MAX_ATTEMPTS) {
            clearInterval(timer);
            if (onDone) onDone();
            _znStatus('⏱️ Tempo limite excedido. O serviço Python pode estar indisponível — verifique o historial mais tarde.', 'warning');
            return;
        }

        const elapsed = attempts * 3;
        _znStatus(`⏳ A processar… (${elapsed}s)  |  Tentativa ${attempts}/${MAX_ATTEMPTS}`, 'info');

        const fd = new FormData();
        fd.append('action',     'get_zonation_status');
        fd.append('request_id', requestId);

        fetch('index.php?tab=map', { method: 'POST', body: fd })
            .then(r => r.json())
            .then(data => {
                if (!data.success && data.message) {
                    clearInterval(timer);
                    if (onDone) onDone();
                    _znStatus('❌ ' + data.message, 'error');
                    return;
                }

                const st = data.status || '';

                if (st === 'done') {
                    clearInterval(timer);
                    if (onDone) onDone();
                    _znStatus('✅ Zonagem concluída!', 'success');
                    _showZonationOnMap(data.id, data.name, data.png, data.bounds, data.legend);
                    loadZonationHistory(reportTerrainId);

                } else if (st === 'error') {
                    clearInterval(timer);
                    if (onDone) onDone();
                    _znStatus('❌ ' + (data.message || 'Erro na zonagem.'), 'error');

                }
                // pending / processing → continuar polling
            })
            .catch(() => { /* ignorar erros de rede temporários no polling */ });

    }, 3000);
}

// ── Overlay no mapa ───────────────────────────────────────────────────────────

function _showZonationOnMap(id, name, png, bounds, legend) {
    // Remover overlay anterior com o mesmo id (se existir)
    if (zonationOverlays[id]) {
        map.removeLayer(zonationOverlays[id]);
        delete zonationOverlays[id];
    }
    const opacity = _globalOpacity();
    const llBounds = [[bounds.min_lat, bounds.min_lng], [bounds.max_lat, bounds.max_lng]];
    const ov = L.imageOverlay(png, llBounds, { opacity, zIndex: 450 }).addTo(map);
    zonationOverlays[id] = ov;
    zonationData[id]     = { name, png, bounds: llBounds, legend };
    map.fitBounds(llBounds, { padding: [30, 30] });
    _renderZonationLegend(legend);
}

function _renderZonationLegend(legend) {
    const el = document.getElementById('zonation-legend');
    if (!el || !legend?.length) return;
    el.style.display = '';
    el.innerHTML = '<div class="zn-lbl" style="margin-bottom:4px;">Legenda</div>' +
        legend.map(z => `
        <div class="zn-legend-row">
            <div class="zn-legend-swatch" style="background:${z.color};"></div>
            <span>${_esc(z.label)}</span>
            <span class="zn-legend-pct">${z.area_pct}%</span>
        </div>`).join('');
}

// ── Historial ─────────────────────────────────────────────────────────────────

function loadZonationHistory(terrainId) {
    const listEl = document.getElementById('zonation-history-list');
    if (!listEl) return;

    const fd = new FormData();
    fd.append('action',     'get_zonation_list');
    fd.append('terrain_id', terrainId || '');

    fetch('index.php?tab=map', { method: 'POST', body: fd })
        .then(r => r.json())
        .then(data => {
            const items = data.items || [];
            _setBadge('zonation', items.length);
            _renderZonationHistory(items);
        })
        .catch(() => {});
}

function _renderZonationHistory(items) {
    const listEl = document.getElementById('zonation-history-list');
    if (!listEl) return;
    if (!items.length) {
        listEl.innerHTML = '<div class="layer-empty">Nenhuma zonagem guardada.</div>';
        return;
    }
    listEl.innerHTML = items.map(it => {
        const on = !!zonationOverlays[it.id];
        const dt = new Date(it.created_at).toLocaleString('pt-PT');
        return `
        <div class="zn-hist-row" id="zn-hist-${it.id}">
            <div class="zn-hist-info">
                <div class="zn-hist-name" title="${_esc(it.name)}">${_esc(it.name)}</div>
                <div class="zn-hist-date">${dt}</div>
            </div>
            <button id="zn-hist-btn-${it.id}"
                    onclick="toggleZonationOnMap(${it.id})"
                    class="layer-toggle-btn ${on ? 'layer-toggle-on' : 'layer-toggle-off'}"
                    style="font-size:10px;padding:3px 7px;">
                ${on ? '✅ ON' : '👁 Ver'}
            </button>
            <a href="api/zonation_download_png.php?id=${it.id}"
               download title="Download PNG + georeferenciação (.pgw) + legenda CSV"
               class="layer-toggle-btn layer-toggle-off"
               style="text-decoration:none;font-size:10px;padding:3px 6px;">⬇</a>
            <button onclick="_deleteZonation(${it.id})"
                    class="layer-toggle-btn layer-toggle-off"
                    style="font-size:10px;padding:3px 6px;color:#ef4444;background:#fff0f0;">🗑</button>
        </div>`;
    }).join('');
}

function toggleZonationOnMap(id) {
    if (zonationOverlays[id]) {
        map.removeLayer(zonationOverlays[id]);
        delete zonationOverlays[id];
        delete zonationData[id];
        const btn = document.getElementById('zn-hist-btn-' + id);
        if (btn) { btn.textContent = '👁 Ver'; btn.className = 'layer-toggle-btn layer-toggle-off'; }
        return;
    }
    // Carregar PNG do servidor
    const btn = document.getElementById('zn-hist-btn-' + id);
    if (btn) { btn.textContent = '⏳'; btn.disabled = true; }

    const fd = new FormData();
    fd.append('action', 'get_zonation_png');
    fd.append('id', id);

    fetch('index.php?tab=map', { method: 'POST', body: fd })
        .then(r => r.json())
        .then(data => {
            if (btn) btn.disabled = false;
            if (!data.success) {
                _showAlert('❌ ' + (data.message || 'Erro.'), 'error');
                if (btn) { btn.textContent = '👁 Ver'; btn.className = 'layer-toggle-btn layer-toggle-off'; }
                return;
            }
            const bounds = { min_lat: data.min_lat, max_lat: data.max_lat,
                             min_lng: data.min_lng, max_lng: data.max_lng };
            _showZonationOnMap(id, data.name, data.png, bounds, data.legend);
            if (btn) { btn.textContent = '✅ ON'; btn.className = 'layer-toggle-btn layer-toggle-on'; }
        })
        .catch(() => {
            if (btn) { btn.textContent = '👁 Ver'; btn.disabled = false; btn.className = 'layer-toggle-btn layer-toggle-off'; }
        });
}

function _deleteZonation(id) {
    if (!confirm('Eliminar esta zonagem?')) return;
    const fd = new FormData();
    fd.append('action', 'delete_zonation');
    fd.append('id', id);
    fetch('index.php?tab=map', { method: 'POST', body: fd })
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                if (zonationOverlays[id]) { map.removeLayer(zonationOverlays[id]); delete zonationOverlays[id]; }
                delete zonationData[id];
                loadZonationHistory(reportTerrainId);
            } else {
                _showAlert('❌ ' + (data.message || 'Erro.'), 'error');
            }
        });
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
// PRESCRIÇÃO / SHAPEFILE VRA
// ─────────────────────────────────────────────────────────────────────────────

/** Helper de estado do painel de prescrição. */
function _prescStatus(msg, type) {
    const el = document.getElementById('presc-status');
    if (!el) return;
    if (!msg) { el.style.display = 'none'; el.textContent = ''; return; }
    const colors = {
        info:    { bg:'#eff6ff', border:'#bfdbfe', text:'#1d4ed8' },
        success: { bg:'#f0fdf4', border:'#bbf7d0', text:'#166534' },
        error:   { bg:'#fef2f2', border:'#fecaca', text:'#dc2626' },
        warning: { bg:'#fffbeb', border:'#fde68a', text:'#92400e' },
    };
    const c = colors[type] || colors.info;
    Object.assign(el.style, {
        display:'', background:c.bg, border:`1px solid ${c.border}`,
        color:c.text, borderRadius:'6px', padding:'8px 10px',
        fontSize:'11px', marginTop:'8px', lineHeight:'1.5', whiteSpace:'pre-line',
    });
    el.textContent = msg;
}

/**
 * Preenche o dropdown "Zonagem base" com as zonagens concluídas do terreno.
 * Chamado quando muda o terreno seleccionado.
 */
function loadPrescriptionZonations(terrainId) {
    const sel = document.getElementById('presc-zonation-select');
    if (!sel) return;
    sel.innerHTML = '<option value="">— Selecione uma zonagem —</option>';
    document.getElementById('presc-zone-inputs').innerHTML = '';
    _prescStatus('', '');

    if (!terrainId) return;

    const fd = new FormData();
    fd.append('action',     'get_zonation_list');
    fd.append('terrain_id', terrainId);

    fetch('index.php?tab=map', { method:'POST', body:fd })
        .then(r => r.json())
        .then(data => {
            const items = data.items || [];
            items.forEach(z => {
                const opt = document.createElement('option');
                opt.value = z.id;
                opt.textContent = _pdfStr(z.name) + '  (' + z.method + ')';
                // guardar legenda como data attribute
                opt.dataset.legend = JSON.stringify(
                    typeof z.legend === 'string' ? JSON.parse(z.legend || '[]') : (z.legend || [])
                );
                sel.appendChild(opt);
            });
        })
        .catch(() => {});
}

/**
 * Ao seleccionar uma zonagem, renderiza os inputs de prescrição por zona.
 */
function onPrescZonationChange(id) {
    const sel = document.getElementById('presc-zonation-select');
    const container = document.getElementById('presc-zone-inputs');
    _prescStatus('', '');
    if (!id || !sel || !container) { container.innerHTML = ''; return; }

    const opt    = sel.querySelector(`option[value="${id}"]`);
    const legend = opt ? JSON.parse(opt.dataset.legend || '[]') : [];

    if (!legend.length) {
        container.innerHTML = '<div class="layer-empty">Sem informação de zonas.</div>';
        return;
    }

    const inp = (id, placeholder, val='0') =>
        `<input type="number" id="${id}" value="${val}" min="0" step="0.1"
                style="width:100%;padding:4px 5px;border:1px solid #e5e7eb;border-radius:5px;
                       font-size:11px;box-sizing:border-box;" placeholder="${placeholder}">`;

    container.innerHTML = `
        <div style="font-size:10px;font-weight:700;color:#9ca3af;text-transform:uppercase;
                    letter-spacing:.5px;margin-bottom:6px;">
            Valores por zona
        </div>
        <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:11px;">
            <thead>
                <tr style="background:#f8fafc;color:#6b7280;">
                    <th style="padding:4px 5px;text-align:left;font-weight:600;border-bottom:1px solid #e5e7eb;min-width:80px;">Zona</th>
                    <th style="padding:4px 5px;text-align:center;font-weight:600;border-bottom:1px solid #e5e7eb;" title="Litros por hectare">Spray<br><small>L/ha</small></th>
                    <th style="padding:4px 5px;text-align:center;font-weight:600;border-bottom:1px solid #e5e7eb;" title="Azoto kg/ha">N<br><small>kg/ha</small></th>
                    <th style="padding:4px 5px;text-align:center;font-weight:600;border-bottom:1px solid #e5e7eb;" title="Fósforo kg/ha">P<br><small>kg/ha</small></th>
                    <th style="padding:4px 5px;text-align:center;font-weight:600;border-bottom:1px solid #e5e7eb;" title="Potássio kg/ha">K<br><small>kg/ha</small></th>
                </tr>
            </thead>
            <tbody>
                ${legend.map((z, idx) => {
                    const zid  = z.zone_id ?? z.id ?? (idx + 1);
                    const lbl  = _pdfStr(z.label || `Zona ${zid}`);
                    const col  = z.color || '#999';
                    return `
                    <tr style="border-bottom:1px solid #f1f5f9;">
                        <td style="padding:5px 5px;">
                            <div style="display:flex;align-items:center;gap:5px;">
                                <div style="width:10px;height:10px;border-radius:2px;
                                            background:${col};flex-shrink:0;"></div>
                                <span style="font-weight:600;color:#374151;">${_esc(lbl)}</span>
                                <span style="color:#9ca3af;font-size:10px;">${z.area_pct ?? ''}%</span>
                            </div>
                        </td>
                        <td style="padding:3px;">${inp('presc-spray-'+zid, '0')}</td>
                        <td style="padding:3px;">${inp('presc-n-'+zid,     '0')}</td>
                        <td style="padding:3px;">${inp('presc-p-'+zid,     '0')}</td>
                        <td style="padding:3px;">${inp('presc-k-'+zid,     '0')}</td>
                    </tr>`;
                }).join('')}
            </tbody>
        </table>
        </div>`;
}

/** Recolhe os valores da tabela e envia o pedido de geração. */
function generatePrescription() {
    if (!reportTerrainId) { _prescStatus('Selecione um terreno primeiro.', 'warning'); return; }

    const sel    = document.getElementById('presc-zonation-select');
    const zonId  = sel ? parseInt(sel.value) : 0;
    if (!zonId)  { _prescStatus('Selecione uma zonagem base.', 'warning'); return; }

    const name = (document.getElementById('presc-name')?.value || '').trim();
    if (!name) { _prescStatus('Dê um nome à prescrição.', 'warning'); return; }

    // Recolher prescriptions da tabela
    const opt    = sel.querySelector(`option[value="${zonId}"]`);
    const legend = opt ? JSON.parse(opt.dataset.legend || '[]') : [];
    if (!legend.length) { _prescStatus('Zonagem sem zonas na legenda.', 'error'); return; }

    const prescriptions = legend.map((z, idx) => {
        const zid = z.zone_id ?? z.id ?? (idx + 1);
        const v   = id => parseFloat(document.getElementById(id)?.value || 0) || 0;
        return {
            zone_id: zid,
            spray:   v('presc-spray-' + zid),
            fert_n:  v('presc-n-' + zid),
            fert_p:  v('presc-p-' + zid),
            fert_k:  v('presc-k-' + zid),
        };
    });

    const btn = document.getElementById('presc-generate-btn');
    const _resetBtn = () => {
        if (btn) { btn.textContent = '📋 Gerar ShapeFile'; btn.disabled = false; btn.style.opacity = '1'; }
    };
    if (btn) { btn.textContent = '⏳ A enviar…'; btn.disabled = true; btn.style.opacity = '0.7'; }
    _prescStatus('⏳ A enviar pedido ao servidor…', 'info');

    const fd = new FormData();
    fd.append('action',        'generate_prescription');
    fd.append('terrain_id',    reportTerrainId);
    fd.append('zonation_id',   zonId);
    fd.append('name',          name);
    fd.append('prescriptions', JSON.stringify(prescriptions));

    fetch('index.php?tab=map', { method:'POST', body:fd })
        .then(r => r.json())
        .then(data => {
            if (!data.success) {
                _resetBtn();
                _prescStatus('❌ ' + (data.message || 'Erro ao criar pedido.'), 'error');
                return;
            }
            if (data.mqtt_warning) {
                _resetBtn();
                _prescStatus('⚠️ MQTT não configurado: o serviço Python não recebeu o pedido.\n' + data.mqtt_warning, 'warning');
                return;
            }
            if (btn) { btn.textContent = '⏳ A processar…'; }
            _prescStatus('📡 Pedido enviado. A aguardar geração do ShapeFile…', 'info');
            _pollPrescriptionStatus(data.request_id, _resetBtn);
        })
        .catch(err => {
            _resetBtn();
            _prescStatus('❌ Erro de rede: ' + err.message, 'error');
        });
}

function _pollPrescriptionStatus(requestId, onDone) {
    const MAX = 60;
    let   att = 0;

    const timer = setInterval(() => {
        att++;
        if (att > MAX) {
            clearInterval(timer);
            if (onDone) onDone();
            _prescStatus('⏱️ Tempo limite excedido. Verifique o historial mais tarde.', 'warning');
            return;
        }
        _prescStatus(`⏳ A gerar ShapeFile… (${att * 3}s)`, 'info');

        const fd = new FormData();
        fd.append('action',     'get_prescription_status');
        fd.append('request_id', requestId);

        fetch('index.php?tab=map', { method:'POST', body:fd })
            .then(r => r.json())
            .then(data => {
                if (!data.success && data.message) {
                    clearInterval(timer); if (onDone) onDone();
                    _prescStatus('❌ ' + data.message, 'error'); return;
                }
                if (data.status === 'done') {
                    clearInterval(timer); if (onDone) onDone();
                    _prescStatus('✅ ShapeFile gerado! Disponível no historial abaixo.', 'success');
                    loadPrescriptionHistory(reportTerrainId);
                } else if (data.status === 'error') {
                    clearInterval(timer); if (onDone) onDone();
                    _prescStatus('❌ ' + (data.message || 'Erro na geração.'), 'error');
                }
            })
            .catch(() => {});
    }, 3000);
}

/** Carrega e renderiza o historial de prescrições para o terreno. */
function loadPrescriptionHistory(terrainId) {
    const listEl = document.getElementById('presc-history-list');
    if (!listEl) return;

    if (!terrainId) {
        listEl.innerHTML = '<div class="layer-empty">Selecione um terreno.</div>';
        _setBadge('prescription', 0);
        return;
    }

    const fd = new FormData();
    fd.append('action',     'get_prescription_list');
    fd.append('terrain_id', terrainId);

    fetch('index.php?tab=map', { method:'POST', body:fd })
        .then(r => r.json())
        .then(data => {
            const items = data.items || [];
            _setBadge('prescription', items.length);
            if (!items.length) {
                listEl.innerHTML = '<div class="layer-empty">Nenhuma prescrição guardada.</div>';
                return;
            }
            listEl.innerHTML = items.map(it => {
                const dt = new Date(it.created_at).toLocaleDateString('pt-PT');
                return `
                <div class="zn-hist-row" style="display:flex;align-items:center;gap:5px;
                      padding:6px 4px;border-bottom:1px solid #f8fafc;">
                    <div style="flex:1;min-width:0;">
                        <div style="font-size:11px;font-weight:600;color:#374151;
                                    white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"
                             title="${_esc(it.name)}">${_esc(it.name)}</div>
                        <div style="font-size:10px;color:#9ca3af;">${dt}</div>
                    </div>
                    <a href="api/prescription_download_png.php?id=${it.id}"
                       download title="Download PNG + georeferenciação (.pgw) + CSV de valores"
                       style="padding:4px 7px;background:#6366f1;color:#fff;border:none;
                              border-radius:5px;font-size:10px;font-weight:600;
                              cursor:pointer;text-decoration:none;white-space:nowrap;">
                        ⬇ PNG
                    </a>
                    <a href="api/prescription_download.php?id=${it.id}"
                       download title="Download ShapeFile ZIP"
                       style="padding:4px 7px;background:#059669;color:#fff;border:none;
                              border-radius:5px;font-size:10px;font-weight:600;
                              cursor:pointer;text-decoration:none;white-space:nowrap;">
                        ⬇ ZIP
                    </a>
                    <button onclick="_deletePrescription(${it.id})"
                            style="padding:4px 6px;background:#fee2e2;color:#dc2626;border:none;
                                   border-radius:5px;font-size:10px;cursor:pointer;">
                        🗑
                    </button>
                </div>`;
            }).join('');
        })
        .catch(() => {
            listEl.innerHTML = '<div class="layer-empty" style="color:#ef4444;">Erro de rede.</div>';
        });
}

function _deletePrescription(id) {
    if (!confirm('Eliminar esta prescrição?')) return;
    const fd = new FormData();
    fd.append('action', 'delete_prescription');
    fd.append('id',     id);
    fetch('index.php?tab=map', { method:'POST', body:fd })
        .then(r => r.json())
        .then(data => {
            if (data.success) loadPrescriptionHistory(reportTerrainId);
            else _prescStatus('❌ ' + (data.message || 'Erro ao eliminar.'), 'error');
        })
        .catch(() => {});
}

// ─────────────────────────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    // Carregar notas (todos os terrenos) na carga inicial da página
    loadMapNotes(null);
    // Pré-carregar lista de terrenos (visível após expandir grupo)
    _loadTerrainList();
    // Carregar todas as trajectórias GNSS do utilizador
    _loadPosLayers(null);
});
