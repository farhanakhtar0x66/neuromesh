import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { opencodeArgs, opencodeParser, opencodePrompt } from "../src/backends/opencode.ts";
import type { RunState } from "../src/engine/types.ts";
import { listPresets } from "../src/presets/presets.ts";
import { allowed, flush, outbox, queue, ratingReport, runReport } from "../src/telemetry/telemetry.ts";
import { FAVOURITES, modelChoices, teamPreset, teamProblem } from "../src/tui/team.ts";
import type { UsageEntry } from "../src/usage/log.ts";

test("opencode: arguments for read-only and write turns, the schema in the prompt, and its events read", () => {
  const base = { cwd: "/w", prompt: "do it", timeoutMs: 1 };
  assert.deepEqual(opencodeArgs({ ...base, access: "write", model: "opencode/big-pickle" }), ["run", "--format", "json", "--model", "opencode/big-pickle", "--auto"]);
  assert.deepEqual(opencodeArgs({ ...base, access: "read-only", model: "nvidia/x", effort: "high", resumeSessionId: "ses_1" }), ["run", "--format", "json", "--model", "nvidia/x#high", "--agent", "plan", "--session", "ses_1"]);
  assert.match(opencodePrompt({ ...base, access: "write", outputSchema: { type: "object" } }), /only a JSON object[\s\S]*\{"type":"object"\}/);
  const seen: string[] = [];
  const p = opencodeParser({ outputSchema: { type: "object" }, onActivity: (a) => seen.push(a.summary) });
  // Events as opencode 2.2.5 printed them.
  p.onEvent({ type: "step_start", sessionID: "ses_9", part: {} });
  p.onEvent({ type: "tool_use", sessionID: "ses_9", part: { tool: "write", state: { input: { path: "ok.txt" } } } });
  p.onEvent({ type: "step_finish", sessionID: "ses_9", part: { reason: "tool-calls", cost: 0.01, tokens: { input: 5927, output: 95, reasoning: 3, cache: { read: 1664, write: 0 } } } });
  p.onEvent({ type: "text", sessionID: "ses_9", part: { text: '{"status":"done","summary":"wrote ok.txt"}' } });
  p.onEvent({ type: "step_finish", sessionID: "ses_9", part: { reason: "stop", cost: 0.002, tokens: { input: 155, output: 2, reasoning: 0, cache: { read: 7552, write: 0 } } } });
  assert.equal(p.finished?.(), true);
  const r = p.result();
  assert.equal(r.stop, "done");
  assert.equal(r.sessionId, "ses_9");
  assert.deepEqual(r.usage, { input: 6082, output: 97, reasoning: 3, cacheRead: 9216, cacheWrite: 0 });
  assert.ok(Math.abs((r.costUsdEquivalent ?? 0) - 0.012) < 1e-9, "what the provider charged, as reported");
  assert.deepEqual(r.structured, { status: "done", summary: "wrote ok.txt" });
  assert.match(seen[0]!, /^write /);
});

test("teams: two favourites ship; a custom team needs someone to build, and becomes a preset", () => {
  const names = listPresets().map((p) => p.name);
  for (const f of FAVOURITES) assert.ok(names.includes(f), f);
  const sol = listPresets().find((p) => p.name === "factory-sol-flash")!;
  assert.deepEqual([sol.roles.orchestrator?.[0]?.model, sol.roles.orchestrator?.[0]?.effort, sol.roles.worker?.[0]?.model], ["gpt-6.1-sol", "high", "gemini-3.8-flash-high"]);

  assert.match(teamProblem({ expert: "none", worker: "none", tester: "none" }) ?? "", /at least one/);
  assert.match(teamProblem({ expert: "none", worker: "none", tester: "codex/gpt-6-luna#high" }) ?? "", /tester alone/);
  assert.equal(teamProblem({ expert: "claude/claude-opus-5-5#medium", worker: "none", tester: "none" }), undefined);

  const all = modelChoices([{ id: "opencode/nvidia/x", label: "nvidia/x", detail: "opencode", config: { backend: "opencode", model: "nvidia/x" } }]);
  const full = teamPreset({ expert: "claude/claude-opus-5-5#medium", worker: "opencode/nvidia/x", tester: "none" }, all);
  assert.equal(full.mode, "team");
  assert.deepEqual(full.roles.worker, [{ backend: "opencode", model: "nvidia/x" }]);
  assert.equal(full.roles.orchestrator?.[0]?.tier, "expert");
  assert.equal(full.roles.tester, undefined, "no tester: the checks alone judge");
  const expertOnly = teamPreset({ expert: "codex/gpt-6.1-sol#high", worker: "none", tester: "none" }, all);
  assert.equal(expertOnly.mode, "solo");
  assert.equal(expertOnly.roles.worker?.[0]?.model, "gpt-6.1-sol", "with no worker, the expert builds");
  const workerOnly = teamPreset({ expert: "none", worker: "codex/gpt-6-luna#high", tester: "codex/gpt-6-luna#medium" }, all);
  assert.equal(workerOnly.mode, "solo");
  assert.equal(workerOnly.roles.orchestrator, undefined);
});

test("telemetry: nothing without consent; a report leaves out code, paths and the repository; the outbox waits", async () => {
  assert.equal(allowed("unasked"), false);
  assert.equal(allowed("off"), false);
  assert.equal(allowed("on"), true);
  const home = mkdtempSync(join(tmpdir(), "nm-tel-"));
  const state = {
    id: "r1",
    mode: "team",
    follows: "r0",
    reason: "failed in /Users/someone/secret/app/src/x.ts",
    tasks: [{ report: { summary: "Edited /home/someone/work/app/index.ts" } }],
  } as unknown as RunState;
  const entry = { run: "r1", at: "x", repo: "/Users/someone/secret/app", preset: "p", request: "fix ~/secret/app/a.ts please", status: "finished", checks: "passed", minutes: 1, turns: 2, escalated: false, models: [], tokens: { expert: 0, worker: 10 }, files: 1, insertions: 1, deletions: 0 } as unknown as UsageEntry;
  const report = runReport(home, state, entry);
  const text = JSON.stringify(report);
  assert.doesNotMatch(text, /someone|secret\/app\/|"repo"/, "no locations, no repository");
  assert.match(report.run.request, /fix …\/a\.ts please/);
  assert.match(report.run.finalReport ?? "", /Edited …\/index\.ts/);
  assert.equal(report.run.follows, true);
  assert.match(report.install, /^[0-9a-f-]{36}$/);

  queue(home, report);
  queue(home, ratingReport(home, "r1", 4));
  assert.equal(outbox(home).length, 2);
  // No endpoint in this build yet: everything waits.
  assert.deepEqual(await flush(home), { sent: 0, waiting: 2 });
  // With one, each report is posted with the ingest key and removed once taken.
  process.env.NEUROMESH_TELEMETRY_URL = "https://example.test";
  const posted: string[] = [];
  const fake = (async (url: string, init: RequestInit) => {
    posted.push(`${url} ${(init.headers as Record<string, string>)["x-neuromesh-key"]}`);
    return new Response("{}", { status: 201 });
  }) as unknown as typeof fetch;
  assert.deepEqual(await flush(home, fake), { sent: 2, waiting: 0 });
  delete process.env.NEUROMESH_TELEMETRY_URL;
  assert.equal(outbox(home).length, 0);
  assert.deepEqual(posted, ["https://example.test/v1/report neuromesh-testing-v1", "https://example.test/v1/report neuromesh-testing-v1"]);
});
