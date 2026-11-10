import assert from "node:assert/strict";
import { test } from "node:test";
import { greet } from "../src/greet.js";
import { titleCase, sentence } from "../src/title.js";

test("greet", () => assert.equal(greet("ana"), "Hello, Ana!"));
test("titleCase", () => assert.equal(titleCase("the GREAT gatsby"), "The Great Gatsby"));
test("sentence", () => assert.equal(sentence(" hello world "), "Hello world."));
