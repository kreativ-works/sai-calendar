import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Isolated synthetic identities. Never run against a deployed calendar.
const base = new URL(process.argv[2] || 'http://127.0.0.1:5174');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname), 'Integration tests run only on loopback.');
const tag = `sai-qa-${randomUUID()}`;
const identity = slot => ({ 'oai-authenticated-user-id': `${tag}-${slot}`, 'oai-authenticated-user-email': `${tag}-${slot}@example.invalid` });
let checks = 0;
const passed = name => { checks++; console.log(`PASS ${name}`); };
async function request(path, slot, method = 'GET', data, extraHeaders = {}) {
  const response = await fetch(new URL(path, base), {
    method,
    headers: { ...(slot ? identity(slot) : {}), ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), ...extraHeaders },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  const text = await response.text();
  let value;
  try { value = JSON.parse(text); } catch { throw new Error(`Expected JSON for ${method} ${path}; got ${response.status}: ${text.slice(0, 180)}`); }
  return { status: response.status, value };
}
const statePath = '/api/state?from=2026-11-01&to=2026-12-31';
const getState = async slot => { const r = await request(statePath, slot); assert.equal(r.status, 200, JSON.stringify(r.value)); return r.value; };
const profile = { name: '테스트 둘의 캘린더', aName: '테스트 하나', bName: '테스트 둘', anniversary: '2020-05-16' };
const event = { title: '통합 검증용 함께 저녁', startDate: '2026-11-05', endDate: '2026-11-05', startTime: '18:00', endTime: '19:00', allDay: false, ownerScope: 'both', category: 'date', location: '테스트 장소', note: '합성 테스트 데이터', repeat: 'none', repeatUntil: null };

assert.equal((await request(statePath)).status, 401); passed('anonymous access rejected');
assert.equal((await getState('a')).household, null); passed('new identity has no household');
assert.equal((await request('/api/household', 'a', 'POST', profile)).status, 200);
let a = await getState('a');
assert.equal(a.viewerSlot, 'a'); assert.equal(a.members.filter(m => m.connected).length, 1); passed('household stored with one connected member');
assert.equal((await request('/api/events', 'a', 'POST', { ...event, endTime: '17:00' })).status, 422); passed('invalid time rejected');
assert.equal((await request('/api/events', 'a', 'POST', event, { Origin: 'https://untrusted.invalid' })).status, 403); passed('cross-origin mutation rejected');
const id = randomUUID();
assert.equal((await request('/api/events', 'a', 'POST', { ...event, clientRequestId: id })).status, 200);
assert.equal((await request('/api/events', 'a', 'POST', { ...event, clientRequestId: id })).status, 200);
a = await getState('a');
assert.equal(a.events.filter(e => e.id === id).length, 1); passed('event persisted and duplicate retry deduplicated');
const concurrentId = randomUUID();
const concurrent = await Promise.all([1, 2].map(() => request('/api/events', 'a', 'POST', { ...event, title: '동시 요청 검증', clientRequestId: concurrentId })));
assert.ok(concurrent.every(r => r.status === 200));
assert.equal((await getState('a')).events.filter(e => e.id === concurrentId).length, 1); passed('concurrent duplicate requests create exactly one event');
assert.equal((await getState('b')).household, null);
assert.equal((await request(`/api/events/${id}`, 'b', 'PATCH', { ...event, revision: 1 })).status, 403); passed('unrelated identity cannot access or mutate household');
const invitation = await request('/api/invites', 'a', 'POST', {});
assert.equal(invitation.status, 200); assert.ok(invitation.value.code); assert.ok(invitation.value.expiresAt);
assert.equal((await request('/api/invites/join', 'b', 'POST', { code: invitation.value.code })).status, 200);
let b = await getState('b');
assert.equal(b.viewerSlot, 'b'); assert.equal(b.household.id, a.household.id); assert.equal(b.members.filter(m => m.connected).length, 2); assert.ok(b.events.some(e => e.id === id)); passed('second identity joins and reads shared event');
const thirdJoin = await request('/api/invites/join', 'c', 'POST', { code: invitation.value.code });
assert.notEqual(thirdJoin.status, 200); assert.equal((await getState('c')).household, null); passed('consumed invitation cannot add a third member');
assert.equal((await request('/api/invites', 'a', 'POST', {})).status, 409); passed('full household cannot issue another invite');
assert.equal((await request(`/api/events/${id}`, 'b', 'PATCH', { ...event, title: '짝꿍이 수정한 저녁', revision: 1 })).status, 200);
a = await getState('a'); const updated = a.events.find(e => e.id === id);
assert.equal(updated.title, '짝꿍이 수정한 저녁'); assert.equal(updated.revision, 2); passed('partner edit propagates back to original identity');
assert.equal((await request(`/api/events/${id}`, 'a', 'PATCH', { ...event, revision: 1 })).status, 409); passed('stale revision cannot overwrite partner edit');
const repeatId = randomUUID();
assert.equal((await request('/api/events', 'b', 'POST', { ...event, title: '매주 산책', ownerScope: 'b', repeat: 'weekly', repeatUntil: '2026-11-19', clientRequestId: repeatId })).status, 200);
assert.equal((await getState('a')).events.filter(e => e.id === repeatId).length, 3); passed('weekly recurrence expands within stop date');
assert.equal((await request('/api/household', 'c', 'POST', { ...profile, name: '별도 테스트 캘린더' })).status, 200);
assert.equal((await request(`/api/events/${id}`, 'c', 'PATCH', { ...event, revision: 2 })).status, 404); passed('different household cannot modify another household event');
assert.equal((await request(`/api/events/${id}`, 'b', 'DELETE', { revision: 2 })).status, 200);
assert.ok(!(await getState('a')).events.some(e => e.id === id)); passed('partner deletion propagates to original identity');
console.log(`Calendar API integration: ${checks} checks passed.`);
