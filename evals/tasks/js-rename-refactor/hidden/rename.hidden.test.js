import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as strings from "../src/strings.js";
import { greet } from "../src/greet.js";
import { sentence, titleCase } from "../src/title.js";

test("hidden: behaviour unchanged", () => {
  assert.equal(greet("bo"), "Hello, Bo!");
  assert.equal(titleCase("a tale OF two"), "A Tale Of Two");
  assert.equal(sentence("done."), "Done.");
  assert.equal(strings.capitalize(""), "");
  assert.equal(strings.capitalize("x"), "X");
  assert.equal(strings.cap("yes"), "Yes");
});

test("hidden: renamed everywhere, alias kept", () => {
  for (const file of ["src/greet.js", "src/title.js"]) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /capitalize/, file);
    assert.doesNotMatch(source, /\bcap\b/, `${file} still uses cap`);
  }
  const lib = readFileSync("src/strings.js", "utf8");
  assert.match(lib, /@deprecated/);
  assert.match(lib, /function capitalize/);
});
