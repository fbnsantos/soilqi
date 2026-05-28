/**
 * Field Tab — Medições de Campo (SoilQI Field PWA)
 */

let fieldMap            = null;
let markerLayer         = null;
let allMeasurements     = [];
let interpolationOverlay = null;
let addModeActive       = false;
let tempMarker          = null;

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

// ── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function () {
    if (activeTab !== 'field') return;
    initFieldMap();
    applyFilters();
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

    markerLayer = L.layerGroup().addTo(fieldMap);

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
        if (!addModeActive) return;
        openQuickModal(e.latlng.lat, e.latlng.lng);
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

    const wrap = document.getElementById('field-table-wrap');
    wrap.innerHTML = '<div style="text-align:center;padding:40px;color:#6b7280">A carregar…</div>';

    fetch('?tab=field', { method: 'POST', body: fd })
        .then(r => r.json())
        .then(data => {
            if (!data.success) {
                wrap.innerHTML = `<div class="warning-box">⚠️ ${escHtml(data.message)}</div>`;
                return;
            }
            allMeasurements = data.measurements || [];
            updateStats(data.stats);
            // Se há terreno selecionado, o zoom é feito pelo polígono (skipZoom=true aqui)
            updateMap(allMeasurements, !!terrainId);
            renderTable(allMeasurements);
            if (terrainId) _zoomToFilterTerrain(terrainId);
        })
        .catch(() => {
            wrap.innerHTML = '<div class="sql-error">❌ Erro ao carregar medições.</div>';
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
    applyFilters();
}

// ── Estatísticas ──────────────────────────────────────────────────────────────
function updateStats(s) {
    if (!s) return;
    const fmt = (v, dec) => (v !== null && v !== undefined) ? parseFloat(v).toFixed(dec) : '—';

    document.getElementById('stat-total').textContent = s.total || 0;
    document.getElementById('stat-ec').textContent    = fmt(s.avg_ec,   2);
    document.getElementById('stat-ph').textContent    = fmt(s.avg_ph,   1);
    document.getElementById('stat-temp').textContent  = fmt(s.avg_temp, 1);
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

// onInterpMethodChange — reservado para futuras extensões
function onInterpMethodChange() {}

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
    idw:     'IDW (p=2)',
    kriging: 'Kriging Ordinária',
    tps:     'Thin Plate Spline',
    nn:      'Vizinho mais próximo'
};

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
        setInterpStatus(`⏳ A construir modelo ${INTERP_METHOD_LABELS[method]} (${pts.length} pontos)…`);
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

    setInterpStatus(`⏳ A calcular ${INTERP_METHOD_LABELS[method]} (${pts.length} pontos, ${resPx}×${resPx} px)…`);
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

    setInterpStatus(`✅ ${INTERP_METHOD_LABELS[method]} concluído — ${pts.length} pontos · ${resPx}×${resPx} px`);

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
    saveBtn.disabled = true;

    if (file.size > 20 * 1024 * 1024) {
        info.textContent = '⚠️ Ficheiro demasiado grande (máx. 20 MB).';
        info.style.color = '#dc2626';
        return;
    }

    const ext = file.name.split('.').pop().toLowerCase();
    const kb  = (file.size / 1024).toFixed(0);

    if (!['kmz','kml','geojson','json'].includes(ext)) {
        info.textContent = `⚠️ Formato não suportado (.${ext}). Use .geojson, .json, .kmz ou .kml.`;
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
const _GJ_FILE_LABEL  = '📁 Clique para selecionar .geojson / .json / .kmz / .kml';

function _gjReset(status, btn) {
    pendingGeoJSON = null;
    pendingKmzFile = null;
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
    if (!pendingGeoJSON && !pendingKmzFile) return;

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
                    return L.circleMarker(latlng, {
                        radius: 6, fillColor: color, color: '#fff',
                        weight: 1.5, opacity: 1, fillOpacity: 0.85
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

// ── Util ──────────────────────────────────────────────────────────────────────
function escHtml(s) {
    return String(s)
        .replace(/&/g,'&amp;').replace(/</g,'&lt;')
        .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
