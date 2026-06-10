/**
 * Field Tab — Medições de Campo (SoilQI Field PWA)
 */

let fieldMap            = null;
let markerLayer         = null;
let allMeasurements     = [];
let interpolationOverlay = null;
let addModeActive       = false;
let tempMarker          = null;

// Field objects (trees / poles)
let fieldObjectsLayer   = null;
let addObjectModeActive = false;
let fieldObjectsList    = [];
let _pendingPositions   = [];  // posições acumuladas no modal multi-ponto
let _pickOverlay        = null; // elemento flutuante no mapa durante o pick mode

// Line / spline draw mode
let _lineDrawMode    = false;  // modo de desenho de linha activo
let _linePoints      = [];     // vértices da linha desenhada pelo utilizador
let _lineLayer       = null;   // Leaflet polyline activa
let _lineMarkers     = [];     // marcadores de vértice
let _linePickOverlay = null;   // overlay flutuante durante o desenho de linha

// Layers control reference (needed to add/remove saved interpolation overlays)
let fieldLayersControl  = null;
// Saved interpolations: id -> Leaflet imageOverlay currently on map
let savedOverlayLayers  = {};
// Cache of saved interpolation metadata (populated by loadSavedInterpolations)
let savedInterpData     = [];
// Last generated IDW result (for saving to DB)
let lastInterpDataUrl   = null;
let lastInterpBounds    = null; // { minLat, maxLat, minLng, maxLng }
let lastInterpMeta      = null; // { minV, maxV, param, colormap, terrainId, resolution, power }

// GeoJSON layers: id -> Leaflet GeoJSON layer currently on map
let geojsonOverlayLayers = {};
// Raw GeoJSON text pending save (for .geojson/.json)
let pendingGeoJSON  = null;
// Raw File object pending save (for .kmz/.kml — sent to server for conversion)
let pendingKmzFile  = null;
// Raw File object pending save (for .pos RTKLIB GNSS — sent to server for conversion)
let pendingPosFile  = null;

// ── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function () {
    if (activeTab !== 'field') return;
    initFieldMap();
    loadFieldStats();   // preenche os stat-cards sem esperar pelo botão Filtrar
    // Tabela não carrega automaticamente — aguarda que o utilizador clique em Filtrar
});

// ── Mapa ─────────────────────────────────────────────────────────────────────
function initFieldMap() {
    fieldMap = L.map('field-map', { zoomControl: true }).setView([39.5, -8.0], 7);

    // Camadas base
    const osmBase = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://openstreetmap.org">OpenStreetMap</a>', maxZoom: 19
    });
    const satBase = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles © Esri', maxZoom: 19
    });
    const topoBase = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenTopoMap', maxZoom: 17
    });
    const labelsOv = L.tileLayer(
        'https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}{r}.png', {
        attribution: '© Carto', maxZoom: 19
    });

    osmBase.addTo(fieldMap);
    fieldLayersControl = L.control.layers(
        { '🗺️ Mapa': osmBase, '🛰️ Satélite': satBase, '🏔️ Relevo': topoBase },
        { '🏷️ Etiquetas': labelsOv },
        { position: 'topright', collapsed: true }
    ).addTo(fieldMap);

    markerLayer       = L.layerGroup().addTo(fieldMap);
    fieldObjectsLayer = L.layerGroup().addTo(fieldMap);

    // ── Controlo "Adicionar medição" ──────────────────────────────────────────
    const AddControl = L.Control.extend({
        options: { position: 'topleft' },
        onAdd: function () {
            const btn = L.DomUtil.create('button', 'leaflet-bar leaflet-control field-add-btn');
            btn.id          = 'field-add-ctrl';
            btn.title       = 'Clique para ativar modo de adição de medição';
            btn.textContent = '📍 Adicionar';
            btn.style.cssText = [
                'background:#fff', 'border:2px solid rgba(0,0,0,.2)',
                'border-radius:4px', 'padding:4px 10px',
                'cursor:pointer', 'font-size:13px', 'font-weight:600',
                'white-space:nowrap', 'display:flex', 'align-items:center', 'gap:4px',
                'box-shadow:0 1px 5px rgba(0,0,0,.3)'
            ].join(';');
            L.DomEvent.on(btn, 'click', L.DomEvent.stopPropagation);
            L.DomEvent.on(btn, 'click', toggleAddMode);
            return btn;
        }
    });
    new AddControl().addTo(fieldMap);

    // ── Listener de clique no mapa ────────────────────────────────────────────
    fieldMap.on('click', function (e) {
        if (addModeActive) {
            openQuickModal(e.latlng.lat, e.latlng.lng);
        } else if (addObjectModeActive) {
            // Adiciona AUTOMATICAMENTE à lista sem precisar de nenhum botão extra
            const lat = e.latlng.lat;
            const lng = e.latlng.lng;
            _pendingPositions.push({ lat, lng, altitude: 0 });
            _updatePickModeOverlay();

            // Pequeno marcador visual que desaparece após 1 s
            const flash = L.circleMarker([lat, lng], {
                radius: 11, color: '#667eea', fillColor: '#667eea',
                fillOpacity: 0.55, weight: 2.5
            }).addTo(fieldMap);
            setTimeout(() => { try { fieldMap.removeLayer(flash); } catch(_){} }, 900);
        } else if (_lineDrawMode) {
            // Adiciona vértice à linha em desenho
            const lat = e.latlng.lat;
            const lng = e.latlng.lng;
            _linePoints.push({ lat, lng });
            _updateLineOnMap();
            _updateLinePickOverlay();
        }
    });
}

function ecColor(ec) {
    if (ec === null || ec === '') return '#9ca3af';
    const v = parseFloat(ec);
    if (v < 0.5)  return '#3b82f6'; // azul — baixo
    if (v < 2.0)  return '#22c55e'; // verde — médio
    if (v < 4.0)  return '#f59e0b'; // amarelo — alto
    return '#ef4444';               // vermelho — muito alto
}

function ecClass(ec) {
    if (ec === null || ec === '') return 'ec-none';
    const v = parseFloat(ec);
    if (v < 0.5)  return 'ec-low';
    if (v < 2.0)  return 'ec-mid';
    if (v < 4.0)  return 'ec-high';
    return 'ec-vhigh';
}

function updateMap(measurements, skipZoom) {
    if (!fieldMap) return;
    markerLayer.clearLayers();

    const valid = measurements.filter(m => m.latitude && m.longitude);
    if (!valid.length) return;

    valid.forEach(m => {
        const color  = ecColor(m.conductivity);
        const marker = L.circleMarker([parseFloat(m.latitude), parseFloat(m.longitude)], {
            radius:      8,
            fillColor:   color,
            color:       '#fff',
            weight:      2,
            opacity:     1,
            fillOpacity: 0.85
        });

        const ec   = m.conductivity !== null ? parseFloat(m.conductivity).toFixed(2) + ' mS/cm' : '—';
        const ph   = m.ph           !== null ? parseFloat(m.ph).toFixed(1)                      : '—';
        const temp = m.temperature  !== null ? parseFloat(m.temperature).toFixed(1) + ' °C'     : '—';
        const dt   = new Date(m.measured_at).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' });

        marker.bindPopup(`
            <div style="min-width:160px; font-size:13px; line-height:1.7">
                <strong style="font-size:14px">${escHtml(m.username || '—')}</strong>
                ${m.terrain_name ? `<br><span style="color:#667eea">📍 ${escHtml(m.terrain_name)}</span>` : ''}
                <br><span style="color:#6b7280">${dt}</span>
                <hr style="margin:6px 0; border-color:#e5e7eb">
                ⚡ EC: <strong>${ec}</strong><br>
                🧪 pH: <strong>${ph}</strong><br>
                🌡️ Temp: <strong>${temp}</strong>
                ${m.notes ? `<br><br>💬 ${escHtml(m.notes)}` : ''}
            </div>
        `);

        markerLayer.addLayer(marker);
    });

    // Ajusta zoom para caber todos os pontos (a menos que skipZoom esteja activo)
    if (!skipZoom) {
        if (valid.length === 1) {
            fieldMap.setView([parseFloat(valid[0].latitude), parseFloat(valid[0].longitude)], 14);
        } else {
            const bounds = L.latLngBounds(valid.map(m => [parseFloat(m.latitude), parseFloat(m.longitude)]));
            fieldMap.fitBounds(bounds, { padding: [40, 40] });
        }
    }
}

// ── Filtros ───────────────────────────────────────────────────────────────────
function applyFilters() {
    const terrainId = document.getElementById('filter-terrain')?.value || '';

    const fd = new FormData();
    fd.append('action',     'get_field_measurements');
    fd.append('date_from',  document.getElementById('filter-date-from')?.value  || '');
    fd.append('date_to',    document.getElementById('filter-date-to')?.value    || '');
    fd.append('terrain_id', terrainId);

    const userSel = document.getElementById('filter-user');
    if (userSel) fd.append('user_id', userSel.value || '');

    // Mostrar a secção da tabela e indicador de carregamento
    const section = document.getElementById('table-section');
    if (section) section.style.display = '';

    const wrap = document.getElementById('field-table-wrap');
    wrap.innerHTML = '<div style="text-align:center;padding:40px;color:#6b7280">A carregar…</div>';

    fetch('?tab=field', { method: 'POST', body: fd })
        .then(r => r.json())
        .then(data => {
            if (!data.success) {
                wrap.innerHTML = `<div class="warning-box">⚠️ ${escHtml(data.message)}</div>`;
                // Mesmo com erro nos measurements, tentar carregar stats
                loadFieldStats();
                return;
            }
            allMeasurements = data.measurements || [];
            // Stats vêm embutidos na resposta (mais eficiente que pedido extra)
            if (data.stats) {
                updateStats(data.stats);
            } else {
                // Fallback: pedir stats separadamente
                loadFieldStats({
                    terrain_id: document.getElementById('filter-terrain')?.value || '',
                    date_from:  document.getElementById('filter-date-from')?.value || '',
                    date_to:    document.getElementById('filter-date-to')?.value   || '',
                    user_id:    document.getElementById('filter-user')?.value      || '',
                });
            }
            updateMap(allMeasurements, !!terrainId);
            renderTable(allMeasurements);
            if (terrainId) _zoomToFilterTerrain(terrainId);
        })
        .catch(() => {
            wrap.innerHTML = '<div class="sql-error">❌ Erro ao carregar medições.</div>';
            loadFieldStats();  // tentar recuperar stats mesmo com erro
        });
}

// Centra o mapa no polígono do terreno selecionado no filtro
function _zoomToFilterTerrain(terrainId) {
    if (!fieldMap || !terrainId) return;
    const fd = new FormData();
    fd.append('action',     'get_terrain_geom');
    fd.append('terrain_id', terrainId);
    fetch('?tab=field', { method: 'POST', body: fd })
        .then(r => r.json())
        .then(data => {
            if (!data.success || !data.terrain) return;
            const poly = JSON.parse(data.terrain.coordinates);
            const lats = poly.map(c => c.lat !== undefined ? c.lat : c[0]);
            const lngs = poly.map(c => c.lng !== undefined ? c.lng : c[1]);
            fieldMap.fitBounds(
                [[Math.min(...lats), Math.min(...lngs)],
                 [Math.max(...lats), Math.max(...lngs)]],
                { padding: [40, 40] }
            );
        })
        .catch(() => {});
}

function clearFilters() {
    ['filter-date-from','filter-date-to','filter-terrain','filter-user'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });

    // Ocultar tabela e limpar estado
    const section = document.getElementById('table-section');
    if (section) section.style.display = 'none';

    const wrap = document.getElementById('field-table-wrap');
    if (wrap) wrap.innerHTML = '';

    const count = document.getElementById('field-count');
    if (count) count.textContent = '';

    // Limpar mapa e estatísticas
    allMeasurements = [];
    if (markerLayer) markerLayer.clearLayers();
    updateStats({ total: null, avg_ec: null, avg_ph: null, avg_temp: null });
}

// ── Estatísticas ──────────────────────────────────────────────────────────────
// Carrega só as estatísticas (sem measurements) — chamado no arranque e ao filtrar
function loadFieldStats(extraParams) {
    const fd = new FormData();
    fd.append('action', 'get_field_stats');
    if (extraParams) {
        for (const [k, v] of Object.entries(extraParams)) fd.append(k, v);
    }
    fetch('?tab=field', { method: 'POST', body: fd })
        .then(r => r.json())
        .then(data => { if (data.success) updateStats(data.stats); })
        .catch(() => {});  // silencioso — stats não são críticos
}

function updateStats(s) {
    if (!s || typeof s !== 'object') return;
    const fmt = (v, dec) => {
        const n = parseFloat(v);
        return (!isNaN(n)) ? n.toFixed(dec) : '—';
    };
    const setEl = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    };
    setEl('stat-total', (s.total !== null && s.total !== undefined) ? (parseInt(s.total) || 0) : '–');
    setEl('stat-ec',    fmt(s.avg_ec,   2));
    setEl('stat-ph',    fmt(s.avg_ph,   1));
    setEl('stat-temp',  fmt(s.avg_temp, 1));
}

// ── Tabela ────────────────────────────────────────────────────────────────────
function renderTable(data) {
    const wrap  = document.getElementById('field-table-wrap');
    const count = document.getElementById('field-count');
    const isAdm = typeof isAdmin !== 'undefined' ? isAdmin : false; // var global do PHP

    count.textContent = data.length + ' registo(s)';

    if (!data.length) {
        wrap.innerHTML = `
            <div class="empty-field">
                <div class="empty-icon">🌱</div>
                <p>Sem medições para os filtros selecionados.</p>
            </div>`;
        return;
    }

    const adminCol = isAdm ? '<th>Utilizador</th>' : '';

    const rows = data.map(m => {
        const dt      = new Date(m.measured_at).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' });
        const lat     = parseFloat(m.latitude).toFixed(5);
        const lng     = parseFloat(m.longitude).toFixed(5);
        const acc     = m.gps_accuracy ? `±${parseFloat(m.gps_accuracy).toFixed(0)}m` : '';
        const ec      = m.conductivity !== null ? parseFloat(m.conductivity).toFixed(2)   : null;
        const ph      = m.ph           !== null ? parseFloat(m.ph).toFixed(1)             : null;
        const temp    = m.temperature  !== null ? parseFloat(m.temperature).toFixed(1)    : null;
        const moist   = m.moisture     !== null ? parseFloat(m.moisture).toFixed(1)       : null;

        const ecHtml = ec !== null
            ? `<span class="ec-chip ${ecClass(m.conductivity)}">${ec}</span>`
            : '<span style="color:#d1d5db">—</span>';

        const adminCell = isAdm ? `<td><strong>${escHtml(m.username || '—')}</strong></td>` : '';

        const photoCell = m.photo_path
            ? `<td style="text-align:center">
                   <a href="pwa/${escHtml(m.photo_path)}" target="_blank"
                      title="Ver fotografia" style="font-size:18px;text-decoration:none;">📷</a>
               </td>`
            : `<td style="text-align:center;color:#d1d5db;font-size:13px;">—</td>`;

        return `<tr>
            <td style="white-space:nowrap">${dt}</td>
            ${adminCell}
            <td>${m.terrain_name ? escHtml(m.terrain_name) : '<span style="color:#d1d5db">—</span>'}</td>
            <td class="coord-small">${lat}<br>${lng}<br><span style="color:#d1d5db">${acc}</span></td>
            <td style="text-align:center">${ecHtml}</td>
            <td style="text-align:center">${ph   !== null ? ph    : '<span style="color:#d1d5db">—</span>'}</td>
            <td style="text-align:center">${temp !== null ? temp  : '<span style="color:#d1d5db">—</span>'}</td>
            <td style="text-align:center">${moist!== null ? moist : '<span style="color:#d1d5db">—</span>'}</td>
            <td style="max-width:160px;font-size:12px;color:#6b7280">${escHtml(m.notes || '')}</td>
            ${photoCell}
            <td>
                <button class="btn btn-danger btn-sm"
                        onclick="deleteMeasurement(${m.id})"
                        title="Eliminar">🗑️</button>
            </td>
        </tr>`;
    }).join('');

    const adminHead = isAdm ? '<th>Utilizador</th>' : '';

    wrap.innerHTML = `
        <table>
            <thead>
                <tr>
                    <th>Data / Hora</th>
                    ${adminHead}
                    <th>Terreno</th>
                    <th>Coordenadas</th>
                    <th>EC (mS/cm)</th>
                    <th>pH</th>
                    <th>Temp (°C)</th>
                    <th>Hum (%)</th>
                    <th>Notas</th>
                    <th title="Fotografia">📷</th>
                    <th></th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
        <div style="margin-top:10px;font-size:11px;color:#d1d5db;padding:4px 8px;">
            ⚡ EC:
            <span class="ec-chip ec-low" style="margin:0 4px">&lt;0.5 baixo</span>
            <span class="ec-chip ec-mid" style="margin:0 4px">0.5–2 médio</span>
            <span class="ec-chip ec-high" style="margin:0 4px">2–4 alto</span>
            <span class="ec-chip ec-vhigh" style="margin:0 4px">&gt;4 muito alto</span>
        </div>`;
}

