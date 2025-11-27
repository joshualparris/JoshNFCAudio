// sw.js — service worker for offline caching
const CACHE_NAME = 'nfc-audio-shell-v1';

// Build asset URLs relative to the service worker scope so the cache works when hosted under
// a subpath (GitHub Pages repo pages). `self.registration.scope` includes the origin+path.
function assetUrl(path){ return new URL(path, self.registration.scope).href; }

const ASSETS = [
  assetUrl('./index.html'),
  assetUrl('./styles.css'),
  assetUrl('./app.js'),
  assetUrl('./db.js'),
  assetUrl('./manifest.json'),
  assetUrl('./icons/icon-192.svg'),
  assetUrl('./icons/icon-512.svg')
];

self.addEventListener('install', ev=>{
  self.skipWaiting();
  ev.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(ASSETS)).catch(()=>{}));
});

self.addEventListener('activate', ev=>{
  ev.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', ev=>{
  const reqUrl = ev.request.url;
  // Navigation requests (user entering URLs / clicking links) should return index.html from cache when offline
  if(ev.request.mode === 'navigate'){
    ev.respondWith(fetch(ev.request).catch(()=>caches.match(assetUrl('./index.html'))));
    return;
  }

  // For resources that are part of the shell, try network then cache fallback
  if(ASSETS.includes(reqUrl)){
    ev.respondWith(fetch(ev.request).catch(()=>caches.match(reqUrl)));
    return;
  }

  // Default: try network, fallback to cache
  ev.respondWith(fetch(ev.request).catch(()=>caches.match(ev.request)));
});
