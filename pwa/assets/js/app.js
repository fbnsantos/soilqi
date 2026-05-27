'use strict';

// ── Config ───────────────────────────────────────────────────────────────────
const API      = 'api.php';
const IDB_NAME = 'soilqi_field';
const IDB_VER  = 1;

// ── State ────────────────────────────────────────────────────────────────────
let idb         = null;
let watchId     = null;
let gpsLat      = null;
let gpsLng      = null;
let gpsAccuracy = null;
let isOnline    = navigator.onLine;

// ── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').catch(() => {});
    }

    idb = await openIDB();

    const authed = await checkAuth();
    if (!authed) { showLogin(); return; }

    window.addEventListener('online',  onOnline);
    window.addEventListener('offline', onOffline);
    updateOnlineUI();

    startGPS();
    await Promise.all([loadTerrains(), loadMeasurements()]);
    await refreshPendingUI();
    if (isOnline) syncPending();

    document.getElementById('measurement-form').addEventListener('submit', handleSubmit);
    showTab('capture');
});

// ── IndexedDB ────────────────────────────────────────────────────────────────
function openIDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(IDB_NAME, IDB_VER);
        req.onupgradeneeded = e => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('pending')) {
                db.createObjectStore('pending', { keyPath: 'localId', autoIncrement: true });
            }
        };
        req.onsuccess  = e => resolve(e.target.result);
        req.onerror    = () => reject(req.error);
    });
}

function idbAdd(store, data) {
    return new Promise((resolve, reject) => {
        const tx  = idb.transaction(store, 'readwrite');
        const req = tx.objectStore(store).add(data);
        req.onsuccess = () => resolve(req.result);
        req.onerror   = () => reject(req.error);
    });
}

function idbGetAll(store) {
    return new Promise((resolve, reject) => {
        const tx  = idb.transaction(store, 'readonly');
        const req = tx.objectStore(store).getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror   = () => reject(req.error);
    });
}

function idbDelete(store, key) {
    return new Promise((resolve, reject) => {
        const tx  = idb.transaction(store, 'readwrite');
        const req = tx.objectStore(store).delete(key);
        req.onsuccess = () => resolve();
        req.onerror   = () => reject(req.error);
    });
}

// ── Auth ─────────────────────────────────────────────────────────────────────
async function checkAuth() {
    try {
        const res  = await fetch(`${API}?action=check_auth`);
        const data = await res.json();
        return data.success === true;
    } catch {
        // If offline, assume session is still valid
        return !navigator.onLine ? true : false;
    }
}

function showLogin() {
    document.getElementById('main-ui').style.display = 'none';
    document.getElementById('nav-bar').style.display = 'none';
    document.getElementById('login-screen').style.display = 'flex';
}

// ── Tabs ─────────────────────────────────────────────────────────────────────
function showTab(name) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`screen-${name}`).classList.add('active');
    document.getElementById(`nav-${name}`).classList.add('active');
    if (name === 'history') loadMeasurements();
}

// ── GPS ──────────────────────────────────────────────────────────────────────
function startGPS() {
    if (!navigator.geolocation) { setGPS('GPS não suportado', 'gps-error'); return; }
    setGPS('A localizar…', 'searching');
    watchId = navigator.geolocation.watchPosition(onGPSSuccess, onGPSError, {
        enableHighAccuracy: true,
        maximumAge: 5000,
        timeout: 20000
    });
}

function stopGPS() {
    if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
}

function refreshGPS() {
    const btn = document.getElementById('btn-gps-refresh');
    btn.innerHTML = '<span class="spin">↻</span>';
    stopGPS();
    gpsLat = gpsLng = gpsAccuracy = null;
    document.getElementById('inp-lat').value = '';
    document.getElementById('inp-lng').value = '';
    setGPS('A localizar…', 'searching');
    setTimeout(() => { startGPS(); btn.innerHTML = '↻'; }, 400);
}

function onGPSSuccess(pos) {
    gpsLat      = pos.coords.latitude;
    gpsLng      = pos.coords.longitude;
    gpsAccuracy = pos.coords.accuracy;
    document.getElementById('inp-lat').value = gpsLat.toFixed(7);
    document.getElementById('inp-lng').value = gpsLng.toFixed(7);
    const quality = gpsAccuracy <= 10 ? 'good' : 'poor';
    setGPS(`Localizado ✓`, quality);
    document.getElementById('gps-accuracy').textContent = `Precisão: ±${gpsAccuracy.toFixed(0)} m`;
}

