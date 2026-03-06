/* Service worker para PWA instalable (iPhone y Android tablet/móvil) */
const CACHE = 'lupohub-v2';
self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then((cache) => {
      return cache.addAll(['/', '/manifest.webmanifest', '/icons/icon.svg']);
    }).catch(() => {})
  );
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    }).then(() => self.clients.claim())
  );
});
