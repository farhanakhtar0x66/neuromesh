// F109: which requests a worker answers in one call with no tools. No model calls.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { MAX_NAMED_FILES, MAX_WORDS, selfContained } from "../src/routing/selfcontained.ts";

const none: { path: string; content: string }[] = [];
const code = [{ path: "app.py", content: "print('hi')\n" }];

test("F109: a short request that names its file is self-contained; the benchmark's small prompts are", () => {
  assert.equal(selfContained("write a python function that parses a duration like 1h30m into seconds. Write it to duration.py", none).ok, true);
  const bench = (slug: string): string => readFileSync(new URL(`../evals/routing-bench/tasks/${slug}/prompt.md`, import.meta.url), "utf8");
  for (const slug of ["t21-hmac-webhook", "t23-gst-tests", "t31-abort-hook", "t51-regex-bomb"]) assert.equal(selfContained(bench(slug), none).ok, true, slug);
});

test("F109: a request with no file named and no code to change is not", () => {
  assert.equal(selfContained("make it better", none).ok, false);
  assert.equal(selfContained("make the login faster", code).ok, true, "there is code to change");
});

test("F109: things that need the tools, or a judgement, are not", () => {
  const cases: [string, RegExp][] = [
    ["write notes.py, then run it and show me the output", /run, installed or looked at/],
    ["fix the failing test in app.py", /run, installed or looked at/],
    ["write sort.py that sorts a list in O(N) worst-case time", /explanation, a derivation or a decision/],
    ["explain why app.py is slow and fix it", /explanation, a derivation or a decision/],
    ["derive the optimal interval and write sim.py", /explanation, a derivation or a decision/],
  ];
  for (const [request, why] of cases) {
    const v = selfContained(request, code);
    assert.equal(v.ok, false, request);
    assert.match(v.reasons[0]!, why, request);
  }
});

test("F109: a long request, many named files, or a big project are not", () => {
  assert.equal(selfContained(`write a.py ${"word ".repeat(MAX_WORDS)}`, none).ok, false);
  assert.equal(selfContained("write a.py, b.py and c.py that call each other", none).ok, false);
  assert.ok(MAX_NAMED_FILES >= 1);
  assert.equal(selfContained("write a.py", [{ path: "big.py", content: "x".repeat(20_000) }]).ok, false);
});

test("F109: words in pasted material are not read as the instruction", () => {
  const request = "turn these notes into notes.md:\n'we should debug the docker install and run it in production'";
  assert.equal(selfContained(request, none).ok, true);
});
