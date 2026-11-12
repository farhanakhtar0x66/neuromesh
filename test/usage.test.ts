import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { RunState } from "../src/engine/types.ts";
import { entryFor, readLog, recordRating, recordRun, usageDir } from "../src/usage/log.ts";

function run(id: string, preset: string, extra: Partial<RunState> = {}): RunState {
  return {
    id,
    preset,
    repo: "/work/typing-app",
    prompt: "the brief",
    request: "build a typing test",
    status: "finished",
    usagePerTurn: true,
    createdAt: "2026-11-11T10:00:00.000Z",
    updatedAt: "2026-11-11T10:06:00.000Z",
    tasks: [{ escalated: false }],
    outcome: { checks: "passed", files: [{ path: "a.js" }], insertions: 10, deletions: 0 },
    attempts: [
      { role: "briefer", tier: "expert", kind: "spec", backend: "claude", model: "claude-opus-5-5", usage: { input: 0, cacheWrite: 10_000, output: 5_000 }, durationMs: 1 },
      { role: "worker", tier: "worker", kind: "initial", backend: "codex", model: "gpt-6-luna", usage: { input: 20_000, cacheRead: 100_000, output: 3_000 }, durationMs: 1 },
    ],
    ...extra,
  } as unknown as RunState;
}

test("a run is recorded with tokens and estimated cost by tier, and the report groups runs by preset", () => {
  const home = mkdtempSync(join(tmpdir(), "nm-usage-"));
  const entry = entryFor(run("r1", "factory-opus-luna"), () => false);
  assert.equal(entry.repo, "typing-app");
  assert.equal(entry.request, "build a typing test", "the request as typed, not the brief");
  assert.equal(entry.minutes, 6);
  assert.deepEqual(entry.tokens, { expert: 15_000, worker: 123_000 });
  // Opus: 10k cache writes at $8/M + 5k output at $20/M = $0.18. Luna: 20k at $0.10/M + 100k at $0.01/M + 3k at $0.50/M = $0.0045.
  assert.equal(entry.expertCost?.toFixed(4), "0.1800");
  assert.equal(entry.cost?.toFixed(4), "0.1845");

  recordRun(home, entry);
  recordRun(home, entryFor(run("r2", "solo-opus", { attempts: [] }), () => false));
  recordRun(home, { ...entry, status: "applied" });
  recordRating(home, { run: "r1", at: "2026-11-11T10:10:00.000Z", score: 4, usual: "Claude Code | Opus", note: "good app" });

  const log = readLog(home);
  assert.equal(log.runs.length, 2, "a run recorded twice (say, after resume) counts once");
  assert.equal(log.runs.find((r) => r.run === "r1")?.status, "applied", "the latest record wins");
  const md = readFileSync(join(usageDir(home), "USAGE.md"), "utf8");
  assert.match(md, /\| factory-opus-luna \| - \| 1 \| 1 \| 6\.0 \| \$0\.18 \| \$0\.18 \| 4\.0 \|/);
  assert.match(md, /4 vs Claude Code \\\| Opus/, "table cells are escaped");
  assert.match(md, /\| solo-opus \|/);
});
