/**
 * operations.js — Tab de Operações de Campo
 * Planeamento de operações agrícolas: calendário, trajectórias, custos.
 */

// ── Estado global ─────────────────────────────────────────────────────────────
let opsMap             = null;
let opsDrawnItems      = null;
let opsDrawControl     = null;
let opsDrawHandler     = null;  // handler activo do Leaflet.Draw
let opsTerrainId       = null;
let opsTerrainArea     = null;
let opsTerrainLayer    = null;  // L.polygon do boundary
let opsOpLayers        = {};    // id → L.layer (trajectórias no mapa)
let opsCurrentTrajectory = null;
let opsCurrentTrajType   = 'line';
let opsCalYear         = 0;
let opsCalMonth        = 0;
let opsCalSelDay       = null;  // dia seleccionado no calendário
let opsAllOps          = [];    // cache todas as operações do terreno
let opsListFilter      = '';    // filtro de estado activo

// ── Definições de tipos e estados ────────────────────────────────────────────
const OPS_TYPES = {
    pulverizacao:    { label: 'Pulverização',       icon: '💦', color: '#8b5cf6', traj: 'line'  },
    fertilizacao:    { label: 'Fertilização',        icon: '🌱', color: '#10b981', traj: 'line'  },
    monda:           { label: 'Monda',               icon: '✂️',  color: '#f59e0b', traj: 'line'  },
    colheita:        { label: 'Colheita',            icon: '🌾', color: '#f97316', traj: 'line'  },
    sementeira:      { label: 'Sementeira',          icon: '🌰', color: '#3b82f6', traj: 'line'  },
    coberto_vegetal: { label: 'Coberto Vegetal',     icon: '🍃', color: '#22c55e', traj: 'area'  },
    monitorizacao:   { label: 'Monitorização',       icon: '📡', color: '#6366f1', traj: 'point' },
    correccao_solo:  { label: 'Correcção Solo',      icon: '⛏️',  color: '#78716c', traj: 'area'  },
    outro:           { label: 'Outro',               icon: '📋', color: '#6b7280', traj: 'line'  },
};

const OPS_STATUS = {
    planned:     { label: 'Planeada',      color: '#2563eb', bg: '#eff6ff'  },
    in_progress: { label: 'Em progresso',  color: '#d97706', bg: '#fffbeb'  },
    done:        { label: 'Concluída',      color: '#059669', bg: '#ecfdf5'  },
    cancelled:   { label: 'Cancelada',     color: '#6b7280', bg: '#f9fafb'  },
};

const OPS_MONTHS = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                    'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

// ── Utilitários ───────────────────────────────────────────────────────────────
function _opsEsc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;')
           .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function _opsAlert(msg, type) {
    if (typeof showAlert === 'function') showAlert(msg, type);
}
function _opsFmtDate(d) {
    if (!d) return '—';
    try { return new Date(d + 'T00:00').toLocaleDateString('pt-PT'); } catch(e) { return d; }
}
function _opsFmtEur(v) {
    return parseFloat(v || 0).toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}
function _opsFetch(data, cb) {
    fetch('index.php?tab=operations', { method: 'POST', body: data })
        .then(r => r.json()).then(cb).catch(() => {});
}
function _opsFormStatus(msg, type) {
    const el = document.getElementById('ops-form-status');
    if (!el) return;
    if (!msg) { el.style.display = 'none'; return; }
    const clr = { info:{bg:'#eff6ff',bd:'#bfdbfe',tx:'#1d4ed8'},
                  success:{bg:'#f0fdf4',bd:'#bbf7d0',tx:'#166534'},
                  error:{bg:'#fef2f2',bd:'#fecaca',tx:'#dc2626'},
                  warning:{bg:'#fffbeb',bd:'#fde68a',tx:'#92400e'} }[type] || {};
    Object.assign(el.style, {
        display:'', background:clr.bg, border:`1px solid ${clr.bd}`,
        color:clr.tx, borderRadius:'5px', padding:'7px 9px', fontSize:'11px',
    });
    el.textContent = msg;
}

// ── Grupos colapsáveis ────────────────────────────────────────────────────────
function opsToggleGroup(name) {
    const body  = document.getElementById('lg-' + name);
    const arrow = document.getElementById(name + '-arrow');
    if (!body) return;
    const opening = body.style.display === 'none';
    body.style.display = opening ? '' : 'none';
    if (arrow) arrow.textContent = opening ? '▼' : '▶';
    if (opening && name === 'oplist') _opsRefreshList();
}

