'use strict';

// ── Config ───────────────────────────────────────────────────────────────────
const API      = 'api.php';
const IDB_NAME = 'soilqi_field';
const IDB_VER  = 1;
const TOKEN_KEY = 'soilqi_api_token';   // localStorage key for persistent session

// ── State ────────────────────────────────────────────────────────────────────
let idb         = null;
let swReg       = null;        // ServiceWorkerRegistration (para updates)
let watchId     = null;
let gpsLat      = null;
let gpsLng      = null;
let gpsAccuracy = null;
let isOnline    = navigator.onLine;
let capturedPhotoB64 = null;   // base64 JPEG da fotografia actual

// ── Token helpers ─────────────────────────────────────────────────────────────
function getToken()       { return localStorage.getItem(TOKEN_KEY); }
function setToken(t)      { localStorage.setItem(TOKEN_KEY, t); updateTokenBadge(); }
function clearToken()     { localStorage.removeItem(TOKEN_KEY); updateTokenBadge(); }
function updateTokenBadge() {
    const el = document.getElementById('token-badge');
    if (el) el.style.display = getToken() ? 'inline' : 'none';
}

// ── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    if ('serviceWorker' in navigator) {
        try {
            swReg = await navigator.serviceWorker.register('sw.js');

            // Detectar controller já existente antes de qualquer mudança
            const hadController = !!navigator.serviceWorker.controller;

            // Verificar actualizações sempre que a app volta ao primeiro plano
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible' && swReg) swReg.update();
            });

            // Novo SW a instalar — escutar mudanças de estado
            swReg.addEventListener('updatefound', () => {
                const newWorker = swReg.installing;
                if (!newWorker) return;
                newWorker.addEventListener('statechange', () => {
                    if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                        showUpdateBanner();
                    }
                });
            });

            // SW já estava à espera (ex: utilizador fechou sem clicar em Atualizar)
            if (swReg.waiting && navigator.serviceWorker.controller) {
                showUpdateBanner();
            }

            // Quando o controller mudar (após skipWaiting) → recarregar para servir novos ficheiros
            let _swReloading = false;
            navigator.serviceWorker.addEventListener('controllerchange', () => {
                if (!_swReloading && hadController) { _swReloading = true; window.location.reload(); }
            });
        } catch (err) {
            console.warn('[SW] Registo falhou:', err);
        }
    }

    idb = await openIDB();
    updateTokenBadge();

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
    const token = getToken();
    try {
        const headers = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const res  = await fetch(`${API}?action=check_auth`, { headers });
        const data = await res.json();

        if (data.success) {
            // Se não havia token, gerar um agora para futuras sessões
            if (!token && isOnline) generateAndStoreToken();
            return true;
        }
        // Token rejeitado pelo servidor — limpar
        if (token) { clearToken(); }
        return false;
    } catch {
        // Offline: assumir sessão/token ainda válidos
        return true;
    }
}

async function generateAndStoreToken() {
    try {
        const data = await callApi({ action: 'generate_token', device_name: 'SoilQI PWA' });
        if (data && data.success && data.token) {
            setToken(data.token);
            toast('🔑 Sessão guardada — próximas entradas serão automáticas.', 'success');
        }
    } catch {}
}

function showLogin() {
    document.getElementById('main-ui').style.display     = 'none';
    document.getElementById('nav-bar').style.display     = 'none';
    document.getElementById('login-screen').style.display = 'flex';
}

// ── API low-level ─────────────────────────────────────────────────────────────
// Devolve o objecto JSON completo (sem envelope { ok, msg })
async function callApi(payload) {
    const token = getToken();
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(API, {
        method:  'POST',
        headers,
        body:    JSON.stringify(payload)
    });
    if (res.status === 401) return { success: false, _needsLogin: true };
    return res.json();
}

