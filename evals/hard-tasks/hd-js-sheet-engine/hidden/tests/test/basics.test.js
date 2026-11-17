import test from "node:test";
import assert from "node:assert/strict";
import { CellError, Sheet } from "../src/index.js";

test("a number is stored and read back", () => {
  const s = new Sheet();
  s.set("A1", 42);
  assert.equal(s.get("A1"), 42);
  assert.equal(s.input("A1"), 42);
});

test("text is stored as it is", () => {
  const s = new Sheet();
  s.set("B2", "  hello ");
  assert.equal(s.get("B2"), "  hello ");
});

test("a string that is a number literal becomes a number", () => {
  const s = new Sheet();
  s.set("A1", " -1.5e3 ");
  assert.equal(s.get("A1"), -1500);
  assert.equal(s.input("A1"), " -1.5e3 ");
});

test("an empty cell is null, and a cell can be emptied", () => {
  const s = new Sheet();
  assert.equal(s.get("C3"), null);
  s.set("C3", 1);
  s.set("C3", null);
  assert.equal(s.get("C3"), null);
  assert.equal(s.input("C3"), null);
});

test("addresses are case-insensitive", () => {
  const s = new Sheet();
  s.set("a1", 7);
  assert.equal(s.get("A1"), 7);
});

test("a bad address is a RangeError and a bad input a TypeError", () => {
  const s = new Sheet();
  assert.throws(() => s.set("A0", 1), RangeError);
  assert.throws(() => s.get("nope"), RangeError);
  assert.throws(() => s.set("A1", true), TypeError);
  assert.throws(() => s.set("A1", Number.NaN), TypeError);
});

test("CellError carries its code", () => {
  const e = new CellError("#DIV/0!");
  assert.equal(e.code, "#DIV/0!");
  assert.equal(String(e), "#DIV/0!");
  assert.throws(() => new CellError("#NOPE!"), RangeError);
});
