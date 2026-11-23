// Nth Play service worker — makes the site installable as an app and keeps
// the app shell available on flaky connections. Booking data is NEVER cached:
// requests to Supabase (another origin) are not touched, so availability is
// always live.
const VERSION = 'nthplay-v2';
const SHELL = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== VERSION) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;          // Supabase etc.: always network
  if (url.pathname.endsWith('.mp4')) return;                 // video uses range requests; let the browser handle it

  // Pages: network first (so new deployments show immediately), cached shell when offline.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        const cache = await caches.open(VERSION);
        cache.put('/', res.clone()).catch(() => {});
        return res;
      } catch {
        return (await caches.match('/')) || new Response('You are offline. Reconnect to book a court.', { headers: { 'Content-Type': 'text/plain' } });
      }
    })());
    return;
  }

  // Built files have content hashes in their names: cache forever. Icons/images: cache, refresh in background.
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/') || url.pathname.startsWith('/media/')) {
    event.respondWith((async () => {
      const cache = await caches.open(VERSION);
      const hit = await cache.match(req);
      const refresh = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || refresh;
    })());
  }
});

// Push notifications: show them, and open the related page when tapped.
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: "Nth Play", body: event.data ? event.data.text() : '' }; }
  event.waitUntil(self.registration.showNotification(data.title || "Nth Play", {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: data.tag,
    data: { link: data.link || '/' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.link || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
    if (open) { await open.focus(); return open.navigate(url); }
    return self.clients.openWindow(url);
  })());
});
