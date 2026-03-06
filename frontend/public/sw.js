/* Service worker mínimo para que la PWA sea instalable en tablet/móvil */
const CACHE = 'lupohub-v1';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
});
