// Taxi Manager : coquille de l'application disponible hors ligne (le chauffeur peut saisir une course sans réseau).
// Jamais de mise en cache de /api : sessions et courses passent toujours par le serveur (file d'attente côté application).
const CACHE = 'taximanager-shell-v2';
const put = (key, response) => { if(response.ok && response.type === 'basic') { const copy = response.clone(); caches.open(CACHE).then(c => c.put(key, copy)); } return response; };

self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(c => c.add('/')).catch(() => {})); self.skipWaiting(); });
self.addEventListener('activate', event => {
 event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
 const request = event.request;
 if(request.method !== 'GET') return;
 const url = new URL(request.url);
 if(url.origin !== self.location.origin || url.pathname === '/api' || url.pathname.startsWith('/api/')) return;
 if(request.mode === 'navigate') {
  // Réseau d'abord (toujours la dernière version), coquille en cache si pas de connexion.
  event.respondWith(fetch(request).then(r => put('/', r)).catch(() => caches.match('/').then(hit => hit || Response.error())));
  return;
 }
 if(url.pathname.startsWith('/assets/') || /\.(?:js|css|svg|png|ico|woff2?)$/.test(url.pathname)) {
  // Fichiers versionnés par Vite : cache d'abord.
  event.respondWith(caches.match(request).then(hit => hit || fetch(request).then(r => put(request, r))));
 }
});
