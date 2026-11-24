/* FinTrack Notification Click Handler (imported by PWA Service Worker) */

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetSection = event.notification?.data?.section || 'dashboard';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.postMessage({ type: 'FINTRACK_NAVIGATE', section: targetSection });
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(`/?section=${encodeURIComponent(targetSection)}`);
      }
      return undefined;
    })
  );
});
