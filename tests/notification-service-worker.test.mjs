import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
function worker() {
  const handlers = new Map(), shown = [], opened = [];
  const self = { location: { origin: 'https://sai.example' }, skipWaiting() {}, clients: { claim: async () => {}, matchAll: async () => [], openWindow: async url => opened.push(url) }, registration: { showNotification: async (title, options) => shown.push({ title, options }) }, addEventListener: (kind, handler) => handlers.set(kind, handler) };
  vm.runInNewContext(source, { self, URL });
  return { handlers, shown, opened, self };
}
test('Push worker never intercepts fetch or caches private calendars and authentication', () => { assert.equal(worker().handlers.has('fetch'), false); assert.doesNotMatch(source, /caches\./); });
test('Push payload always becomes a visible notice with safe bounded copy and destination', async () => {
  const { handlers, shown } = worker(); let pending;
  handlers.get('push')({ data: { json: () => ({ title: 'x'.repeat(500), body: 'y'.repeat(1000), tag: 'notice', url: 'https://evil.test/?token=private' }) }, waitUntil: promise => pending = promise });
  await pending;
  assert.equal(shown[0].title.length, 120); assert.equal(shown[0].options.body.length, 300); assert.equal(shown[0].options.data.url, '/app');
});
test('Push notification click preserves same-origin event deep link and rejects external routes', async () => {
  const { handlers, opened } = worker(); let pending, closed = 0;
  const click = url => handlers.get('notificationclick')({ notification: { data: { url }, close: () => closed++ }, waitUntil: promise => pending = promise });
  click('/app?notification=notice-1&date=2026-11-05&event=event-1'); await pending;
  assert.equal(opened.length, 1); assert.match(opened[0], /\/app\?notification=notice-1/);
  click('https://evil.test/app'); await pending; assert.equal(opened.length, 1);
  click('/login'); await pending; assert.equal(opened.length, 1); assert.equal(closed, 3);
});
