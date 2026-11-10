import assert from "node:assert/strict";
import { test } from "node:test";
import { render } from "../src/markdown.js";

test("paragraphs", () => {
  assert.equal(render("one\ntwo\n\nthree"), "<p>one two</p>\n<p>three</p>");
});
