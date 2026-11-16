// F110 structured-rescue: a report the tool could not format is taken from its last attempt, and the schemas ask for less.
// No model calls.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { claudeParser } from "../src/backends/claude.ts";
import { blindSchema, directSchema, parseDirect, parseReport, reportSchema, rescueStructured, VERDICT_SCHEMA } from "../src/engine/prompts.ts";
import { disable, resetFeatures } from "../src/features.ts";
import type { AgentResult } from "../src/backends/types.ts";

afterEach(() => {
  resetFeatures();
  delete process.env.NEUROMESH_FAULT;
});

const failed = (lastStructured: Record<string, unknown> | undefined, detail = "error_max_structured_output_retries"): AgentResult =>
  ({ stop: "error", finalText: "", usage: {}, durationMs: 1, exitCode: 1, detail, lastStructured }) as AgentResult;

test("F110: the report, one-answer and blind-test schemas require only what an answer cannot do without; the verdict is unchanged", () => {
  assert.deepEqual(reportSchema().required, ["status", "summary"]);
  assert.deepEqual(directSchema().required, ["files", "summary"]);
  assert.deepEqual(blindSchema().properties.tests.items.required, ["path", "content"]);
  // The fields are still in the schemas, so the model is still asked for them.
  assert.ok(["notes", "run", "choices", "open"].every((k) => k in reportSchema().properties));
  assert.ok(["notes", "run", "choices", "open"].every((k) => k in directSchema().properties));
  assert.ok(["open", "question"].every((k) => k in blindSchema().properties.tests.items.properties));
  assert.deepEqual(VERDICT_SCHEMA.properties.findings.items.required, ["problem", "file", "reproduce", "severity", "check"]);
  assert.deepEqual(VERDICT_SCHEMA.required, ["verdict", "summary", "findings"]);
});

test("F110: switched off, every field is required as before", () => {
  disable("structured-rescue");
  assert.deepEqual(reportSchema().required, ["status", "summary", "notes", "run", "choices", "open"]);
  assert.deepEqual(directSchema().required, ["files", "summary", "notes", "run", "choices", "open"]);
  assert.deepEqual(blindSchema().properties.tests.items.required, ["path", "content", "open", "question"]);
});

test("F110: a report's last attempt with a summary is the answer; the fields it left out are named; unknown keys are dropped", () => {
  const r = rescueStructured(reportSchema() as unknown as Record<string, unknown>, failed({ status: "done", summary: "Fixed it.", notes: "n", surprise: "x" }));
  assert.deepEqual(r?.structured, { status: "done", summary: "Fixed it.", notes: "n" });
  assert.deepEqual(r?.missing.sort(), ["choices", "open", "run"]);
  // The engine reads it as an ordinary report.
  const report = parseReport({ ...failed(undefined), stop: "done", structured: r!.structured });
  assert.equal(report.status, "done");
  assert.equal(report.summary, "Fixed it.");
});

test("F110: a one-answer turn's last attempt is taken when it has a usable file; keys inside the files are dropped", () => {
  const schema = directSchema() as unknown as Record<string, unknown>;
  const r = rescueStructured(schema, failed({ files: [{ path: "a.txt", content: "A", mode: "755" }, { path: 3 }], summary: "wrote it" }));
  assert.deepEqual(r?.structured.files, [{ path: "a.txt", content: "A" }, { path: 3, content: undefined }]);
  assert.equal(parseDirect({ ...failed(undefined), stop: "done", structured: r!.structured })?.files.length, 1);
  assert.equal(rescueStructured(schema, failed({ files: [], summary: "nothing" })), undefined, "no file, no answer");
  assert.equal(rescueStructured(schema, failed({ files: [{ path: 3 }], summary: "x" })), undefined, "no usable file");
});

test("F110: it is not rescued without a summary, for another schema, for another failure, with no attempt, or when switched off", () => {
  const report = reportSchema() as unknown as Record<string, unknown>;
  assert.equal(rescueStructured(report, failed({ status: "done" })), undefined, "no summary");
  assert.equal(rescueStructured(report, failed({ status: "done", summary: "  " })), undefined, "a blank summary");
  assert.equal(rescueStructured(report, failed(undefined)), undefined, "no attempt was seen");
  assert.equal(rescueStructured(report, failed({ status: "done", summary: "s" }, "boom")), undefined, "another failure");
  assert.equal(rescueStructured(report, { ...failed({ status: "done", summary: "s" }), stop: "quota" }), undefined, "another stop");
  assert.equal(rescueStructured(VERDICT_SCHEMA as unknown as Record<string, unknown>, failed({ verdict: "pass", summary: "s", findings: [] })), undefined, "a verdict is not rescued");
  assert.equal(rescueStructured(blindSchema() as unknown as Record<string, unknown>, failed({ tests: [{ path: "a", content: "b" }], summary: "s" })), undefined, "blind tests are not rescued");
  disable("structured-rescue");
  assert.equal(rescueStructured(report, failed({ status: "done", summary: "s" })), undefined, "switched off");
});

test("F110: the Claude adapter keeps the last StructuredOutput input, and still reports the turn as an error", () => {
  const parser = claudeParser({});
  const events = [
    { type: "system", subtype: "init", session_id: "s1", model: "claude-haiku-5-5" },
    { type: "assistant", message: { id: "m1", content: [{ type: "tool_use", id: "t1", name: "StructuredOutput", input: { status: "done", summary: "first try" } }] } },
    { type: "assistant", message: { id: "m2", content: [{ type: "tool_use", id: "t2", name: "Bash", input: { command: "ls" } }] } },
    { type: "assistant", message: { id: "m3", content: [{ type: "tool_use", id: "t3", name: "StructuredOutput", input: { status: "done", summary: "last try", notes: "" } }] } },
    { type: "result", subtype: "error_max_structured_output_retries", is_error: true, session_id: "s1", result: "", usage: { input_tokens: 1, output_tokens: 2 } },
  ];
  for (const e of events) parser.onEvent(e as Record<string, unknown>);
  const run = parser.result();
  assert.deepEqual(run.lastStructured, { status: "done", summary: "last try", notes: "" });
  assert.equal(run.stop, "error");
  assert.match(run.detail ?? "", /error_max_structured_output_retries/);
  assert.equal(run.structured, undefined);
  // Not kept when the feature is off.
  disable("structured-rescue");
  const off = claudeParser({});
  for (const e of events) off.onEvent(e as Record<string, unknown>);
  assert.equal(off.result().lastStructured, undefined);
});