// ── Eliminar ──────────────────────────────────────────────────────────────────
function deleteMeasurement(id) {
    if (!confirm('Eliminar esta medição?')) return;

    const fd = new FormData();
    fd.append('action', 'delete_field_measurement');
    fd.append('id', id);

    fetch('?tab=field', { method: 'POST', body: fd })
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                showAlert(data.message, 'success');
                applyFilters();
            } else {
                showAlert(data.message, 'error');
            }
        })
        .catch(() => showAlert('Erro ao eliminar.', 'error'));
}

// ══════════════════════════════════════════════════════════════════════════════
// INTERPOLAÇÃO ESPACIAL IDW
// ══════════════════════════════════════════════════════════════════════════════

// ── Paletas de cores ──────────────────────────────────────────────────────────
const COLORMAPS = {
    ryg:    [[0,[215,25,28]],[0.25,[253,174,97]],[0.5,[255,255,191]],[0.75,[166,217,106]],[1,[26,150,65]]],
    gyr:    [[0,[26,150,65]],[0.25,[166,217,106]],[0.5,[255,255,191]],[0.75,[253,174,97]],[1,[215,25,28]]],
    plasma: [[0,[13,8,135]],[0.33,[126,3,168]],[0.66,[204,71,120]],[0.85,[248,149,64]],[1,[240,249,33]]],
    blues:  [[0,[247,251,255]],[0.33,[198,219,239]],[0.66,[107,174,214]],[1,[8,48,107]]],
    viridis:[[0,[68,1,84]],[0.25,[59,82,139]],[0.5,[33,145,140]],[0.75,[94,201,98]],[1,[253,231,37]]]
};

function colorRamp(t, name) {
    const stops = COLORMAPS[name] || COLORMAPS.ryg;
    t = Math.max(0, Math.min(1, t));
    for (let i = 1; i < stops.length; i++) {
        if (t <= stops[i][0]) {
            const f  = (t - stops[i-1][0]) / (stops[i][0] - stops[i-1][0]);
            const c0 = stops[i-1][1], c1 = stops[i][1];
            return [
                Math.round(c0[0] + f*(c1[0]-c0[0])),
                Math.round(c0[1] + f*(c1[1]-c0[1])),
                Math.round(c0[2] + f*(c1[2]-c0[2]))
            ];
        }
    }
    return stops[stops.length-1][1];
}

// ── IDW (Inverse Distance Weighting) ─────────────────────────────────────────
function idw(pts, lat, lng, power) {
    let ws = 0, vs = 0;
    const cosLat = Math.cos(lat * Math.PI / 180);
    for (const p of pts) {
        const dlat = p.lat - lat;
        const dlng = (p.lng - lng) * cosLat;
        const d    = Math.sqrt(dlat*dlat + dlng*dlng);
        if (d < 1e-10) return p.v;
        const w = 1 / Math.pow(d, power);
        ws += w; vs += w * p.v;
    }
    return ws > 0 ? vs / ws : null;
}

// ── Vizinho mais próximo ──────────────────────────────────────────────────────
function nnValue(pts, lat, lng) {
    const cosL = Math.cos(lat * Math.PI / 180);
    let best = null, bestD = Infinity;
    for (const p of pts) {
        const d = (p.lat - lat) ** 2 + ((p.lng - lng) * cosL) ** 2;
        if (d < bestD) { bestD = d; best = p.v; }
    }
    return best;
}

// ── Álgebra linear (Gauss-Jordan) ─────────────────────────────────────────────
function _gauss(M, sz) {
    // Eliminação de Gauss-Jordan in-place na matriz aumentada M
    for (let col = 0; col < sz; col++) {
        let maxRow = col;
        for (let r = col + 1; r < sz; r++) {
            if (Math.abs(M[r][col]) > Math.abs(M[maxRow][col])) maxRow = r;
        }
        [M[col], M[maxRow]] = [M[maxRow], M[col]];
        const piv = M[col][col];
        if (Math.abs(piv) < 1e-14) continue;
        for (let j = col; j < M[col].length; j++) M[col][j] /= piv;
        for (let r = 0; r < sz; r++) {
            if (r === col) continue;
            const f = M[r][col];
            if (Math.abs(f) < 1e-14) continue;
            for (let j = col; j < M[r].length; j++) M[r][j] -= f * M[col][j];
        }
    }
}

function _matInvert(A) {
    const n = A.length;
    const M = A.map((row, i) => {
        const r = [...row, ...new Array(n).fill(0)];
        r[n + i] = 1;
        return r;
    });
    _gauss(M, n);
    return M.map(row => row.slice(n));
}

function _matVec(A, v) {
    return A.map(row => row.reduce((s, a, j) => s + a * v[j], 0));
}

// ── Kriging Ordinária (variograma auto-ajustado, modelo e nugget configuráveis) ─
function buildKriging(pts, variogramType = 'spherical', nuggetPct = 0) {
    const n    = pts.length;
    const cosL = Math.cos(pts.reduce((s, p) => s + p.lat, 0) / n * Math.PI / 180);

    // Distâncias par-a-par
    const h = Array.from({ length: n }, (_, i) =>
        pts.map((p, j) => {
            const dlat = pts[i].lat - p.lat;
            const dlng = (pts[i].lng - p.lng) * cosL;
            return Math.sqrt(dlat * dlat + dlng * dlng);
        })
    );

    // Auto-ajuste: sill=variância, range=65º percentil das distâncias, nugget=% do sill
    const vals  = pts.map(p => p.v);
    const mean  = vals.reduce((a, b) => a + b, 0) / n;
    const sill  = Math.max(vals.reduce((a, v) => a + (v - mean) ** 2, 0) / n, 1e-10);
    const flatH = [];
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) flatH.push(h[i][j]);
    flatH.sort((a, b) => a - b);
    const range  = flatH[Math.floor(flatH.length * 0.65)] || flatH[flatH.length - 1] || 1;
    const nugget = (nuggetPct / 100) * sill;
    const pSill  = sill - nugget; // sill parcial (continuidade)

    // Função de covariância: C(0) = sill; C(h>0) depende do modelo
    function cov(d) {
        if (d <= 0) return sill;
        if (variogramType === 'exponential') {
            // Exponencial: alcance prático ≈ 3·range → exp(-3)≈0.05
            return nugget + pSill * Math.exp(-3 * d / range);
        }
        if (variogramType === 'gaussian') {
            // Gaussiano: alcance prático ≈ √3·range
            return nugget + pSill * Math.exp(-3 * (d / range) ** 2);
        }
        // Esférico (default)
        if (d >= range) return nugget;
        const r = d / range;
        return nugget + pSill * (1 - 1.5 * r + 0.5 * r * r * r);
    }

    // Matriz kriging (n+1)×(n+1) com multiplicador de Lagrange
    const K = Array.from({ length: n + 1 }, (_, i) =>
        Array.from({ length: n + 1 }, (_, j) => {
            if (i === n && j === n) return 0;
            if (i === n || j === n) return 1;
            return cov(h[i][j]) + (i === j ? sill * 1e-6 : 0); // jitter de estabilidade
        })
    );

    const Kinv = _matInvert(K);

    return function predict(lat, lng) {
        const k = pts.map(p => {
            const dlat = p.lat - lat;
            const dlng = (p.lng - lng) * cosL;
            return cov(Math.sqrt(dlat * dlat + dlng * dlng));
        });
        k.push(1); // restrição de não-enviesamento
        const w = _matVec(Kinv, k);
        return pts.reduce((z, p, i) => z + w[i] * p.v, 0);
    };
}

// ── Thin Plate Spline (com parâmetro de suavização λ) ────────────────────────
function buildTPS(pts, smoothVal = 0) {
    const n   = pts.length;
    const sz  = n + 3;
    const phi = r => (r < 1e-10 ? 0 : r * r * Math.log(r)); // φ(r) = r²·ln(r)

    // Sistema [Φ P; Pᵀ 0]·[w; a₀ a₁ a₂] = [z; 0 0 0]
    const M = Array.from({ length: sz }, (_, i) => {
        const row = new Array(sz + 1).fill(0);
        if (i < n) {
            for (let j = 0; j < n; j++) {
                const dlat = pts[i].lat - pts[j].lat;
                const dlng = pts[i].lng - pts[j].lng;
                row[j] = phi(Math.sqrt(dlat * dlat + dlng * dlng));
            }
            row[n] = 1; row[n + 1] = pts[i].lat; row[n + 2] = pts[i].lng;
            row[sz] = pts[i].v;
        } else {
            const k = i - n; // 0→const, 1→lat, 2→lng
            for (let j = 0; j < n; j++) {
                row[j] = k === 0 ? 1 : k === 1 ? pts[j].lat : pts[j].lng;
            }
        }
        return row;
    });

    // Suavização λ: adicionar λ·I à sub-matriz Φ (só linhas/colunas 0..n-1)
    // λ é escalado pelo valor máximo off-diagonal de Φ para ser independente da escala
    if (smoothVal > 0) {
        let maxPhi = 0;
        for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
            if (i !== j) maxPhi = Math.max(maxPhi, Math.abs(M[i][j]));
        }
        const lambda = (smoothVal / 50) * maxPhi;
        for (let i = 0; i < n; i++) M[i][i] += lambda;
    }

    _gauss(M, sz);
    const coeffs = M.map(row => row[sz]);
    const w = coeffs.slice(0, n);
    const [a0, a1, a2] = coeffs.slice(n);

    return function predict(lat, lng) {
        let z = a0 + a1 * lat + a2 * lng;
        for (let i = 0; i < n; i++) {
            const dlat = pts[i].lat - lat;
            const dlng = pts[i].lng - lng;
            z += w[i] * phi(Math.sqrt(dlat * dlat + dlng * dlng));
        }
        return z;
    };
}

// ── Point-in-polygon (ray casting) ───────────────────────────────────────────
function pip(lat, lng, poly) {
    let inside = false;
    const n = poly.length;
    for (let i = 0, j = n-1; i < n; j = i++) {
        const ai = poly[i], aj = poly[j];
        const yi = ai.lng !== undefined ? ai.lng : ai[1];
        const xi = ai.lat !== undefined ? ai.lat : ai[0];
        const yj = aj.lng !== undefined ? aj.lng : aj[1];
        const xj = aj.lat !== undefined ? aj.lat : aj[0];
        if (((yi > lng) !== (yj > lng)) &&
            (lat < (xj - xi) * (lng - yi) / (yj - yi) + xi)) {
            inside = !inside;
        }
    }
    return inside;
}

// ── UI: mostrar parâmetros do método seleccionado ────────────────────────────
function onInterpMethodChange() {
    const method = document.getElementById('interp-method')?.value || 'idw';
    const show = {
        'ipar-idw':      method === 'idw',
        'ipar-kriging':  method === 'kriging',
        'ipar-kriging2': method === 'kriging',
        'ipar-tps':      method === 'tps',
    };
    Object.entries(show).forEach(([id, visible]) => {
        const el = document.getElementById(id);
        if (el) el.style.display = visible ? '' : 'none';
    });
}

// ── UI: toggle painel ─────────────────────────────────────────────────────────
function toggleInterpPanel() {
    const panel = document.getElementById('interp-panel');
    const btn   = document.getElementById('interp-toggle-btn');
    const open  = panel.style.display === 'none';
    panel.style.display = open ? 'block' : 'none';
    btn.textContent     = open ? '▲ Recolher' : '▼ Expandir';
}

function setInterpStatus(msg) {
    const el = document.getElementById('interp-status');
    if (el) el.textContent = msg;
}

function updateOverlayOpacity() {
    if (!interpolationOverlay) return;
    const v = parseInt(document.getElementById('interp-opacity').value) / 100;
    interpolationOverlay.setOpacity(v);
}

function removeInterpolation() {
    if (interpolationOverlay) { fieldMap.removeLayer(interpolationOverlay); interpolationOverlay = null; }
    const leg = document.getElementById('interp-legend');
    if (leg) leg.style.display = 'none';
    const saveBox = document.getElementById('interp-save-box');
    if (saveBox) saveBox.style.display = 'none';
    lastInterpDataUrl = null;
    lastInterpBounds  = null;
    lastInterpMeta    = null;
    setInterpStatus('Overlay removido.');
}

// ── Gerar interpolação ────────────────────────────────────────────────────────
const INTERP_METHOD_LABELS = {
    kriging: 'Kriging Ordinária',
    tps:     'Thin Plate Spline',
    nn:      'Vizinho mais próximo'
};
function _interpLabel(method, power) {
    return method === 'idw' ? `IDW (p=${power})` : (INTERP_METHOD_LABELS[method] || method);
}

