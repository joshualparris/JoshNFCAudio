// sw.js — service worker for offline caching
const CACHE_NAME = 'nfc-audio-shell-v1';
const ASSETS = [
  '/', '/index.html', '/styles.css', '/app.js', '/db.js', '/manifest.json', '/icons/icon-192.svg', '/icons/icon-512.svg'
];

self.addEventListener('install', ev=>{
  self.skipWaiting();
  ev.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(ASSETS)).catch(()=>{}));
});

self.addEventListener('activate', ev=>{
  ev.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', ev=>{
  const url = new URL(ev.request.url);
  // App shell: network first then cache fallback for dynamic content; serve from cache for shell
  if(ASSETS.includes(url.pathname) || url.pathname === '/'){
    ev.respondWith(fetch(ev.request).catch(()=>caches.match(ev.request)));
    return;
  }
  // For other requests (audio blobs will come from IndexedDB via object URLs), just default to network
  ev.respondWith(fetch(ev.request).catch(()=>caches.match(ev.request)));
});
