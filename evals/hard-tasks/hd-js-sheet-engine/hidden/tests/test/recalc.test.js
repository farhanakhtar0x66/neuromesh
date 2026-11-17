// Recalculation: what is evaluated, how often, in what order; cycles (README.md: Recalculation).
import test from "node:test";
import assert from "node:assert/strict";
import { CellError, Sheet } from "../src/index.js";

const show = (v) => (v instanceof CellError ? v.code : v);

function rig() {
  const seen = [];
  const sheet = new Sheet({ onEvaluate: (a) => seen.push(a) });
  return {
    sheet,
    seen,
    /** the cells evaluated since the last call, then forget them */
    take() {
      const out = [...seen];
      seen.length = 0;
      return out;
    },
  };
}

const sorted = (xs) => [...xs].sort();

test("recalc: a diamond is evaluated once per cell, each after the cells it reads", () => {
  const r = rig();
  r.sheet.set("A1", 1);
  r.sheet.set("B1", "=A1+1");
  r.sheet.set("C1", "=A1+2");
  r.sheet.set("D1", "=B1+C1");
  r.take();
  r.sheet.set("A1", 10);
  const order = r.take();
  assert.deepEqual(sorted(order), ["B1", "C1", "D1"]);
  assert.ok(order.indexOf("D1") > order.indexOf("B1") && order.indexOf("D1") > order.indexOf("C1"));
  assert.equal(r.sheet.get("D1"), 23);
});

test("recalc: a formula that is set is evaluated, a constant is not, and a new cell has no dependents yet", () => {
  const r = rig();
  r.sheet.set("A1", 1);
  assert.deepEqual(r.take(), []);
  r.sheet.set("B1", "=A1+1");
  assert.deepEqual(r.take(), ["B1"]);
  r.sheet.set("B1", 5);
  assert.deepEqual(r.take(), []);
});

test("recalc: only the cells that depend on the changed cell are evaluated", () => {
  const r = rig();
  r.sheet.set("A1", 1);
  r.sheet.set("A2", 2);
  r.sheet.set("B1", "=A1*2");
  r.sheet.set("B2", "=A2*2");
  r.sheet.set("C1", "=B1+1");
  r.take();
  r.sheet.set("A2", 5);
  assert.deepEqual(r.take(), ["B2"]);
  r.sheet.set("A1", 5);
  assert.deepEqual(sorted(r.take()), ["B1", "C1"]);
});

test("recalc: there is no cut-off when a value does not change, and setting the same input again recalculates", () => {
  const r = rig();
  r.sheet.set("A1", 5);
  r.sheet.set("B1", "=A1*0");
  r.sheet.set("C1", "=B1+1");
  r.take();
  r.sheet.set("A1", 6);
  assert.deepEqual(sorted(r.take()), ["B1", "C1"]);
  r.sheet.set("A1", 6);
  assert.deepEqual(sorted(r.take()), ["B1", "C1"]);
  r.sheet.set("B1", "=A1*0");
  assert.deepEqual(sorted(r.take()), ["B1", "C1"]);
});

test("recalc: a formula that names an empty cell is recalculated when the cell is set", () => {
  const r = rig();
  r.sheet.set("B1", "=A1+1");
  assert.equal(r.sheet.get("B1"), 1);
  r.take();
  r.sheet.set("A1", 4);
  assert.deepEqual(r.take(), ["B1"]);
  assert.equal(r.sheet.get("B1"), 5);
  r.sheet.set("A1", null);
  assert.deepEqual(r.take(), ["B1"]);
  assert.equal(r.sheet.get("B1"), 1);
});

test("recalc: overwriting a formula drops its dependencies", () => {
  const r = rig();
  r.sheet.set("A1", 1);
  r.sheet.set("A2", 2);
  r.sheet.set("B1", "=A1");
  r.sheet.set("B1", "=A2");
  r.take();
  r.sheet.set("A1", 9);
  assert.deepEqual(r.take(), []);
  r.sheet.set("A2", 9);
  assert.deepEqual(r.take(), ["B1"]);
  r.sheet.set("B1", 7);
  r.sheet.set("A2", 10);
  assert.deepEqual(r.take(), []);
  assert.equal(r.sheet.get("B1"), 7);
});

test("recalc: a range makes a formula depend on every cell in it, and only on those", () => {
  const r = rig();
  r.sheet.set("B1", "=SUM(A1:A3)");
  r.take();
  r.sheet.set("A2", 5);
  assert.deepEqual(r.take(), ["B1"]);
  r.sheet.set("A4", 5);
  assert.deepEqual(r.take(), []);
  r.sheet.set("A1", 1);
  assert.deepEqual(r.take(), ["B1"]);
  assert.equal(r.sheet.get("B1"), 6);
});