// ── Terrenos ──────────────────────────────────────────────────────────────────
function _opsLoadTerrains() {
    const fd = new FormData();
    fd.append('action', 'get_ops_terrains');
    _opsFetch(fd, data => {
        const sel = document.getElementById('ops-terrain-sel');
        if (!sel) return;
        (data.terrains || []).forEach(t => {
            const opt = document.createElement('option');
            opt.value = t.id;
            opt.textContent = t.name + (t.area ? '  (' + parseFloat(t.area).toFixed(2) + ' ha)' : '');
            opt.dataset.area   = t.area        || '';
            opt.dataset.coords = t.coordinates || '';
            sel.appendChild(opt);
        });
    });
}

function opsTerrainChange(val) {
    opsTerrainId   = val ? parseInt(val) : null;
    opsTerrainArea = null;
    opsAllOps      = [];

    // Limpar mapa
    Object.values(opsOpLayers).forEach(l => { try { opsMap.removeLayer(l); } catch(e) {} });
    opsOpLayers = {};
    if (opsTerrainLayer) { opsMap.removeLayer(opsTerrainLayer); opsTerrainLayer = null; }

    document.getElementById('ops-list').innerHTML = '<div class="layer-empty">A carregar…</div>';
    _opsHideSeasonSummary();

    if (!opsTerrainId) {
        document.getElementById('ops-list').innerHTML = '<div class="layer-empty">Selecione um terreno.</div>';
        document.getElementById('ops-list-badge').textContent = '0';
        document.getElementById('ops-list-badge').classList.remove('has-items');
        document.getElementById('ops-prescription').innerHTML = '<option value="">— Sem prescrição associada —</option>';
        opsCalOps = []; _opsRenderCalendar();
        return;
    }

    // Área do terreno → preencher campo
    const sel = document.getElementById('ops-terrain-sel');
    const opt = sel ? sel.querySelector(`option[value="${val}"]`) : null;
    if (opt) {
        if (opt.dataset.area) {
            opsTerrainArea = parseFloat(opt.dataset.area);
            const aEl = document.getElementById('ops-area');
            if (aEl && !aEl.value) { aEl.value = opsTerrainArea.toFixed(2); opsCalcCost(); }
        }
        // Mostrar boundary
        if (opt.dataset.coords) {
            try {
                const coords  = JSON.parse(opt.dataset.coords);
                const latlngs = coords.map(c => [c.lat, c.lng]);
                if (latlngs.length) {
                    opsTerrainLayer = L.polygon(latlngs, {
                        color: '#667eea', weight: 2, fillOpacity: 0.05,
                        fillColor: '#667eea', dashArray: '6,4',
                    }).addTo(opsMap);
                    opsMap.fitBounds(opsTerrainLayer.getBounds(), { padding: [30, 30] });
                }
            } catch(e) {}
        }
    }

    _opsLoadPrescriptions(opsTerrainId);
    _opsLoadOps();
}

function _opsLoadPrescriptions(terrainId) {
    const sel = document.getElementById('ops-prescription');
    if (!sel) return;
    sel.innerHTML = '<option value="">— Sem prescrição associada —</option>';
    const fd = new FormData();
    fd.append('action',     'get_ops_prescriptions');
    fd.append('terrain_id', terrainId);
    _opsFetch(fd, data => {
        (data.prescriptions || []).forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = p.name + '  (' + _opsFmtDate(p.created_at) + ')';
            sel.appendChild(opt);
        });
    });
}

// ── CRUD de operações ─────────────────────────────────────────────────────────
function _opsLoadOps() {
    if (!opsTerrainId) return;
    const fd = new FormData();
    fd.append('action',     'get_operations');
    fd.append('terrain_id', opsTerrainId);
    _opsFetch(fd, data => {
        opsAllOps = data.items || [];
        _opsRefreshList();
        _opsRenderCalendar();
        _opsRenderOpsOnMap(opsAllOps);
        _opsUpdateSeasonSummary();
    });
}

function _opsRefreshList() {
    const filtered = opsListFilter
        ? opsAllOps.filter(o => o.status === opsListFilter)
        : opsAllOps;
    _opsRenderList(filtered);
}

