// ============================================================
// Shittu Stores — Service Worker  (sw.js)
// Handles: offline caching · push notifications · notification clicks
// ============================================================

const CACHE_NAME  = 'shittu-stores-v1';
const APP_SHELL   = ['./index.html', './manifest.json', './icon.svg'];

// ── Install: pre-cache the app shell ──────────────────────────
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.allSettled(
        APP_SHELL.map(url =>
          cache.add(new Request(url, { cache: 'reload' })).catch(() => {})
        )
      )
    )
  );
});

// ── Activate: clean old caches, take control immediately ──────
self.addEventListener('activate', event => {
  event.waitUntil(
    Promise.all([
      clients.claim(),
      caches.keys().then(keys =>
        Promise.all(
          keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
        )
      )
    ])
  );
});

// ── Fetch: network-first for API calls, cache-first for assets ─
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Let non-GET and cross-origin requests (e.g. GAS API) pass through
  if (event.request.method !== 'GET') return;
  if (url.origin !== location.origin)  return;

  // Navigation requests: try network, fall back to cached index.html
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(resp => {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
          return resp;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Static assets: stale-while-revalidate
  event.respondWith(
    caches.open(CACHE_NAME).then(cache =>
      cache.match(event.request).then(cached => {
        const networkFetch = fetch(event.request).then(resp => {
          if (resp.ok) cache.put(event.request, resp.clone());
          return resp;
        }).catch(() => cached);
        return cached || networkFetch;
      })
    )
  );
});

// ── Push: show notification from server-sent push ─────────────
self.addEventListener('push', event => {
  let data = { title: '🛒 Shittu Stores', body: 'You have a new notification.' };
  try { data = { ...data, ...event.data.json() }; } catch (_) {}

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body:             data.body,
      icon:             './icon.svg',
      badge:            './icon.svg',
      tag:              data.tag  || 'shittu-push',
      data:             data.data || {},
      requireInteraction: true,
      vibrate:          [200, 100, 200],
    })
  );
});

// ── Notification click: focus or open the app ─────────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url)
    || './index.html';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      // Focus an already-open window/tab
      for (const client of list) {
        if (client.url.includes(location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      // Otherwise open a new window
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});

// ── Periodic background sync (Chrome 80+) ────────────────────
// The main thread registers 'check-orders'; here we just wake the
// app so it can do its own polling — no API credentials stored in SW.
self.addEventListener('periodicsync', event => {
  if (event.tag === 'check-orders') {
    event.waitUntil(
      clients.matchAll({ type: 'window' }).then(list => {
        list.forEach(client => client.postMessage({ type: 'PERIODIC_SYNC' }));
      })
    );
  }
});

// ── Message from main thread ──────────────────────────────────
// Allows the app to ask the SW to show a notification directly
// (works in background tabs where new Notification() is blocked)
self.addEventListener('message', event => {
  if (!event.data) return;
  if (event.data.type === 'SHOW_NOTIFICATION') {
    const { title, body, tag, url } = event.data;
    self.registration.showNotification(title || '🛒 Shittu Stores', {
      body:             body   || '',
      icon:             './icon.svg',
      badge:            './icon.svg',
      tag:              tag    || 'shittu-msg-' + Date.now(),
      data:             { url: url || './' },
      requireInteraction: true,
      vibrate:          [200, 100, 200],
    }).catch(() => {});
  }
});
