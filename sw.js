const CACHE = 'schet-vitkov-v1';
const ASSETS = ['./', 'index.html', 'algorithm.js', 'app.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then(r => {
          const copy = r.clone();
          caches.open(CACHE).then(x => x.put('./', copy));
          return r;
        })
        .catch(() => caches.match('./'))
    );
    return;
  }
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
