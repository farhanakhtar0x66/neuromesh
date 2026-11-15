// F107 paired-bootstrap (plan item M2): the interval and the "shown / not shown" line. No model calls.
import assert from "node:assert/strict";
import { test } from "node:test";
import { describeComparison, notWorseThan, pair, pairedBootstrap, rng, showableMargin, taskScores } from "../src/eval/stats.ts";

test("F107: the same data always gives the same interval", () => {
  const a = [1, 0, 1, 1, 0, 1, 1, 1];
  const b = [1, 1, 1, 0, 1, 1, 1, 1];
  assert.deepEqual(pairedBootstrap(a, b), pairedBootstrap(a, b));
  const x = [0.1, 0.35, 0.8, 0.5, 0.95, 0.2, 0.6, 0.45, 0.7];
  const y = [0.5, 0.3, 0.9, 0.1, 0.8, 0.6, 0.4, 0.55, 0.2];
  assert.notEqual(pairedBootstrap(x, y, { seed: 2 })!.low, pairedBootstrap(x, y)!.low, "another seed, another draw");
  assert.equal(pairedBootstrap(a, b)!.resamples, 10_000);
});

test("F107: identical results give a zero interval; a clearly worse one is below zero and not shown", () => {
  const ones = Array.from({ length: 40 }, () => 1);
  const same = pairedBootstrap(ones, ones)!;
  assert.deepEqual([same.diff, same.low, same.high], [0, 0, 0]);
  assert.equal(notWorseThan(same, 0.1), true);
  const half = Array.from({ length: 40 }, (_, i) => (i % 2 === 0 ? 1 : 0));
  const worse = pairedBootstrap(half, ones)!;
  assert.ok(worse.high < 0 && Math.abs(worse.diff + 0.5) < 1e-9);
  assert.equal(notWorseThan(worse, 0.1), false);
  assert.equal(pairedBootstrap([1], [0]), undefined, "one task has no interval");
});

test("F107: the interval matches the normal approximation on a large sample (5th percentile = mean - 1.645 sd/sqrt(n))", () => {
  const next = rng(42);
  const n = 400;
  const a = Array.from({ length: n }, () => (next() < 0.7 ? 1 : 0));
  const b = Array.from({ length: n }, () => (next() < 0.7 ? 1 : 0));
  const i = pairedBootstrap(a, b, { seed: 7 })!;
  const d = a.map((x, k) => x - b[k]!);
  const m = d.reduce((s, x) => s + x, 0) / n;
  const sd = Math.sqrt(d.reduce((s, x) => s + (x - m) ** 2, 0) / (n - 1));
  assert.ok(Math.abs(i.low - (m - (1.645 * sd) / Math.sqrt(n))) < 0.01, `low ${i.low}`);
  assert.ok(Math.abs(i.high - (m + (1.645 * sd) / Math.sqrt(n))) < 0.01, `high ${i.high}`);
});

test("F107: runs are averaged per task and only tasks both configurations ran are paired", () => {
  const a = taskScores([{ t1: 1, t2: 0, t3: 1 }, { t1: 1, t2: 1 }, { t1: 0, t2: 1 }]);
  assert.deepEqual(a, { t1: 2 / 3, t2: 2 / 3, t3: 1 });
  const p = pair(a, { t2: 1, t3: 0, t9: 1 });
  assert.deepEqual(p.tasks, ["t2", "t3"]);
});

test("F107: the line the plan asks for", () => {
  const ones = Array.from({ length: 40 }, () => 1);
  const worse = ones.map((x, i) => (i < 6 ? 0 : x));
  const text = describeComparison("cascade", "opus", pairedBootstrap(worse, ones), 0.1).join("\n");
  assert.match(text, /not worse than opus by more than 10 points: (shown|not shown)/);
  assert.match(text, /10,000 task resamples/);
  const i = pairedBootstrap(worse, ones)!;
  assert.ok(showableMargin(i) > 0.05);
  assert.match(describeComparison("a", "b", undefined, 0.1)[0]!, /fewer than 2 tasks/);
  const ceiling = describeComparison("a", "b", pairedBootstrap(ones, ones), 0.1).join("\n");
  assert.match(ceiling, /a ceiling/, "a zero-width interval is called a ceiling, not a margin");
  assert.ok(!/can show a margin/.test(ceiling));
});