function opsFilter(btn, status) {
    opsListFilter = status;
    document.querySelectorAll('.ops-filter-btn').forEach(b => b.classList.remove('ops-filter-active'));
    btn.classList.add('ops-filter-active');
    _opsRefreshList();
}

function _opsRenderList(items) {
    const el    = document.getElementById('ops-list');
    const badge = document.getElementById('ops-list-badge');
    if (badge) {
        badge.textContent = opsAllOps.length;
        badge.classList.toggle('has-items', opsAllOps.length > 0);
    }
    if (!el) return;
    if (!items.length) {
        el.innerHTML = opsAllOps.length
            ? '<div class="layer-empty">Nenhuma operação para o filtro seleccionado.</div>'
            : '<div class="layer-empty">Nenhuma operação registada.</div>';
        return;
    }
    el.innerHTML = items.map(op => {
        const t   = OPS_TYPES[op.type]   || OPS_TYPES.outro;
        const st  = OPS_STATUS[op.status] || OPS_STATUS.planned;
        const dt  = op.scheduled_date ? _opsFmtDate(op.scheduled_date) : '—';
        const cost= op.total_cost > 0 ? _opsFmtEur(op.total_cost) : '';
        const onMap = !!opsOpLayers[op.id];
        return `
        <div class="ops-item" id="ops-item-${op.id}">
            <div class="ops-item-hdr">
                <span class="ops-item-icon">${t.icon}</span>
                <span class="ops-item-name" title="${_opsEsc(op.name)}">${_opsEsc(op.name)}</span>
                <span class="ops-status-badge"
                      style="background:${st.bg};color:${st.color};">${st.label}</span>
            </div>
            <div class="ops-item-meta">
                <span>📅 ${dt}</span>
                ${op.season ? `<span>🗓 ${_opsEsc(op.season)}</span>` : ''}
                ${op.area_ha > 0 ? `<span>📐 ${parseFloat(op.area_ha).toFixed(2)} ha</span>` : ''}
                ${cost ? `<span>💰 ${cost}</span>` : ''}
                ${op.notes ? `<span title="${_opsEsc(op.notes)}" style="color:#d97706;">📝</span>` : ''}
            </div>
            <div class="ops-item-actions">
                <button class="ops-item-btn" id="ops-map-btn-${op.id}"
                        onclick="_opsToggleOnMap(${op.id})"
                        style="background:${onMap ? '#ede9fe' : '#f3f4f6'};color:${onMap ? '#7c3aed' : '#6b7280'};">
                    ${onMap ? '✅ Mapa' : '🗺️ Mapa'}
                </button>
                <button class="ops-item-btn" onclick="opsEdit(${op.id})"
                        style="background:#eff6ff;color:#2563eb;">✏️</button>
                <select onchange="opsQuickStatus(${op.id},this)" title="Mudar estado"
                        style="font-size:10px;padding:3px 4px;border:1px solid #e5e7eb;
                               border-radius:5px;cursor:pointer;background:#fff;color:#374151;
                               max-width:90px;">
                    <option value="">Estado…</option>
                    <option value="planned">🔵 Planeada</option>
                    <option value="in_progress">🟡 Progresso</option>
                    <option value="done">🟢 Feita</option>
                    <option value="cancelled">⚫ Cancelada</option>
                </select>
                <button class="ops-item-btn" onclick="_opsDelete(${op.id})"
                        style="background:#fef2f2;color:#dc2626;">🗑</button>
            </div>
        </div>`;
    }).join('');
}

