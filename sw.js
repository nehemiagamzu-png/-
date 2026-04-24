/* ================================================
   Service Worker — יומן משימות v6
   ================================================ */

const CACHE = 'tasks-pro-v6';

const FILES = [
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

/* ── Install: cache all files immediately ── */
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then(cache =>
      Promise.all(FILES.map(f => cache.add(f).catch(() => {})))
    )
  );
});

/* ── Activate: remove old caches, claim clients ── */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

/* ── Fetch: cache-first, fallback to network ── */
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request)
        .then(res => {
          if (res && res.status === 200 && res.type !== 'opaque') {
            caches.open(CACHE).then(c => c.put(event.request, res.clone()));
          }
          return res;
        })
        .catch(() => caches.match('./index.html'));
    })
  );
});

/* ── Message from page → show notification ── */
self.addEventListener('message', event => {
  if (!event.data || event.data.type !== 'SHOW_NOTIFICATION') return;

  const { title, body, tag, taskId, dateStr } = event.data;

  const actions = taskId ? [
    { action: 'done',    title: '✅ סמן כמושלם' },
    { action: 'dismiss', title: '✕ סגור' }
  ] : [];

  event.waitUntil(
    self.registration.showNotification(title || '⏰ תזכורת', {
      body:    body || '',
      icon:    './icon-192.png',
      badge:   './icon-192.png',
      tag:     tag  || 'task',
      actions,
      silent:  false,
      vibrate: [200, 100, 200],
      requireInteraction: false,
      data:    { taskId, dateStr, url: './index.html' }
    })
  );
});

/* ── Notification clicked or action tapped ── */
self.addEventListener('notificationclick', event => {
  event.notification.close();

  const { taskId, dateStr } = event.notification.data || {};
  const base = './index.html';

  if (event.action === 'done' && taskId && dateStr) {
    // Send MARK_DONE to open clients, or open with URL param
    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
        for (const c of list) {
          if (c.url.includes('index') || c.url.endsWith('/')) {
            c.postMessage({ type: 'MARK_DONE', taskId, dateStr });
            return c.focus();
          }
        }
        return clients.openWindow(base + '?markDone=' + taskId + '&date=' + dateStr);
      })
    );
    return;
  }

  // Dismiss or default tap → just open app
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if ('focus' in c) return c.focus();
      }
      return clients.openWindow(base);
    })
  );
});