// Devolve { ok, msg, needsLogin } — compatível com código existente
async function postToServer(payload) {
    try {
        const data = await callApi(payload);
        if (data._needsLogin) return { ok: false, msg: 'Sessão expirada — faça login novamente.', needsLogin: true };
        return { ok: data.success === true, msg: data.message || 'Erro desconhecido' };
    } catch (err) {
        console.error('[SoilQI] postToServer:', err);
        return { ok: false, msg: 'Servidor inacessível' };
    }
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
        maximumAge:  5000,
        timeout:    20000
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
    document.getElementById('gps-card').className = `gps-card ${cls}`;
}

// ── Fotografia ────────────────────────────────────────────────────────────────
async function onPhotoSelected(input) {
    const file = input.files[0];
    if (!file) return;

    const label = document.getElementById('photo-label');
    label.textContent = '⏳ A comprimir…';

    capturedPhotoB64 = await compressPhoto(file);

    if (capturedPhotoB64) {
        document.getElementById('photo-preview').src           = capturedPhotoB64;
        document.getElementById('photo-preview-wrap').style.display = 'block';
        // Estimar tamanho
        const kb = Math.round(capturedPhotoB64.length * 0.75 / 1024);
        document.getElementById('photo-size').textContent = `~${kb} KB após compressão`;
        label.innerHTML = '📸 Alterar fotografia <input id="inp-photo" type="file" accept="image/*" capture="environment" style="display:none" onchange="onPhotoSelected(this)">';
    } else {
        toast('Erro a processar fotografia.', 'error');
        label.textContent = '📸 Tirar / Escolher Fotografia';
    }
}

function clearPhoto() {
    capturedPhotoB64 = null;
    document.getElementById('photo-preview-wrap').style.display = 'none';
    document.getElementById('photo-preview').src = '';
    document.getElementById('photo-size').textContent = '';
    // Recriar input para permitir seleccionar a mesma foto novamente
    const label = document.getElementById('photo-label');
    label.innerHTML = '📸 Tirar / Escolher Fotografia <input id="inp-photo" type="file" accept="image/*" capture="environment" style="display:none" onchange="onPhotoSelected(this)">';
}

async function compressPhoto(file) {
    return new Promise(resolve => {
        const MAX = 1200;
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
            let { width: w, height: h } = img;
            if (w > MAX || h > MAX) {
                if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
                else       { w = Math.round(w * MAX / h); h = MAX; }
            }
            const canvas = document.createElement('canvas');
            canvas.width  = w;
            canvas.height = h;
            canvas.getContext('2d').drawImage(img, 0, 0, w, h);
            URL.revokeObjectURL(url);
            resolve(canvas.toDataURL('image/jpeg', 0.78));
        };
        img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
        img.src = url;
    });
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
    btn.disabled    = true;
    btn.innerHTML   = '<span class="spin">⟳</span> A guardar…';

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
        photo_b64:    capturedPhotoB64,  // null se sem foto
        action:       'save_measurement'
    };

    if (isOnline) {
        const result = await postToServer(m);
        if (result.ok) {
            toast('Medição guardada! ✓', 'success');
            resetForm();
        } else {
            if (result.needsLogin) { showLogin(); return; }
            // Guardar localmente (sem foto para poupar espaço se a foto for grande)
            await idbAdd('pending', { ...m, _ts: Date.now() });
            toast(`Guardado localmente. (${result.msg})`, 'warning');
            resetForm();
        }
    } else {
        await idbAdd('pending', { ...m, _ts: Date.now() });
        toast('Guardado localmente. Será sincronizado quando tiver ligação.', 'warning');
        resetForm();
    }

    btn.disabled  = false;
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
    clearPhoto();
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
        if (result.ok)          { await idbDelete('pending', localId); n++; }
        else if (result.needsLogin) { showLogin(); break; }
    }
    if (n) toast(`${n} medição(ões) sincronizadas ✓`, 'success');
    await refreshPendingUI();
}

async function refreshPendingUI() {
    const items = await idbGetAll('pending');
    const n = items.length;
    const badge  = document.getElementById('pending-badge');
    const navDot = document.getElementById('nav-dot-capture');
    badge.textContent = n;
    badge.classList.toggle('visible', n > 0);
    navDot.classList.toggle('visible', n > 0);
}

