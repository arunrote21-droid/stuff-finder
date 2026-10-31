const CACHE = 'stuff-finder-v4';
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'art-icons.js', 'art-catalog.js', 'icon.svg', 'manifest.webmanifest',
  'fonts/Kanit-Light.woff2', 'fonts/Kanit-Regular.woff2', 'fonts/Kanit-Medium.woff2',
  'fonts/Kanit-SemiBold.woff2', 'fonts/Kanit-Bold.woff2'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// network first, always revalidating so a new deploy shows up right away, cache as the offline fallback
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(r => {
    const copy = r.clone();
    caches.open(CACHE).then(c => c.put(e.request, copy));
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