function opsSave() {
    if (!opsTerrainId) { _opsFormStatus('Selecione um terreno primeiro.', 'warning'); return; }
    const name = document.getElementById('ops-name')?.value.trim();
    if (!name)  { _opsFormStatus('O nome é obrigatório.', 'warning'); return; }

    const opId = parseInt(document.getElementById('ops-edit-id')?.value || 0) || 0;
    const fd   = new FormData();
    fd.append('action',          'save_operation');
    fd.append('op_id',           opId);
    fd.append('terrain_id',      opsTerrainId);
    fd.append('type',            document.getElementById('ops-type')?.value         || 'outro');
    fd.append('name',            name);
    fd.append('status',          document.getElementById('ops-status')?.value       || 'planned');
    fd.append('scheduled_date',  document.getElementById('ops-date')?.value         || '');
    fd.append('season',          document.getElementById('ops-season')?.value       || '');
    fd.append('prescription_id', document.getElementById('ops-prescription')?.value || '');
    fd.append('area_ha',         document.getElementById('ops-area')?.value         || '');
    fd.append('cost_per_ha',     document.getElementById('ops-cost-ha')?.value      || '0');
    fd.append('fixed_cost',      document.getElementById('ops-cost-fixed')?.value   || '0');
    fd.append('notes',           document.getElementById('ops-notes')?.value        || '');
    fd.append('trajectory',      opsCurrentTrajectory ? JSON.stringify(opsCurrentTrajectory) : '');
    fd.append('trajectory_type', opsCurrentTrajType || 'line');

    const btn = document.getElementById('ops-save-btn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ A guardar…'; }

    _opsFetch(fd, data => {
        if (btn) { btn.disabled = false; btn.textContent = '💾 Guardar'; }
        if (!data.success) { _opsFormStatus('❌ ' + (data.message || 'Erro.'), 'error'); return; }
        _opsFormStatus('✅ Guardado!', 'success');
        setTimeout(() => { opsFormReset(); }, 1200);
        _opsLoadOps();
        // Abrir lista se fechada
        const listEl = document.getElementById('lg-oplist');
        if (listEl && listEl.style.display === 'none') opsToggleGroup('oplist');
    });
}