test("recalc: a two-dimensional range, written either way round", () => {
  const r = rig();
  r.sheet.set("E1", "=SUM(C3:B2)");
  r.take();
  for (const cell of ["B2", "C2", "B3", "C3"]) {
    r.sheet.set(cell, 1);
    assert.deepEqual(r.take(), ["E1"], cell);
  }
  r.sheet.set("D2", 1);
  r.sheet.set("B4", 1);
  assert.deepEqual(r.take(), []);
  assert.equal(r.sheet.get("E1"), 4);
});

test("recalc: the branch IF does not take is still a dependency", () => {
  const r = rig();
  r.sheet.set("A1", 1);
  r.sheet.set("A3", 3);
  r.sheet.set("B1", "=IF(A1,2,A3)");
  r.take();
  r.sheet.set("A3", 4);
  assert.deepEqual(r.take(), ["B1"]);
  assert.equal(r.sheet.get("B1"), 2);
});

test("recalc: the arguments of an unknown function are dependencies too", () => {
  const r = rig();
  r.sheet.set("B1", "=FOO(A1)");
  assert.equal(show(r.sheet.get("B1")), "#NAME?");
  r.take();
  r.sheet.set("A1", 1);
  assert.deepEqual(r.take(), ["B1"]);
});

test("recalc: a formula that does not parse is not evaluated and depends on nothing", () => {
  const r = rig();
  r.sheet.set("B1", "=A1+");
  r.sheet.set("C1", "=(A1");
  assert.deepEqual(r.take(), []);
  assert.equal(show(r.sheet.get("B1")), "#VALUE!");
  r.sheet.set("A1", 1);
  assert.deepEqual(r.take(), []);
  r.sheet.set("B1", "=A1+1");
  assert.deepEqual(r.take(), ["B1"]);
});

test("recalc: a dependent of a dependent of an empty cell, three levels, in order", () => {
  const r = rig();
  r.sheet.set("C1", "=B1*2");
  r.sheet.set("B1", "=A1+1");
  r.sheet.set("D1", "=C1+B1");
  r.take();
  r.sheet.set("A1", 3);
  const order = r.take();
  assert.deepEqual(order, ["B1", "C1", "D1"]);
  assert.equal(r.sheet.get("D1"), 12);
});

test("recalc: the hook gets the upper-case address, only from set, once per evaluation", () => {
  const r = rig();
  r.sheet.set("b1", "=a1");
  assert.deepEqual(r.take(), ["B1"]);
  r.sheet.get("B1");
  r.sheet.input("B1");
  assert.deepEqual(r.take(), []);
});

test("recalc: a formula whose value is an error is still evaluated each time", () => {
  const r = rig();
  r.sheet.set("A1", 0);
  r.sheet.set("B1", "=1/A1");
  assert.equal(show(r.sheet.get("B1")), "#DIV/0!");
  r.take();
  r.sheet.set("A1", 4);
  assert.deepEqual(r.take(), ["B1"]);
  assert.equal(r.sheet.get("B1"), 0.25);
});

test("recalc: errors propagate along a chain and clear when the source is fixed", () => {
  const r = rig();
  r.sheet.set("A1", "=1/0");
  r.sheet.set("A2", "=A1+1");
  r.sheet.set("A3", "=A2*2");
  assert.equal(show(r.sheet.get("A3")), "#DIV/0!");
  r.sheet.set("A1", 1);
  assert.equal(r.sheet.get("A3"), 4);
});

// ---- cycles ----

test("cycle: a cell that names itself is #CIRC!", () => {
  const r = rig();
  r.sheet.set("A1", "=A1");
  assert.equal(show(r.sheet.get("A1")), "#CIRC!");
  r.sheet.set("A2", "=A2+1");
  assert.equal(show(r.sheet.get("A2")), "#CIRC!");
  assert.deepEqual(r.take(), []);
});

test("cycle: every cell of a cycle shows #CIRC!, and none of them is evaluated", () => {
  const r = rig();
  r.sheet.set("A1", "=B1");
  r.sheet.set("B1", "=C1");
  assert.deepEqual(r.take(), ["A1", "B1", "A1"]); // setting B1 recalculates A1, which reads it
  r.sheet.set("C1", "=A1");
  assert.deepEqual(r.take(), []);
  for (const c of ["A1", "B1", "C1"]) assert.equal(show(r.sheet.get(c)), "#CIRC!", c);
});

