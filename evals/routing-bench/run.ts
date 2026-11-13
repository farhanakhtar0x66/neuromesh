// The routing benchmark (evals/routing-bench/README.md): run its 15 prompts on
// one configuration, live, and commit a record of each prompt as it finishes.
//
//   node evals/routing-bench/run.ts --config cascade  --name rb-cascade-1
//   node evals/routing-bench/run.ts --config frontier --name rb-frontier-1
//   (--tasks t11-pdf-table-json,t52-jargon-log-csv to run some; --no-push to commit without pushing)
//
// Every prompt starts with nothing from an earlier one: its own Neuromesh home
// (so the router's calibration, cooldowns and runs start empty), its own
// repository, and Claude sessions that load none of the owner's settings.
// Rerunning a name continues it: prompts with a record are skipped.

import { spawnSync } from "node:child_process";
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { backends as liveBackends } from "../../src/backends/index.ts";
import { createFakeBackend } from "../../src/backends/fake.ts";
import type { AgentBackend } from "../../src/backends/types.ts";
import type { Usage } from "../../src/backends/types.ts";
import { applyRun } from "../../src/engine/apply.ts";
import { startRun } from "../../src/engine/run.ts";
import type { AttemptRecord, RunState } from "../../src/engine/types.ts";
import { loadPreset } from "../../src/presets/presets.ts";
import { CASCADE_TIERS } from "../../src/routing/router.ts";
import type { CascadeTier } from "../../src/routing/router.ts";
import { estimateCost } from "../../src/usage/prices.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const PRESETS = { cascade: "cascade-claude", frontier: "solo-opus" } as const;

/**
 * --fake: a self-test with no model calls. Every "claude" turn writes the
 * task's reference answer (evals/routing-bench/reference) and reports done.
 * Implies --no-commit.
 */
const FAKE = process.argv.includes("--fake");
let currentSlug = "";
const backends: Record<string, AgentBackend> = FAKE
  ? {
      claude: createFakeBackend((req) => {
        const props = (req.outputSchema?.properties ?? {}) as Record<string, unknown>;
        if ("status" in props && req.access === "write") {
          const ref = join(HERE, "reference", currentSlug);
          if (existsSync(ref)) cpSync(ref, req.cwd, { recursive: true });
          return { structured: { status: "done", summary: "wrote the answer", notes: "", run: "" }, usage: { input: 1000, output: 500 } };
        }
        if ("diagnosis" in props) return { structured: { diagnosis: "x", steps: ["y"] } };
        if ("tasks" in props) return { structured: { summary: "one task", tasks: [{ id: "t1", title: "the request", brief: "do it", owned: [], depends_on: [], owner: "expert" }] }, usage: { input: 2000, output: 300 } };
        return { structured: {}, usage: { input: 10, output: 1 } };
      }, "claude"),
    }
  : liveBackends;

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

export interface TurnRecord {
  role: string;
  kind: string;
  model?: string;
  tier?: string;
  cascadeTier?: CascadeTier;
  earlyExit?: boolean;
  stop: string;
  durationMs: number;
  usage: Usage;
  tokens: number;
  /** Estimated at API list prices; undefined when the model has no price. */
  costUsd?: number;
  /** Fraction of each Claude window used, as the turn's last rate-limit event said. */
  quotaUsed?: Record<string, number>;
  discarded: boolean;
}

export interface PromptRecord {
  id: string;
  slug: string;
  config: keyof typeof PRESETS;
  preset: string;
  name: string;
  expectedTier: string;
  expectedPath: string;
  routedTier?: string;
  routeStage?: string;
  routeReasons?: string[];
  tierPath: string[];
  finalTier?: string;
  status: RunState["status"];
  reason?: string;
  failure?: "agent" | "engine";
  score?: { passed: number; total: number };
  /** Quality 0 to 10: the hidden check's share of passed items. */
  quality: number;
  hiddenOutput: string;
  wallMs: number;
  turns: TurnRecord[];
  tokens: number;
  discardedTokens: number;
  costUsd: number;
  discardedCostUsd: number;
  unpricedTurns: number;
  /** Claude subscription windows (fraction used) read just before and just after the prompt. */
  quota: { before?: Record<string, number>; after?: Record<string, number> };
  runId: string;
  finishedAt: string;
}

function sh(cwd: string, cmd: string, args: string[]): { code: number | null; out: string } {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", timeout: 15 * 60_000 });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
}

function tokensOf(u: Usage): number {
  return (u.input ?? 0) + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0) + (u.output ?? 0);
}

