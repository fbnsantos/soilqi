'use strict';

// ── VERSÃO ────────────────────────────────────────────────────────────────────
// Muda este número sempre que houver uma nova versão para forçar a actualização
// nos telemóveis dos utilizadores.
const CACHE_VERSION = 'v12'; // 2026-05-27 — photo thumbnail + version indicator
const CACHE = `soilqi-field-${CACHE_VERSION}`;

const STATIC = [
    './',
    './index.html',
    './assets/css/style.css',
    './assets/js/app.js',
    './manifest.json',
    './icons/icon-192.png',
    './icons/icon-512.png',
    './icons/icon-maskable-192.png',
    './icons/icon-maskable-512.png'
];

// ── Install: pré-cachear assets estáticos ─────────────────────────────────────
self.addEventListener('install', e => {
    e.waitUntil(
        caches.open(CACHE)
              .then(c => c.addAll(STATIC))
              .then(() => self.skipWaiting()) // Activar imediatamente, sem esperar
    );
});

// ── Activate: limpar caches antigos e assumir controlo ───────────────────────
self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys()
              .then(keys => Promise.all(
                  keys.filter(k => k !== CACHE).map(k => caches.delete(k))
              ))
              .then(() => self.clients.claim()) // Assumir controlo sem reload manual
    );
});

// ── Message: receber pedido de skipWaiting da app ────────────────────────────
self.addEventListener('message', e => {
    if (e.data && e.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

// ── Fetch ────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', e => {
    const url = new URL(e.request.url);

    // api.php → network first, fallback offline JSON
    if (url.pathname.endsWith('api.php')) {
        e.respondWith(
            fetch(e.request).catch(() =>
                new Response(
                    JSON.stringify({ success: false, offline: true, message: 'Sem ligação à internet' }),
                    { headers: { 'Content-Type': 'application/json' } }
                )
            )
        );
        return;
    }

    // Fotos carregadas (uploads) → network first (podem não estar em cache)
    if (url.pathname.includes('/uploads/')) {
        e.respondWith(
            fetch(e.request).catch(() => caches.match(e.request))
        );
        return;
    }

    // Assets estáticos → network first, fallback para cache
    // (network first garante que actualizações chegam ao utilizador,
    //  mas o service worker mantém cache para funcionar offline)
    e.respondWith(
        fetch(e.request)
            .then(res => {
                if (res.ok) {
                    const clone = res.clone();
                    caches.open(CACHE).then(c => c.put(e.request, clone));
                }
                return res;
            })
            .catch(() => caches.match(e.request))
    );
});