async function generateInterpolation() {
    const terrainId = document.getElementById('interp-terrain-sel').value;
    const param     = document.getElementById('interp-param').value;
    const colormap  = document.getElementById('interp-colormap').value;
    const resPx     = parseInt(document.getElementById('interp-res').value);
    const opacity   = parseInt(document.getElementById('interp-opacity').value) / 100;
    const method      = document.getElementById('interp-method')?.value || 'idw';
    const power       = parseFloat(document.getElementById('interp-power')?.value      || 2);
    const variogram   = document.getElementById('interp-variogram')?.value             || 'spherical';
    const nuggetPct   = parseFloat(document.getElementById('interp-nugget')?.value     || 0);
    const tpsSmooth   = parseFloat(document.getElementById('interp-tps-smooth')?.value || 0);

    if (!terrainId) { setInterpStatus('⚠️ Selecione um campo (terreno).'); return; }

    // Pontos com o parâmetro escolhido
    const pts = allMeasurements
        .filter(m => m[param] !== null && m[param] !== '' && m.latitude && m.longitude)
        .map(m => ({ lat: parseFloat(m.latitude), lng: parseFloat(m.longitude), v: parseFloat(m[param]) }));

    const minPts = (method === 'tps' || method === 'kriging') ? 3 : 2;
    if (pts.length < minPts) {
        setInterpStatus(`⚠️ São necessárias ≥ ${minPts} medições com "${param}" nos filtros actuais.`);
        return;
    }

    setInterpStatus('⏳ A obter geometria do terreno…');

    // Geometria do terreno
    const fd = new FormData();
    fd.append('action', 'get_terrain_geom');
    fd.append('terrain_id', terrainId);
    let geomData;
    try {
        const r = await fetch('?tab=field', { method: 'POST', body: fd });
        geomData = await r.json();
    } catch { setInterpStatus('❌ Erro de rede ao obter terreno.'); return; }
    if (!geomData.success) { setInterpStatus('❌ ' + geomData.message); return; }

    const poly = JSON.parse(geomData.terrain.coordinates); // [{lat,lng}...]
    const lats  = poly.map(c => c.lat !== undefined ? c.lat : c[0]);
    const lngs  = poly.map(c => c.lng !== undefined ? c.lng : c[1]);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);

    // ── Fase de setup (modelos que requerem pré-computação) ───────────────────
    let predictor = null;
    if (method === 'kriging' || method === 'tps') {
        setInterpStatus(`⏳ A construir modelo ${_interpLabel(method, power)} (${pts.length} pontos)…`);
        await new Promise(r => setTimeout(r, 30));
        try {
            predictor = method === 'kriging'
                ? buildKriging(pts, variogram, nuggetPct)
                : buildTPS(pts, tpsSmooth);
        } catch (err) {
            setInterpStatus('❌ Erro ao construir modelo: ' + err.message);
            return;
        }
    }

    setInterpStatus(`⏳ A calcular ${_interpLabel(method, power)} (${pts.length} pontos, ${resPx}×${resPx} px)…`);
    await new Promise(r => setTimeout(r, 20));

    const minV = Math.min(...pts.map(p => p.v));
    const maxV = Math.max(...pts.map(p => p.v));

    const canvas  = document.createElement('canvas');
    canvas.width  = resPx;
    canvas.height = resPx;
    const ctx     = canvas.getContext('2d');
    const img     = ctx.createImageData(resPx, resPx);
    const alpha   = Math.round(opacity * 255);

    for (let py = 0; py < resPx; py++) {
        const lat = maxLat - (py / resPx) * (maxLat - minLat);
        for (let px = 0; px < resPx; px++) {
            const lng = minLng + (px / resPx) * (maxLng - minLng);
            if (!pip(lat, lng, poly)) continue;

            let val;
            if (method === 'idw')  val = idw(pts, lat, lng, power);
            else if (method === 'nn') val = nnValue(pts, lat, lng);
            else val = predictor(lat, lng);

            if (val === null) continue;

            // Clamp ao intervalo dos dados (kriging/tps podem extrapolar)
            const vc = Math.max(minV, Math.min(maxV, val));
            const t  = maxV > minV ? (vc - minV) / (maxV - minV) : 0.5;
            const [r, g, b] = colorRamp(t, colormap);
            const i = (py * resPx + px) * 4;
            img.data[i] = r; img.data[i+1] = g; img.data[i+2] = b; img.data[i+3] = alpha;
        }
    }
    ctx.putImageData(img, 0, 0);

    // Remover overlay anterior
    if (interpolationOverlay) fieldMap.removeLayer(interpolationOverlay);

    const bounds = [[minLat, minLng], [maxLat, maxLng]];
    interpolationOverlay = L.imageOverlay(canvas.toDataURL('image/png'), bounds, { opacity })
        .addTo(fieldMap);

    fieldMap.fitBounds(bounds, { padding: [60, 60] });

    // Legenda
    const paramLabels = { conductivity:'EC (mS/cm)', ph:'pH', temperature:'Temp. (°C)', moisture:'Hum. (%)' };
    drawInterpLegend(minV, maxV, colormap, paramLabels[param] || param);

    setInterpStatus(`✅ ${_interpLabel(method, power)} concluído — ${pts.length} pontos · ${resPx}×${resPx} px`);

    // ── Guardar resultado para posterior salvamento ────────────────────────────
    lastInterpDataUrl = canvas.toDataURL('image/png');
    lastInterpBounds  = { minLat, maxLat, minLng, maxLng };
    lastInterpMeta    = { minV, maxV, param, colormap, method,
                          terrainId: terrainId,
                          resolution: resPx, power };

    // Mostrar caixa de guardar
    const saveBox = document.getElementById('interp-save-box');
    if (saveBox) saveBox.style.display = 'block';
    const saveStatus = document.getElementById('interp-save-status');
    if (saveStatus) saveStatus.textContent = '';
}

// ── Legenda ───────────────────────────────────────────────────────────────────
function drawInterpLegend(minV, maxV, colormap, label) {
    const canvas = document.getElementById('legend-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    for (let x = 0; x < w; x++) {
        const [r, g, b] = colorRamp(x / w, colormap);
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(x, 0, 1, h);
    }
    document.getElementById('legend-min').textContent = minV.toFixed(2);
    document.getElementById('legend-mid').textContent = ((minV + maxV) / 2).toFixed(2);
    document.getElementById('legend-max').textContent = maxV.toFixed(2);
    document.getElementById('interp-legend-title').textContent = `Legenda: ${label}`;
    document.getElementById('interp-legend').style.display = 'block';
}

// ══════════════════════════════════════════════════════════════════════════════
// INTERPOLAÇÕES GUARDADAS
// ══════════════════════════════════════════════════════════════════════════════

function toggleSavedInterpPanel() {
    const panel = document.getElementById('saved-interp-panel');
    const btn   = document.getElementById('saved-interp-toggle');
    const open  = panel.style.display === 'none';
    panel.style.display = open ? 'block' : 'none';
    if (btn) btn.textContent = open ? '▲ Recolher' : '▼ Expandir';
    if (open) loadSavedInterpolations();
}

function loadSavedInterpolations() {
    const list = document.getElementById('saved-interp-list');
    if (list) list.innerHTML = '<div style="text-align:center;padding:20px;color:#9ca3af">A carregar…</div>';

    const fd = new FormData();
    fd.append('action', 'get_interpolations');

    fetch('?tab=field', { method: 'POST', body: fd })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (!data.success) {
                if (list) list.innerHTML =
                    '<div class="warning-box">⚠️ ' + escHtml(data.message || 'Erro ao carregar.') +
                    ' — aplique a migração <strong>002_field_interpolations</strong> em Admin → Migrações.</div>';
                return;
            }
            savedInterpData = data.interpolations || [];
            renderSavedInterpolations(savedInterpData);
        })
        .catch(function() {
            if (list) list.innerHTML = '<div class="sql-error">❌ Erro de rede ao carregar interpolações.</div>';
        });
}

function renderSavedInterpolations(items) {
    const list = document.getElementById('saved-interp-list');
    if (!list) return;

    if (!items.length) {
        list.innerHTML = '<div class="empty-field"><div class="empty-icon">🎨</div>' +
            '<p>Nenhuma interpolação guardada ainda.<br>' +
            '<small style="color:#d1d5db">Gere uma interpolação e clique em "💾 Guardar".</small></p></div>';
        return;
    }

    const PARAM_LABELS = {
        conductivity: 'EC (mS/cm)', ph: 'pH',
        temperature:  'Temp (°C)', moisture: 'Hum (%)'
    };

    const rows = items.map(function(item) {
        const dt      = new Date(item.created_at).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' });
        const param   = PARAM_LABELS[item.param] || item.param;
        const terrain = item.terrain_name || '—';
        const minV    = item.min_val !== null ? parseFloat(item.min_val).toFixed(2) : '—';
        const maxV    = item.max_val !== null ? parseFloat(item.max_val).toFixed(2) : '—';
        const loaded  = !!savedOverlayLayers[item.id];

        return '<tr id="saved-row-' + item.id + '">' +
            '<td style="font-weight:600;max-width:180px">' + escHtml(item.name) + '</td>' +
            '<td>' + escHtml(terrain) + '</td>' +
            '<td>' + escHtml(param) + '</td>' +
            '<td style="font-size:11px;color:#6b7280;white-space:nowrap">' + minV + ' – ' + maxV + '</td>' +
            '<td style="font-size:11px;color:#9ca3af;white-space:nowrap">' + dt + '</td>' +
            '<td>' +
                '<div style="display:flex;gap:4px;flex-wrap:wrap;">' +
                    '<button id="show-btn-' + item.id + '" class="btn btn-secondary btn-sm" ' +
                        'onclick="toggleSavedOnMap(' + item.id + ')" ' +
                        'style="' + (loaded ? 'background:#667eea;color:#fff;border-color:#667eea;' : '') + '">' +
                        (loaded ? '👁️ Visível' : '👁️ Mostrar') + '</button>' +
                    '<button class="btn btn-secondary btn-sm" onclick="downloadInterpPng(' + item.id + ')" ' +
                        'title="Download PNG georeferenciado">⬇ PNG</button>' +
                    '<button class="btn btn-secondary btn-sm" onclick="downloadInterpPgw(' + item.id + ')" ' +
                        'title="Download World File (.pgw) para QGIS / SIG">⬇ PGW</button>' +
                    '<button class="btn btn-danger btn-sm" onclick="deleteSavedInterp(' + item.id + ')" ' +
                        'title="Eliminar">🗑️</button>' +
                '</div>' +
            '</td>' +
        '</tr>';
    }).join('');

    list.innerHTML =
        '<div style="overflow-x:auto">' +
        '<table>' +
        '<thead><tr>' +
            '<th>Nome</th><th>Terreno</th><th>Parâmetro</th>' +
            '<th>Intervalo</th><th>Data</th><th>Ações</th>' +
        '</tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
        '</table></div>' +
        '<p style="font-size:11px;color:#9ca3af;margin-top:8px;padding:0 4px">' +
            '📌 O ficheiro .pgw é o <em>PNG World File</em> — abra-o com o PNG em QGIS (CRS: WGS 84 / EPSG:4326).' +
        '</p>';
}

// ── Guardar interpolação ──────────────────────────────────────────────────────
function saveInterpolation() {
    if (!lastInterpDataUrl || !lastInterpBounds || !lastInterpMeta) {
        showAlert('Nenhuma interpolação activa para guardar. Gere primeiro uma interpolação.', 'error');
        return;
    }
    const name = (document.getElementById('interp-save-name').value || '').trim();
    if (!name) {
        showAlert('Insira um nome para a interpolação antes de guardar.', 'error');
        document.getElementById('interp-save-name').focus();
        return;
    }

    const saveStatus = document.getElementById('interp-save-status');
    if (saveStatus) saveStatus.textContent = '⏳ A guardar…';

    const fd = new FormData();
    fd.append('action',     'save_interpolation');
    fd.append('name',       name);
    fd.append('png_data',   lastInterpDataUrl);
    fd.append('param',      lastInterpMeta.param);
    fd.append('colormap',   lastInterpMeta.colormap);
    fd.append('resolution', lastInterpMeta.resolution);
    fd.append('power',      lastInterpMeta.power);
    fd.append('method',     lastInterpMeta.method || 'idw');
    fd.append('min_lat',    lastInterpBounds.minLat);
    fd.append('max_lat',    lastInterpBounds.maxLat);
    fd.append('min_lng',    lastInterpBounds.minLng);
    fd.append('max_lng',    lastInterpBounds.maxLng);
    if (lastInterpMeta.minV !== undefined) fd.append('min_val', lastInterpMeta.minV);
    if (lastInterpMeta.maxV !== undefined) fd.append('max_val', lastInterpMeta.maxV);
    if (lastInterpMeta.terrainId) fd.append('terrain_id', lastInterpMeta.terrainId);

    fetch('?tab=field', { method: 'POST', body: fd })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.success) {
                if (saveStatus) saveStatus.textContent = '✅ Guardado! (ID #' + data.id + ')';
                document.getElementById('interp-save-name').value = '';
                // Auto-abre o painel de guardadas e recarrega a lista
                const panel = document.getElementById('saved-interp-panel');
                if (panel && panel.style.display === 'none') {
                    panel.style.display = 'block';
                    const tb = document.getElementById('saved-interp-toggle');
                    if (tb) tb.textContent = '▲ Recolher';
                }
                loadSavedInterpolations();
            } else {
                if (saveStatus) saveStatus.textContent = '❌ ' + (data.message || 'Erro ao guardar.');
            }
        })
        .catch(function() {
            if (saveStatus) saveStatus.textContent = '❌ Erro de rede.';
        });
}

// ── Mostrar / ocultar no mapa ─────────────────────────────────────────────────
function toggleSavedOnMap(id) {
    if (savedOverlayLayers[id]) { hideSavedOnMap(id); } else { showSavedOnMap(id); }
}

function showSavedOnMap(id) {
    const btn = document.getElementById('show-btn-' + id);
    if (btn) { btn.textContent = '⏳'; btn.disabled = true; }

    const fd = new FormData();
    fd.append('action', 'get_interpolation_png');
    fd.append('id',     id);

    fetch('?tab=field', { method: 'POST', body: fd })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (!data.success) {
                showAlert('❌ ' + (data.message || 'Erro ao carregar interpolação.'), 'error');
                if (btn) { btn.textContent = '👁️ Mostrar'; btn.disabled = false; }
                return;
            }
            const bounds  = [[data.min_lat, data.min_lng], [data.max_lat, data.max_lng]];
            const overlay = L.imageOverlay(data.png, bounds, { opacity: 0.75 }).addTo(fieldMap);
            savedOverlayLayers[id] = overlay;
            if (fieldLayersControl) fieldLayersControl.addOverlay(overlay, '🎨 ' + data.name);
            fieldMap.fitBounds(bounds, { padding: [40, 40] });
            if (btn) {
                btn.textContent       = '👁️ Visível';
                btn.style.background  = '#667eea';
                btn.style.color       = '#fff';
                btn.style.borderColor = '#667eea';
                btn.disabled          = false;
            }
        })
        .catch(function() {
            showAlert('Erro de rede ao carregar interpolação.', 'error');
            if (btn) { btn.textContent = '👁️ Mostrar'; btn.disabled = false; }
        });
}

function hideSavedOnMap(id) {
    if (savedOverlayLayers[id]) {
        if (fieldLayersControl) fieldLayersControl.removeLayer(savedOverlayLayers[id]);
        fieldMap.removeLayer(savedOverlayLayers[id]);
        delete savedOverlayLayers[id];
    }
    const btn = document.getElementById('show-btn-' + id);
    if (btn) {
        btn.textContent       = '👁️ Mostrar';
        btn.style.background  = '';
        btn.style.color       = '';
        btn.style.borderColor = '';
    }
}

// ── Downloads ─────────────────────────────────────────────────────────────────
function downloadInterpPng(id) {
    const item     = savedInterpData.find(function(x) { return parseInt(x.id) === parseInt(id); });
    const rawName  = item ? item.name : ('interpolacao_' + id);
    const safeName = rawName.replace(/[^\wÀ-ɏ \-]/g, '_').trim();

    const fd = new FormData();
    fd.append('action', 'get_interpolation_png');
    fd.append('id',     id);

    fetch('?tab=field', { method: 'POST', body: fd })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (!data.success) { showAlert('Erro: ' + (data.message || ''), 'error'); return; }
            // Trigger browser download from data URL
            const a    = document.createElement('a');
            a.href     = data.png;
            a.download = safeName + '.png';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        })
        .catch(function() { showAlert('Erro de rede ao fazer download.', 'error'); });
}

function downloadInterpPgw(id) {
    const item = savedInterpData.find(function(x) { return parseInt(x.id) === parseInt(id); });
    if (!item) { showAlert('Dados não encontrados. Recarregue a lista.', 'error'); return; }

    const res    = parseInt(item.resolution);
    const minLat = parseFloat(item.min_lat);
    const maxLat = parseFloat(item.max_lat);
    const minLng = parseFloat(item.min_lng);
    const maxLng = parseFloat(item.max_lng);

    // PNG World File (.pgw) — 6 lines:
    // Line 1: pixel width  (longitude per pixel, positive → east)
    // Line 2: rotation about y (0 for north-up)
    // Line 3: rotation about x (0 for north-up)
    // Line 4: pixel height (latitude per pixel, NEGATIVE → south)
    // Line 5: longitude of center of upper-left pixel
    // Line 6: latitude  of center of upper-left pixel
    const pixW   =  (maxLng - minLng) / res;
    const pixH   = -(maxLat - minLat) / res;
    const origX  =  minLng + pixW / 2;
    const origY  =  maxLat + pixH / 2;   // pixH is negative → slightly south of maxLat

    const pgwContent = [
        pixW.toFixed(10),
        '0.0000000000',
        '0.0000000000',
        pixH.toFixed(10),
        origX.toFixed(10),
        origY.toFixed(10)
    ].join('\n');

    const safeName = item.name.replace(/[^\wÀ-ɏ \-]/g, '_').trim();
    const blob = new Blob([pgwContent], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = safeName + '.pgw';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ── Eliminar ──────────────────────────────────────────────────────────────────
function deleteSavedInterp(id) {
    if (!confirm('Eliminar esta interpolação da base de dados?')) return;

    hideSavedOnMap(id); // remove from map first if visible

    const fd = new FormData();
    fd.append('action', 'delete_interpolation');
    fd.append('id',     id);

    fetch('?tab=field', { method: 'POST', body: fd })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.success) {
                showAlert('Interpolação eliminada.', 'success');
                loadSavedInterpolations();
            } else {
                showAlert('Erro: ' + (data.message || ''), 'error');
            }
        })
        .catch(function() { showAlert('Erro de rede.', 'error'); });
}