function onGPSError(err) {
    const msgs = { 1: 'Acesso negado — active a localização', 2: 'Posição indisponível', 3: 'Tempo esgotado' };
    setGPS(msgs[err.code] || 'Erro de GPS', 'gps-error');
    document.getElementById('gps-accuracy').textContent = 'Verifique as permissões do browser';
}

function setGPS(text, cls) {
    document.getElementById('gps-status').textContent = text;
    const card = document.getElementById('gps-card');
    card.className = `gps-card ${cls}`;
}

// ── Form Submit ───────────────────────────────────────────────────────────────
async function handleSubmit(e) {
    e.preventDefault();

    const lat = parseFloat(document.getElementById('inp-lat').value);
    const lng = parseFloat(document.getElementById('inp-lng').value);

    if (isNaN(lat) || isNaN(lng)) {
        toast('Aguarde o GPS ou introduza as coordenadas manualmente.', 'warning');
        return;
    }

    const btn = document.getElementById('btn-submit');
    btn.disabled = true;
    btn.innerHTML = '<span class="spin">⟳</span> A guardar…';

    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const m = {
        latitude:     lat,
        longitude:    lng,
        gps_accuracy: gpsAccuracy,
        conductivity: numOrNull('inp-ec'),
        ph:           numOrNull('inp-ph'),
        temperature:  numOrNull('inp-temp'),
        moisture:     numOrNull('inp-moisture'),
        terrain_id:   document.getElementById('inp-terrain').value || null,
        notes:        document.getElementById('inp-notes').value.trim(),
        measured_at:  now,
        action:       'save_measurement'
    };

    if (isOnline) {
        const result = await postToServer(m);
        if (result.ok) {
            toast('Medição guardada! ✓', 'success');
            resetForm();
        } else {
            if (result.needsLogin) { showLogin(); return; }
            await idbAdd('pending', { ...m, _ts: Date.now() });
            toast(`Guardado localmente. (${result.msg})`, 'warning');
            resetForm();
        }
    } else {
        await idbAdd('pending', { ...m, _ts: Date.now() });
        toast('Guardado localmente. Será sincronizado quando tiver ligação.', 'warning');
        resetForm();
    }

    btn.disabled = false;
    btn.innerHTML = '📊 Registar Medição';
    await refreshPendingUI();
}

function numOrNull(id) {
    const v = parseFloat(document.getElementById(id).value);
    return isNaN(v) ? null : v;
}

function resetForm() {
    ['inp-ec','inp-ph','inp-temp','inp-moisture','inp-notes'].forEach(id => {
        document.getElementById(id).value = '';
    });
    document.getElementById('inp-terrain').value = '';
}

// ── Server Comms ──────────────────────────────────────────────────────────────
// Devolve { ok, msg, needsLogin }
async function postToServer(payload) {
    try {
        const res  = await fetch(API, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(payload)
        });
        let data;
        try { data = await res.json(); }
        catch { return { ok: false, msg: `Resposta inválida do servidor (HTTP ${res.status})` }; }

        if (res.status === 401) return { ok: false, msg: 'Sessão expirada — faça login novamente.', needsLogin: true };
        return { ok: data.success === true, msg: data.message || 'Erro desconhecido' };
    } catch (err) {
        console.error('[SoilQI] postToServer:', err);
        return { ok: false, msg: 'Servidor inacessível' };
    }
}

// ── Sync ──────────────────────────────────────────────────────────────────────
async function syncPending() {
    if (!isOnline) return;
    const items = await idbGetAll('pending');
    if (!items.length) return;

    let n = 0;
    for (const item of items) {
        const { localId, _ts, ...payload } = item;
        payload.action = 'save_measurement';
        const result = await postToServer(payload);
        if (result.ok) { await idbDelete('pending', localId); n++; }
        else if (result.needsLogin) { showLogin(); break; }
    }
    if (n) { toast(`${n} medição(ões) sincronizadas ✓`, 'success'); }
    await refreshPendingUI();
}

