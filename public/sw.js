/* Service worker Ember Arcade — jeu hors-ligne + chargements plus rapides.
   Stratégie :
     - pages (navigate)  : réseau d'abord, cache en secours (contenu frais, mais jouable hors-ligne)
     - autres GET même origine (js/css/png/mp3) : stale-while-revalidate (rapide + mise à jour en arrière-plan)
     - cross-origin (Supabase, esm.sh, Google Fonts) : jamais interceptés
   Pour publier une nouvelle version du shell, incrémente VERSION. */
const VERSION = 'ember-v1';
const CORE = [
  '/', '/index.html', '/styles.css', '/sdk.js',
  '/daily.html', '/leaderboard.html', '/roadmap.html',
  '/favicon.png', '/icon-192.png', '/icon-512.png', '/manifest.webmanifest'
];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(CORE).catch(() => {})));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;          // laisse passer les API / CDN
  if (url.pathname === '/config.js') return;            // config runtime : toujours réseau

  if (req.mode === 'navigate') {                        // pages : réseau d'abord
    e.respondWith((async () => {
      try {
        const net = await fetch(req);
        const c = await caches.open(VERSION);
        c.put(req, net.clone());
        return net;
      } catch (err) {
        const cached = await caches.match(req);
        return cached || (await caches.match('/index.html')) || Response.error();
      }
    })());
    return;
  }

  // ressources statiques : stale-while-revalidate
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const cached = await cache.match(req);
    const net = fetch(req).then(r => {
      if (r && r.status === 200 && r.type === 'basic') cache.put(req, r.clone());
      return r;
    }).catch(() => null);
    return cached || (await net) || fetch(req);
  })());
});
