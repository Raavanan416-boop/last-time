/**
 * MovieTime — Service Worker (PWA offline + caching)
 */
const CACHE_NAME = 'movietime-v1';
const PRECACHE = [
  '/',
  '/index.html',
  '/room.html',
  '/player.html',
  '/style.css',
  '/script.js',
  '/manifest.json'
];

// Install — precache shell
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

// Activate — clean old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch — network first, fallback to cache
self.addEventListener('fetch', e => {
  // Skip non-GET and socket.io/video streams
  if (e.request.method !== 'GET') return;
  if (e.request.url.includes('/socket.io/')) return;
  if (e.request.url.includes('/video/')) return;

  e.respondWith(
    fetch(e.request)
      .then(res => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