// ══════════════════════════════════════════════════════════════════════════════
// ADICIONAR MEDIÇÃO DIRECTAMENTE NO MAPA
// ══════════════════════════════════════════════════════════════════════════════

function toggleAddMode() {
    addModeActive = !addModeActive;
    const btn = document.getElementById('field-add-ctrl');
    if (addModeActive) {
        fieldMap.getContainer().style.cursor = 'crosshair';
        if (btn) {
            btn.textContent  = '✖ Cancelar';
            btn.style.background = '#fee2e2';
            btn.style.borderColor = '#ef4444';
            btn.style.color = '#b91c1c';
        }
        showAlert('Clique no mapa para adicionar uma medição nesse ponto.', 'info');
    } else {
        fieldMap.getContainer().style.cursor = '';
        if (btn) {
            btn.textContent  = '📍 Adicionar';
            btn.style.background = '#fff';
            btn.style.borderColor = 'rgba(0,0,0,.2)';
            btn.style.color = '';
        }
        // remove temp marker if modal was closed without saving
        if (tempMarker) { fieldMap.removeLayer(tempMarker); tempMarker = null; }
    }
}

function openQuickModal(lat, lng) {
    // Desligar modo de adição imediatamente
    addModeActive = false;
    const btn = document.getElementById('field-add-ctrl');
    if (btn) {
        btn.textContent  = '📍 Adicionar';
        btn.style.background = '#fff';
        btn.style.borderColor = 'rgba(0,0,0,.2)';
        btn.style.color = '';
    }
    fieldMap.getContainer().style.cursor = '';

    // Marcador temporário no local clicado
    if (tempMarker) fieldMap.removeLayer(tempMarker);
    tempMarker = L.circleMarker([lat, lng], {
        radius: 10, fillColor: '#667eea', color: '#fff',
        weight: 3, opacity: 1, fillOpacity: 0.9,
        dashArray: '4 2'
    }).addTo(fieldMap);
    tempMarker.bindPopup('📍 Nova medição aqui').openPopup();

    // Preencher coordenadas no modal
    document.getElementById('qm-lat').value = lat.toFixed(7);
    document.getElementById('qm-lng').value = lng.toFixed(7);

    // Limpar campos anteriores
    ['qm-ec','qm-ph','qm-temp','qm-moisture','qm-notes'].forEach(function(id) {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    const terrSel = document.getElementById('qm-terrain');
    if (terrSel) terrSel.value = '';

    // Mostrar modal
    document.getElementById('quick-modal-backdrop').style.display = 'block';
    document.getElementById('quick-modal').style.display = 'block';
    document.getElementById('qm-ec').focus();
}

function closeQuickModal() {
    document.getElementById('quick-modal-backdrop').style.display = 'none';
    document.getElementById('quick-modal').style.display = 'none';

    if (tempMarker) { fieldMap.removeLayer(tempMarker); tempMarker = null; }
}

function submitQuickMeasurement() {
    const lat  = parseFloat(document.getElementById('qm-lat').value);
    const lng  = parseFloat(document.getElementById('qm-lng').value);

    if (isNaN(lat) || isNaN(lng)) {
        showAlert('Coordenadas inválidas.', 'error');
        return;
    }

    const fd = new FormData();
    fd.append('action',    'save_field_measurement');
    fd.append('latitude',  lat);
    fd.append('longitude', lng);

    const ec    = document.getElementById('qm-ec').value.trim();
    const ph    = document.getElementById('qm-ph').value.trim();
    const temp  = document.getElementById('qm-temp').value.trim();
    const moist = document.getElementById('qm-moisture').value.trim();
    const notes = document.getElementById('qm-notes').value.trim();
    const terr  = document.getElementById('qm-terrain').value;

    if (ec)    fd.append('conductivity', ec);
    if (ph)    fd.append('ph', ph);
    if (temp)  fd.append('temperature', temp);
    if (moist) fd.append('moisture', moist);
    if (notes) fd.append('notes', notes);
    if (terr)  fd.append('terrain_id', terr);

    const submitBtn = document.getElementById('qm-submit');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '⏳ A guardar…'; }

    fetch('?tab=field', { method: 'POST', body: fd })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '💾 Guardar'; }
            if (data.success) {
                closeQuickModal();
                showAlert('Medição adicionada com sucesso.', 'success');
                applyFilters();   // actualiza tabela, mapa e estatísticas
            } else {
                showAlert('Erro: ' + (data.message || 'Falha ao guardar.'), 'error');
            }
        })
        .catch(function() {
            if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '💾 Guardar'; }
            showAlert('Erro de rede ao guardar medição.', 'error');
        });
}

// ── GeoJSON Import & Layers ───────────────────────────────────────────────────

function toggleGeoJSONPanel() {
    const panel = document.getElementById('geojson-panel');
    const btn   = document.getElementById('geojson-toggle-btn');
    if (!panel) return;
    const open = panel.style.display === 'none';
    panel.style.display = open ? 'block' : 'none';
    btn.textContent = open ? '▲ Recolher' : '▼ Expandir';
    if (open) loadGeoJSONLayers();
}

// Ficheiro selecionado — ler e pré-validar (GeoJSON/JSON local; KMZ/KML via servidor)
function onGeoJSONFileSelected(input) {
    const file = input.files[0];
    if (!file) return;

    const info    = document.getElementById('gj-file-info');
    const saveBtn = document.getElementById('gj-save-btn');
    pendingGeoJSON = null;
    pendingKmzFile = null;
    pendingPosFile = null;
    saveBtn.disabled = true;

    if (file.size > 20 * 1024 * 1024) {
        info.textContent = '⚠️ Ficheiro demasiado grande (máx. 20 MB).';
        info.style.color = '#dc2626';
        return;
    }

    const ext = file.name.split('.').pop().toLowerCase();
    const kb  = (file.size / 1024).toFixed(0);

    if (!['kmz','kml','geojson','json','pos'].includes(ext)) {
        info.textContent = `⚠️ Formato não suportado (.${ext}). Use .geojson, .json, .kmz, .kml ou .pos.`;
        info.style.color = '#dc2626';
        return;
    }

    // ── KMZ / KML: guardar File object — conversão feita no servidor ──────────
    if (ext === 'kmz' || ext === 'kml') {
        pendingKmzFile = file;
        info.textContent = `✓ ${file.name}  •  ${kb} KB  •  será convertido pelo servidor`;
        info.style.color = '#16a34a';
        const nameEl = document.getElementById('gj-name');
        if (!nameEl.value) nameEl.value = file.name.replace(/\.(kmz|kml)$/i, '');
        saveBtn.disabled = false;
        return;
    }

    // ── RTKLIB .pos: guardar File object — parsing feito no servidor ──────────
    if (ext === 'pos') {
        pendingPosFile = file;
        info.textContent = `✓ ${file.name}  •  ${kb} KB  •  trajectória GNSS (RTKLIB)`;
        info.style.color = '#16a34a';
        const nameEl = document.getElementById('gj-name');
        if (!nameEl.value) nameEl.value = file.name.replace(/\.pos$/i, '');
        saveBtn.disabled = false;
        return;
    }

    // ── GeoJSON / JSON: ler e validar localmente ──────────────────────────────
    const reader = new FileReader();
    reader.onload = function (e) {
        try {
            const parsed = JSON.parse(e.target.result);
            const type   = parsed.type || '';
            let count = 0;
            if (type === 'FeatureCollection') count = (parsed.features || []).length;
            else if (type === 'Feature')      count = 1;
            else if (['Polygon','MultiPolygon','LineString','MultiLineString',
                      'Point','MultiPoint','GeometryCollection'].includes(type)) count = 1;
            else { throw new Error('Tipo GeoJSON não reconhecido: ' + type); }

            pendingGeoJSON = e.target.result;
            info.textContent = `✓ ${file.name}  •  ${count} feature(s)  •  ${kb} KB`;
            info.style.color = '#16a34a';
            const nameEl = document.getElementById('gj-name');
            if (!nameEl.value) nameEl.value = file.name.replace(/\.(geojson|json)$/i, '');
            saveBtn.disabled = false;
        } catch (err) {
            info.textContent = '⚠️ Ficheiro inválido: ' + err.message;
            info.style.color = '#dc2626';
        }
    };
    reader.readAsText(file);
}

// Guardar GeoJSON na BD
const _GJ_FILE_ACCEPT = '*/*';
const _GJ_FILE_LABEL  = '📁 Clique para selecionar .geojson / .json / .kmz / .kml / .pos';

function _gjReset(status, btn) {
    pendingGeoJSON = null;
    pendingKmzFile = null;
    pendingPosFile = null;
    ['gj-name','gj-description'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    const terr = document.getElementById('gj-terrain'); if (terr) terr.value = '';
    try { document.getElementById('gj-file').value = ''; } catch {}
    document.getElementById('gj-file-info').textContent = '';
    document.getElementById('gj-file-label').innerHTML =
        _GJ_FILE_LABEL +
        `<input id="gj-file" type="file" accept="${_GJ_FILE_ACCEPT}" style="display:none" onchange="onGeoJSONFileSelected(this)">`;
    btn.disabled = true;
    if (status) { status.textContent = ''; }
}

function saveGeoJSON() {
    if (!pendingGeoJSON && !pendingKmzFile && !pendingPosFile) return;

    const name   = (document.getElementById('gj-name')?.value || '').trim();
    const descr  = (document.getElementById('gj-description')?.value || '').trim();
    const terrId = document.getElementById('gj-terrain')?.value || '';
    const status = document.getElementById('gj-save-status');
    const btn    = document.getElementById('gj-save-btn');

    if (!name) { status.textContent = '⚠️ Preencha o nome da camada.'; status.style.color = '#dc2626'; return; }

    btn.disabled = true;

    const fd = new FormData();
    fd.append('name',        name);
    fd.append('description', descr);
    fd.append('terrain_id',  terrId);

    if (pendingKmzFile) {
        // KMZ/KML: enviar ficheiro raw — servidor converte para GeoJSON
        fd.append('action',    'save_kmz');
        fd.append('kmz_file',  pendingKmzFile, pendingKmzFile.name);
        status.textContent = '⏳ A converter e guardar…';
    } else if (pendingPosFile) {
        // RTKLIB .pos: enviar ficheiro raw — servidor faz parsing e converte para GeoJSON
        fd.append('action',   'save_pos');
        fd.append('pos_file', pendingPosFile, pendingPosFile.name);
        status.textContent = '⏳ A importar trajectória GNSS…';
    } else {
        // GeoJSON/JSON: enviar texto já validado
        fd.append('action',       'save_geojson');
        fd.append('geojson_data', pendingGeoJSON);
        status.textContent = '⏳ A guardar…';
    }
    status.style.color = '#6b7280';

    fetch('', { method: 'POST', body: fd })
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                status.textContent = '✓ ' + data.message;
                status.style.color = '#16a34a';
                _gjReset(null, btn);
                loadGeoJSONLayers();
            } else {
                status.textContent = '⚠️ ' + (data.message || 'Erro ao guardar.');
                status.style.color = '#dc2626';
                btn.disabled = false;
            }
        })
        .catch(() => {
            status.textContent = '⚠️ Erro de rede.';
            status.style.color = '#dc2626';
            btn.disabled = false;
        });
}

// Carregar lista de camadas guardadas
function loadGeoJSONLayers() {
    const list = document.getElementById('geojson-layers-list');
    if (!list) return;
    list.innerHTML = '<div style="text-align:center;padding:20px;color:#9ca3af;">A carregar…</div>';

    const fd = new FormData();
    fd.append('action', 'get_geojson_layers');

    fetch('', { method: 'POST', body: fd })
        .then(r => r.json())
        .then(data => {
            if (!data.success) { list.innerHTML = '<div style="color:#dc2626;padding:10px;">' + escHtml(data.message||'Erro') + '</div>'; return; }
            renderGeoJSONList(data.layers || []);
        })
        .catch(() => { list.innerHTML = '<div style="color:#dc2626;padding:10px;">Erro de rede.</div>'; });
}

const GJ_COLORS = ['#3b82f6','#f59e0b','#ef4444','#8b5cf6','#10b981','#ec4899','#06b6d4','#84cc16'];
let   gjColorIdx = 0;
const gjColorMap = {}; // id -> color

function renderGeoJSONList(layers) {
    const list = document.getElementById('geojson-layers-list');
    if (!layers.length) {
        list.innerHTML = '<div style="text-align:center;padding:24px;color:#9ca3af;">Nenhuma camada guardada ainda.</div>';
        return;
    }

    list.innerHTML = `
        <table class="data-table" style="font-size:13px; width:100%; border-collapse:collapse;">
            <thead>
                <tr>
                    <th>Nome</th>
                    <th>Features</th>
                    <th>Terreno</th>
                    <th>Data</th>
                    <th style="text-align:center;">Acções</th>
                </tr>
            </thead>
            <tbody>
                ${layers.map(l => {
                    const dt = new Date(l.created_at).toLocaleDateString('pt-PT');
                    const onMap = !!geojsonOverlayLayers[l.id];
                    const color = gjColorMap[l.id] || GJ_COLORS[gjColorIdx % GJ_COLORS.length];
                    return `
                    <tr>
                        <td>
                            <span style="display:inline-block;width:10px;height:10px;border-radius:50%;
                                         background:${escHtml(color)};margin-right:5px;"></span>
                            <strong>${escHtml(l.name)}</strong>
                            ${l.description ? `<div style="font-size:11px;color:#9ca3af;margin-top:1px;">${escHtml(l.description)}</div>` : ''}
                        </td>
                        <td style="text-align:center;">${l.feature_count}</td>
                        <td>${l.terrain_name ? escHtml(l.terrain_name) : '<span style="color:#d1d5db">—</span>'}</td>
                        <td style="white-space:nowrap;">${dt}</td>
                        <td style="text-align:center; white-space:nowrap;">
                            <button class="btn btn-sm ${onMap ? 'btn-primary' : 'btn-secondary'}"
                                    id="gj-map-btn-${l.id}"
                                    data-id="${l.id}"
                                    onclick="toggleGeoJSONOnFieldMap(this.dataset.id)"
                                    title="${onMap ? 'Remover do mapa' : 'Mostrar no mapa'}"
                                    style="margin-right:4px;">
                                ${onMap ? '🗺️ Visível' : '👁️ Mostrar'}
                            </button>
                            <button class="btn btn-danger btn-sm"
                                    data-id="${l.id}"
                                    data-name="${escHtml(l.name)}"
                                    onclick="deleteGeoJSONLayer(this.dataset.id, this.dataset.name)"
                                    title="Eliminar">🗑️</button>
                        </td>
                    </tr>`;
                }).join('')}
            </tbody>
        </table>`;
}

