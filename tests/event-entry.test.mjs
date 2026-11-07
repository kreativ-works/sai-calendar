import assert from "node:assert/strict";
import test from "node:test";
import { automaticEndDate, defaultEventEnd, withEventEndTime, withEventStartTime } from "../lib/client/event-entry.ts";
import { CalendarError, parseEvent } from "../lib/domain/calendar.ts";

const event = (overrides = {}) => ({
  title: "함께 점심", startDate: "2026-11-07", endDate: "2026-11-07",
  startTime: "09:00", endTime: "10:00", allDay: false, ownerScope: "both",
  category: "date", location: "동네 식당", note: "예약 확인", repeat: "none", repeatUntil: null,
  ...overrides,
});

test("selecting 14:00 defaults the end to 15:00 and keeps start minutes", () => {
  for (const [start, end] of [["14:00", "15:00"], ["14:05", "15:05"], ["09:37", "10:37"], ["00:00", "01:00"], ["22:59", "23:59"]]) {
    assert.deepEqual(defaultEventEnd("2026-11-07", start), { endDate: "2026-11-07", endTime: end });
  }
  const input = Object.freeze(event()), updated = withEventStartTime(input, "14:00");
  assert.deepEqual(updated, { ...input, startTime: "14:00", endTime: "15:00" });
  assert.notEqual(updated, input);
  assert.equal(input.startTime, "09:00");
  assert.deepEqual(parseEvent(updated), updated);
});

test("late evening crosses midnight, month and year boundaries without shifting local minutes", () => {
  for (const [date, start, endDate, endTime] of [
    ["2026-11-07", "23:00", "2026-11-08", "00:00"],
    ["2026-11-07", "23:59", "2026-11-08", "00:59"],
    ["2026-04-30", "23:30", "2026-05-01", "00:30"],
    ["2026-12-31", "23:15", "2027-01-01", "00:15"],
    ["2028-02-28", "23:45", "2028-02-29", "00:45"],
    ["2028-02-29", "23:45", "2028-03-01", "00:45"],
    ["2100-02-28", "23:45", "2100-03-01", "00:45"],
  ]) {
    assert.deepEqual(defaultEventEnd(date, start), { endDate, endTime });
    assert.doesNotThrow(() => parseEvent(withEventStartTime(event({ startDate: date, endDate: date }), start)));
  }
});

test("changing a default overnight start back to daytime removes the automatic extra day", () => {
  const overnight = withEventStartTime(event(), "23:20");
  assert.equal(overnight.endDate, "2026-11-08");
  const daytime = withEventStartTime(overnight, "14:20");
  assert.equal(daytime.endDate, "2026-11-07");
  assert.equal(daytime.endTime, "15:20");
  assert.deepEqual(parseEvent(daytime), daytime);
});

test("explicit multi-day dates survive start time changes only when requested", () => {
  const multiDay = event({ endDate: "2026-11-10", endTime: "18:00" });
  assert.deepEqual(withEventStartTime(multiDay, "14:25", true), { ...multiDay, startTime: "14:25", endTime: "15:25" });
  const overnight = withEventStartTime(multiDay, "23:25", true);
  assert.equal(overnight.endDate, "2026-11-10");
  assert.equal(overnight.endTime, "00:25");
  assert.deepEqual(parseEvent(overnight), overnight);
  assert.equal(withEventStartTime(multiDay, "14:25").endDate, multiDay.startDate);
  assert.equal(withEventStartTime(event(), "23:25", true).endDate, "2026-11-08");
});

test("empty, malformed and impossible start values never silently replace the end", () => {
  for (const [date, time] of [
    ["", "14:00"], ["2026-11-7", "14:00"], ["2026-02-29", "14:00"], ["2026-04-31", "14:00"],
    ["2026-11-07", ""], ["2026-11-07", "9:00"], ["2026-11-07", "24:00"], ["2026-11-07", "14:60"],
    ["2026-11-07", "14:00:00"], ["2026-11-07", " 14:00"], ["2026-11-07", "14:00 "],
    ["2026-11-07", null], [null, "14:00"],
  ]) {
    assert.equal(defaultEventEnd(date, time), null);
    const input = event({ startDate: date });
    const updated = withEventStartTime(input, time, true);
    assert.deepEqual(updated, { ...input, startTime: time });
    assert.throws(() => parseEvent(updated), CalendarError);
  }
});

test("domain date limits permit the last valid hour and reject next-year overflow", () => {
  assert.deepEqual(defaultEventEnd("1970-01-01", "00:00"), { endDate: "1970-01-01", endTime: "01:00" });
  assert.equal(defaultEventEnd("1969-12-31", "23:00"), null);
  assert.equal(defaultEventEnd("2101-01-01", "00:00"), null);
  assert.deepEqual(defaultEventEnd("2100-12-31", "22:59"), { endDate: "2100-12-31", endTime: "23:59" });
  for (const time of ["23:00", "23:59"]) {
    assert.equal(defaultEventEnd("2100-12-31", time), null);
    const input = event({ startDate: "2100-12-31", endDate: "2100-12-31", endTime: "23:59" });
    assert.deepEqual(withEventStartTime(input, time), { ...input, startTime: time });
  }
});

test("manually changing an overnight end recalculates its date while preserving explicit multi-day spans", () => {
  const overnight = Object.freeze(withEventStartTime(event(), "23:30"));
  assert.equal(overnight.endDate, "2026-11-08");
  assert.equal(overnight.endTime, "00:30");
  const shortEvening = withEventEndTime(overnight, "23:45");
  assert.equal(shortEvening.endDate, "2026-11-07");
  assert.deepEqual(parseEvent(shortEvening), shortEvening);
  const nextMorning = withEventEndTime(shortEvening, "00:15");
  assert.equal(nextMorning.endDate, "2026-11-08");
  assert.deepEqual(parseEvent(nextMorning), nextMorning);
  const explicit = event({ startTime: "23:30", endDate: "2026-11-10", endTime: "00:30" });
  assert.deepEqual(withEventEndTime(explicit, "23:45", true), { ...explicit, endTime: "23:45" });
  assert.equal(overnight.endTime, "00:30");
  assert.equal(automaticEndDate(event({ startTime: "23:30", endTime: "23:30" })), "2026-11-07");
  assert.throws(() => parseEvent(withEventEndTime(overnight, "23:30")), CalendarError);
  assert.equal(automaticEndDate(event({ startDate: "", startTime: "23:30", endTime: "00:30" })), "");
});

test("a manual same-day end recovers a late start at the maximum supported date", () => {
  const input = event({ startDate: "2100-12-31", endDate: "2100-12-31" });
  assert.equal(defaultEventEnd(input.startDate, "23:30"), null);
  const lateStart = withEventStartTime(input, "23:30");
  assert.throws(() => parseEvent(lateStart), CalendarError);
  const recovered = withEventEndTime(lateStart, "23:59");
  assert.equal(recovered.endDate, "2100-12-31");
  assert.deepEqual(parseEvent(recovered), recovered);
  assert.equal(withEventEndTime(lateStart, "00:15").endDate, "2101-01-01");
  assert.throws(() => parseEvent(withEventEndTime(lateStart, "00:15")), CalendarError);
});
