import test from "node:test";
import assert from "node:assert/strict";
import { createAssistantHandoffReader } from "../lib/client/assistant-handoff.ts";

function fixture(address, read = async () => ({ text: "내일 오후 3시 엄마와 약속" })) {
  let url = new URL(address); const replacements = [];
  return { reader: createAssistantHandoffReader({ url: () => new URL(url), replace: next => { url = new URL(next); replacements.push(url.href); }, read }), replacements, url: () => url };
}

test("a Shortcut's private fragment is removed synchronously, without a server request", async () => {
  const text = "내일 오후 3시 + 엄마와 약속 / 장소: A&B #2";
  const f = fixture(`https://sai.day/assistant#text=${encodeURIComponent(text)}`, () => { throw new Error("No network expected"); });
  const promise = f.reader.take("account-a");
  assert.equal(f.url().href, "https://sai.day/assistant");
  assert.deepEqual(await promise, { text, source: "voice" });
  assert.ok(!f.replacements.join().includes(encodeURIComponent(text)));
});

test("duplicate mounts share one single-use handoff request and explicit clearing erases it", async () => {
  let calls = 0;
  const f = fixture("https://sai.day/assistant?share=16713781-561d-43e5-8392-194a348a00ee", async () => { ++calls; return { text: "이번주 토요일 오후 2시 산책" }; });
  const first = f.reader.take("account-a"), second = f.reader.take("account-a");
  assert.equal(first, second); assert.equal((await first).source, "share");
  assert.equal(calls, 1); assert.equal(f.url().search, "");
  f.reader.clear(); assert.equal(await f.reader.take("account-a"), null);
});

test("late private results cannot survive an account change", async () => {
  let finish;
  const f = fixture("https://sai.day/assistant?share=16713781-561d-43e5-8392-194a348a00ee", () => new Promise(resolve => { finish = resolve; }));
  const old = f.reader.take("account-a");
  assert.equal(await f.reader.take("account-b"), null);
  finish({ text: "account-a private conversation" });
  await assert.rejects(old, /계정/);
});

test("oversized dictated content is removed before rejection and share errors do not trigger analysis", async () => {
  const f = fixture(`https://sai.day/assistant#text=${"a".repeat(6001)}`);
  await assert.rejects(f.reader.take("account-a")); assert.equal(f.url().hash, "");
  const error = fixture("https://sai.day/assistant?shareError=signin", () => { throw new Error("No network expected"); });
  await assert.rejects(error.reader.take("account-a"), /로그인/); assert.equal(error.url().search, "");
});
