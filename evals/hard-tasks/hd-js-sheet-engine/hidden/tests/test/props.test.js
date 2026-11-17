// Random sheets against oracles that are plain JavaScript computed from the generator's own description:
// every value after every set, and exactly which formulas were evaluated.
import test from "node:test";
import assert from "node:assert/strict";
import { CellError, Sheet } from "../src/index.js";

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COLS = ["A", "B", "C", "D", "E"];
const ROWS = 6;
const ADDRS = COLS.flatMap((c) => Array.from({ length: ROWS }, (_, i) => `${c}${i + 1}`));
const show = (v) => (v instanceof CellError ? v.code : v);

/** A cell description: { kind: "num", n } | { kind: "f", op, a, b } (a, b: an address or a number) | { kind: "empty" }. */
function describeCell(rand, allowCycles, index) {
  const r = rand();
  if (r < 0.3) return { kind: "num", n: Math.floor(rand() * 10) - 3 };
  if (r < 0.34) return { kind: "empty" };
  const pickRef = () => {
    if (rand() < 0.2) return Math.floor(rand() * 5) + 1;
    const pool = allowCycles ? ADDRS : ADDRS.slice(0, Math.max(index, 1));
    return pool[Math.floor(rand() * pool.length)];
  };
  return { kind: "f", op: ["+", "-", "*"][Math.floor(rand() * 3)], a: pickRef(), b: pickRef() };
}

const inputOf = (d) => (d.kind === "num" ? d.n : d.kind === "empty" ? null : `=${d.a}${d.op}${d.b}`);
const refsOf = (d) => (d.kind === "f" ? [d.a, d.b].filter((x) => typeof x === "string") : []);

/** Values and the evaluated set, by brute force over the whole description. */
function oracle(cells, changed) {
  const reach = new Map(); // address -> the set of cells it reaches through references
  const reachOf = (start) => {
    const out = new Set();
    const stack = [...refsOf(cells[start])];
    while (stack.length) {
      const x = stack.pop();
      if (out.has(x)) continue;
      out.add(x);
      stack.push(...refsOf(cells[x]));
    }
    return out;
  };
  for (const a of ADDRS) reach.set(a, reachOf(a));
  const inCycle = (a) => reach.get(a).has(a);
  const memo = new Map();
  const value = (a) => {
    if (memo.has(a)) return memo.get(a);
    const d = cells[a];
    let v;
    if (inCycle(a)) v = "#CIRC!";
    else if (d.kind === "num") v = d.n;
    else if (d.kind === "empty") v = null;
    else {
      const x = typeof d.a === "number" ? d.a : value(d.a) ?? 0;
      const y = typeof d.b === "number" ? d.b : value(d.b) ?? 0;
      if (x === "#CIRC!" || y === "#CIRC!") v = "#CIRC!";
      else v = d.op === "+" ? x + y : d.op === "-" ? x - y : x * y;
      if (v === 0) v = 0;
    }
    memo.set(a, v);
    return v;
  };
  const values = Object.fromEntries(ADDRS.map((a) => [a, value(a)]));
  // evaluated: formulas, not in a cycle, that are the changed cell or reach it
  const evaluated = ADDRS.filter((a) => cells[a].kind === "f" && !inCycle(a) && (a === changed || reach.get(a).has(changed)));
  return { values, evaluated };
}

function run(seed, allowCycles, steps) {
  const rand = mulberry32(seed);
  const seen = [];
  const sheet = new Sheet({ onEvaluate: (a) => seen.push(a) });
  const cells = Object.fromEntries(ADDRS.map((a) => [a, { kind: "empty" }]));
  const order = [...ADDRS];
  for (let step = 0; step < steps; step++) {
    const addr = order[Math.floor(rand() * order.length)];
    const d = describeCell(rand, allowCycles, ADDRS.indexOf(addr));
    cells[addr] = d;
    seen.length = 0;
    sheet.set(addr, inputOf(d));
    const { values, evaluated } = oracle(cells, addr);
    for (const a of ADDRS) assert.deepStrictEqual(show(sheet.get(a)), a in values && values[a] === null ? null : values[a], `seed ${seed} step ${step} (set ${addr} ${JSON.stringify(inputOf(d))}): ${a}`);
    assert.deepEqual([...seen].sort(), [...evaluated].sort(), `seed ${seed} step ${step} (set ${addr}): the cells evaluated`);
    // each formula is evaluated after the cells it reads that were evaluated in the same set
    for (const a of seen) {
      for (const x of refsOf(cells[a])) {
        const ix = seen.indexOf(x);
        if (ix >= 0) assert.ok(ix < seen.indexOf(a), `seed ${seed} step ${step}: ${x} before ${a}`);
      }
    }
  }
}

test("random sheets without cycles: every value and exactly the dependents evaluated (150 sequences)", () => {
  for (let seed = 1; seed <= 150; seed++) run(seed, false, 60);
});

test("random sheets with cycles made and broken: every value and the cells evaluated (150 sequences)", () => {
  for (let seed = 1001; seed <= 1150; seed++) run(seed, true, 60);
});
