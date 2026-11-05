/* Push only: no fetch handler, no caching of calendars, sessions or auth helpers. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
self.addEventListener("push", event => {
  event.waitUntil((async () => {
    let payload = {};
    try { payload = event.data?.json() || {}; } catch { /* Show a safe generic notice. */ }
    let url = "/app";
    try {
      const target = new URL(payload.url || "/app", self.location.origin);
      if (target.origin === self.location.origin && target.pathname === "/app") url = target.pathname + target.search;
    } catch { /* Keep same-origin application path. */ }
    await self.registration.showNotification(typeof payload.title === "string" ? payload.title.slice(0, 120) : "사이에서 알림이 왔어요", {
      body: typeof payload.body === "string" ? payload.body.slice(0, 300) : "우리 캘린더에서 확인해 주세요.",
      icon: "/icons/icon-192.png", badge: "/icons/badge-96.png",
      tag: typeof payload.tag === "string" ? payload.tag.slice(0, 180) : "sai-notification",
      data: { url },
    });
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of clients) client.postMessage({ type: "sai:notification" });
  })());
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil((async () => {
    const target = new URL(event.notification.data?.url || "/app", self.location.origin);
    if (target.origin !== self.location.origin || target.pathname !== "/app") return;
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const client = clients.find(item => { try { return new URL(item.url).origin === self.location.origin && new URL(item.url).pathname === "/app"; } catch { return false; } });
    if (client) { await client.navigate(target.href); await client.focus(); }
    else await self.clients.openWindow(target.href);
  })());
});
