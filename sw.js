// sw.js - Basic Service Worker
const CACHE_NAME = 'md-enterprise-v2';
const urlsToCache = [
  '/',
  '/index.html',
  '/desktop.css',
  '/mobile.css',
  '/images/icon-192.png',
  '/images/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => response || fetch(event.request))
  );
});