// O Monetizeo não usa service worker. Este arquivo existe só para desligar o
// da versão antiga ("Casa em Ordem"), que prendia páginas velhas em cache:
// o navegador que ainda o tem instalado baixa este, que limpa tudo e se remove.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) await caches.delete(key);
    await self.registration.unregister();
    for (const client of await self.clients.matchAll({ type: 'window' })) client.navigate(client.url);
  })());
});
