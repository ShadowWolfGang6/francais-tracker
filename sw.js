self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    await caches.delete('francais-tracker-v1');
    await self.clients.claim();
    await self.registration.unregister();
  })());
});
