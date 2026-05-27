/**
 * Field Tab — Medições de Campo (SoilQI Field PWA)
 */

let fieldMap            = null;
let markerLayer         = null;
let allMeasurements     = [];
let interpolationOverlay = null;

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
    L.control.layers(
        { '🗺️ Mapa': osmBase, '🛰️ Satélite': satBase, '🏔️ Relevo': topoBase },
        { '🏷️ Etiquetas': labelsOv },
        { position: 'topright', collapsed: true }
    ).addTo(fieldMap);

    markerLayer = L.layerGroup().addTo(fieldMap);
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

function updateMap(measurements) {
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

    // Ajusta zoom para caber todos os pontos
    if (valid.length === 1) {
        fieldMap.setView([parseFloat(valid[0].latitude), parseFloat(valid[0].longitude)], 14);
    } else {
        const bounds = L.latLngBounds(valid.map(m => [parseFloat(m.latitude), parseFloat(m.longitude)]));
        fieldMap.fitBounds(bounds, { padding: [40, 40] });
    }
}

// ── Filtros ───────────────────────────────────────────────────────────────────
function applyFilters() {
    const fd = new FormData();
    fd.append('action',     'get_field_measurements');
    fd.append('date_from',  document.getElementById('filter-date-from')?.value  || '');
    fd.append('date_to',    document.getElementById('filter-date-to')?.value    || '');
    fd.append('terrain_id', document.getElementById('filter-terrain')?.value    || '');

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
            updateMap(allMeasurements);
            renderTable(allMeasurements);
        })
        .catch(() => {
            wrap.innerHTML = '<div class="sql-error">❌ Erro ao carregar medições.</div>';
        });
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
    setInterpStatus('Overlay removido.');
}

// ── Gerar interpolação ────────────────────────────────────────────────────────
async function generateInterpolation() {
    const terrainId = document.getElementById('interp-terrain-sel').value;
    const param     = document.getElementById('interp-param').value;
    const colormap  = document.getElementById('interp-colormap').value;
    const resPx     = parseInt(document.getElementById('interp-res').value);
    const opacity   = parseInt(document.getElementById('interp-opacity').value) / 100;
    const power     = 2; // expoente IDW

    if (!terrainId) { setInterpStatus('⚠️ Selecione um campo (terreno).'); return; }

    // Pontos com o parâmetro escolhido
    const pts = allMeasurements
        .filter(m => m[param] !== null && m[param] !== '' && m.latitude && m.longitude)
        .map(m => ({ lat: parseFloat(m.latitude), lng: parseFloat(m.longitude), v: parseFloat(m[param]) }));

    if (pts.length < 2) {
        setInterpStatus(`⚠️ São necessárias ≥ 2 medições com "${param}" nos filtros actuais.`);
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

    setInterpStatus(`⏳ A calcular IDW (${pts.length} pontos, ${resPx}×${resPx} px)…`);

    // Dar tempo ao browser para mostrar a mensagem antes do cálculo intensivo
    await new Promise(r => setTimeout(r, 30));

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
            const val = idw(pts, lat, lng, power);
            if (val === null) continue;
            const t = maxV > minV ? (val - minV) / (maxV - minV) : 0.5;
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

    setInterpStatus(`✅ Interpolação concluída — ${pts.length} pontos · ${resPx}×${resPx} px · IDW (p=${power})`);
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

// ── Util ──────────────────────────────────────────────────────────────────────
function escHtml(s) {
    return String(s)
        .replace(/&/g,'&amp;').replace(/</g,'&lt;')
        .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
