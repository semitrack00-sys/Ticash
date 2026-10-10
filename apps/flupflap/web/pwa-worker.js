const CACHE = '__PWA_CACHE__';
const ASSETS = __PWA_ASSETS__;
const allowed = new Set(ASSETS.map(path => new URL(path, self.registration.scope).href));
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS.map(path => new Request(new URL(path, self.registration.scope), {cache:'reload'})))));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('flupflap-pwa-') && key !== CACHE).map(key => caches.delete(key)))));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  url.hash = ''; // Browser routes are fragments; cache only the public shell.
  // Sensitive navigation/query strings, cross-origin APIs and all mutations bypass caching.
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.search) return;
  const key = event.request.mode === 'navigate' && url.href === self.registration.scope
    ? new URL('index.html', self.registration.scope).href : url.href;
  if (!allowed.has(key)) return;
  event.respondWith(fetch(event.request).catch(() => caches.open(CACHE).then(cache => cache.match(key)).then(response => response || Response.error())));
});