function opsEdit(id) {
    const fd = new FormData();
    fd.append('action', 'get_operation');
    fd.append('id', id);
    _opsFetch(fd, data => {
        if (!data.success || !data.operation) {
            _opsAlert('❌ Operação não encontrada.', 'error'); return;
        }
        const op = data.operation;
        const g  = id => document.getElementById(id);
        g('ops-edit-id').value   = op.id;
        g('ops-type').value      = op.type           || 'outro';
        g('ops-name').value      = op.name           || '';
        g('ops-status').value    = op.status         || 'planned';
        g('ops-date').value      = op.scheduled_date || '';
        g('ops-season').value    = op.season         || '';
        g('ops-area').value      = op.area_ha        || '';
        g('ops-cost-ha').value   = op.cost_per_ha    || '0';
        g('ops-cost-fixed').value= op.fixed_cost     || '0';
        g('ops-notes').value     = op.notes          || '';
        if (g('ops-prescription')) g('ops-prescription').value = op.prescription_id || '';
        opsCalcCost();

        // Restaurar trajectória
        opsCurrentTrajectory = null; opsCurrentTrajType = 'line';
        if (opsDrawnItems) opsDrawnItems.clearLayers();
        if (op.trajectory) {
            try {
                const traj = typeof op.trajectory === 'string'
                    ? JSON.parse(op.trajectory) : op.trajectory;
                opsCurrentTrajectory = traj;
                opsCurrentTrajType   = op.trajectory_type || 'line';
                const color = (OPS_TYPES[op.type] || OPS_TYPES.outro).color;
                _opsDrawFromData(traj, opsCurrentTrajType, color, true);
                _opsUpdateTrajSummary();
            } catch(e) {}
        }

        // Abrir grupo e fazer scroll
        const body = document.getElementById('lg-newop');
        if (body) body.style.display = '';
        const arrow = document.getElementById('newop-arrow');
        if (arrow) arrow.textContent = '▼';
        _opsFormStatus('A editar — altere os campos e clique em Guardar.', 'info');
        g('ops-name')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
}

function opsFormReset() {
    document.getElementById('ops-edit-id').value    = '';
    document.getElementById('ops-name').value       = '';
    document.getElementById('ops-notes').value      = '';
    document.getElementById('ops-type').value       = 'pulverizacao';
    document.getElementById('ops-status').value     = 'planned';
    document.getElementById('ops-date').value       = new Date().toISOString().slice(0, 10);
    document.getElementById('ops-cost-ha').value    = '0';
    document.getElementById('ops-cost-fixed').value = '0';
    document.getElementById('ops-area').value       = opsTerrainArea ? opsTerrainArea.toFixed(2) : '';
    document.getElementById('ops-prescription').value = '';
    opsCalcCost();
    if (opsDrawnItems) opsDrawnItems.clearLayers();
    opsCurrentTrajectory = null; opsCurrentTrajType = 'line';
    _opsUpdateTrajSummary();
    _opsFormStatus('', '');
}

function _opsDelete(id) {
    if (!confirm('Eliminar esta operação? Esta acção é irreversível.')) return;
    const fd = new FormData();
    fd.append('action', 'delete_operation');
    fd.append('id', id);
    _opsFetch(fd, data => {
        if (data.success) {
            if (opsOpLayers[id]) {
                try { opsMap.removeLayer(opsOpLayers[id]); } catch(e) {}
                delete opsOpLayers[id];
            }
            _opsLoadOps();
        } else {
            _opsAlert('❌ ' + (data.message || 'Erro.'), 'error');
        }
    });
}

function opsQuickStatus(id, sel) {
    const status = sel.value;
    if (!status) return;
    sel.value = '';  // reset select
    const fd = new FormData();
    fd.append('action', 'update_op_status');
    fd.append('id',     id);
    fd.append('status', status);
    _opsFetch(fd, data => {
        if (data.success) _opsLoadOps();
        else _opsAlert('❌ ' + (data.message || 'Erro.'), 'error');
    });
}

// ── Trajectórias no mapa ──────────────────────────────────────────────────────
function _opsOnDrawCreated(e) {
    opsDrawnItems.addLayer(e.layer);
    if (opsDrawHandler) { try { opsDrawHandler.disable(); } catch(x) {} opsDrawHandler = null; }
    _opsSetDrawActive('');

    const t     = OPS_TYPES[document.getElementById('ops-type')?.value || 'outro'] || OPS_TYPES.outro;
    const color = t.color;
    if (e.layer.setStyle) e.layer.setStyle({ color, fillColor: color });

    if (e.layerType === 'polyline') {
        opsCurrentTrajectory = e.layer.getLatLngs().map(ll => ({ lat: ll.lat, lng: ll.lng }));
        opsCurrentTrajType   = 'line';
    } else if (e.layerType === 'polygon') {
        const lls = e.layer.getLatLngs()[0] || e.layer.getLatLngs();
        opsCurrentTrajectory = lls.map(ll => ({ lat: ll.lat, lng: ll.lng }));
        opsCurrentTrajType   = 'area';
    } else if (e.layerType === 'marker') {
        const ll = e.layer.getLatLng();
        opsCurrentTrajectory = (opsCurrentTrajectory || []);
        opsCurrentTrajectory.push({ lat: ll.lat, lng: ll.lng });
        opsCurrentTrajType   = 'point';
    }
    _opsUpdateTrajSummary();
    document.getElementById('ops-draw-hint').textContent = '';
}

function _opsDrawFromData(points, type, color, addToMap) {
    if (!points || !points.length) return null;
    const latlngs = points.map(p => [p.lat, p.lng]);
    let layer;
    if (type === 'line') {
        layer = L.polyline(latlngs, { color, weight: 3 });
    } else if (type === 'area') {
        layer = L.polygon(latlngs, { color, weight: 2, fillOpacity: 0.15, fillColor: color });
    } else {
        layer = L.layerGroup(points.map(p =>
            L.circleMarker([p.lat, p.lng], {
                radius: 6, color, fillColor: color, fillOpacity: 0.85, weight: 1.5
            })
        ));
    }
    if (addToMap) opsDrawnItems.addLayer(layer);
    return layer;
}

function opsDrawMode(mode) {
    if (!opsMap) return;
    // Cancelar handler anterior
    if (opsDrawHandler) { try { opsDrawHandler.disable(); } catch(x) {} opsDrawHandler = null; }

    const t     = OPS_TYPES[document.getElementById('ops-type')?.value || 'outro'] || OPS_TYPES.outro;
    const color = t.color;
    const hints = {
        line:  'Clique para traçar o percurso — duplo-clique para terminar.',
        area:  'Clique para delimitar a área — duplo-clique para fechar.',
        point: 'Clique para adicionar pontos de monitorização.',
    };

    if (mode === 'line') {
        opsDrawHandler = new L.Draw.Polyline(opsMap, { shapeOptions: { color, weight: 3 } });
        opsCurrentTrajType = 'line';
    } else if (mode === 'area') {
        opsDrawHandler = new L.Draw.Polygon(opsMap, {
            shapeOptions: { color, weight: 2, fillOpacity: 0.15, fillColor: color }
        });
        opsCurrentTrajType = 'area';
    } else {
        opsDrawHandler = new L.Draw.Marker(opsMap);
        opsCurrentTrajType = 'point';
    }

    opsDrawHandler.enable();
    _opsSetDrawActive(mode);
    const hint = document.getElementById('ops-draw-hint');
    if (hint) hint.textContent = hints[mode] || '';
}

function _opsSetDrawActive(mode) {
    ['line','area','point'].forEach(m => {
        const btn = document.getElementById('ops-btn-' + m);
        if (btn) btn.classList.toggle('active', m === mode);
    });
}

function opsClearDraw() {
    if (opsDrawHandler) { try { opsDrawHandler.disable(); } catch(x) {} opsDrawHandler = null; }
    if (opsDrawnItems) opsDrawnItems.clearLayers();
    opsCurrentTrajectory = null; opsCurrentTrajType = 'line';
    _opsSetDrawActive('');
    const hint = document.getElementById('ops-draw-hint');
    if (hint) hint.textContent = '';
    _opsUpdateTrajSummary();
}

function _opsUpdateTrajSummary() {
    const el  = document.getElementById('ops-traj-summary');
    const inf = document.getElementById('ops-traj-info');
    if (!el) return;
    if (!opsCurrentTrajectory || !opsCurrentTrajectory.length) {
        el.style.display = 'none';
        if (inf) inf.style.display = '';
        return;
    }
    let msg = '';
    if (opsCurrentTrajType === 'line') {
        let dist = 0;
        for (let i = 1; i < opsCurrentTrajectory.length; i++) {
            const a = opsCurrentTrajectory[i - 1], b = opsCurrentTrajectory[i];
            dist += L.latLng(a.lat, a.lng).distanceTo(L.latLng(b.lat, b.lng));
        }
        msg = `✏️ Percurso definido: ${opsCurrentTrajectory.length} ponto(s) · ${(dist / 1000).toFixed(2)} km`;
    } else if (opsCurrentTrajType === 'area') {
        msg = `🔷 Área definida: ${opsCurrentTrajectory.length} vértice(s)`;
    } else {
        msg = `📍 ${opsCurrentTrajectory.length} ponto(s) de monitorização`;
    }
    el.textContent  = msg;
    el.style.display = '';
    if (inf) inf.style.display = 'none';
}

function _opsRenderOpsOnMap(ops) {
    Object.entries(opsOpLayers).forEach(([, l]) => { try { opsMap.removeLayer(l); } catch(e) {} });
    opsOpLayers = {};

    ops.forEach(op => {
        if (!op.trajectory) return;
        try {
            const traj = typeof op.trajectory === 'string'
                ? JSON.parse(op.trajectory) : op.trajectory;
            if (!traj || !traj.length) return;
            const t      = OPS_TYPES[op.type] || OPS_TYPES.outro;
            const st     = OPS_STATUS[op.status] || OPS_STATUS.planned;
            const layer  = _opsDrawFromData(traj, op.trajectory_type || 'line', t.color, false);
            if (!layer) return;

            const dt      = op.scheduled_date ? _opsFmtDate(op.scheduled_date) : '—';
            const costStr = op.total_cost > 0 ? '<br>💰 ' + _opsFmtEur(op.total_cost) : '';
            const popup   = `<b>${t.icon} ${op.name}</b><br>
                <span style="color:${st.color};font-weight:600;">${st.label}</span><br>
                📅 ${dt}${costStr}
                ${op.notes ? '<br><span style="color:#6b7280;font-size:11px;">' + _opsEsc(op.notes.slice(0,80)) + '</span>' : ''}`;

            if (layer.bindPopup)  layer.bindPopup(popup);
            else if (layer.eachLayer) layer.eachLayer(l => l.bindPopup(popup));

            layer.addTo(opsMap);
            opsOpLayers[op.id] = layer;
        } catch(e) { console.warn('[ops] trajectory error:', e); }
    });
}

function _opsToggleOnMap(id) {
    if (opsOpLayers[id]) {
        try { opsMap.removeLayer(opsOpLayers[id]); } catch(e) {}
        delete opsOpLayers[id];
    } else {
        const op = opsAllOps.find(o => o.id == id);
        if (!op || !op.trajectory) {
            _opsAlert('Esta operação não tem trajectória definida.', 'info');
            return;
        }
        const traj = typeof op.trajectory === 'string' ? JSON.parse(op.trajectory) : op.trajectory;
        const t    = OPS_TYPES[op.type] || OPS_TYPES.outro;
        const layer = _opsDrawFromData(traj, op.trajectory_type || 'line', t.color, false);
        if (layer) {
            layer.addTo(opsMap);
            opsOpLayers[id] = layer;
            // Zoom to it
            try {
                const bounds = layer.getBounds ? layer.getBounds() : null;
                if (bounds) opsMap.fitBounds(bounds, { padding: [30, 30] });
            } catch(e) {}
        }
    }
    // Actualizar botão
    const btn = document.getElementById('ops-map-btn-' + id);
    const on  = !!opsOpLayers[id];
    if (btn) {
        btn.textContent = on ? '✅ Mapa' : '🗺️ Mapa';
        btn.style.background = on ? '#ede9fe' : '#f3f4f6';
        btn.style.color      = on ? '#7c3aed' : '#6b7280';
    }
}

// ── Tipo de operação ──────────────────────────────────────────────────────────
function opsTypeChange(type) {
    const t = OPS_TYPES[type] || OPS_TYPES.outro;
    opsCurrentTrajType = t.traj;
}

// ── Cálculo de custo ──────────────────────────────────────────────────────────
function opsCalcCost() {
    const area  = parseFloat(document.getElementById('ops-area')?.value       || 0) || 0;
    const cHa   = parseFloat(document.getElementById('ops-cost-ha')?.value    || 0) || 0;
    const cFix  = parseFloat(document.getElementById('ops-cost-fixed')?.value || 0) || 0;
    const total = area * cHa + cFix;
    const el    = document.getElementById('ops-cost-total');
    if (el) el.textContent = _opsFmtEur(total);
}

// ── Resumo da época ───────────────────────────────────────────────────────────
function _opsUpdateSeasonSummary() {
    const wrap = document.getElementById('ops-season-summary');
    if (!wrap) return;
    if (!opsAllOps.length) { _opsHideSeasonSummary(); return; }

    const totalCost = opsAllOps.reduce((s, o) => s + parseFloat(o.total_cost || 0), 0);
    const done      = opsAllOps.filter(o => o.status === 'done').length;
    const upcoming  = opsAllOps
        .filter(o => o.scheduled_date && o.status === 'planned')
        .sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date))[0];

    document.getElementById('ops-sum-total').textContent = '💰 ' + _opsFmtEur(totalCost);
    document.getElementById('ops-sum-count').textContent = '📋 ' + opsAllOps.length + ' operaç' + (opsAllOps.length === 1 ? 'ão' : 'ões');
    document.getElementById('ops-sum-done').textContent  = '✅ ' + done + ' feita' + (done === 1 ? '' : 's');
    document.getElementById('ops-sum-next').textContent  = '📅 ' + (upcoming ? _opsFmtDate(upcoming.scheduled_date) + ' — ' + (OPS_TYPES[upcoming.type]?.label || upcoming.type) : 'Sem próxima');

    wrap.style.display = 'flex';
}
function _opsHideSeasonSummary() {
    const wrap = document.getElementById('ops-season-summary');
    if (wrap) wrap.style.display = 'none';
}