test("cycle: a cell that only depends on a cycle is evaluated and ends up #CIRC!", () => {
  const r = rig();
  r.sheet.set("A1", "=B1");
  r.sheet.set("B1", "=A1");
  r.sheet.set("C1", "=A1+1");
  r.sheet.set("D1", "=C1*2");
  assert.equal(show(r.sheet.get("C1")), "#CIRC!");
  assert.equal(show(r.sheet.get("D1")), "#CIRC!");
  r.take();
  r.sheet.set("A1", "=B1");
  assert.deepEqual(r.take(), ["C1", "D1"]);
});

test("cycle: making a cycle updates the cells downstream of it", () => {
  const r = rig();
  r.sheet.set("A1", 1);
  r.sheet.set("B1", "=A1+1");
  r.sheet.set("C1", "=B1+1");
  assert.equal(r.sheet.get("C1"), 3);
  r.take();
  r.sheet.set("A1", "=C1");
  assert.deepEqual(r.take(), []);
  for (const c of ["A1", "B1", "C1"]) assert.equal(show(r.sheet.get(c)), "#CIRC!");
});

test("cycle: breaking a cycle leaves no stale #CIRC! behind", () => {
  const r = rig();
  r.sheet.set("A1", "=B1");
  r.sheet.set("B1", "=C1");
  r.sheet.set("C1", "=A1");
  r.sheet.set("D1", "=B1+1");
  r.take();
  r.sheet.set("C1", 7);
  assert.deepEqual(sorted(r.take()), ["A1", "B1", "D1"]);
  assert.equal(r.sheet.get("A1"), 7);
  assert.equal(r.sheet.get("B1"), 7);
  assert.equal(r.sheet.get("D1"), 8);
  assert.equal(r.sheet.get("C1"), 7);
});

test("cycle: breaking a two-cell cycle by emptying one of them", () => {
  const r = rig();
  r.sheet.set("A1", "=B1");
  r.sheet.set("B1", "=A1");
  r.sheet.set("B1", null);
  assert.strictEqual(r.sheet.get("A1"), 0);
  assert.equal(r.sheet.get("B1"), null);
});

test("cycle: a cycle can be made, broken and made again", () => {
  const r = rig();
  for (let round = 0; round < 3; round++) {
    r.sheet.set("A1", "=B1+1");
    r.sheet.set("B1", "=A1+1");
    assert.equal(show(r.sheet.get("A1")), "#CIRC!");
    r.sheet.set("B1", round);
    assert.equal(r.sheet.get("A1"), round + 1);
  }
});

test("cycle: cycles are found on the references as written, whatever IF would do", () => {
  const r = rig();
  r.sheet.set("A1", "=IF(TRUE,1,A1)");
  assert.equal(show(r.sheet.get("A1")), "#CIRC!");
  r.sheet.set("B1", "=IF(TRUE,1,C1)");
  r.sheet.set("C1", "=B1");
  assert.equal(show(r.sheet.get("B1")), "#CIRC!");
  assert.equal(show(r.sheet.get("C1")), "#CIRC!");
});

test("cycle: a formula whose IF skips a cycle cell still depends on it and may ignore its error", () => {
  const r = rig();
  r.sheet.set("A1", "=A1");
  r.sheet.set("B1", "=IF(TRUE,5,A1)");
  assert.equal(r.sheet.get("B1"), 5);
});

test("cycle: a range that contains the cell itself is a cycle", () => {
  const r = rig();
  r.sheet.set("A1", 1);
  r.sheet.set("A3", "=SUM(A1:A5)");
  assert.equal(show(r.sheet.get("A3")), "#CIRC!");
  assert.equal(r.sheet.get("A1"), 1);
});

test("cycle: two separate cycles, one broken, the other stays", () => {
  const r = rig();
  r.sheet.set("A1", "=A2");
  r.sheet.set("A2", "=A1");
  r.sheet.set("B1", "=B2");
  r.sheet.set("B2", "=B1");
  r.sheet.set("A2", 1);
  assert.equal(r.sheet.get("A1"), 1);
  assert.equal(show(r.sheet.get("B1")), "#CIRC!");
  assert.equal(show(r.sheet.get("B2")), "#CIRC!");
});

test("cycle: a cell that reads a cycle through two routes is evaluated once", () => {
  const r = rig();
  r.sheet.set("A1", "=B1");
  r.sheet.set("B1", "=A1");
  r.sheet.set("C1", "=A1");
  r.sheet.set("D1", "=A1+C1+B1");
  r.take();
  r.sheet.set("B1", "=A1");
  assert.deepEqual(sorted(r.take()), ["C1", "D1"]);
});
