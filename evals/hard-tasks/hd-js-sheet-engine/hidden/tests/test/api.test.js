// The API, addresses, inputs and values (README.md: API, Addresses, Inputs, Values).
import test from "node:test";
import assert from "node:assert/strict";
import { CellError, Sheet } from "../src/index.js";

test("api: addresses of any case name the same cell, and the grid's corners are valid", () => {
  const s = new Sheet();
  s.set("a1", 1);
  s.set("ZZ100000", 2);
  s.set("zz1", 3);
  s.set("Ab7", 4);
  assert.equal(s.get("A1"), 1);
  assert.equal(s.get("zz100000"), 2);
  assert.equal(s.get("ZZ1"), 3);
  assert.equal(s.get("AB7"), 4);
});

test("api: an invalid address is a RangeError from set, get and input", () => {
  const s = new Sheet();
  for (const bad of ["A0", "A01", "AAA1", "A100001", "1A", "", "A1 ", " A1", "A", "12", "A-1", "A1:B2", null, undefined, 5, {}]) {
    assert.throws(() => s.set(bad, 1), RangeError, `set ${String(bad)}`);
    assert.throws(() => s.get(bad), RangeError, `get ${String(bad)}`);
    assert.throws(() => s.input(bad), RangeError, `input ${String(bad)}`);
  }
});

test("api: an invalid input is a TypeError and changes nothing", () => {
  const s = new Sheet();
  s.set("A1", 5);
  for (const bad of [true, false, {}, [], NaN, Infinity, -Infinity, () => 1, Symbol("x"), 10n]) {
    assert.throws(() => s.set("A1", bad), TypeError, String(typeof bad));
  }
  assert.equal(s.get("A1"), 5);
  assert.equal(s.input("A1"), 5);
});

test("api: a call that throws leaves the sheet and the hook alone", () => {
  const seen = [];
  const s = new Sheet({ onEvaluate: (a) => seen.push(a) });
  s.set("A1", 1);
  s.set("B1", "=A1+1");
  seen.length = 0;
  assert.throws(() => s.set("A1", true), TypeError);
  assert.throws(() => s.set("A0", 1), RangeError);
  assert.deepEqual(seen, []);
  assert.equal(s.get("B1"), 2);
});

test("api: null, undefined and the empty string empty a cell", () => {
  const s = new Sheet();
  for (const empty of [null, undefined, ""]) {
    s.set("A1", 9);
    s.set("A1", empty);
    assert.equal(s.get("A1"), null);
    assert.equal(s.input("A1"), null);
  }
  assert.equal(s.get("Q9"), null);
  assert.equal(s.input("Q9"), null);
});

test("api: strings that are number literals are numbers, the rest is text kept as given", () => {
  const s = new Sheet();
  const numbers = [["42", 42], [" 42 ", 42], ["-1.5e3", -1500], [".5", 0.5], ["5.", 5], ["+7", 7], ["1E2", 100], ["007", 7], ["\t3\t", 3], ["-.5e-1", -0.05]];
  for (const [text, n] of numbers) {
    s.set("A1", text);
    assert.equal(s.get("A1"), n, JSON.stringify(text));
    assert.equal(s.input("A1"), text);
  }
  const texts = ["1,000", "0x10", "Infinity", "1e999", "--5", "5 5", "five", "TRUE", "#DIV/0!", " hello ", "'5", "1/2", "$5", "5%", "e5", "."];
  for (const text of texts) {
    s.set("A1", text);
    assert.strictEqual(s.get("A1"), text, JSON.stringify(text));
    assert.ok(!(s.get("A1") instanceof CellError));
  }
});

test("api: negative zero is never reported", () => {
  const s = new Sheet();
  s.set("A1", -0);
  assert.ok(Object.is(s.get("A1"), 0));
  s.set("A2", "-0");
  assert.ok(Object.is(s.get("A2"), 0));
  s.set("A3", "=A1*-1");
  assert.ok(Object.is(s.get("A3"), 0));
});

test("api: input() gives back what was set, a formula with its equals sign", () => {
  const s = new Sheet();
  s.set("A1", 0);
  s.set("A2", "=a1 + 1");
  s.set("A3", "=");
  assert.equal(s.input("A1"), 0);
  assert.equal(s.input("A2"), "=a1 + 1");
  assert.equal(s.input("A3"), "=");
});

test("api: an error value is a CellError with a code and prints as its code", () => {
  const s = new Sheet();
  s.set("A1", "=1/0");
  const e = s.get("A1");
  assert.ok(e instanceof CellError);
  assert.equal(e.code, "#DIV/0!");
  assert.equal(String(e), "#DIV/0!");
  assert.equal(`${new CellError("#CIRC!")}`, "#CIRC!");
});

test("api: a formula never reports an empty value", () => {
  const s = new Sheet();
  s.set("A1", "=B1");
  assert.strictEqual(s.get("A1"), 0);
  assert.equal(s.get("B1"), null);
});

test("api: emptying a cell turns its dependents' view of it into zero or empty text", () => {
  const s = new Sheet();
  s.set("A1", 5);
  s.set("B1", "=A1+1");
  s.set("C1", '=A1&"!"');
  s.set("A1", null);
  assert.equal(s.get("B1"), 1);
  assert.equal(s.get("C1"), "!");
});

test("api: a non-formula string starting with a space or a quote is text", () => {
  const s = new Sheet();
  s.set("A1", " =1+1");
  assert.strictEqual(s.get("A1"), " =1+1");
});

test("api: a lone equals sign is a formula that does not parse", () => {
  const s = new Sheet();
  s.set("A1", "=");
  assert.equal(show(s.get("A1")), "#VALUE!");
});

function show(v) {
  return v instanceof CellError ? v.code : v;
}
