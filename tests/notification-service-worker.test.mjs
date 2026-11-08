import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
const origin = 'https://sai.example';
const asset = (name = 'entry-Ab123456', extension = 'js') => `${origin}/_next/static/${extension === 'css' ? 'css' : 'chunks'}/${name}.${extension}`;
const key = input => typeof input === 'string' ? input : input.url;

// Real network/cache responses retain their final URL and redirect metadata.
// Give fixtures that same metadata instead of blank constructed Response URLs.
function networkResponse(url, options = {}) {
  const decorate = response => {
    Object.defineProperties(response, {
      url: { value: options.url ?? url }, redirected: { value: options.redirected ?? false }, type: { value: options.type ?? 'basic' },
    });
    const clone = response.clone.bind(response);
    response.clone = () => decorate(clone());
    return response;
  };
  return decorate(new Response(options.body ?? 'public code', { status: options.status ?? 200, headers: { 'Content-Type': url.endsWith('.css') ? 'text/css' : 'text/javascript', ...options.headers } }));
}

function worker(options = {}) {
  const handlers = new Map(), shown = [], opened = [], network = [], cacheValues = new Map(), cacheCalls = [], writes = [];
  let inFlight = 0, peakInFlight = 0;
  const cache = {
    async match(input) { if (options.cacheFailure === 'match') throw new Error('cache match unavailable'); return cacheValues.get(key(input))?.clone(); },
    async put(input, value) { if (options.cacheFailure === 'put') throw new Error('cache write unavailable'); const url = key(input); writes.push(url); cacheValues.set(url, value.clone()); },
    async keys() { if (options.cacheFailure === 'keys') throw new Error('cache keys unavailable'); return [...cacheValues.keys()].map(url => new Request(url)); },
    async delete(input) { if (options.cacheFailure === 'delete') throw new Error('cache delete unavailable'); return cacheValues.delete(key(input)); },
  };
  const self = { location: { origin }, navigator: { connection: { saveData: options.saveData ?? false } }, skipWaiting() {}, clients: { claim: async () => {}, matchAll: async () => [], openWindow: async url => opened.push(url) }, registration: { showNotification: async (title, config) => shown.push({ title, options: config }) }, addEventListener: (kind, handler) => handlers.set(kind, handler) };
  const fetch = async (request, init) => {
    network.push({ request, init }); ++inFlight; peakInFlight = Math.max(peakInFlight, inFlight);
    try { return options.fetch ? await options.fetch(request, init) : networkResponse(request.url); }
    finally { --inFlight; }
  };
  const context = { self, URL, Request, Response, fetch };
  if (!options.noCacheApi) context.caches = { async open(name) { cacheCalls.push(name); if (options.cacheFailure === 'open') throw new Error('cache storage unavailable'); return cache; } };
  vm.runInNewContext(source, context);
  function dispatch(request) {
    let response;
    const work = [];
    handlers.get('fetch')({ request, respondWith: promise => response = Promise.resolve(promise), waitUntil: promise => work.push(promise) });
    return { intercepted: !!response, async complete() { const result = await response; await Promise.all(work); return result; } };
  }
  async function message(urls, extra = {}) {
    const work = [];
    handlers.get('message')({ data: { type: 'sai:cache-static', urls, ...extra.data }, origin: extra.origin ?? origin, source: extra.source ?? { url: `${origin}/app` }, waitUntil: promise => work.push(promise) });
    await Promise.all(work);
  }
  return { handlers, shown, opened, self, dispatch, message, cacheValues, cacheCalls, writes, network, peak: () => peakInFlight };
}

