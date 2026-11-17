import test from "node:test";
import assert from "node:assert/strict";
import { CellError, Sheet } from "../src/index.js";

test("a formula computes its value", () => {
  const s = new Sheet();
  s.set("A1", "=1+2*3");
  assert.equal(s.get("A1"), 7);
  assert.equal(s.input("A1"), "=1+2*3");
});

test("a formula reads other cells", () => {
  const s = new Sheet();
  s.set("A1", 5);
  s.set("A2", "=A1*2");
  assert.equal(s.get("A2"), 10);
});

test("changing a cell updates the cells that depend on it", () => {
  const s = new Sheet();
  s.set("A1", 5);
  s.set("A2", "=A1*2");
  s.set("A3", "=A2+1");
  s.set("A1", 10);
  assert.equal(s.get("A3"), 21);
});

test("SUM adds a range", () => {
  const s = new Sheet();
  s.set("A1", 1);
  s.set("A2", 2);
  s.set("A3", 3);
  s.set("B1", "=SUM(A1:A3)");
  assert.equal(s.get("B1"), 6);
});

test("dividing by zero is an error value", () => {
  const s = new Sheet();
  s.set("A1", "=1/0");
  assert.ok(s.get("A1") instanceof CellError);
  assert.equal(s.get("A1").code, "#DIV/0!");
});

test("onEvaluate is told about each formula that is evaluated", () => {
  const seen = [];
  const s = new Sheet({ onEvaluate: (a) => seen.push(a) });
  s.set("a1", 1);
  s.set("b1", "=A1+1");
  assert.deepEqual(seen, ["B1"]);
  s.set("A1", 2);
  assert.deepEqual(seen, ["B1", "B1"]);
});
