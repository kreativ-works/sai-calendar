import assert from "node:assert/strict";
import test from "node:test";
import { initialCalendarRange, matchesCalendarBootstrap } from "../lib/client/calendar-bootstrap.ts";
import { parseRange } from "../lib/domain/calendar.ts";

test("the SSR month range covers neighboring calendar cells across years and leap months", () => {
  for (const [today, from, to] of [
    ["2026-11-08", "2026-10-25", "2026-12-07"],
    ["2026-12-31", "2026-11-24", "2027-01-07"],
    ["2027-01-01", "2026-12-25", "2027-02-07"],
    ["2028-02-29", "2028-01-25", "2028-03-07"],
  ]) {
    const range = initialCalendarRange(today);
    assert.deepEqual(range, { from, to });
    assert.deepEqual(parseRange(from, to), range);
  }
});

test("only the exact SSR range can skip the initial state request; navigation and search require a new read", () => {
  const range = initialCalendarRange("2026-11-08");
  assert.equal(matchesCalendarBootstrap(range, range.from, range.to), true);
  assert.equal(matchesCalendarBootstrap(null, range.from, range.to), false);
  assert.equal(matchesCalendarBootstrap(undefined, range.from, range.to), false);
  assert.equal(matchesCalendarBootstrap(range, "2026-11-08", "2027-11-08"), false);
  const next = initialCalendarRange("2026-12-01");
  assert.equal(matchesCalendarBootstrap(range, next.from, next.to), false);
});
