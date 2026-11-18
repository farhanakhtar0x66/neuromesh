// [F120 lead] The lead's review answer, offline.
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseLead } from "../src/engine/prompts.ts";
import type { AgentResult } from "../src/backends/types.ts";

const answer = (structured: unknown): AgentResult => ({ stop: "done", finalText: "", structured }) as AgentResult;

test("the lead accepts, or hands follow-ups to the developers it names", () => {
  assert.equal(parseLead(answer({ decision: "accept", summary: "fine", followups: [] }), true, true).decision, "accept");
  const more = parseLead(answer({ decision: "more", summary: "x", followups: [
    { id: "a", title: "dB plus dB", brief: "make 3 dB + 3 dB give 6.0103 dB", owner: "senior" },
    { id: "b", title: "rename", brief: "rename it", owner: "grunt" },
    { id: "c", title: "the hard one", brief: "do it", owner: "expert" },
  ] }), true, true);
  assert.deepEqual(more.followups.map((f) => f.owner), ["senior", "grunt", "expert"]);
});

test("owners the preset lacks fall back, and in blueprint mode the expert builds nothing", () => {
  const f = [{ id: "a", title: "t", brief: "b", owner: "senior" }, { id: "b", title: "t", brief: "b", owner: "grunt" }, { id: "c", title: "t", brief: "b", owner: "expert" }];
  assert.deepEqual(parseLead(answer({ decision: "more", summary: "", followups: f }), false, false).followups.map((x) => x.owner), ["worker", "worker", "expert"]);
  assert.deepEqual(parseLead(answer({ decision: "more", summary: "", followups: f }), true, false, true).followups.map((x) => x.owner), ["senior", "worker", "senior"]);
});

test("an unusable review throws", () => {
  assert.throws(() => parseLead(answer({ decision: "maybe" }), true, true));
  assert.throws(() => parseLead(answer({ decision: "more", summary: "", followups: [] }), true, true));
});

import { parseCases, parseEvidence, parseRepoReport } from "../src/engine/prompts.ts";

test("the plan's cases, the report and the probes are read defensively", () => {
  assert.deepEqual(parseCases(answer({ summary: "", tasks: [], cases: ["3 dB + 3 dB gives 6.0103 dB", "", 4] })), ["3 dB + 3 dB gives 6.0103 dB"]);
  assert.deepEqual(parseCases(answer({ summary: "", tasks: [] })), []);
  assert.equal(parseRepoReport(answer({ report: "short" })), undefined);
  assert.ok(parseRepoReport(answer({ report: "The code is in pint/facets/plain/quantity.py, _add_sub at line 1100." })));
  assert.deepEqual(parseEvidence(answer({ evidence: [{ case: "a", command: " pytest -q t.py ", holds: true }, { case: "b", holds: false }] })), [{ case: "a", command: "pytest -q t.py" }, { case: "b", command: "" }]);
  assert.throws(() => parseEvidence(answer({ nothing: true })));
});