async function quota(): Promise<Record<string, number> | undefined> {
  const dir = mkdtempSync(join(tmpdir(), "routing-bench-quota-"));
  try {
    const r = await backends.claude!.run({ cwd: dir, prompt: "Reply with the single word: ok", model: "claude-haiku-5-5", effort: "low", access: "read-only", timeoutMs: 120_000, idleMs: 120_000 });
    return r.quotaUsed;
  } catch {
    return undefined;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function seed(taskDir: string, into: string): string {
  rmSync(into, { recursive: true, force: true });
  mkdirSync(into, { recursive: true });
  cpSync(join(taskDir, "seed"), into, { recursive: true });
  for (const args of [["init", "-q", "-b", "main"], ["add", "-A"], ["commit", "-q", "-m", "seed"]]) {
    const r = spawnSync("git", ["-c", "user.name=routing-bench", "-c", "user.email=bench@localhost", ...args], { cwd: into });
    if (r.status !== 0) throw new Error(`could not seed ${taskDir}: git ${args[0]} failed`);
  }
  return realpathSync(into);
}

/** Turns on a tier the task later left, and turns the early-exit gate stopped, are the cascade's waste. */
export function turnsOf(state: RunState): TurnRecord[] {
  const rank = (t: string | undefined): number => (t === undefined ? -1 : CASCADE_TIERS.indexOf(t as CascadeTier));
  const final = new Map<string, string>();
  for (const t of state.tasks) final.set(t.id, t.owner === "expert" || t.escalated ? "expert" : (state.attempts.filter((a) => a.task === t.id && a.cascadeTier).at(-1)?.cascadeTier ?? "worker"));
  return state.attempts.map((a: AttemptRecord) => {
    const last = a.task ? final.get(a.task) : undefined;
    const discarded = Boolean(a.earlyExit) || (a.cascadeTier !== undefined && last !== undefined && rank(a.cascadeTier) < rank(last));
    return {
      role: a.role,
      kind: a.kind,
      model: a.model,
      tier: a.tier,
      cascadeTier: a.cascadeTier,
      earlyExit: a.earlyExit,
      stop: a.stop,
      durationMs: a.durationMs,
      usage: a.usage,
      tokens: tokensOf(a.usage),
      costUsd: estimateCost(a.model, a.usage),
      quotaUsed: a.quotaUsed,
      discarded,
    };
  });
}

function commit(path: string[], message: string, push: boolean): void {
  sh(REPO, "git", ["add", "--", ...path]);
  const c = sh(REPO, "git", ["commit", "-q", "-m", message, "--", ...path]);
  if (c.code !== 0 && !/nothing to commit/.test(c.out)) process.stderr.write(`  (commit failed: ${c.out.slice(0, 200)})\n`);
  if (push) {
    const p = sh(REPO, "git", ["push", "-q"]);
    if (p.code !== 0) process.stderr.write(`  (push failed: ${p.out.slice(0, 200)})\n`);
  }
}

async function main(): Promise<number> {
  const config = arg("config") as keyof typeof PRESETS | undefined;
  const name = arg("name");
  if (!config || !(config in PRESETS) || !name) {
    process.stderr.write("usage: node evals/routing-bench/run.ts --config cascade|frontier --name <name> [--tasks a,b] [--no-push]\n");
    return 2;
  }
  const push = !process.argv.includes("--no-push") && !FAKE;
  const commits = !FAKE && !process.argv.includes("--no-commit");
  const preset = loadPreset(PRESETS[config]);
  const only = arg("tasks")?.split(",").filter(Boolean);
  const tasksDir = join(HERE, "tasks");
  const slugs = readdirSync(tasksDir).filter((s) => existsSync(join(tasksDir, s, "task.json")) && (!only || only.includes(s))).sort();
  const out = join(HERE, "results", name);
  mkdirSync(out, { recursive: true });
  const log = join(out, "LOG.md");
  if (!existsSync(log)) writeFileSync(log, `# ${name}\n\nConfiguration: ${config} (preset ${preset.name}). Each line is written as it happens.\n\n`);
  const note = (line: string): void => {
    const stamped = `- ${new Date().toISOString().replace("T", " ").slice(0, 19)} UTC: ${line}\n`;
    appendFileSync(log, stamped);
    process.stderr.write(stamped);
  };
  const benchHome = join(homedir(), ".neuromesh-bench", name);
  note(`started: ${slugs.length} prompt(s) on preset ${preset.name}`);

  for (const slug of slugs) {
    const recordPath = join(out, `${slug}.json`);
    if (existsSync(recordPath)) {
      const done = JSON.parse(readFileSync(recordPath, "utf8")) as PromptRecord;
      if (!["paused", "interrupted", "running"].includes(done.status)) continue;
    }
    const taskDir = join(tasksDir, slug);
    const task = JSON.parse(readFileSync(join(taskDir, "task.json"), "utf8")) as { hiddenCheck: string; bench: { id: string; expectedTier: string; expectedPath: string } };
    const prompt = readFileSync(join(taskDir, "prompt.md"), "utf8").trim();
    // Nothing carried over from an earlier prompt or run.
    const home = join(benchHome, slug);
    rmSync(home, { recursive: true, force: true });
    mkdirSync(home, { recursive: true });
    const repo = seed(taskDir, join(home, "repo"));
    currentSlug = slug;
    note(`${task.bench.id} ${slug}: reading quota, then running`);
    const before = FAKE ? undefined : await quota();
    const started = Date.now();
    const state = await startRun({ cwd: repo, prompt, preset }, { home, backends, onEvent: (e) => {
      if (["route.tier", "task.early-exit", "task.climbed", "task.escalated", "task.advised", "plan.ready"].includes(e.type)) {
        note(`${task.bench.id} ${e.type}${e.tier ? ` ${e.tier}` : ""}${e.to ? ` to ${e.to}` : ""}${e.reason ? `: ${String(e.reason).slice(0, 120)}` : ""}`);
      }
    } });
    const wallMs = Date.now() - started;
    const after = FAKE ? undefined : await quota();

    let hiddenOutput = "";
    let score: PromptRecord["score"];
    if (state.status === "finished") {
      applyRun(state, { force: true });
      cpSync(join(taskDir, "hidden"), join(repo, "hidden"), { recursive: true });
      const check = sh(repo, "sh", ["-c", `${task.hiddenCheck} 2>&1`]);
      hiddenOutput = check.out.slice(-4000);
      const m = [...check.out.matchAll(/^SCORE (\d+)\/(\d+)\s*$/gm)].at(-1);
      if (m) score = { passed: Number(m[1]), total: Number(m[2]) };
    }
    const turns = turnsOf(state);
    const routed = state.cascade?.route;
    // The expert's planning turn (the sandwich's blueprint) comes first in the path.
    const tierPath = turns
      .filter((t) => t.cascadeTier || (t.role === "orchestrator" && t.kind === "plan"))
      .map((t) => t.cascadeTier ?? "expert-plan")
      .filter((t, i, a) => i === 0 || a[i - 1] !== t);
    const record: PromptRecord = {
      id: task.bench.id,
      slug,
      config,
      preset: preset.name,
      name,
      expectedTier: task.bench.expectedTier,
      expectedPath: task.bench.expectedPath,
      routedTier: config === "frontier" ? "frontier" : routed?.tier,
      routeStage: routed?.stage,
      routeReasons: routed?.reasons,
      tierPath: config === "frontier" ? ["frontier"] : tierPath,
      finalTier: config === "frontier" ? "frontier" : tierPath.at(-1),
      status: state.status,
      reason: state.reason,
      failure: state.failure,
      score,
      quality: score && score.total > 0 ? (10 * score.passed) / score.total : 0,
      hiddenOutput,
      wallMs,
      turns,
      tokens: turns.reduce((n, t) => n + t.tokens, 0),
      discardedTokens: turns.filter((t) => t.discarded).reduce((n, t) => n + t.tokens, 0),
      costUsd: turns.reduce((n, t) => n + (t.costUsd ?? 0), 0),
      discardedCostUsd: turns.filter((t) => t.discarded).reduce((n, t) => n + (t.costUsd ?? 0), 0),
      unpricedTurns: turns.filter((t) => t.costUsd === undefined && t.tokens > 0).length,
      quota: { before, after },
      runId: state.id,
      finishedAt: new Date().toISOString(),
    };
    writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`);
    const q = (w: Record<string, number> | undefined): string => (w ? Object.entries(w).map(([k, v]) => `${k} ${Math.round(v * 100)}%`).join(", ") : "unknown");
    note(`${task.bench.id} ${slug}: ${state.status}, quality ${record.quality.toFixed(1)}/10${score ? ` (${score.passed}/${score.total})` : ""}, path ${record.tierPath.join(">") || "-"}, ${record.tokens.toLocaleString("en-US")} tokens, est. $${record.costUsd.toFixed(4)} (API list prices), ${(wallMs / 60_000).toFixed(1)} min; quota before ${q(before)}, after ${q(after)}`);
    if (commits) commit([recordPath, log], `routing-bench ${name}: ${task.bench.id} ${slug} (${state.status}, Q ${record.quality.toFixed(1)})`, push);
    if (state.status === "paused") {
      note(`stopped: ${state.reason ?? "paused"}; rerun the same command to continue`);
      if (commits) commit([log], `routing-bench ${name}: paused`, push);
      return 1;
    }
  }
  note("finished");
  if (commits) commit([log], `routing-bench ${name}: finished`, push);
  return 0;
}

process.exitCode = await main();
