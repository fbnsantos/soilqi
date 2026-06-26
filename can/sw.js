'use strict';

const CACHE_VERSION = 'v6';
const CACHE = `soilqi-can-${CACHE_VERSION}`;

const STATIC = [
    './',
    './index.html',
    './manifest.json',
    './icon-192.png',
    './icon-512.png',
    './icon.svg'
];

self.addEventListener('install', e => {
    // Pre-cache static assets but do NOT skipWaiting —
    // the app will prompt the user before activating.
    e.waitUntil(
        caches.open(CACHE).then(c => c.addAll(STATIC))
    );
});

self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys()
              .then(keys => Promise.all(
                  keys.filter(k => k !== CACHE).map(k => caches.delete(k))
              ))
              .then(() => self.clients.claim())
    );
});

// App sends SKIP_WAITING when user confirms update
self.addEventListener('message', e => {
    if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', e => {
    const url = new URL(e.request.url);

    // API: always network, fallback to offline message
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

    // Static: network-first, update cache, fallback to cache
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