// Mostrar/ocultar camada GeoJSON no mapa de medições
function toggleGeoJSONOnFieldMap(id) {
    id = String(id);
    if (geojsonOverlayLayers[id]) {
        // Remover
        fieldMap.removeLayer(geojsonOverlayLayers[id]);
        if (fieldLayersControl) fieldLayersControl.removeLayer(geojsonOverlayLayers[id]);
        delete geojsonOverlayLayers[id];
        const btn = document.getElementById('gj-map-btn-' + id);
        if (btn) { btn.textContent = '👁️ Mostrar'; btn.className = 'btn btn-sm btn-secondary'; }
        return;
    }

    // Buscar dados e adicionar
    const btn = document.getElementById('gj-map-btn-' + id);
    if (btn) btn.textContent = '⏳…';

    const fd = new FormData();
    fd.append('action', 'get_geojson_data');
    fd.append('id', id);

    fetch('', { method: 'POST', body: fd })
        .then(r => r.json())
        .then(data => {
            if (!data.success || !data.geojson) {
                showAlert('Erro ao carregar GeoJSON: ' + (data.message || '?'), 'error');
                if (btn) { btn.textContent = '👁️ Mostrar'; btn.className = 'btn btn-sm btn-secondary'; }
                return;
            }

            // Atribuir cor persistente
            if (!gjColorMap[id]) {
                gjColorMap[id] = GJ_COLORS[gjColorIdx % GJ_COLORS.length];
                gjColorIdx++;
            }
            const color = gjColorMap[id];

            let gjData;
            try { gjData = JSON.parse(data.geojson); } catch(e) {
                showAlert('GeoJSON corrompido na base de dados.', 'error');
                if (btn) { btn.textContent = '👁️ Mostrar'; btn.className = 'btn btn-sm btn-secondary'; }
                return;
            }

            const layer = L.geoJSON(gjData, {
                style: { color: color, weight: 2, opacity: 0.9, fillOpacity: 0.25, fillColor: color },
                pointToLayer: function(feature, latlng) {
                    const q = feature.properties && feature.properties.Q;
                    const fc = q === 1 ? '#16a34a' : q === 2 ? '#ea580c' : q ? '#6b7280' : color;
                    return L.circleMarker(latlng, {
                        radius: 5, fillColor: fc, color: '#fff',
                        weight: 1.5, opacity: 1, fillOpacity: 0.9
                    });
                },
                onEachFeature: function(feature, lyr) {
                    const props = feature.properties || {};
                    const keys  = Object.keys(props);
                    if (!keys.length) return;
                    const html = keys.slice(0, 10).map(k =>
                        `<tr><td style="color:#6b7280;padding-right:8px;font-size:11px;">${escHtml(k)}</td>
                             <td style="font-size:12px;"><strong>${escHtml(String(props[k]))}</strong></td></tr>`
                    ).join('');
                    lyr.bindPopup(`<div style="max-height:200px;overflow:auto;">
                        <div style="font-weight:700;font-size:13px;margin-bottom:6px;">
                            ${escHtml(data.name)}
                        </div>
                        <table>${html}</table>
                    </div>`);
                }
            }).addTo(fieldMap);

            geojsonOverlayLayers[id] = layer;
            if (fieldLayersControl) fieldLayersControl.addOverlay(layer, '🗺️ ' + escHtml(data.name));

            // Fazer zoom para a camada
            try { fieldMap.fitBounds(layer.getBounds(), { padding: [30, 30] }); } catch(e) {}

            if (btn) { btn.textContent = '🗺️ Visível'; btn.className = 'btn btn-sm btn-primary'; }
        })
        .catch(() => {
            showAlert('Erro de rede ao carregar GeoJSON.', 'error');
            if (btn) { btn.textContent = '👁️ Mostrar'; btn.className = 'btn btn-sm btn-secondary'; }
        });
}

// Eliminar camada
function deleteGeoJSONLayer(id, name) {
    if (!confirm(`Eliminar a camada "${name}"?\nEsta acção não pode ser desfeita.`)) return;

    const fd = new FormData();
    fd.append('action', 'delete_geojson');
    fd.append('id', id);

    fetch('', { method: 'POST', body: fd })
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                // Remover do mapa se visível
                if (geojsonOverlayLayers[id]) {
                    fieldMap.removeLayer(geojsonOverlayLayers[id]);
                    if (fieldLayersControl) fieldLayersControl.removeLayer(geojsonOverlayLayers[id]);
                    delete geojsonOverlayLayers[id];
                }
                loadGeoJSONLayers();
            } else {
                showAlert('Erro: ' + (data.message || 'Falha.'), 'error');
            }
        })
        .catch(() => showAlert('Erro de rede.', 'error'));
}

// ── Objectos de Campo (árvores, plantas, postes) ──────────────────────────────

const SPECIES_ICON = {
    oliveira:    '🫒',
    videira:     '🍇',
    macieira:    '🍎',
    macieira_2d: '🍎',
    pereira:     '🍐',
    outro:       '🌳'
};
const SPECIES_COLOR = {
    oliveira:    '#84cc16',
    videira:     '#7c3aed',
    macieira:    '#ef4444',
    macieira_2d: '#f97316',
    pereira:     '#eab308',
    outro:       '#22c55e'
};

function toggleObjectsPanel() {
    const panel = document.getElementById('objects-panel');
    const btn   = document.getElementById('objects-toggle-btn');
    if (!panel) return;
    const open = panel.style.display === 'none';
    panel.style.display = open ? 'block' : 'none';
    if (btn) btn.textContent = open ? '▲ Recolher' : '▼ Expandir';
    if (open && fieldObjectsList.length === 0) loadFieldObjects();
}

function loadFieldObjects() {
    const tid = document.getElementById('obj-filter-terrain')?.value || '';
    const listEl = document.getElementById('objects-list');
    if (listEl) listEl.innerHTML = '<div style="text-align:center;padding:20px;color:#9ca3af;">A carregar…</div>';

    const fd = new FormData();
    fd.append('action', 'get_field_objects');
    if (tid) fd.append('terrain_id', tid);

    fetch('?tab=field', { method: 'POST', body: fd })
        .then(r => r.json())
        .then(data => {
            if (!data.success) {
                if (listEl) listEl.innerHTML = `<div style="color:#ef4444;font-size:13px;">⚠️ ${escHtml(data.message || 'Erro')}</div>`;
                return;
            }
            fieldObjectsList = data.objects || [];
            renderFieldObjectsList(fieldObjectsList);
            renderFieldObjectsOnMap(fieldObjectsList);
        })
        .catch(() => {
            if (listEl) listEl.innerHTML = '<div style="color:#ef4444;font-size:13px;">❌ Erro de rede.</div>';
        });
}

function renderFieldObjectsList(objects) {
    const listEl = document.getElementById('objects-list');
    if (!listEl) return;

    if (!objects.length) {
        listEl.innerHTML = `
            <div style="text-align:center; padding:30px; color:#9ca3af;">
                <div style="font-size:36px; margin-bottom:8px;">🌱</div>
                <p style="font-size:13px;">Ainda não foram registados objectos de campo.</p>
                <p style="font-size:12px;">Clique em <strong>➕ Adicionar objecto</strong> para começar.</p>
            </div>`;
        return;
    }

    const rows = objects.map(obj => {
        const icon    = obj.type === 'pole' ? '🪵' : (SPECIES_ICON[obj.species] || '🌳');
        const species = obj.type === 'pole' ? 'Poste' : (obj.species || 'Outro');
        const lat     = parseFloat(obj.lat).toFixed(6);
        const lng     = parseFloat(obj.lng).toFixed(6);
        const terrain = obj.terrain_name ? `<span style="color:#667eea;font-size:11px;">📍 ${escHtml(obj.terrain_name)}</span>` : '';
        const label   = obj.label ? `<strong>${escHtml(obj.label)}</strong> · ` : '';
        const dt      = new Date(obj.created_at).toLocaleDateString('pt-PT', { day:'2-digit', month:'2-digit', year:'2-digit' });

        return `
            <div style="display:flex; align-items:center; gap:10px; padding:8px 0;
                        border-bottom:1px solid #f3f4f6; font-size:13px;">
                <span style="font-size:22px; flex-shrink:0;">${icon}</span>
                <div style="flex:1; min-width:0;">
                    <div style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                        ${label}<em>${escHtml(species)}</em>
                    </div>
                    <div style="font-family:monospace; font-size:11px; color:#9ca3af;">${lat}, ${lng}</div>
                    <div>${terrain}</div>
                </div>
                <div style="font-size:10px; color:#d1d5db; flex-shrink:0;">${dt}</div>
                <button onclick="deleteFieldObject(${obj.id}, '${escHtml(obj.label || species)}')"
                        class="btn btn-danger btn-sm"
                        style="padding:2px 7px; font-size:11px; flex-shrink:0;" title="Eliminar">🗑️</button>
            </div>`;
    }).join('');

    listEl.innerHTML = `<div style="font-size:12px;color:#6b7280;margin-bottom:6px;">${objects.length} objecto(s)</div>` + rows;
}

function renderFieldObjectsOnMap(objects) {
    if (!fieldObjectsLayer) return;
    fieldObjectsLayer.clearLayers();

    objects.forEach(obj => {
        const lat = parseFloat(obj.lat);
        const lng = parseFloat(obj.lng);
        if (!lat && !lng) return;

        const isTree = obj.type === 'tree';
        const color  = isTree ? (SPECIES_COLOR[obj.species] || '#22c55e') : '#92400e';
        const icon   = isTree ? (SPECIES_ICON[obj.species] || '🌳') : '🪵';
        const shape  = isTree ? 'circle' : 'square';

        // Use divIcon for distinctive markers
        const divIcon = L.divIcon({
            className: '',
            html: `<div style="
                width:${isTree ? 22 : 18}px; height:${isTree ? 22 : 18}px;
                background:${color}; border:2.5px solid #fff;
                border-radius:${isTree ? '50%' : '4px'};
                box-shadow:0 1px 4px rgba(0,0,0,.4);
                display:flex; align-items:center; justify-content:center;
                font-size:11px; line-height:1;">
                ${icon}
            </div>`,
            iconSize: [22, 22],
            iconAnchor: [11, 11]
        });

        const marker = L.marker([lat, lng], { icon: divIcon });

        const species = obj.type === 'pole' ? 'Poste' : (obj.species || 'Outro');
        const label   = obj.label ? `<strong>${escHtml(obj.label)}</strong><br>` : '';
        const alt     = parseFloat(obj.altitude) ? `<br>Alt: ${parseFloat(obj.altitude).toFixed(1)} m` : '';
        const terrain = obj.terrain_name ? `<br><span style="color:#667eea">📍 ${escHtml(obj.terrain_name)}</span>` : '';
        const notes   = obj.notes ? `<br><span style="color:#6b7280;font-size:11px;">💬 ${escHtml(obj.notes)}</span>` : '';

        marker.bindPopup(`
            <div style="font-size:13px; line-height:1.6; min-width:150px;">
                ${label}
                <strong>${icon} ${escHtml(species)}</strong>${terrain}${alt}${notes}
                <br><span style="font-family:monospace;font-size:10px;color:#9ca3af;">
                    ${parseFloat(obj.lat).toFixed(6)}, ${parseFloat(obj.lng).toFixed(6)}
                </span>
                <br><button onclick="deleteFieldObject(${obj.id}, '${escHtml(obj.label || species)}')"
                            class="btn btn-danger btn-sm" style="margin-top:4px;font-size:11px;padding:2px 6px;">
                    🗑️ Eliminar
                </button>
            </div>
        `);

        fieldObjectsLayer.addLayer(marker);
    });
}

function openAddObjectModal(lat, lng) {
    // Resetar tudo, incluindo a lista de posições pendentes e estado de linha
    _pendingPositions = [];
    _destroyPickOverlay();
    addObjectModeActive = false;
    _lineDrawMode = false;
    _linePoints   = [];
    _destroyLinePickOverlay();
    _updateLineOnMap(); // limpa a polyline do mapa
    if (fieldMap) fieldMap.getContainer().style.cursor = '';

    // Repor modo para "pontos" (primeiro radio)
    const ptRadio = document.querySelector('input[name="ao-mode"][value="points"]');
    if (ptRadio) ptRadio.checked = true;

    // Pre-fill manual coords if provided (e.g. from an external source)
    const latEl = document.getElementById('ao-lat');
    const lngEl = document.getElementById('ao-lng');
    if (latEl) latEl.value = lat != null ? lat : '';
    if (lngEl) lngEl.value = lng != null ? lng : '';
    const altEl = document.getElementById('ao-altitude');
    if (altEl) altEl.value = '';

    document.getElementById('ao-label').value   = '';
    document.getElementById('ao-notes').value   = '';
    document.getElementById('ao-species').value = 'oliveira';
    document.querySelector('input[name="ao-type"][value="tree"]').checked = true;
    const status = document.getElementById('ao-status');
    if (status) status.textContent = '';

    // Esconder ao-line-config (aparece só depois de desenhar)
    const lineCfg = document.getElementById('ao-line-config');
    if (lineCfg) lineCfg.style.display = 'none';

    onAoTypeChange();
    onAoModeChange();
    renderPendingPositions();

    document.getElementById('add-obj-backdrop').style.display = 'block';
    document.getElementById('add-obj-modal').style.display    = 'block';
}

function closeAddObjectModal() {
    document.getElementById('add-obj-backdrop').style.display = 'none';
    document.getElementById('add-obj-modal').style.display    = 'none';
    addObjectModeActive = false;
    _pendingPositions   = [];
    _destroyPickOverlay();
    _lineDrawMode = false;
    _linePoints   = [];
    _destroyLinePickOverlay();
    _updateLineOnMap(); // remove polyline do mapa
    if (fieldMap) fieldMap.getContainer().style.cursor = '';
}

function onAoTypeChange() {
    const isTree    = document.querySelector('input[name="ao-type"]:checked')?.value === 'tree';
    const speciesRow = document.getElementById('ao-species-row');
    if (speciesRow) speciesRow.style.display = isTree ? 'block' : 'none';
    document.getElementById('ao-type-tree-lbl').style.borderColor = isTree  ? '#667eea' : '#e5e7eb';
    document.getElementById('ao-type-tree-lbl').style.background  = isTree  ? '#eef2ff' : '';
    document.getElementById('ao-type-pole-lbl').style.borderColor = !isTree ? '#667eea' : '#e5e7eb';
    document.getElementById('ao-type-pole-lbl').style.background  = !isTree ? '#eef2ff' : '';
}

/** Alterna entre secção de pontos avulso e linha/espaldeira no modal */
function onAoModeChange() {
    const isLine = document.querySelector('input[name="ao-mode"]:checked')?.value === 'line';

    const pts  = document.getElementById('ao-section-points');
    const line = document.getElementById('ao-section-line');
    if (pts)  pts.style.display  = isLine ? 'none'  : 'block';
    if (line) line.style.display = isLine ? 'block' : 'none';

    // Estilo visual dos botões de modo
    const ptsLbl  = document.getElementById('ao-mode-pts-lbl');
    const lineLbl = document.getElementById('ao-mode-line-lbl');
    if (ptsLbl) {
        ptsLbl.style.borderColor = !isLine ? '#667eea' : '#e5e7eb';
        ptsLbl.style.background  = !isLine ? '#eef2ff' : '';
    }
    if (lineLbl) {
        lineLbl.style.borderColor = isLine ? '#0ea5e9' : '#e5e7eb';
        lineLbl.style.background  = isLine ? '#e0f2fe' : '';
    }

    // Adaptar texto do prefixo conforme o modo
    const labelLbl = document.getElementById('ao-label-lbl');
    if (labelLbl) {
        labelLbl.innerHTML = isLine
            ? 'Prefixo <span style="font-weight:400;color:#9ca3af;">(opcional — combinado com ID da linha, ex: T → Linha A - T001)</span>'
            : 'Prefixo <span style="font-weight:400;color:#9ca3af;">(opcional — ex: T → T001, T002…)</span>';
    }
}

/** Adiciona as coordenadas actuais à lista de posições pendentes */
function addToPositionsList() {
    const lat = parseFloat(document.getElementById('ao-lat')?.value);
    const lng = parseFloat(document.getElementById('ao-lng')?.value);
    const alt = parseFloat(document.getElementById('ao-altitude')?.value) || 0;
    const hint = document.getElementById('ao-pick-hint');

    if (!lat || !lng) {
        if (hint) { hint.textContent = '⚠️ Defina primeiro a posição GPS.'; hint.style.color = '#ef4444'; }
        return;
    }

    _pendingPositions.push({ lat, lng, altitude: alt });

    // Limpar campos de coordenadas para a próxima entrada
    document.getElementById('ao-lat').value      = '';
    document.getElementById('ao-lng').value      = '';
    document.getElementById('ao-altitude').value = '';
    if (hint) { hint.textContent = `✅ Posição ${_pendingPositions.length} adicionada.`; hint.style.color = '#16a34a'; }

    renderPendingPositions();
}

