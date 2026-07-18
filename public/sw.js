/*
 * Blurwell service worker.
 *
 * The cache key embeds a version that MUST be bumped on every deploy — a fixed
 * key would serve a stale index.html (and therefore stale hashed asset URLs) to
 * returning visitors forever.
 */
const VERSION = 'blurwell-v1';
const SHELL = `${VERSION}-shell`;
const RUNTIME = `${VERSION}-runtime`;

// Only the tiny, always-needed files are precached. The MediaPipe WASM runtime
// is ~11 MB — precaching it would block the install on a huge download that
// most first-time visitors haven't asked for yet, so it's cached on first use.
const SHELL_ASSETS = ['/', '/index.html', '/favicon.svg', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => !key.startsWith(VERSION)).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Navigations: network first so a new deploy is picked up promptly, falling
  // back to the cached shell when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(SHELL).then((cache) => cache.put('/index.html', copy));
          return response;
        })
        .catch(() => caches.match('/index.html').then((hit) => hit ?? Response.error())),
    );
    return;
  }

  // Everything else (hashed bundles, the model, the WASM): cache first, then
  // populate on miss. Hashed filenames make this safe across deploys.
  event.respondWith(
    caches.match(request).then((hit) => {
      if (hit) return hit;
      return fetch(request).then((response) => {
        if (response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(RUNTIME).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    }),
  );
});