test('Only same-origin query-free fingerprinted public JS/CSS requests are intercepted', async () => {
  const instance = worker();
  for (const url of [asset(), asset('calendar.abcdefgh'), asset('styles-Abc_1234', 'css'), `${origin}/_next/static/chunks/nested/calendar-Abc12345.js`]) {
    const request = instance.dispatch(new Request(url)); assert.equal(request.intercepted, true, url); await request.complete();
  }
  const rejected = ['/app', '/assistant', '/admin/ai', '/login', '/__/auth/handler', '/api/state', '/api/auth/session', '/sw.js', '/manifest.webmanifest', '/favicon.svg', '/_next/static/chunks/calendar.js', '/_next/static/chunks/calendar-abc.js', '/_next/static/chunks/calendar-Ab123456.js.map', '/assets/calendar-Ab123456.js'];
  for (const path of rejected) assert.equal(instance.dispatch(new Request(`${origin}${path}`)).intercepted, false, path);
  for (const url of [`${asset()}?v=1`, `${asset()}?`, 'https://evil.test/_next/static/chunks/entry-Ab123456.js']) assert.equal(instance.dispatch(new Request(url)).intercepted, false, url);
  for (const headers of [{ Authorization: 'Bearer private' }, { Range: 'bytes=0-100' }, { 'If-Range': 'etag' }, { RSC: '1' }, { 'Next-Router-State-Tree': 'private' }]) assert.equal(instance.dispatch(new Request(asset(), { headers })).intercepted, false);
  assert.equal(instance.dispatch(new Request(asset(), { method: 'POST' })).intercepted, false);
  assert.equal(instance.dispatch({ url: asset(), method: 'GET', mode: 'navigate', headers: new Headers() }).intercepted, false);
  assert.equal(instance.dispatch({ url: asset(), method: 'GET', destination: 'document', headers: new Headers() }).intercepted, false);
});

test('A verified public code response is cached and a second visit uses the cache', async () => {
  const instance = worker();
  const first = await instance.dispatch(new Request(asset(), { mode: 'same-origin' })).complete();
  assert.equal(await first.text(), 'public code'); assert.equal(instance.network.length, 1);
  assert.deepEqual(instance.cacheCalls, ['sai-static-v1']); assert.equal(instance.network[0].init.credentials, 'omit'); assert.equal(instance.network[0].request.mode, 'same-origin');
  const second = await instance.dispatch(new Request(asset())).complete();
  assert.equal(await second.text(), 'public code'); assert.equal(instance.network.length, 1); assert.equal(instance.writes.length, 1);
});

test('Both network and cached responses must be exact public 200 JS/CSS responses', async () => {
  const rejected = [
    { headers: { 'Content-Type': 'text/html' } }, { headers: { 'Content-Type': 'text/x-component' } }, { headers: { 'Content-Type': 'application/json' } }, { headers: { 'Content-Type': '' } },
    { status: 201 }, { status: 206 }, { status: 404 }, { headers: { 'Cache-Control': 'public, max-age=0, PRIVATE="cookie"' } }, { headers: { 'Cache-Control': 'no-store' } },
    { headers: { 'Set-Cookie': 'sai_session=private' } }, { headers: { 'Set-Cookie': '' } }, { headers: { Vary: 'Cookie, Accept-Encoding' } }, { headers: { Vary: 'Authorization' } }, { headers: { Vary: '*' } },
    { redirected: true }, { type: 'opaque' }, { type: 'opaqueredirect' }, { url: `${origin}/login` }, { url: '' },
  ];
  for (const options of rejected) {
    const instance = worker({ fetch: async request => networkResponse(request.url, options) });
    await instance.dispatch(new Request(asset())).complete(); assert.equal(instance.cacheValues.size, 0, JSON.stringify(options));
    instance.cacheValues.set(asset(), networkResponse(asset(), options));
    await instance.dispatch(new Request(asset())).complete(); assert.equal(instance.network.length, 2, `cached rejection ${JSON.stringify(options)}`); assert.equal(instance.cacheValues.size, 0);
  }
  const css = worker({ fetch: async request => networkResponse(request.url, { headers: { 'Content-Type': 'text/javascript' } }) });
  await css.dispatch(new Request(asset('styles-Ab123456', 'css'))).complete(); assert.equal(css.cacheValues.size, 0);
});

test('Safe MIME parameters and non-personal Vary headers retain immutable public code', async () => {
  const instance = worker({ fetch: async request => networkResponse(request.url, { headers: { 'Content-Type': 'Application/JavaScript; charset=utf-8', 'Cache-Control': 'public, max-age=0, must-revalidate', Vary: 'Accept-Encoding' } }) });
  await instance.dispatch(new Request(asset())).complete(); assert.equal(instance.cacheValues.size, 1);
  const css = worker({ fetch: async request => networkResponse(request.url, { headers: { 'Content-Type': 'text/css; charset=utf-8' } }) });
  await css.dispatch(new Request(asset('styles-Ab123456', 'css'))).complete(); assert.equal(css.cacheValues.size, 1);
});

