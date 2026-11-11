import assert from "node:assert/strict";
import { test } from "node:test";
import { diffFrame, toCells } from "../src/tui/term.ts";
import { width } from "../src/tui/text.ts";

test("a line becomes exactly as many cells as the screen is wide, with wide characters taking two", () => {
  const cells = toCells("\x1b[32mok\x1b[39m 世", 8);
  assert.equal(cells.length, 8);
  assert.deepEqual(cells.slice(0, 5).map((c) => c.ch), ["o", "k", " ", "世", ""]);
  assert.notEqual(cells[0]!.style, cells[2]!.style, "colour is kept per cell");
  assert.equal(toCells("abcdef", 3).length, 3, "cut at the edge");
});

test("symbols such as the working glyphs are one cell, so the row never shifts as they change", () => {
  for (const g of ["✳", "✶", "✻", "✢", "✽", "✓", "◆", "⎿"]) assert.equal(width(g), 1, g);
  assert.equal(width("✳️"), 2, "unless asked for as an emoji");
});

test("redrawing writes only the cells that changed", () => {
  const before = [toCells("  ✶ Cooking…  3s", 40), toCells("unchanged row", 40)];
  const after = [toCells("  ✻ Cooking…  4s", 40), toCells("unchanged row", 40)];
  const out = diffFrame(before, after);
  assert.match(out, /\x1b\[1;3H/, "jumps to the glyph");
  assert.doesNotMatch(out, /Cooking/, "the word is not rewritten");
  assert.doesNotMatch(out, /\x1b\[2;/, "the other row is left alone");
  assert.equal(diffFrame(after, after), "", "nothing to do for the same frame");
  assert.match(diffFrame([], after), /Cooking[\s\S]*unchanged row/, "a first frame is drawn in full");
});
