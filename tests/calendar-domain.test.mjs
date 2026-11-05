import test from "node:test";
import assert from "node:assert/strict";
import { CalendarError, validDate, parseEvent, parseHousehold, parseRange, parseRevision, expandEvents, eventsOverlap } from "../lib/domain/calendar.ts";

function event(overrides = {}) {
  return { id: "series-1", title: "저녁 산책", startDate: "2026-11-05", endDate: "2026-11-05", startTime: "19:00", endTime: "20:00", allDay: false, ownerScope: "both", category: "date", location: "한강", note: "", repeat: "none", repeatUntil: null, revision: 1, ...overrides };
}

test("rejects invalid and normalized-away dates, accepts leap day", () => {
  assert.equal(validDate("2026-02-29"), false);
  assert.equal(validDate("2026-04-31"), false);
  assert.equal(validDate("2024-02-29"), true);
  assert.equal(validDate("2026-11-5"), false);
  assert.equal(validDate("2101-01-01"), false);
});

test("preserves all-day wall dates and discards unused times", () => {
  const parsed = parseEvent(event({ allDay: true, startTime: "garbage", endTime: "garbage" }));
  assert.equal(parsed.startDate, "2026-11-05");
  assert.equal(parsed.startTime, null);
  assert.equal(parsed.endTime, null);
});

test("timed event requires later endpoint, supports overnight", () => {
  assert.throws(() => parseEvent(event({ endTime: "19:00" })), CalendarError);
  assert.throws(() => parseEvent(event({ startTime: "24:00" })), CalendarError);
  assert.doesNotThrow(() => parseEvent(event({ startTime: "23:00", endTime: "01:00", endDate: "2026-11-06" })));
});

test("bounds text, span, canonical ownership, categories and revisions", () => {
  assert.throws(() => parseEvent(event({ title: " " })), CalendarError);
  assert.throws(() => parseEvent(event({ note: "x".repeat(2001) })), CalendarError);
  assert.throws(() => parseEvent(event({ ownerScope: "me" })), CalendarError);
  assert.throws(() => parseEvent(event({ category: "other" })), CalendarError);
  assert.throws(() => parseEvent(event({ category: ["life"] })), CalendarError);
  assert.throws(() => parseEvent(event({ repeat: { toString: null } })), CalendarError);
  assert.throws(() => parseEvent(event({ endDate: "2028-11-05" })), CalendarError);
  assert.throws(() => parseRevision(0), CalendarError);
  assert.throws(() => parseRevision(1.5), CalendarError);
  assert.equal(parseRevision(2), 2);
});

test("household validates both names and optional anniversary", () => {
  assert.deepEqual(parseHousehold({ name: " 우리 사이 ", aName: "나", bName: "너" }), { name: "우리 사이", aName: "나", bName: "너", anniversary: null });
  assert.throws(() => parseHousehold({ name: "사이", aName: "나", bName: "" }), CalendarError);
  assert.throws(() => parseHousehold({ name: "사이", aName: "나", bName: "너", anniversary: "2026-02-30" }), CalendarError);
});

test("range is bounded and rejects reversed dates", () => {
  assert.doesNotThrow(() => parseRange("2026-11-05", "2027-11-05"));
  assert.throws(() => parseRange("2026-11-05", "2028-11-05"), CalendarError);
  assert.throws(() => parseRange("2026-11-06", "2026-11-05"), CalendarError);
});

test("weekly expands only intersecting dates and honors inclusive repeatUntil", () => {
  const result = expandEvents([event({ repeat: "weekly", repeatUntil: "2026-11-19" })], "2026-11-10", "2026-12-01");
  assert.deepEqual(result.map((item) => item.startDate), ["2026-11-12", "2026-11-19"]);
  assert.equal(result[0].id, "series-1");
  assert.equal(result[0].occurrenceId, "series-1:2026-11-12");
  assert.equal(result[0].originalStartDate, "2026-11-05");
});

test("monthly on the 31st skips absent days instead of moving them", () => {
  const result = expandEvents([event({ startDate: "2026-01-31", endDate: "2026-01-31", repeat: "monthly" })], "2026-02-01", "2026-05-31");
  assert.deepEqual(result.map((item) => item.startDate), ["2026-03-31", "2026-05-31"]);
});

test("yearly leap day skips nonleap years", () => {
  const result = expandEvents([event({ startDate: "2024-02-29", endDate: "2024-02-29", repeat: "yearly" })], "2027-12-01", "2028-03-01");
  assert.deepEqual(result.map((item) => item.startDate), ["2028-02-29"]);
});

test("includes multi-day occurrences crossing query boundary and keeps series span", () => {
  const result = expandEvents([event({ startDate: "2026-11-04", endDate: "2026-11-06", allDay: true, repeat: "weekly" })], "2026-11-05", "2026-11-12");
  assert.deepEqual(result.map(({ startDate, endDate }) => [startDate, endDate]), [["2026-11-04", "2026-11-06"], ["2026-11-11", "2026-11-13"]]);
  assert.equal(result[1].originalEndDate, "2026-11-06");
});

test("old recurrence jumps to requested month without expanding intervening years", () => {
  const result = expandEvents([event({ startDate: "1970-01-01", endDate: "1970-01-01", repeat: "weekly" })], "2099-11-01", "2099-11-30");
  assert.ok(result.length >= 4 && result.length <= 5);
  assert.ok(result.every((item) => item.startDate >= "2099-11-01" && item.startDate <= "2099-11-30"));
});

test("conflicts require shared participants and strict time overlap", () => {
  assert.equal(eventsOverlap(event({ ownerScope: "a" }), event({ ownerScope: "b" })), false);
  assert.equal(eventsOverlap(event({ ownerScope: "a" }), event({ ownerScope: "both", startTime: "19:30" })), true);
  assert.equal(eventsOverlap(event(), event({ startTime: "20:00", endTime: "21:00" })), false);
  assert.equal(eventsOverlap(event({ allDay: true }), event({ startTime: "00:00", endTime: "00:30" })), true);
  assert.equal(eventsOverlap(event({ allDay: true }), event({ startDate: "2026-11-06", endDate: "2026-11-06", startTime: "00:00", endTime: "00:30" })), false);
});
