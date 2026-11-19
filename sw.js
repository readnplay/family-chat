// 우리 가족 채팅방 알림 담당 (사이트를 닫아 두어도 동작)
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data && e.data.text() }; }
  e.waitUntil(
    self.registration.showNotification(d.title || '우리 가족', {
      body: d.body || '새 메시지가 왔어요',
      icon: '/icon-192.png',
      badge: '/badge-96.png',
      tag: 'family-chat',
      renotify: true,
      vibrate: [200, 100, 200],
      data: { url: d.url || '/' },
    })
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) if ('focus' in w) return w.focus();
    return self.clients.openWindow((e.notification.data && e.notification.data.url) || '/');
  })());
});