async function refreshPendingUI() {
    const items = await idbGetAll('pending');
    const n = items.length;
    const badge   = document.getElementById('pending-badge');
    const navDot  = document.getElementById('nav-dot-capture');
    badge.textContent = n;
    badge.classList.toggle('visible', n > 0);
    navDot.classList.toggle('visible', n > 0);
}

// ── Load Data ─────────────────────────────────────────────────────────────────
async function loadTerrains() {
    if (!isOnline) return;
    try {
        const res  = await fetch(`${API}?action=get_terrains`);
        const data = await res.json();
        if (!data.success) return;
        const sel = document.getElementById('inp-terrain');
        sel.innerHTML = '<option value="">— Sem terreno associado —</option>';
        (data.terrains || []).forEach(t => {
            const opt = document.createElement('option');
            opt.value = t.id; opt.textContent = t.name;
            sel.appendChild(opt);
        });
    } catch {}
}

async function loadMeasurements() {
    const list = document.getElementById('measurement-list');
    list.innerHTML = '<div class="loading-state">A carregar…</div>';

    let server = [];
    if (isOnline) {
        try {
            const res  = await fetch(`${API}?action=get_measurements`);
            const data = await res.json();
            if (data.success) server = (data.measurements || []).map(m => ({ ...m, _synced: true }));
        } catch {}
    }

    const pending = await idbGetAll('pending');
    const local   = pending.map(m => ({ ...m, id: `p${m.localId}`, _synced: false }));

    const all = [...local, ...server];

    if (!all.length) {
        list.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">🌱</div>
                <p>Ainda sem medições.<br>Use o separador <strong>Capturar</strong> para adicionar.</p>
            </div>`;
        return;
    }

    list.innerHTML = all.map(renderCard).join('');
}

function renderCard(m) {
    const dt     = new Date(m.measured_at).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' });
    const lat    = parseFloat(m.latitude).toFixed(6);
    const lng    = parseFloat(m.longitude).toFixed(6);
    const accStr = m.gps_accuracy ? ` ±${parseFloat(m.gps_accuracy).toFixed(0)}m` : '';

    const chips = [];
    if (m.conductivity != null && m.conductivity !== '') chips.push(['EC', `${parseFloat(m.conductivity).toFixed(2)} mS/cm`]);
    if (m.ph           != null && m.ph           !== '') chips.push(['pH', parseFloat(m.ph).toFixed(1)]);
    if (m.temperature  != null && m.temperature  !== '') chips.push(['Temp', `${parseFloat(m.temperature).toFixed(1)} °C`]);
    if (m.moisture     != null && m.moisture     !== '') chips.push(['Hum', `${parseFloat(m.moisture).toFixed(1)} %`]);

    const chipsHtml = chips.length
        ? chips.map(([l,v]) => `<div class="m-chip"><span class="lbl">${l}</span><span class="val">${v}</span></div>`).join('')
        : '<span style="font-size:12px;color:#aaa">Sem valores registados</span>';

    const terrainHtml = m.terrain_name ? `<div class="m-terrain">📍 ${escHtml(m.terrain_name)}</div>` : '';
    const notesHtml   = m.notes        ? `<div class="m-notes">💬 ${escHtml(m.notes)}</div>`          : '';
    const syncTag     = m._synced
        ? '<span class="sync-tag synced">Sincronizado</span>'
        : '<span class="sync-tag pending">Pendente</span>';

    return `
        <div class="m-card">
            <div class="m-card-head">
                <span class="m-date">${dt}</span>
                ${syncTag}
            </div>
            ${terrainHtml}
            <div class="m-coords">${lat}, ${lng}${accStr}</div>
            <div class="m-values">${chipsHtml}</div>
            ${notesHtml}
        </div>`;
}

function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Online/Offline ────────────────────────────────────────────────────────────
function onOnline()  { isOnline = true;  updateOnlineUI(); loadTerrains(); syncPending(); }
function onOffline() { isOnline = false; updateOnlineUI(); }

function updateOnlineUI() {
    document.getElementById('status-dot').classList.toggle('online', isOnline);
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function toast(msg, type = 'info') {
    document.querySelectorAll('.toast').forEach(t => t.remove());
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => { el.style.transition = 'opacity .3s'; el.style.opacity = '0'; }, 2800);
    setTimeout(() => el.remove(), 3150);
}
