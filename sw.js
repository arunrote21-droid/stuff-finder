// network first (so new versions show up), cached copy as the offline fallback
const CACHE = 'sheet-v1';
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'fflate.min.js', 'manifest.webmanifest', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'fonts/Kanit-Regular.woff2', 'fonts/Kanit-SemiBold.woff2'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  // also drops the cache left by the app that used to live at this address
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (/\.mp4$/i.test(new URL(e.request.url).pathname) || e.request.headers.has('range')) return; // videos stream straight from the network (Safari needs range requests, a cached copy would break them)
  // wait at most 3 s for the network (weak signal on stage), then use the saved copy; the fresh one still lands in the cache
  const net = fetch(e.request, { cache: 'no-cache' }).then(r => { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); return r; });
  const saved = () => caches.match(e.request, { ignoreSearch: true });
  e.respondWith(Promise.race([net.catch(() => null), new Promise(ok => setTimeout(() => ok(null), 3000))]).then(r => r || saved().then(c => c || net)).catch(() => saved()));
});
