const CACHE = 'ls-landscaping-shell-v2';
const BASE = '/tools/quote-builder/';
const SHELL = [BASE, `${BASE}index.html`, `${BASE}app.css`, `${BASE}app.js`, `${BASE}domain.mjs`, `${BASE}storage.mjs`, `${BASE}manifest.webmanifest`, `${BASE}settings.html`, `${BASE}settings.mjs`, `${BASE}settings-page.js`, `${BASE}settings.css`, '/assets/quote-fonts/Archivo.ttf', '/assets/quote-fonts/Inter.ttf', '/assets/quote-fonts/DMMono.ttf'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('ls-landscaping-shell-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/') || !SHELL.includes(url.pathname)) return;
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok) { const copy = response.clone(); event.waitUntil(caches.open(CACHE).then(cache => cache.put(event.request, copy))); }
    return response;
  }).catch(async () => {
    const cached = await caches.match(event.request);
    if (cached) return cached;
    if (event.request.mode === 'navigate') return caches.match(BASE);
    throw new Error('This file is not available offline.');
  }));
});