/** Remove uma posição da lista pendente pelo índice */
function removePendingPosition(idx) {
    _pendingPositions.splice(idx, 1);
    renderPendingPositions();
}

/** Actualiza o bloco visual de posições e o texto do botão de guardar */
function renderPendingPositions() {
    const listEl  = document.getElementById('ao-positions-list');
    const saveBtn = document.getElementById('ao-save-btn');
    const n       = _pendingPositions.length;

    // Texto dinâmico no botão
    if (saveBtn) {
        saveBtn.textContent = n > 1
            ? `💾 Guardar ${n} objectos`
            : '💾 Guardar Objecto';
    }

    if (!listEl) return;

    if (!n) {
        listEl.style.display = 'none';
        return;
    }

    listEl.style.display = 'block';
    listEl.innerHTML =
        `<div style="font-size:11px;font-weight:700;color:#166534;margin-bottom:6px;">
            📋 ${n} posição${n !== 1 ? 'ões' : ''} marcada${n !== 1 ? 's' : ''}:
         </div>` +
        _pendingPositions.map((pos, i) => `
            <div style="display:flex;align-items:center;gap:8px;padding:5px 0;
                        border-bottom:1px solid #bbf7d0;font-size:12px;">
                <span style="color:#16a34a;font-weight:700;flex-shrink:0;min-width:22px;">#${i+1}</span>
                <span style="font-family:monospace;font-size:11px;color:#374151;flex:1;
                             overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                    ${pos.lat.toFixed(6)}, ${pos.lng.toFixed(6)}
                    ${pos.altitude ? ` · ${pos.altitude.toFixed(1)} m` : ''}
                </span>
                <button onclick="removePendingPosition(${i})"
                        style="background:#fee2e2;color:#dc2626;border:none;border-radius:5px;
                               padding:2px 7px;cursor:pointer;font-size:12px;flex-shrink:0;">✕</button>
            </div>`).join('');
}

/** Activa o modo multi-pick: esconde o modal, mostra overlay flutuante no mapa */
function activateObjectPickMode() {
    document.getElementById('add-obj-backdrop').style.display = 'none';
    document.getElementById('add-obj-modal').style.display    = 'none';
    addObjectModeActive = true;
    if (fieldMap) fieldMap.getContainer().style.cursor = 'crosshair';
    _createPickOverlay();
}

/** Cria o overlay flutuante sobre o mapa durante o modo pick */
function _createPickOverlay() {
    _destroyPickOverlay();
    const container = fieldMap ? fieldMap.getContainer() : document.getElementById('field-map');
    if (!container) return;

    _pickOverlay = document.createElement('div');
    _pickOverlay.id = 'obj-pick-overlay';
    Object.assign(_pickOverlay.style, {
        position:      'absolute',
        top:           '12px',
        left:          '50%',
        transform:     'translateX(-50%)',
        zIndex:        '1000',
        background:    'rgba(20,20,40,.88)',
        color:         '#fff',
        borderRadius:  '24px',
        padding:       '10px 18px',
        display:       'flex',
        alignItems:    'center',
        gap:           '12px',
        fontSize:      '14px',
        boxShadow:     '0 4px 16px rgba(0,0,0,.45)',
        backdropFilter:'blur(6px)',
        whiteSpace:    'nowrap',
        pointerEvents: 'auto'
    });
    _pickOverlay.innerHTML = `
        <span style="font-size:20px;line-height:1;">🗺️</span>
        <span id="pick-mode-label" style="font-size:13px;">Clique no mapa para marcar posições</span>
        <button onclick="finishObjectPickMode()"
                style="background:#667eea;color:#fff;border:none;border-radius:16px;
                       padding:7px 18px;cursor:pointer;font-weight:700;font-size:13px;
                       flex-shrink:0;transition:background .15s;">
            ✅ Concluído
        </button>`;
    container.appendChild(_pickOverlay);
}

/** Actualiza o contador no overlay */
function _updatePickModeOverlay() {
    const el = document.getElementById('pick-mode-label');
    if (!el) return;
    const n = _pendingPositions.length;
    el.textContent = n === 0
        ? 'Clique no mapa para marcar posições'
        : `${n} posição${n !== 1 ? 'ões' : ''} marcada${n !== 1 ? 's' : ''} — continue ou clique Concluído`;
}

/** Remove o overlay flutuante */
function _destroyPickOverlay() {
    if (_pickOverlay) { _pickOverlay.remove(); _pickOverlay = null; }
    const old = document.getElementById('obj-pick-overlay');
    if (old) old.remove();
}

/** Termina o modo pick e reabre o modal com a lista de posições */
function finishObjectPickMode() {
    addObjectModeActive = false;
    _destroyPickOverlay();
    if (fieldMap) fieldMap.getContainer().style.cursor = '';

    // Reabrir modal
    document.getElementById('add-obj-backdrop').style.display = 'block';
    document.getElementById('add-obj-modal').style.display    = 'block';
    renderPendingPositions();
}

// ── Linha / Espaldeira: desenhar spline no mapa ───────────────────────────────

/** Activa o modo de desenho de linha: esconde o modal, configura cursor e overlay */
function activateLineDrawMode() {
    // Limpar linha anterior ao re-desenhar
    _linePoints = [];
    _updateLineOnMap();

    // Esconder modal
    document.getElementById('add-obj-backdrop').style.display = 'none';
    document.getElementById('add-obj-modal').style.display    = 'none';

    _lineDrawMode = true;
    if (fieldMap) fieldMap.getContainer().style.cursor = 'crosshair';
    _createLinePickOverlay();
}

/** Cria o overlay flutuante sobre o mapa durante o desenho de linha */
function _createLinePickOverlay() {
    _destroyLinePickOverlay();
    const container = fieldMap ? fieldMap.getContainer() : document.getElementById('field-map');
    if (!container) return;

    _linePickOverlay = document.createElement('div');
    _linePickOverlay.id = 'line-pick-overlay';
    Object.assign(_linePickOverlay.style, {
        position:       'absolute',
        top:            '12px',
        left:           '50%',
        transform:      'translateX(-50%)',
        zIndex:         '1000',
        background:     'rgba(3,105,161,.92)',
        color:          '#fff',
        borderRadius:   '24px',
        padding:        '10px 18px',
        display:        'flex',
        alignItems:     'center',
        gap:            '12px',
        fontSize:       '14px',
        boxShadow:      '0 4px 16px rgba(0,0,0,.45)',
        backdropFilter: 'blur(6px)',
        whiteSpace:     'nowrap',
        pointerEvents:  'auto'
    });
    _linePickOverlay.innerHTML = `
        <span style="font-size:20px;line-height:1;">📏</span>
        <span id="line-pick-label" style="font-size:13px;">Clique no mapa para adicionar vértices da linha</span>
        <button onclick="finishLineDrawMode()"
                style="background:#0ea5e9;color:#fff;border:none;border-radius:16px;
                       padding:7px 18px;cursor:pointer;font-weight:700;font-size:13px;
                       flex-shrink:0;transition:background .15s;">
            ✅ Concluído
        </button>`;
    container.appendChild(_linePickOverlay);
}

/** Actualiza o contador de vértices no overlay */
function _updateLinePickOverlay() {
    const el = document.getElementById('line-pick-label');
    if (!el) return;
    const n = _linePoints.length;
    el.textContent = n === 0
        ? 'Clique no mapa para adicionar vértices da linha'
        : `${n} vértice${n !== 1 ? 's' : ''} — continue ou clique Concluído`;
}

/** Remove o overlay de desenho de linha */
function _destroyLinePickOverlay() {
    if (_linePickOverlay) { _linePickOverlay.remove(); _linePickOverlay = null; }
    const old = document.getElementById('line-pick-overlay');
    if (old) old.remove();
}

/** Redesenha a polyline e os marcadores de vértice no mapa */
function _updateLineOnMap() {
    // Remover polyline anterior
    if (_lineLayer) {
        try { fieldMap.removeLayer(_lineLayer); } catch (_) {}
        _lineLayer = null;
    }
    // Remover marcadores de vértice anteriores
    _lineMarkers.forEach(m => { try { fieldMap.removeLayer(m); } catch (_) {} });
    _lineMarkers = [];

    if (!fieldMap || _linePoints.length < 1) return;

    // Polyline (só se houver ≥2 vértices)
    if (_linePoints.length >= 2) {
        _lineLayer = L.polyline(
            _linePoints.map(p => [p.lat, p.lng]),
            { color: '#0ea5e9', weight: 3, opacity: 0.9, dashArray: '7 5' }
        ).addTo(fieldMap);
    }

    // Marcadores de vértice
    _linePoints.forEach((p, i) => {
        const m = L.circleMarker([p.lat, p.lng], {
            radius: 7, color: '#0369a1', fillColor: '#7dd3fc',
            fillOpacity: 0.9, weight: 2
        }).addTo(fieldMap);
        m.bindTooltip(`V${i + 1}`, { permanent: false, direction: 'top', offset: [0, -8] });
        _lineMarkers.push(m);
    });
}

/** Termina o modo de desenho de linha e volta ao modal */
function finishLineDrawMode() {
    _lineDrawMode = false;
    _destroyLinePickOverlay();
    if (fieldMap) fieldMap.getContainer().style.cursor = '';

    // Reabrir modal
    document.getElementById('add-obj-backdrop').style.display = 'block';
    document.getElementById('add-obj-modal').style.display    = 'block';

    if (_linePoints.length < 2) {
        const status = document.getElementById('ao-status');
        if (status) {
            status.textContent = '⚠️ Desenhe pelo menos 2 vértices para definir uma linha.';
            status.style.color = '#ef4444';
        }
        return;
    }

    // Mostrar painel de configuração
    const cfg = document.getElementById('ao-line-config');
    if (cfg) cfg.style.display = 'block';

    // Actualizar rótulo com o comprimento da linha
    const lenM   = _lineLength(_linePoints);
    const lenLbl = document.getElementById('ao-line-length-label');
    if (lenLbl) {
        lenLbl.textContent = `📏 Linha: ${lenM.toFixed(1)} m  (${_linePoints.length} vértices)`;
    }

    previewLineObjects();
}

// ── Geometria de linha ────────────────────────────────────────────────────────

/** Distância Haversine em metros entre dois pontos {lat, lng} */
function _haversineM(p1, p2) {
    const R  = 6371000;
    const φ1 = p1.lat * Math.PI / 180;
    const φ2 = p2.lat * Math.PI / 180;
    const Δφ = (p2.lat - p1.lat) * Math.PI / 180;
    const Δλ = (p2.lng - p1.lng) * Math.PI / 180;
    const a  = Math.sin(Δφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Comprimento total da polyline em metros */
function _lineLength(points) {
    let total = 0;
    for (let i = 1; i < points.length; i++) {
        total += _haversineM(points[i - 1], points[i]);
    }
    return total;
}

/** Ponto a distância `d` metros desde o início da linha (interpolação linear de lat/lng) */
function _interpolateOnLine(points, d) {
    let remaining = d;
    for (let i = 1; i < points.length; i++) {
        const segLen = _haversineM(points[i - 1], points[i]);
        if (remaining <= segLen || i === points.length - 1) {
            const t = segLen > 0 ? Math.min(1, remaining / segLen) : 0;
            return {
                lat: points[i - 1].lat + t * (points[i].lat - points[i - 1].lat),
                lng: points[i - 1].lng + t * (points[i].lng - points[i - 1].lng)
            };
        }
        remaining -= segLen;
    }
    return { lat: points[points.length - 1].lat, lng: points[points.length - 1].lng };
}

/** Distribui posições ao longo da linha com espaçamento `spacing` e offset inicial `offset` */
function _distributeAlongLine(points, spacing, offset) {
    const total     = _lineLength(points);
    const positions = [];
    if (spacing <= 0) return positions;
    let d = offset < 0 ? 0 : offset;
    while (d <= total + 1e-6) {
        positions.push(_interpolateOnLine(points, d));
        d += spacing;
    }
    return positions;
}

/** Calcula e mostra a pré-visualização do número de objectos gerados */
function previewLineObjects() {
    const spacing = parseFloat(document.getElementById('ao-spacing')?.value)     || 5;
    const offset  = parseFloat(document.getElementById('ao-line-offset')?.value) || 0;
    const preview = document.getElementById('ao-line-preview');
    if (!preview) return;

    if (_linePoints.length < 2) { preview.textContent = '—'; return; }

    const positions = _distributeAlongLine(_linePoints, spacing, offset);
    const n         = positions.length;
    const lenM      = _lineLength(_linePoints);
    preview.textContent = n > 0
        ? `→ ${n} objecto${n !== 1 ? 's' : ''} distribuídos ao longo de ${lenM.toFixed(1)} m`
        : '⚠️ Nenhum objecto — espaçamento maior que a linha';
}

/** Gera e guarda os objectos distribuídos ao longo da linha desenhada */
async function saveLineObjects() {
    const type    = document.querySelector('input[name="ao-type"]:checked')?.value || 'tree';
    const species = document.getElementById('ao-species')?.value || '';
    const prefix  = (document.getElementById('ao-label')?.value   || '').trim();
    const rowId   = (document.getElementById('ao-row-id')?.value  || '').trim();
    const notes   = document.getElementById('ao-notes')?.value    || '';
    const tid     = document.getElementById('ao-terrain')?.value  || '';
    const spacing = parseFloat(document.getElementById('ao-spacing')?.value)     || 5;
    const offset  = parseFloat(document.getElementById('ao-line-offset')?.value) || 0;

    if (_linePoints.length < 2) {
        const status = document.getElementById('ao-status');
        if (status) { status.textContent = '⚠️ Desenhe uma linha primeiro.'; status.style.color = '#ef4444'; }
        return;
    }

    const positions = _distributeAlongLine(_linePoints, spacing, offset);
    if (!positions.length) {
        const status = document.getElementById('ao-status');
        if (status) { status.textContent = '⚠️ Nenhuma posição gerada — verifique o espaçamento.'; status.style.color = '#ef4444'; }
        return;
    }

    const status  = document.getElementById('ao-status');
    const saveBtn = document.getElementById('ao-save-btn');
    if (status)  { status.textContent = `⏳ A guardar ${positions.length}…`; status.style.color = '#6b7280'; }
    if (saveBtn) saveBtn.disabled = true;

    let ok = 0;
    for (let i = 0; i < positions.length; i++) {
        const pos = positions[i];
        const idx = String(i + 1).padStart(3, '0');

        // Gerar etiqueta: "Linha A - T001"  /  "Linha A - 001"  /  "T001"  /  ""
        let label = '';
        if (rowId && prefix)  label = `${rowId} - ${prefix}${idx}`;
        else if (rowId)        label = `${rowId} - ${idx}`;
        else if (prefix)       label = `${prefix}${idx}`;

        const fd = new FormData();
        fd.append('action',     'save_field_object');
        fd.append('type',       type);
        fd.append('species',    species);
        fd.append('label',      label);
        fd.append('lat',        pos.lat);
        fd.append('lng',        pos.lng);
        fd.append('altitude',   0);
        fd.append('notes',      notes);
        fd.append('terrain_id', tid);

        try {
            const r    = await fetch('?tab=field', { method: 'POST', body: fd });
            const data = await r.json();
            if (data.success) ok++;
        } catch (_) { /* continua com os restantes */ }
    }

    if (saveBtn) saveBtn.disabled = false;
    closeAddObjectModal();

    const failed = positions.length - ok;
    if (ok > 0) {
        showAlert(
            failed === 0
                ? `✅ ${ok} objecto${ok !== 1 ? 's' : ''} guardado${ok !== 1 ? 's' : ''} ao longo da linha!`
                : `⚠️ ${ok} guardado${ok !== 1 ? 's' : ''}, ${failed} com erro.`,
            failed === 0 ? 'success' : 'warning'
        );
    } else {
        showAlert('❌ Não foi possível guardar nenhum objecto.', 'error');
    }
    loadFieldObjects();
}

/** Guarda todos os objectos (lista pendente + coords actuais, se preenchidas) */
async function saveFieldObject() {
    const type    = document.querySelector('input[name="ao-type"]:checked')?.value || 'tree';
    const species = document.getElementById('ao-species')?.value  || '';
    const prefix  = (document.getElementById('ao-label')?.value  || '').trim();
    const notes   = document.getElementById('ao-notes')?.value   || '';
    const tid     = document.getElementById('ao-terrain')?.value || '';

    // Juntar posições pendentes + coordenadas actuais (se preenchidas)
    const curLat = parseFloat(document.getElementById('ao-lat')?.value);
    const curLng = parseFloat(document.getElementById('ao-lng')?.value);
    const curAlt = parseFloat(document.getElementById('ao-altitude')?.value) || 0;

    const positions = [..._pendingPositions];
    if (curLat && curLng) positions.push({ lat: curLat, lng: curLng, altitude: curAlt });

    if (!positions.length) {
        const status = document.getElementById('ao-status');
        if (status) { status.textContent = '⚠️ Adicione pelo menos uma posição GPS.'; status.style.color = '#ef4444'; }
        return;
    }

    const status = document.getElementById('ao-status');
    const saveBtn = document.getElementById('ao-save-btn');
    if (status)  { status.textContent = `⏳ A guardar ${positions.length}…`; status.style.color = '#6b7280'; }
    if (saveBtn) saveBtn.disabled = true;

    // Guardar todas as posições sequencialmente
    let ok = 0;
    for (let i = 0; i < positions.length; i++) {
        const pos = positions[i];
        // Gerar etiqueta: se há prefix e múltiplas posições → T001, T002...
        //                 se há prefix e só uma → usa o prefix directamente
        const label = prefix
            ? (positions.length > 1 ? `${prefix}${String(i + 1).padStart(3, '0')}` : prefix)
            : '';

        const fd = new FormData();
        fd.append('action',     'save_field_object');
        fd.append('type',       type);
        fd.append('species',    species);
        fd.append('label',      label);
        fd.append('lat',        pos.lat);
        fd.append('lng',        pos.lng);
        fd.append('altitude',   pos.altitude);
        fd.append('notes',      notes);
        fd.append('terrain_id', tid);

        try {
            const r    = await fetch('?tab=field', { method: 'POST', body: fd });
            const data = await r.json();
            if (data.success) ok++;
        } catch (_) { /* continuar com os restantes */ }
    }

    if (saveBtn) saveBtn.disabled = false;
    closeAddObjectModal();

    const failed = positions.length - ok;
    if (ok > 0) {
        showAlert(
            failed === 0
                ? `✅ ${ok} objecto${ok !== 1 ? 's' : ''} guardado${ok !== 1 ? 's' : ''} com sucesso!`
                : `⚠️ ${ok} guardado${ok !== 1 ? 's' : ''}, ${failed} com erro.`,
            failed === 0 ? 'success' : 'warning'
        );
    } else {
        showAlert('❌ Não foi possível guardar nenhum objecto.', 'error');
    }
    loadFieldObjects();
}

/** Despachador: chama saveFieldObject (pontos) ou saveLineObjects (linha) */
function saveObjects() {
    const mode = document.querySelector('input[name="ao-mode"]:checked')?.value || 'points';
    if (mode === 'line') {
        saveLineObjects();
    } else {
        saveFieldObject();
    }
}

function deleteFieldObject(id, name) {
    if (!confirm(`Eliminar "${name}"?`)) return;
    const fd = new FormData();
    fd.append('action', 'delete_field_object');
    fd.append('id',     id);

    fetch('?tab=field', { method: 'POST', body: fd })
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                showAlert('🗑️ Objecto eliminado.', 'info');
                // Close any open popup
                if (fieldMap) fieldMap.closePopup();
                loadFieldObjects();
            } else {
                showAlert('❌ ' + (data.message || 'Erro'), 'error');
            }
        })
        .catch(() => showAlert('❌ Erro de rede.', 'error'));
}

