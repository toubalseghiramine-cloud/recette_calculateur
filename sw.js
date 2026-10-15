// ============================================================
// sw.js — service worker : permet d'utiliser l'app hors ligne
// ------------------------------------------------------------
// Au premier chargement, tous les fichiers de l'application
// sont copiés dans un cache du navigateur. Ensuite, ils sont
// servis depuis ce cache, même sans connexion internet.
//
// Mises à jour : quand vous publiez une nouvelle version,
// changez CACHE_VERSION (ex. 'v2', 'v3'…). Le téléphone
// détecte alors la nouvelle version et affiche le bandeau
// « Nouvelle version disponible ».
// (Les données — produits, recettes — ne sont pas dans ce
// cache mais dans IndexedDB : elles ne sont jamais effacées.)
// ============================================================

const CACHE_VERSION = 'v1';
const CACHE_NAME = 'cout-recettes-' + CACHE_VERSION;

// Fichiers nécessaires au fonctionnement hors ligne
const APP_FILES = [
  './',
  './index.html',
  './styles.css',
  './db.js',
  './app.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

// Installation : on met tous les fichiers en cache
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_FILES.map(url => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting()) // la nouvelle version s'active tout de suite
  );
});

// Activation : on supprime les caches des anciennes versions
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => key.startsWith('cout-recettes-') && key !== CACHE_NAME)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// Requêtes : on répond tout de suite avec le cache (rapide, marche
// hors ligne) et, si internet est disponible, on télécharge en
// arrière-plan la dernière version du fichier pour la prochaine
// ouverture de l'application.
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request, { ignoreSearch: true });

    const fromNetwork = fetch(request)
      .then(response => {
        if (response.ok) cache.put(request, response.clone());
        return response;
      })
      .catch(() => null); // hors ligne

    if (cached) {
      event.waitUntil(fromNetwork); // mise à jour du cache en arrière-plan
      return cached;
    }
    const response = await fromNetwork;
    if (response) return response;
    // Hors ligne et page inconnue : on affiche l'application
    if (request.mode === 'navigate') return (await cache.match('./index.html')) || Response.error();
    return Response.error();
  })());
});
