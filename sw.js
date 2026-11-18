// sw.js - service worker for the AGE Capital Structure app.
// Network first: always try GitHub Pages for the newest copy, so each merged
// change shows up; fall back to the cached copy when you're offline.
// All paths are relative, because the site lives at /<repository>/.
const CACHE = 'age-capstruct-v1';
const FILES = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'capstruct.js',
  'manifest.webmanifest',
  'data/cdss.csv',
  'data/assumptions.csv',
  'data/banker_schedule.csv',
  'data/banker_schedule_riskier.csv',
  'data/example_firms.csv',
  'data/ebit_scenarios.csv',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  // Only handle this site's own GET requests; the app makes no others.
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(cache => cache.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then(hit => hit || caches.match('index.html')))
  );
});
