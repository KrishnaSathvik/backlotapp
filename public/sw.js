// Bump CACHE_VERSION when changing this file; old caches are deleted on activate.
const CACHE_VERSION = 'v2';
const CACHE_NAME = `contentvault-shell-${CACHE_VERSION}`;
const SHELL_ASSETS = ['/', '/icon.svg', '/pwa-192x192.png', '/pwa-512x512.png', '/apple-touch-icon.png'];
const MAX_ENTRIES = 150;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .catch(() => undefined)
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function trim(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_ENTRIES; i += 1) await cache.delete(keys[i]);
}

async function put(request, response) {
  if (!response || response.status !== 200 || response.type !== 'basic') return;
  const cache = await caches.open(CACHE_NAME);
  await cache.put(request, response);
  await trim(cache);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Never cache API responses (they are per-user and authenticated).
  if (url.pathname.startsWith('/api/')) return;

  // Pages: network first, fall back to the cached app shell when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          event.waitUntil(put('/', response.clone()));
          return response;
        })
        .catch(async () => (await caches.match('/')) || Response.error())
    );
    return;
  }

  // Hashed build assets never change: cache first.
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            event.waitUntil(put(request, response.clone()));
            return response;
          })
      )
    );
    return;
  }

  // Everything else: serve cached copy immediately, refresh in the background.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          event.waitUntil(put(request, response.clone()));
          return response;
        })
        .catch(() => cached || Response.error());
      return cached || network;
    })
  );
});
