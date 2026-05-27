/**
 * Field Tab — Medições de Campo (SoilQI Field PWA)
 */

let fieldMap     = null;
let markerLayer  = null;
let allMeasurements = [];

// ── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function () {
    if (activeTab !== 'field') return;
    initFieldMap();
    applyFilters();
});

// ── Mapa ─────────────────────────────────────────────────────────────────────
function initFieldMap() {
    fieldMap = L.map('field-map', { zoomControl: true }).setView([39.5, -8.0], 7);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19
    }).addTo(fieldMap);

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

// ── Util ──────────────────────────────────────────────────────────────────────
function escHtml(s) {
    return String(s)
        .replace(/&/g,'&amp;').replace(/</g,'&lt;')
        .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
