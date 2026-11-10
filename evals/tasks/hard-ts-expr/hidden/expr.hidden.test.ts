import assert from "node:assert/strict";
import { test } from "node:test";
import { ExprError, evaluate } from "../src/expr.ts";

test("hidden: values", () => {
  const cases: [string, number, Record<string, number>?][] = [
    ["1 + 2 * 3", 7],
    ["(1 + 2) * 3", 9],
    ["10 - 4 - 3", 3],
    ["100 / 10 / 5", 2],
    ["7 % 4 * 2", 6],
    ["2^3^2", 512],
    ["-2^2", -4],
    ["(-2)^2", 4],
    ["2^-1", 0.5],
    ["--3", 3],
    ["-+-3", 3],
    ["2 * -3", -6],
    [".5 + 2.25", 2.75],
    ["  1+  ( 2 )  ", 3],
    ["x * y + z", 14, { x: 3, y: 4, z: 2 }],
    ["min(5, 2, 8) + max(1, -1)", 3],
    ["max(3)", 3],
    ["abs(-4) + sqrt(16)", 8],
    ["min(abs(-3), 2^2) * 2", 6],
    ["rate * 2", 3, { rate: 1.5 }],
    ["_a1 + 1", 2, { _a1: 1 }],
  ];
  for (const [src, want, vars] of cases) assert.equal(evaluate(src, vars), want, src);
});

function fails(src: string, message: string, position: number, vars?: Record<string, number>) {
  try {
    evaluate(src, vars);
  } catch (e) {
    assert.ok(e instanceof ExprError, `${src}: not an ExprError`);
    assert.ok(e instanceof Error);
    assert.equal(e.message, message, src);
    assert.equal(e.position, position, src);
    return;
  }
  assert.fail(`${src} did not throw`);
}

test("hidden: errors and positions", () => {
  fails("2 *", "Unexpected end of input at 3", 3);
  fails("(1 + 2", "Unexpected end of input at 6", 6);
  fails("", "Unexpected end of input at 0", 0);
  fails("1 + )", "Unexpected token ')' at 4", 4);
  fails("3 4", "Unexpected token '4' at 2", 2);
  fails("1 + 2)", "Unexpected token ')' at 5", 5);
  fails("1 $ 2", "Unexpected token '$' at 2", 2);
  fails("foo + 1", "Unknown variable 'foo' at 0", 0);
  fails("2 * bar(1)", "Unknown function 'bar' at 4", 4);
  fails("max()", "Wrong number of arguments for max at 0", 0);
  fails("1 + abs(1, 2)", "Wrong number of arguments for abs at 4", 4);
  fails("10 / (5 - 5)", "Division by zero at 3", 3);
  fails("4 % 0", "Division by zero at 2", 2);
  fails("x / y", "Division by zero at 2", 2, { x: 1, y: 0 });
});