// ── Calendário ────────────────────────────────────────────────────────────────
function opsCalPrev() {
    opsCalMonth--;
    if (opsCalMonth < 1) { opsCalMonth = 12; opsCalYear--; }
    opsCalSelDay = null;
    _opsRenderCalendar();
}
function opsCalNext() {
    opsCalMonth++;
    if (opsCalMonth > 12) { opsCalMonth = 1; opsCalYear++; }
    opsCalSelDay = null;
    _opsRenderCalendar();
}

function _opsRenderCalendar() {
    const titleEl = document.getElementById('ops-cal-title');
    const calEl   = document.getElementById('ops-calendar');
    if (!calEl) return;
    if (titleEl) titleEl.textContent = OPS_MONTHS[opsCalMonth - 1] + ' ' + opsCalYear;

    const today    = new Date(); today.setHours(0, 0, 0, 0);
    const firstDay = new Date(opsCalYear, opsCalMonth - 1, 1);
    let   startDow = firstDay.getDay() - 1; if (startDow < 0) startDow = 6;
    const daysInMonth = new Date(opsCalYear, opsCalMonth, 0).getDate();

    // Índice de operações por dia
    const opsByDay = {};
    (opsAllOps || []).forEach(op => {
        if (!op.scheduled_date) return;
        const d = new Date(op.scheduled_date + 'T00:00');
        if (d.getFullYear() === opsCalYear && d.getMonth() + 1 === opsCalMonth) {
            const day = d.getDate();
            if (!opsByDay[day]) opsByDay[day] = [];
            opsByDay[day].push(op);
        }
    });

    const HEADS = ['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'];
    let html = '<table class="ops-cal-table"><thead><tr>'
             + HEADS.map(h => `<th>${h}</th>`).join('') + '</tr></thead><tbody><tr>';

    let cell = 0;
    for (let i = 0; i < startDow; i++) { html += '<td></td>'; cell++; }

    for (let d = 1; d <= daysInMonth; d++) {
        if (cell > 0 && cell % 7 === 0) html += '</tr><tr>';
        const dt      = new Date(opsCalYear, opsCalMonth - 1, d);
        const isToday = dt.getTime() === today.getTime();
        const isSel   = opsCalSelDay === d;
        const dayOps  = opsByDay[d] || [];
        const cls     = ['ops-cal-day',
            isToday ? 'today' : '', isSel ? 'sel' : '', dayOps.length ? 'has-ops' : ''
        ].filter(Boolean).join(' ');
        const dots = dayOps.slice(0, 4).map(op => {
            const c = (OPS_TYPES[op.type] || OPS_TYPES.outro).color;
            return `<div class="ops-cal-dot" style="background:${c};" title="${_opsEsc(op.name)}"></div>`;
        }).join('');
        html += `<td><div class="${cls}" onclick="_opsCalDayClick(${d})">${d}`
             + (dots ? `<div class="ops-cal-dots">${dots}</div>` : '')
             + `</div></td>`;
        cell++;
    }
    while (cell % 7 !== 0) { html += '<td></td>'; cell++; }
    html += '</tr></tbody></table>';
    calEl.innerHTML = html;

    // Renderizar painel do dia seleccionado
    if (opsCalSelDay) _opsCalDayClick(opsCalSelDay, false);
}

