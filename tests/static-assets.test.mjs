import assert from "node:assert/strict";
import test from "node:test";
import { collectStaticAssetUrls, isPublicStaticAssetUrl } from "../lib/client/static-assets.ts";

const origin = "https://sai.day";
const script = "/_next/static/chunks/calendar-aB12cd34.js";
const style = "/_next/static/css/styles.1234abcd.css";

test("only fingerprinted public JavaScript and CSS on the exact origin are eligible", () => {
  for (const value of [script, style, `${origin}${script}`, "/_next/static/chunks/app/nested/calendar-aB12cd34.js"]) assert.equal(isPublicStaticAssetUrl(value, origin), true, value);
  for (const value of ["https://other.day" + script, "http://sai.day" + script, "https://sai.day:444" + script, "https://user:secret@sai.day" + script, "/_next/static/chunks/calendar.js", "/_next/static/chunks/calendar-1234567.js", "/_next/static/chunks/calendar-12345678.js.map", "/_next/static/media/calendar-12345678.js", "/_next/static/css/calendar-12345678.svg", "/api/events", "/__/auth/handler", "/auth/session", "/app", "/manifest.webmanifest", "/sw.js"]) assert.equal(isPublicStaticAssetUrl(value, origin), false, value);
});

test("queries, fragments, encoded path tricks and empty delimiters never enter the shared cache", () => {
  for (const suffix of ["?", "?token=private", "#", "#private", "?x=1#y"]) assert.equal(isPublicStaticAssetUrl(script + suffix, origin), false, suffix);
  for (const value of [" " + script, script + " ", "/_next/static/chunks/app%2Fcalendar-12345678.js", "/_next/static/chunks/%2e%2e/calendar-12345678.js", "/_next/static/chunks/folder/%2e%2e/calendar-12345678.js", "/_next/static/chunks/calendar-%3F12345678.js", "/_next/static/chunks/한글-12345678.js", "data:text/javascript,alert(1)", "javascript:alert(1)"]) assert.equal(isPublicStaticAssetUrl(value, origin), false, value);
});

test("loaded resource sources deduplicate normalized URLs, skip private entries and stop at 30", () => {
  const extra = Array.from({ length: 40 }, (_, index) => `/_next/static/chunks/part-${index}-12345678.js`);
  const result = collectStaticAssetUrls(origin, ["/app?invite=secret", script, `${origin}${script}`, style, "https://other.day" + script, ...extra]);
  assert.equal(result.length, 30);
  assert.deepEqual(result.slice(0, 3), [`${origin}${script}`, `${origin}${style}`, `${origin}${extra[0]}`]);
  assert.equal(result.at(-1), `${origin}${extra[27]}`);
  assert.equal(new Set(result).size, 30);
});
