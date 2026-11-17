// Long chains and wide fans: no whole-sheet scans, no recursion as deep as the chain. The limits are ten times what
// the reference needs on the owner's Mac (see NOTES.md), because these are the only tests where time matters.
import test from "node:test";
import assert from "node:assert/strict";
import { Sheet } from "../src/index.js";

const N = 20000;
const CHAIN_LIMIT_MS = 6000;
const CYCLE_LIMIT_MS = 3000;
const FAN_LIMIT_MS = 5000;
const WIDE_LIMIT_MS = 13000;

function elapsed(fn) {
  const t0 = performance.now();
  const out = fn();
  return { ms: performance.now() - t0, out };
}

test("perf: a chain of 20000 formulas is built, recalculated from its first cell, and read back", () => {
  let evaluations = 0;
  const s = new Sheet({ onEvaluate: () => evaluations++ });
  const { ms } = elapsed(() => {
    s.set("A1", 1);
    for (let i = 2; i <= N; i++) s.set(`A${i}`, `=A${i - 1}+1`);
    assert.equal(s.get(`A${N}`), N);
    evaluations = 0;
    s.set("A1", 5);
    assert.equal(evaluations, N - 1);
    assert.equal(s.get(`A${N}`), N + 4);
    assert.equal(s.get("A10000"), 10004);
    s.set("A1", 7);
    assert.equal(s.get(`A${N}`), N + 6);
  });
  assert.ok(ms < CHAIN_LIMIT_MS, `took ${ms.toFixed(0)} ms, limit ${CHAIN_LIMIT_MS} ms`);
});

test("perf: a chain of 20000 is closed into a cycle and broken again without recursion", () => {
  const s = new Sheet();
  s.set("A1", 1);
  for (let i = 2; i <= N; i++) s.set(`A${i}`, `=A${i - 1}+1`);
  const { ms } = elapsed(() => {
    s.set("A1", `=A${N}`);
    assert.equal(s.get(`A${N}`).code, "#CIRC!");
    assert.equal(s.get("A1").code, "#CIRC!");
    assert.equal(s.get("A777").code, "#CIRC!");
    s.set("A1", 3);
    assert.equal(s.get(`A${N}`), N + 2);
  });
  assert.ok(ms < CYCLE_LIMIT_MS, `took ${ms.toFixed(0)} ms, limit ${CYCLE_LIMIT_MS} ms`);
});

test("perf: one cell read by 20000 formulas, and a SUM over a 20000-cell range", () => {
  let evaluations = 0;
  const s = new Sheet({ onEvaluate: () => evaluations++ });
  const { ms } = elapsed(() => {
    for (let i = 1; i <= N; i++) s.set(`B${i}`, `=A1+${i}`);
    s.set("C1", `=SUM(B1:B${N})`);
    evaluations = 0;
    s.set("A1", 10);
    assert.equal(evaluations, N + 1);
    assert.equal(s.get("B5"), 15);
    assert.equal(s.get("C1"), N * 10 + (N * (N + 1)) / 2);
    evaluations = 0;
    s.set("B7", 0);
    assert.equal(evaluations, 1);
  });
  assert.ok(ms < FAN_LIMIT_MS, `took ${ms.toFixed(0)} ms, limit ${FAN_LIMIT_MS} ms`);
});

test("perf: setting a cell does not cost more because the sheet is big", () => {
  const WIDE = 60000;
  let evaluations = 0;
  const s = new Sheet({ onEvaluate: () => evaluations++ });
  const { ms } = elapsed(() => {
    for (let i = 1; i <= WIDE; i++) s.set(`C${i}`, i);
    for (let i = 1; i <= WIDE; i++) {
      s.set(`D${i}`, `=C${i}*2`);
      s.set(`C${i}`, i + 1);
    }
  });
  assert.equal(evaluations, 2 * WIDE);
  assert.equal(s.get(`D${WIDE}`), (WIDE + 1) * 2);
  assert.ok(ms < WIDE_LIMIT_MS, `took ${ms.toFixed(0)} ms, limit ${WIDE_LIMIT_MS} ms`);
});
