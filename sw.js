/* ================================================
   Service Worker — יומן משימות v7
   ================================================ */

const CACHE = 'tasks-pro-v7';
const PENDING_STORE = 'pending-completions-v1';

const FILES = [
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

/* ── Install ── */
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then(cache =>
      Promise.all(FILES.map(f => cache.add(f).catch(() => {})))
    )
  );
});

/* ── Activate ── */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE && k !== PENDING_STORE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

/* ── Fetch ── */
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

/* ── Store a pending completion in Cache so app can read it on open ── */
async function storePendingCompletion(taskId, dateStr) {
  try {
    const cache = await caches.open(PENDING_STORE);
    const key   = 'pending-' + taskId + '-' + dateStr;
    await cache.put(
      new Request(key),
      new Response(JSON.stringify({ taskId, dateStr, ts: Date.now() }), {
        headers: { 'Content-Type': 'application/json' }
      })
    );
  } catch(e) {
    console.warn('[SW] storePendingCompletion error:', e);
  }
}

/* ── Message from page → show notification ── */
self.addEventListener('message', event => {
  if (!event.data) return;

  if (event.data.type === 'SHOW_NOTIFICATION') {
    const { title, body, tag, taskId, dateStr } = event.data;
    event.waitUntil(
      self.registration.showNotification(title || '⏰ תזכורת', {
        body:    body || '',
        icon:    './icon-192.png',
        badge:   './icon-192.png',
        tag:     tag  || 'task',
        vibrate: [200, 100, 200],
        requireInteraction: false,
        actions: taskId ? [
          { action: 'done',    title: '✅ הושלם' },
          { action: 'dismiss', title: '✕ סגור' }
        ] : [],
        data: { taskId, dateStr, url: self.location.origin + self.registration.scope + 'index.html' }
      })
    );
  }

  // App requests list of pending completions (called on app open)
  if (event.data.type === 'GET_PENDING') {
    event.waitUntil(
      caches.open(PENDING_STORE).then(async cache => {
        const keys = await cache.keys();
        const pending = [];
        for (const req of keys) {
          const res  = await cache.match(req);
          const data = await res.json();
          pending.push(data);
        }
        // Send back to the requesting client
        if (event.source) {
          event.source.postMessage({ type: 'PENDING_LIST', pending });
        }
      }).catch(() => {})
    );
  }

  // App tells SW it processed a completion — remove from pending store
  if (event.data.type === 'CLEAR_PENDING') {
    const { taskId, dateStr } = event.data;
    caches.open(PENDING_STORE).then(cache => {
      cache.delete(new Request('pending-' + taskId + '-' + dateStr));
    }).catch(() => {});
  }
});

/* ── Notification click / action ── */
self.addEventListener('notificationclick', event => {
  event.notification.close();

  const { taskId, dateStr, url } = event.notification.data || {};
  // Build absolute URL — use SW scope as base
  const appUrl = url || (self.location.origin + self.registration.scope + 'index.html');

  if (event.action === 'done' && taskId && dateStr) {
    event.waitUntil(
      (async () => {
        // 1. Store completion in persistent cache — survives app restart
        await storePendingCompletion(taskId, dateStr);

        // 2. Try to notify any already-open clients immediately
        const list = await clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const client of list) {
          client.postMessage({ type: 'MARK_DONE', taskId, dateStr });
          await client.focus();
          return;
        }

        // 3. No open client — open app (it will read pending on init)
        await clients.openWindow(appUrl);
      })()
    );
    return;
  }

  // Default tap — open / focus app
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if ('focus' in client) return client.focus();
      }
      return clients.openWindow(appUrl);
    })
  );
});

/* ── Periodic Sync (Android Chrome — delivers even when app closed) ── */
self.addEventListener('periodicsync', event => {
  if (event.tag === 'check-notifications') {
    // The app will handle actual notification logic when it opens.
    // SW can't access tasks in localStorage — nothing to do here.
    console.log('[SW] Periodic sync fired');
  }
});