function _opsCalDayClick(day, toggleSel = true) {
    if (toggleSel) {
        opsCalSelDay = opsCalSelDay === day ? null : day;
        _opsRenderCalendar();
        if (!opsCalSelDay) {
            const el = document.getElementById('ops-cal-day-ops');
            if (el) el.innerHTML = '';
            return;
        }
    }
    const dateStr = new Date(opsCalYear, opsCalMonth - 1, day).toISOString().slice(0, 10);
    const dayOps  = (opsAllOps || []).filter(op => op.scheduled_date === dateStr);
    const el      = document.getElementById('ops-cal-day-ops');
    if (!el) return;

    if (!dayOps.length) {
        el.innerHTML = `<div style="font-size:11px;color:#9ca3af;padding:4px 2px;">
            Sem operações em ${_opsFmtDate(dateStr)}.</div>`;
        return;
    }
    el.innerHTML = `<div style="font-size:10px;font-weight:700;color:#9ca3af;margin-bottom:5px;
                                text-transform:uppercase;letter-spacing:.4px;">
        ${_opsFmtDate(dateStr)}</div>`
    + dayOps.map(op => {
        const t  = OPS_TYPES[op.type]   || OPS_TYPES.outro;
        const st = OPS_STATUS[op.status] || OPS_STATUS.planned;
        return `<div style="display:flex;align-items:center;gap:6px;padding:5px 7px;
                            background:${st.bg};border-radius:6px;margin-bottom:3px;
                            font-size:11px;cursor:pointer;"
                    onclick="opsEdit(${op.id})">
            <span>${t.icon}</span>
            <span style="flex:1;font-weight:600;color:#1f2937;overflow:hidden;
                         text-overflow:ellipsis;white-space:nowrap;">${_opsEsc(op.name)}</span>
            <span style="color:${st.color};font-size:10px;font-weight:600;flex-shrink:0;">${st.label}</span>
        </div>`;
    }).join('');
}