// ── Load Data ─────────────────────────────────────────────────────────────────
async function loadTerrains() {
    if (!isOnline) return;
    try {
        const token = getToken();
        const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
        const res  = await fetch(`${API}?action=get_terrains`, { headers });
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
            const token = getToken();
            const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
            const res  = await fetch(`${API}?action=get_measurements`, { headers });
            const data = await res.json();
            if (data.success) server = (data.measurements || []).map(m => ({ ...m, _synced: true }));
        } catch {}
    }

    const pending = await idbGetAll('pending');
    const local   = pending.map(m => ({ ...m, id: `p${m.localId}`, _synced: false }));
    const all     = [...local, ...server];

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
    if (m.conductivity != null && m.conductivity !== '') chips.push(['EC',   `${parseFloat(m.conductivity).toFixed(2)} mS/cm`]);
    if (m.ph           != null && m.ph           !== '') chips.push(['pH',   parseFloat(m.ph).toFixed(1)]);
    if (m.temperature  != null && m.temperature  !== '') chips.push(['Temp', `${parseFloat(m.temperature).toFixed(1)} °C`]);
    if (m.moisture     != null && m.moisture     !== '') chips.push(['Hum',  `${parseFloat(m.moisture).toFixed(1)} %`]);

    const chipsHtml = chips.length
        ? chips.map(([l,v]) => `<div class="m-chip"><span class="lbl">${l}</span><span class="val">${v}</span></div>`).join('')
        : '<span style="font-size:12px;color:#aaa">Sem valores registados</span>';

    const terrainHtml = m.terrain_name ? `<div class="m-terrain">📍 ${escHtml(m.terrain_name)}</div>` : '';
    const notesHtml   = m.notes        ? `<div class="m-notes">💬 ${escHtml(m.notes)}</div>`          : '';
    const syncTag     = m._synced
        ? '<span class="sync-tag synced">Sincronizado</span>'
        : '<span class="sync-tag pending">Pendente</span>';

    // Fotografia (apenas para medições sincronizadas com caminho guardado)
    const photoHtml = (m.photo_path && m._synced)
        ? `<img src="../${escHtml(m.photo_path)}" alt="Foto da medição"
                style="width:100%;border-radius:8px;margin-top:8px;max-height:200px;object-fit:cover;display:block;"
                loading="lazy" onerror="this.style.display='none'">`
        : (m.photo_b64 && !m._synced)
            ? `<img src="${m.photo_b64}" alt="Foto (local)"
                    style="width:100%;border-radius:8px;margin-top:8px;max-height:200px;object-fit:cover;display:block;">`
            : '';

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
            ${photoHtml}
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

// ── SW Update Banner ──────────────────────────────────────────────────────────
function showUpdateBanner() {
    if (document.getElementById('sw-update-banner')) return; // já visível
    const banner = document.createElement('div');
    banner.id = 'sw-update-banner';
    banner.style.cssText = [
        'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:9999',
        'background:#166534', 'color:#fff', 'display:flex', 'align-items:center',
        'justify-content:space-between', 'padding:10px 16px', 'font-size:14px',
        'font-weight:600', 'box-shadow:0 2px 8px rgba(0,0,0,.3)',
        'gap:12px'
    ].join(';');
    banner.innerHTML = `
        <span>🔄 Nova versão disponível!</span>
        <button onclick="applyUpdate()"
                style="background:#fff;color:#166534;border:none;border-radius:8px;
                       padding:6px 14px;font-weight:700;cursor:pointer;font-size:13px;
                       flex-shrink:0;">
            Atualizar
        </button>`;
    document.body.prepend(banner);
}

function applyUpdate() {
    if (swReg && swReg.waiting) {
        swReg.waiting.postMessage({ type: 'SKIP_WAITING' });
        // controllerchange vai disparar e recarregar automaticamente
    } else {
        window.location.reload(true);
    }
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function toast(msg, type = 'info') {
    document.querySelectorAll('.toast').forEach(t => t.remove());
    const el = document.createElement('div');
    el.className   = `toast ${type}`;
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => { el.style.transition = 'opacity .3s'; el.style.opacity = '0'; }, 2800);
    setTimeout(() => el.remove(), 3150);
}