// ══════════════════════════════════════════════════════════════════════════════
// IMAGENS DE SATÉLITE (Sentinel Hub via MQTT)
// ══════════════════════════════════════════════════════════════════════════════

let _rasterPollTimer   = null;  // interval de polling
let _rasterPollSeconds = 0;     // segundos decorridos desde o pedido

function toggleRasterPanel() {
    const panel = document.getElementById('raster-panel');
    const btn   = document.getElementById('raster-toggle-btn');
    if (!panel) return;
    const open = panel.style.display === 'none';
    panel.style.display = open ? 'block' : 'none';
    if (btn) btn.textContent = open ? '▲ Recolher' : '▼ Expandir';
    if (open) loadRastersList();
}

/** Mostra/oculta período de referência e actualiza hint */
function onRasterTypeChange() {
    const type    = document.getElementById('raster-type')?.value || 'ndvi';
    const refBox  = document.getElementById('raster-ref-period');
    const hint    = document.getElementById('raster-ref-hint');
    const fromLbl = document.getElementById('raster-date-from-lbl');
    const needsRef = type === 'ndvi_anomaly' || type === 'ndvi_diff';

    if (refBox) refBox.style.display = needsRef ? 'block' : 'none';
    if (fromLbl) fromLbl.textContent = needsRef ? 'Início período actual *' : 'Data início *';
    if (hint) hint.textContent = (type === 'ndvi_anomaly')
        ? 'Sugestão: mesmo mês do ano anterior. Ex: 2025-05-01 → 2025-05-31' : '';

    // ── Painel de descrição do índice ─────────────────────────────────────────
    const descBox    = document.getElementById('raster-desc-box');
    const descMetric = document.getElementById('raster-desc-metric');
    const descUse    = document.getElementById('raster-desc-use');
    const info       = RASTER_INFO[type];
    if (info && descBox) {
        if (descMetric) descMetric.textContent = '📐 ' + info.metric;
        if (descUse)    descUse.textContent    = '✅ ' + info.use;
        descBox.style.display = '';
    } else if (descBox) {
        descBox.style.display = 'none';
    }
}

/** Submete o pedido de raster ao servidor (que publica no MQTT) */
function submitRasterRequest() {
    const terrain  = document.getElementById('raster-terrain')?.value    || '';
    const type     = document.getElementById('raster-type')?.value       || '';
    const dateFrom = document.getElementById('raster-date-from')?.value  || '';
    const dateTo   = document.getElementById('raster-date-to')?.value    || '';
    const dateFrom2= document.getElementById('raster-date-from2')?.value || '';
    const dateTo2  = document.getElementById('raster-date-to2')?.value   || '';

    if (!terrain) { showAlert('Selecione um terreno.', 'error'); return; }
    if (!dateFrom || !dateTo) { showAlert('Defina o período de datas.', 'error'); return; }
    if ((type === 'ndvi_anomaly' || type === 'ndvi_diff') && (!dateFrom2 || !dateTo2)) {
        showAlert('Defina o período de referência.', 'error'); return;
    }

    const btn    = document.getElementById('raster-submit-btn');
    const status = document.getElementById('raster-submit-status');
    if (btn)    { btn.disabled = true; btn.textContent = '⏳ A enviar…'; }
    if (status) status.textContent = '';

    const fd = new FormData();
    fd.append('action',      'request_raster');
    fd.append('terrain_id',  terrain);
    fd.append('raster_type', type);
    fd.append('date_from',   dateFrom);
    fd.append('date_to',     dateTo);
    fd.append('date_from2',  dateFrom2);
    fd.append('date_to2',    dateTo2);

    fetch('?tab=field', { method: 'POST', body: fd })
        .then(r => r.json())
        .then(data => {
            if (btn) { btn.disabled = false; btn.textContent = '🚀 Gerar Raster'; }

            if (!data.success) {
                if (status) status.textContent = '❌ ' + (data.message || 'Erro');
                showAlert('❌ ' + (data.message || 'Erro ao submeter pedido.'), 'error');
                return;
            }

            if (data.mqtt_warning) {
                showAlert('⚠️ Pedido criado mas MQTT falhou: ' + data.mqtt_warning, 'warning');
            }

            // Iniciar polling de estado
            _startRasterPolling(data.request_id, data.name);
            loadRastersList();
        })
        .catch(() => {
            if (btn) { btn.disabled = false; btn.textContent = '🚀 Gerar Raster'; }
            if (status) status.textContent = '❌ Erro de rede.';
        });
}

/** Inicia o polling de estado do pedido */
function _startRasterPolling(requestId, name) {
    _stopRasterPolling();
    _rasterPollSeconds = 0;

    const box     = document.getElementById('raster-progress-box');
    const spinner = document.getElementById('raster-progress-spinner');
    const nameEl  = document.getElementById('raster-progress-name');
    const msgEl   = document.getElementById('raster-progress-msg');

    if (box)     box.style.display = 'block';
    if (nameEl)  nameEl.textContent = name || 'A processar…';
    if (msgEl)   msgEl.textContent  = '⏳ A aguardar Sentinel.py…';
    if (spinner) spinner.textContent = '⏳';

    _rasterPollTimer = setInterval(() => {
        _rasterPollSeconds += 2;
        _pollRasterStatus(requestId, name);
    }, 2000);
}

function _stopRasterPolling() {
    if (_rasterPollTimer) { clearInterval(_rasterPollTimer); _rasterPollTimer = null; }
}

function _pollRasterStatus(requestId, name) {
    const fd = new FormData();
    fd.append('action',     'get_raster_status');
    fd.append('request_id', requestId);

    fetch('?tab=field', { method: 'POST', body: fd })
        .then(r => r.json())
        .then(data => {
            const spinner = document.getElementById('raster-progress-spinner');
            const msgEl   = document.getElementById('raster-progress-msg');

            if (!data.success) {
                _stopRasterPolling();
                _hideRasterProgress();
                showAlert('❌ ' + (data.message || 'Erro'), 'error');
                return;
            }

            const st = data.status;

            if (st === 'done') {
                _stopRasterPolling();
                if (spinner) spinner.textContent = '✅';
                if (msgEl)   msgEl.textContent  = '✅ Concluído! Disponível na tab 🗺️ Mapa.';
                showAlert(`✅ Raster "${name}" gerado com sucesso! Abra a tab Mapa para o visualizar.`, 'success');
                loadRastersList();
                setTimeout(_hideRasterProgress, 4000);
                return;
            }

            if (st === 'error') {
                _stopRasterPolling();
                if (spinner) spinner.textContent = '❌';
                if (msgEl)   msgEl.textContent   = '❌ Erro: ' + (data.error || 'falha desconhecida');
                showAlert('❌ Erro ao gerar raster: ' + (data.error || '?'), 'error');
                loadRastersList();
                return;
            }

            if (st === 'processing') {
                if (spinner) spinner.textContent = '🔄';
                if (msgEl)   msgEl.textContent   = `🔄 Sentinel.py a processar… (${_rasterPollSeconds}s)`;
            } else {
                // pending
                if (_rasterPollSeconds >= 20) {
                    if (msgEl) msgEl.textContent = `⚠️ Sentinel.py ainda não respondeu (${_rasterPollSeconds}s) — verifique se está em execução.`;
                } else {
                    if (msgEl) msgEl.textContent = `⏳ A aguardar Sentinel.py… (${_rasterPollSeconds}s)`;
                }
            }

            // Parar polling após 120 s
            if (_rasterPollSeconds >= 120) {
                _stopRasterPolling();
                if (spinner) spinner.textContent = '🕒';
                if (msgEl)   msgEl.textContent   = 'A processar em segundo plano. Verifique os Rasters gerados mais tarde.';
                loadRastersList();
            }
        })
        .catch(() => { /* rede instável — tentar novamente no próximo tick */ });
}

function _hideRasterProgress() {
    const box = document.getElementById('raster-progress-box');
    if (box) box.style.display = 'none';
}

/** Carrega lista de rasters gerados */
function loadRastersList() {
    const tid   = document.getElementById('raster-list-terrain')?.value || '';
    const listEl = document.getElementById('rasters-list');
    if (!listEl) return;
    listEl.innerHTML = '<div style="text-align:center;padding:16px;color:#9ca3af;font-size:13px;">A carregar…</div>';

    const fd = new FormData();
    fd.append('action',     'get_rasters');
    fd.append('terrain_id', tid);

    fetch('?tab=field', { method: 'POST', body: fd })
        .then(r => r.json())
        .then(data => {
            if (!data.success) { listEl.innerHTML = `<div style="color:#ef4444;font-size:13px;">⚠️ ${escHtml(data.message||'Erro')}</div>`; return; }
            _renderRastersList(data.rasters || []);
        })
        .catch(() => { listEl.innerHTML = '<div style="color:#ef4444;font-size:13px;">❌ Erro de rede.</div>'; });
}

