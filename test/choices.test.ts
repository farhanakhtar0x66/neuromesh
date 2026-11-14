// F105 choices-shown (plan item D6): a developer's choices and open points are kept and shown whole.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { formatSummary } from "../src/cli/format.ts";
import { parseDirect, parseReport, directSchema, reportSchema } from "../src/engine/prompts.ts";
import type { RunState } from "../src/engine/types.ts";
import { disable, resetFeatures } from "../src/features.ts";

afterEach(() => resetFeatures());
const long = `no size cap; the request did not ask for one. ${"x".repeat(400)} END`;
const result = (structured: unknown) => ({ structured, finalText: "" }) as never;

test("F105: choices and open come through whole; empty ones are dropped", () => {
  const r = parseReport(result({ status: "done", summary: "s", notes: "", choices: long, open: "  ", run: "" }));
  assert.equal(r.choices, long);
  assert.equal(r.open, undefined);
  const d = parseDirect(result({ files: [{ path: "a.txt", content: "x" }], summary: "s", notes: "", choices: "one\ntwo", open: "q?", run: "" }));
  assert.equal(d?.report.choices, "one\ntwo");
  assert.equal(d?.report.open, "q?");
});

test("F105: the schemas ask for both fields, and ask for nothing new when switched off", () => {
  assert.ok(reportSchema().required.includes("choices") && reportSchema().required.includes("open"));
  assert.ok(directSchema().required.includes("choices"));
  disable("choices-shown");
  assert.ok(!reportSchema().required.includes("choices"));
  assert.equal(parseReport(result({ status: "done", summary: "s", notes: "", choices: "c", open: "o", run: "" })).choices, undefined);
});

test("F105: the summary prints the choices in full, notes still short", () => {
  const state = { id: "r", status: "done", prompt: "p", attempts: [], baseline: undefined, latest: undefined, tasks: [{ id: "t1", status: "merged", title: "t", report: { status: "done", summary: "built", notes: long, choices: long, open: "Should it be capped?" } }] } as unknown as RunState;
  const text = formatSummary(state);
  assert.match(text, /choices made:/);
  assert.ok(text.includes(long), "the whole text is shown");
  assert.match(text, /left open:\n\s+Should it be capped\?/);
  disable("choices-shown");
  assert.ok(!formatSummary(state).includes("choices made:"));
});