test('Unavailable or failing caches preserve normal cookie-free network loading', async () => {
  const missing = worker({ noCacheApi: true }); assert.equal(missing.dispatch(new Request(asset())).intercepted, false); await missing.message([asset()]); assert.equal(missing.network.length, 0);
  for (const cacheFailure of ['open', 'match', 'put', 'keys', 'delete']) {
    const instance = worker({ cacheFailure });
    if (cacheFailure === 'delete') instance.cacheValues.set(asset(), networkResponse(asset(), { headers: { 'Content-Type': 'text/html' } }));
    const result = await instance.dispatch(new Request(asset())).complete(); assert.equal(await result.text(), 'public code', cacheFailure); assert.equal(instance.network.length, 1); assert.equal(instance.network[0].init.credentials, 'omit');
  }
});

test('Concurrent writes enforce an 80-entry FIFO bound without refreshing duplicate entries', async () => {
  const instance = worker(); const urls = Array.from({ length: 86 }, (_, index) => asset(`chunk${index}-abcdefgh`));
  await instance.dispatch(new Request(urls[0])).complete(); await instance.dispatch(new Request(urls[1])).complete(); await instance.dispatch(new Request(urls[0])).complete();
  await Promise.all(urls.slice(2).map(url => instance.dispatch(new Request(url)).complete()));
  assert.equal(instance.cacheValues.size, 80); assert.equal(instance.writes.length, 86);
  assert.equal(instance.cacheValues.has(urls[0]), false); assert.equal(instance.cacheValues.has(urls[5]), false); assert.equal(instance.cacheValues.has(urls[6]), true); assert.equal(instance.cacheValues.has(urls[85]), true);
});

test('Warmup revalidates URLs, deduplicates and caps at 30 with at most three requests in flight', async () => {
  const instance = worker({ fetch: async request => { await new Promise(resolve => setTimeout(resolve, 1)); return networkResponse(request.url); } });
  const urls = Array.from({ length: 40 }, (_, index) => asset(`warm${index}-abcdefgh`));
  await instance.message(['/app?private=calendar', 'https://evil.test/_next/static/chunks/a-abcdefgh.js', `${asset()}?`, `${asset()}#`, `${origin}/_next/static/chunks/nested/%2e%2e/entry-Ab123456.js`, urls[0], urls[0], ...urls]);
  assert.equal(instance.network.length, 30); assert.equal(instance.cacheValues.size, 30); assert.ok(instance.peak() <= 3); assert.ok(instance.peak() > 1); assert.ok(instance.network.every(item => item.init.credentials === 'omit'));
  await instance.message([urls[39]]); assert.equal(instance.network.length, 30, 'worker warmup is once only');
});

test('Warmup ignores foreign clients, malformed payloads, Save-Data and cache/network failures', async () => {
  const instance = worker();
  await instance.message([asset()], { origin: 'https://evil.test' }); await instance.message([asset()], { source: { url: 'https://evil.test/app' } }); await instance.message([asset()], { source: {} }); await instance.message(null); await instance.message([asset()], { data: { saveData: true } });
  assert.equal(instance.network.length, 0);
  const constrained = worker({ saveData: true }); await constrained.message([asset()]); assert.equal(constrained.network.length, 0);
  const failing = worker({ fetch: async () => { throw new Error('offline'); } }); await failing.message([asset(), asset('other-abcdefgh')]); assert.equal(failing.cacheValues.size, 0);
  const failedCache = worker({ cacheFailure: 'put' }); await failedCache.message([asset()]); assert.equal(failedCache.network.length, 1); assert.equal(failedCache.cacheValues.size, 0);
});

test('Push payload still becomes a visible notice with safe bounded copy and destination', async () => {
  const { handlers, shown } = worker(); let pending;
  handlers.get('push')({ data: { json: () => ({ title: 'x'.repeat(500), body: 'y'.repeat(1000), tag: 'notice', url: 'https://evil.test/?token=private' }) }, waitUntil: promise => pending = promise }); await pending;
  assert.equal(shown[0].title.length, 120); assert.equal(shown[0].options.body.length, 300); assert.equal(shown[0].options.data.url, '/app');
});

test('Push notification click preserves same-origin event deep link and rejects external routes', async () => {
  const { handlers, opened } = worker(); let pending, closed = 0;
  const click = url => handlers.get('notificationclick')({ notification: { data: { url }, close: () => closed++ }, waitUntil: promise => pending = promise });
  click('/app?notification=notice-1&date=2026-11-05&event=event-1'); await pending; assert.equal(opened.length, 1); assert.match(opened[0], /\/app\?notification=notice-1/);
  click('https://evil.test/app'); await pending; assert.equal(opened.length, 1); click('/login'); await pending; assert.equal(opened.length, 1); assert.equal(closed, 3);
});