const RASTER_TYPE_LABELS = {
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

// Descrições para o painel informativo do índice selecionado
const RASTER_INFO = {
    ndvi:          { metric:'Vigor vegetal padrão (NIR–Red)',         use:'Avaliação geral de vegetação e monitorização da biomassa foliar' },
    evi:           { metric:'Vigor com menor saturação em vegetação densa (NIR, Red, Blue)', use:'Florestas e culturas com biomassa elevada; mais sensível que o NDVI em zonas densas' },
    msavi:         { metric:'Vigor vegetal com correção do efeito do solo (NIR, Red)', use:'Culturas jovens, linhas de vinha espaçadas ou vegetação pouco densa sobre solo exposto' },
    gndvi:         { metric:'Sensibilidade à clorofila e ao estado fisiológico (NIR, Green)', use:'Deteção precoce de diferenças vegetativas e stress por nutrientes (N, Mg)' },
    ndre:          { metric:'Índice baseado no Red-Edge (NIR, RE1)', use:'Stress hídrico e foliar, teor relativo de clorofila, diferenças em vegetação mais desenvolvida' },
    ndmi:          { metric:'Teor relativo de humidade na vegetação (NIR, SWIR1)', use:'Stress hídrico, seca e risco de incêndio em vegetação' },
    ndwi:          { metric:'Água superficial ou humidade (Green, NIR)', use:'Delimitação de corpos de água e zonas húmidas; deteção de cheias' },
    nbr:           { metric:'Severidade e extensão de áreas ardidas (NIR, SWIR2)', use:'Monitorização pós-incêndio; classificação de severidade (dNBR entre datas)' },
    bsi:           { metric:'Solo exposto — minerais vs. vegetação (SWIR1, Red, NIR, Blue)', use:'Parcelas abandonadas, mobilização do solo e avaliação do risco de erosão' },
    ndvi_anomaly:  { metric:'NDVI atual vs. período de referência', use:'Identificar zonas com vigor anómalos (excesso ou défice) face à mediana histórica' },
    ndvi_diff:     { metric:'Diferença de NDVI entre dois períodos', use:'Comparar evolução da vegetação antes/depois de evento (seca, corte, reflorestação)' },
    lst:           { metric:'Temperatura de brilho superficial — banda S8 10.85 µm (~1 km)', use:'Stress térmico, ilhas de calor, deteção de secas e microclimas' },
    chuva:         { metric:'Precipitação acumulada em mm (ERA5 reanalysis)', use:'Histórico de chuva no período pedido; correlacionar com NDVI ou estado hídrico' },
    humidade_solo: { metric:'Proxy de humidade do solo — VV backscatter SAR C-band', use:'Avaliação indicativa do teor de humidade; requer calibração local para valores absolutos' },
    sar_vv:        { metric:'Retroespalhamento VV em dB (polarização vertical)', use:'Estrutura superficial, solo nu e vegetação baixa; referência estrutural do terreno' },
    sar_vh:        { metric:'Retroespalhamento VH em dB (polarização cruzada)', use:'Estrutura da vegetação e biomassa relativa; complemento ao NDVI em dias nublados' },
    sar_ratio:     { metric:'Relação VV/VH entre polarizações (dB)', use:'Deteção de alterações estruturais; distinção solo/vegetação/água' },
    sar_rvi:       { metric:'Radar Vegetation Index — 4·VH/(VV+VH)', use:'Indicador radar de vegetação; complemento ao NDVI em períodos com nuvens' },
    sar_agua:      { metric:'Deteção de água por retroespalhamento muito baixo', use:'Mapeamento de cheias, charcos e zonas de drenagem deficiente' },
    altitude:      { metric:'Altitude em metros — DEM Copernicus GLO-30 (~30 m)', use:'Caracterização topográfica e microclimática; base para índices derivados' },
    declive:       { metric:'Declive em graus calculado a partir do DEM', use:'Mecanização, acessibilidade, erosão e risco operacional' },
    aspect:        { metric:'Orientação da encosta (N/S/E/W) — rosa-dos-ventos', use:'Exposição solar, diferenças de humidade e seleção de espécies' },
};
const RASTER_STATUS_ICON = { pending:'⏳', processing:'🔄', done:'✅', error:'❌' };

function _renderRastersList(rasters) {
    const listEl = document.getElementById('rasters-list');
    if (!listEl) return;

    if (!rasters.length) {
        listEl.innerHTML = `
            <div style="text-align:center;padding:24px;color:#9ca3af;font-size:13px;">
                <div style="font-size:32px;margin-bottom:8px;">🛰️</div>
                Nenhum raster gerado ainda. Use o formulário acima para criar o primeiro.
            </div>`;
        return;
    }

    const rows = rasters.map(r => {
        const dt      = new Date(r.created_at).toLocaleString('pt-PT', { dateStyle:'short', timeStyle:'short' });
        const icon    = RASTER_STATUS_ICON[r.status] || '?';
        const label   = RASTER_TYPE_LABELS[r.raster_type] || r.raster_type;
        const isDone  = r.status === 'done';
        const terrain = r.terrain_name ? `<span style="color:#667eea;font-size:11px;">📍 ${escHtml(r.terrain_name)}</span><br>` : '';

        return `
            <div style="display:flex;align-items:flex-start;gap:10px;padding:10px 0;
                        border-bottom:1px solid #f3f4f6;font-size:13px;">
                <span style="font-size:20px;flex-shrink:0;line-height:1.4;">${icon}</span>
                <div style="flex:1;min-width:0;">
                    ${terrain}
                    <div style="font-weight:600;color:#1f2937;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                        ${escHtml(r.name)}
                    </div>
                    <div style="font-size:11px;color:#9ca3af;margin-top:2px;">${label} · ${dt}</div>
                    ${r.error_msg ? `<div style="font-size:11px;color:#ef4444;margin-top:2px;">❌ ${escHtml(r.error_msg.substring(0,120))}</div>` : ''}
                </div>
                <div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0;">
                    ${isDone ? `<a href="?tab=map" class="btn btn-primary btn-sm" style="font-size:11px;padding:3px 8px;text-decoration:none;">🗺️ Ver no Mapa</a>` : ''}
                    <button onclick="deleteRaster(${r.id}, '${escHtml(r.name.replace(/'/g,''))}')"
                            class="btn btn-danger btn-sm" style="font-size:11px;padding:3px 8px;">🗑️</button>
                </div>
            </div>`;
    }).join('');

    listEl.innerHTML = `<div style="font-size:12px;color:#6b7280;margin-bottom:6px;">${rasters.length} raster(s)</div>` + rows;
}

function deleteRaster(id, name) {
    if (!confirm(`Eliminar raster "${name}"?`)) return;
    const fd = new FormData();
    fd.append('action', 'delete_raster');
    fd.append('id',     id);
    fetch('?tab=field', { method: 'POST', body: fd })
        .then(r => r.json())
        .then(data => {
            if (data.success) { showAlert('🗑️ Raster eliminado.', 'info'); loadRastersList(); }
            else showAlert('❌ ' + (data.message || 'Erro'), 'error');
        })
        .catch(() => showAlert('❌ Erro de rede.', 'error'));
}

// ── Util ──────────────────────────────────────────────────────────────────────
function escHtml(s) {
    return String(s)
        .replace(/&/g,'&amp;').replace(/</g,'&lt;')
        .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ══════════════════════════════════════════════════════════════════════════════
// CSV Import & Field Parameters
// ══════════════════════════════════════════════════════════════════════════════

let csvImportMarkers = [];

function toggleCsvPanel() {
    const panel = document.getElementById('csv-panel');
    const btn   = document.getElementById('csv-toggle-btn');
    if (!panel) return;
    const open = panel.style.display === 'none';
    panel.style.display = open ? 'block' : 'none';
    btn.textContent = open ? '▲ Recolher' : '▼ Expandir';
    if (open) {
        loadFieldParameters();
        loadCsvImportsList();
    }
}

// ── Parâmetros ────────────────────────────────────────────────────────────────

function loadFieldParameters() {
    const fd = new FormData();
    fd.append('action', 'get_field_parameters');
    fetch('?tab=field', { method: 'POST', body: fd })
        .then(r => r.json())
        .then(data => renderFieldParams(data.parameters || []))
        .catch(() => {});
}

function renderFieldParams(params) {
    const el = document.getElementById('field-params-list');
    if (!el) return;
    if (params.length === 0) {
        el.innerHTML = '<span style="color:#9ca3af;font-size:13px;">Nenhum parâmetro. Execute a migração 007.</span>';
        return;
    }
    el.innerHTML = params.map(p => {
        const isUser   = p.scope === 'user';
        const scopeBadge = isUser
            ? '<span style="background:#d1fae5;color:#065f46;font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;margin-left:4px;">pessoal</span>'
            : '<span style="background:#dbeafe;color:#1e40af;font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;margin-left:4px;">global</span>';
        const delBtn = isUser
            ? `<button onclick="deleteFieldParameter(${p.id})"
                       title="Remover"
                       style="background:none;border:none;color:#ef4444;cursor:pointer;font-size:13px;padding:0 2px;margin-left:4px;">✕</button>`
            : '';
        return `<span style="display:inline-flex;align-items:center;background:#f3f4f6;border-radius:8px;padding:5px 10px;font-size:13px;">
                    <strong>${escHtml(p.name)}</strong>
                    ${p.unit ? `<span style="color:#9ca3af;margin-left:4px;font-size:11px;">${escHtml(p.unit)}</span>` : ''}
                    ${scopeBadge}${delBtn}
                </span>`;
    }).join('');
}

function addFieldParameter() {
    const name = (document.getElementById('new-param-name').value || '').trim();
    const unit = (document.getElementById('new-param-unit').value || '').trim();
    if (!name) { showAlert('⚠️ Introduza o nome do parâmetro.', 'warning'); return; }
    const fd = new FormData();
    fd.append('action',     'add_field_parameter');
    fd.append('param_name', name);
    fd.append('param_unit', unit);
    fetch('?tab=field', { method: 'POST', body: fd })
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                showAlert('✅ Parâmetro adicionado.', 'success');
                document.getElementById('new-param-name').value = '';
                document.getElementById('new-param-unit').value = '';
                loadFieldParameters();
            } else {
                showAlert('❌ ' + (data.message || 'Erro'), 'error');
            }
        })
        .catch(() => showAlert('❌ Erro de rede.', 'error'));
}

function deleteFieldParameter(id) {
    if (!confirm('Remover este parâmetro?')) return;
    const fd = new FormData();
    fd.append('action',   'delete_field_parameter');
    fd.append('param_id', id);
    fetch('?tab=field', { method: 'POST', body: fd })
        .then(r => r.json())
        .then(data => {
            if (data.success) { showAlert('🗑️ Parâmetro removido.', 'info'); loadFieldParameters(); }
            else showAlert('❌ ' + (data.message || 'Erro'), 'error');
        })
        .catch(() => showAlert('❌ Erro de rede.', 'error'));
}

// ── CSV File Handling ─────────────────────────────────────────────────────────

const csvDropZone = document.getElementById('csv-drop-zone');
if (csvDropZone) {
    csvDropZone.addEventListener('dragover', e => { e.preventDefault(); csvDropZone.style.borderColor = '#667eea'; csvDropZone.style.background = '#f5f3ff'; });
    csvDropZone.addEventListener('dragleave', () => { csvDropZone.style.borderColor = '#d1d5db'; csvDropZone.style.background = ''; });
    csvDropZone.addEventListener('drop', e => {
        e.preventDefault();
        csvDropZone.style.borderColor = '#d1d5db';
        csvDropZone.style.background = '';
        const file = e.dataTransfer.files[0];
        if (file && file.name.toLowerCase().endsWith('.csv')) handleCsvFileSelect(file);
        else showAlert('⚠️ Selecione um ficheiro .csv', 'warning');
    });
}

function handleCsvFileSelect(file) {
    if (!file) return;
    const statusEl = document.getElementById('csv-import-status');
    statusEl.innerHTML = '<div style="color:#6b7280;font-size:13px;">A ler ficheiro…</div>';
    const reader = new FileReader();
    reader.onload = e => {
        try {
            const rows = parseCsv(e.target.result);
            if (rows.length === 0) { statusEl.innerHTML = '<div style="color:#ef4444;font-size:13px;">❌ Sem linhas válidas no CSV.</div>'; return; }
            statusEl.innerHTML = `<div style="color:#6b7280;font-size:13px;">📊 ${rows.length} linhas lidas. A importar…</div>`;
            submitCsvRows(rows, statusEl);
        } catch (err) {
            statusEl.innerHTML = `<div style="color:#ef4444;font-size:13px;">❌ Erro: ${escHtml(err.message)}</div>`;
        }
    };
    reader.readAsText(file, 'UTF-8');
}

function parseCsv(text) {
    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    if (lines.length < 2) return [];
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const vals = line.split(',');
        const row  = {};
        headers.forEach((h, idx) => { row[h] = (vals[idx] || '').trim(); });
        rows.push(row);
    }
    return rows;
}

function submitCsvRows(rows, statusEl) {
    const fd = new FormData();
    fd.append('action', 'import_csv');
    fd.append('rows',   JSON.stringify(rows));
    fetch('?tab=field', { method: 'POST', body: fd })
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                statusEl.innerHTML = `<div style="color:#16a34a;font-size:13px;font-weight:600;">✅ ${data.message}</div>`;
                showAlert(`✅ ${data.message}`, 'success');
                showCsvRowsOnMap(rows);
                loadCsvImportsList();
            } else {
                statusEl.innerHTML = `<div style="color:#ef4444;font-size:13px;">❌ ${escHtml(data.message || 'Erro')}</div>`;
            }
        })
        .catch(() => { statusEl.innerHTML = '<div style="color:#ef4444;font-size:13px;">❌ Erro de rede.</div>'; });
}

// ── Visualização no mapa ──────────────────────────────────────────────────────

const CLASS_COLORS = { '0':'#ef4444','1':'#22c55e','2':'#3b82f6','3':'#f97316','4':'#a855f7' };

function showCsvRowsOnMap(rows) {
    csvImportMarkers.forEach(m => { if (fieldMap) fieldMap.removeLayer(m); });
    csvImportMarkers = [];
    const bounds = [];
    rows.forEach(row => {
        const lat = parseFloat(row['latitude'] || row['lat'] || '');
        const lon = parseFloat(row['longitude'] || row['lon'] || row['lng'] || '');
        if (isNaN(lat) || isNaN(lon)) return;
        const cls   = String(row['class'] || row['classe'] || '2');
        const color = CLASS_COLORS[cls] || '#6b7280';
        const m = L.circleMarker([lat, lon], { radius:6, color, fillColor:color, fillOpacity:0.85, weight:1.5 });
        const lines = [`<b>${escHtml(row['place'] || 'Campo')}</b>`, `Classe: ${escHtml(cls)}`];
        Object.keys(row).forEach(k => {
            if (['place','latitude','longitude','lat','lon','lng','class','classe'].includes(k)) return;
            lines.push(`${escHtml(k)}: ${escHtml(row[k])}`);
        });
        m.bindPopup(lines.join('<br>'));
        m.addTo(fieldMap);
        csvImportMarkers.push(m);
        bounds.push([lat, lon]);
    });
    if (bounds.length > 0) fieldMap.fitBounds(bounds, { padding:[30,30] });
}

// ── Lista de importações anteriores ──────────────────────────────────────────

function loadCsvImportsList() {
    const el = document.getElementById('csv-imports-list');
    if (!el) return;
    el.innerHTML = '<div style="color:#9ca3af;font-size:13px;">A carregar…</div>';
    const fd = new FormData();
    fd.append('action', 'get_csv_imports');
    fetch('?tab=field', { method: 'POST', body: fd })
        .then(r => r.json())
        .then(data => {
            const imports = data.imports || [];
            if (imports.length === 0) {
                el.innerHTML = '<div style="color:#9ca3af;font-size:13px;">Nenhuma importação ainda.</div>';
                return;
            }
            el.innerHTML = '<table style="width:100%;font-size:13px;border-collapse:collapse;">' +
                '<thead><tr>' +
                '<th style="text-align:left;padding:6px 10px;background:#f9fafb;color:#374151;font-size:12px;border-bottom:1px solid #e5e7eb;">ID</th>' +
                '<th style="text-align:left;padding:6px 10px;background:#f9fafb;color:#374151;font-size:12px;border-bottom:1px solid #e5e7eb;">Data</th>' +
                '<th style="text-align:left;padding:6px 10px;background:#f9fafb;color:#374151;font-size:12px;border-bottom:1px solid #e5e7eb;">Linhas</th>' +
                '<th style="padding:6px 10px;background:#f9fafb;border-bottom:1px solid #e5e7eb;"></th>' +
                '</tr></thead><tbody>' +
                imports.map(imp => `<tr>
                    <td style="padding:6px 10px;font-family:monospace;font-size:11px;color:#9ca3af;border-bottom:1px solid #f3f4f6;">${escHtml(imp.import_id.substring(0,8))}…</td>
                    <td style="padding:6px 10px;border-bottom:1px solid #f3f4f6;">${escHtml(imp.imported_at ? imp.imported_at.substring(0,16) : '—')}</td>
                    <td style="padding:6px 10px;border-bottom:1px solid #f3f4f6;font-weight:700;">${escHtml(imp.row_count)}</td>
                    <td style="padding:6px 10px;border-bottom:1px solid #f3f4f6;text-align:right;">
                        <button class="btn btn-secondary btn-sm" onclick="loadCsvImportOnMap('${escHtml(imp.import_id)}')">🗺️ Ver</button>
                        <button class="btn btn-secondary btn-sm" onclick="deleteCsvImport('${escHtml(imp.import_id)}')" style="color:#ef4444;">🗑️</button>
                    </td>
                </tr>`).join('') +
                '</tbody></table>';
        })
        .catch(() => { el.innerHTML = '<div style="color:#ef4444;font-size:13px;">Erro ao carregar.</div>'; });
}

function loadCsvImportOnMap(importId) {
    const fd = new FormData();
    fd.append('action',    'get_csv_import_data');
    fd.append('import_id', importId);
    fetch('?tab=field', { method: 'POST', body: fd })
        .then(r => r.json())
        .then(data => {
            if (data.success) showCsvRowsOnMap(data.rows.map(r => ({
                place: r.place, latitude: r.latitude, longitude: r.longitude,
                class: r.class_value, ...(r.params || {})
            })));
            else showAlert('❌ ' + (data.message || 'Erro'), 'error');
        })
        .catch(() => showAlert('❌ Erro de rede.', 'error'));
}

function deleteCsvImport(importId) {
    if (!confirm('Eliminar esta importação?')) return;
    const fd = new FormData();
    fd.append('action',    'delete_csv_import');
    fd.append('import_id', importId);
    fetch('?tab=field', { method: 'POST', body: fd })
        .then(r => r.json())
        .then(data => {
            if (data.success) { showAlert('🗑️ Importação eliminada.', 'info'); loadCsvImportsList(); }
            else showAlert('❌ ' + (data.message || 'Erro'), 'error');
        })
        .catch(() => showAlert('❌ Erro de rede.', 'error'));
}
