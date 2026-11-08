/* Only fingerprinted public JS/CSS is cached. Calendar, auth and HTML requests
 * always bypass this worker's fetch handler. Push behavior stays independent. */
const STATIC_CACHE = "sai-static-v1";
const STATIC_CACHE_LIMIT = 80;
const STATIC_WARM_LIMIT = 30;
const STATIC_PATH = /^\/_next\/static\/(?:chunks|css)\/(?:[A-Za-z0-9_-][A-Za-z0-9._-]*\/)*[A-Za-z0-9_-][A-Za-z0-9._-]*[.-][A-Za-z0-9_-]{8,}\.(?:js|css)$/;
let staticWrites = Promise.resolve();
let staticWarmupStarted = false;

function publicStaticUrl(value) {
  try {
    if (typeof value !== "string" || value.length > 2048 || value.trim() !== value || /[?#%]/.test(value)) return null;
    const url = new URL(value, self.location.origin);
    if (url.origin !== self.location.origin || url.username || url.password || url.search || url.hash || !STATIC_PATH.test(url.pathname)) return null;
    return url.href;
  } catch { return null; }
}

function eligibleStaticRequest(request) {
  if (request.method !== "GET" || request.mode === "navigate" || request.destination === "document") return null;
  for (const header of ["Authorization", "Range", "If-Range", "RSC", "Next-Router-State-Tree"]) if (request.headers.has(header)) return null;
  return publicStaticUrl(request.url);
}

function publicStaticResponse(response, url) {
  if (!response || !response.ok || response.status !== 200 || response.redirected || response.url !== url || ["opaque", "opaqueredirect", "error"].includes(response.type)) return false;
  if (response.headers.has("Set-Cookie")) return false;
  if (/(?:^|,)\s*(?:private|no-store)\b/i.test(response.headers.get("Cache-Control") || "")) return false;
  const vary = (response.headers.get("Vary") || "").split(",").map(value => value.trim().toLowerCase());
  if (vary.some(value => value === "cookie" || value === "authorization" || value === "*")) return false;
  const type = (response.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
  return url.endsWith(".css") ? type === "text/css" : ["text/javascript", "application/javascript", "application/ecmascript", "text/ecmascript"].includes(type);
}

function rememberStatic(cache, url, response) {
  // Serialize writes so simultaneous warmups cannot overfill the FIFO cache.
  const write = staticWrites.catch(() => {}).then(async () => {
    const existing = await cache.match(url);
    if (existing && publicStaticResponse(existing, url)) return;
    if (existing) await cache.delete(url);
    const before = await cache.keys();
    while (before.length >= STATIC_CACHE_LIMIT) await cache.delete(before.shift());
    await cache.put(url, response);
    const after = await cache.keys();
    while (after.length > STATIC_CACHE_LIMIT) await cache.delete(after.shift());
  });
  staticWrites = write.catch(() => {});
  return write;
}

async function fetchStatic(request, url, keepWrite) {
  let cache = null;
  try {
    cache = await caches.open(STATIC_CACHE);
    const cached = await cache.match(url);
    if (cached && publicStaticResponse(cached, url)) return cached;
    if (cached) await cache.delete(url);
  } catch { /* A disabled or failed Cache API must not prevent normal loading. */ }
  // Public code does not need account cookies. Omit them even on cache failure.
  const response = await fetch(request, { credentials: "omit" });
  if (cache && publicStaticResponse(response, url)) {
    try {
      const write = rememberStatic(cache, url, response.clone()).catch(() => {});
      if (keepWrite) keepWrite(write);
      else await write;
    } catch { /* Cache failures leave the successful network response usable. */ }
  }
  return response;
}

self.addEventListener("fetch", event => {
  const url = eligibleStaticRequest(event.request);
  if (!url || typeof caches === "undefined") return;
  const background = [];
  const response = fetchStatic(event.request, url, write => background.push(write));
  event.respondWith(response);
  // Extend the event synchronously, without making the response await disk writes.
  event.waitUntil(response.then(() => Promise.all(background)).catch(() => {}));
});

self.addEventListener("message", event => {
  if (event.data?.type !== "sai:cache-static" || staticWarmupStarted || typeof caches === "undefined" || !Array.isArray(event.data.urls)) return;
  if (event.origin && event.origin !== self.location.origin) return;
  try { if (!event.source?.url || new URL(event.source.url).origin !== self.location.origin) return; } catch { return; }
  if (self.navigator?.connection?.saveData || event.data.saveData === true) return;
  const urls = [...new Set(event.data.urls.map(publicStaticUrl).filter(Boolean))].slice(0, STATIC_WARM_LIMIT);
  if (!urls.length) return;
  staticWarmupStarted = true;
  event.waitUntil((async () => {
    let next = 0;
    const warm = async () => {
      while (next < urls.length) {
        const url = urls[next++];
        try { await fetchStatic(new Request(url), url); } catch { /* The next real request can retry a failed warmup. */ }
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, urls.length) }, warm));
  })());
});

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
