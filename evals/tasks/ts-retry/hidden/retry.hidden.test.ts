import assert from "node:assert/strict";
import { test } from "node:test";
import { retry } from "../src/retry.ts";

function flaky(failures: number) {
  let calls = 0;
  const fn = async () => {
    calls += 1;
    if (calls <= failures) throw new Error(`fail ${calls}`);
    return "ok";
  };
  return { fn, calls: () => calls };
}

test("hidden: retries until success", async () => {
  const f = flaky(2);
  assert.equal(await retry(f.fn), "ok");
  assert.equal(f.calls(), 3);
});

test("hidden: rejects with the last error after the attempts run out", async () => {
  const f = flaky(10);
  await assert.rejects(retry(f.fn, { attempts: 4 }), /fail 4/);
  assert.equal(f.calls(), 4);
});

test("hidden: backoff and onRetry", async () => {
  const f = flaky(3);
  const seen: [string, number][] = [];
  const started = Date.now();
  assert.equal(
    await retry(f.fn, { attempts: 5, delayMs: 40, factor: 2, onRetry: (e, n) => seen.push([(e as Error).message, n]) }),
    "ok",
  );
  const elapsed = Date.now() - started;
  assert.deepEqual(seen, [["fail 1", 1], ["fail 2", 2], ["fail 3", 3]]);
  assert.ok(elapsed >= 270 && elapsed < 1500, `waited ${elapsed} ms, expected about 280`);
});

test("hidden: shouldRetry false stops at once", async () => {
  const f = flaky(5);
  await assert.rejects(retry(f.fn, { attempts: 5, shouldRetry: () => false }), /fail 1/);
  assert.equal(f.calls(), 1);
});
