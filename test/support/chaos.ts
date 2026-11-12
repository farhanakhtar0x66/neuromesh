// The fault harness: one seeded random run of the engine against agents that
// misbehave, and the rules every run must keep whatever they do.
//
// It makes no model calls. A seed fixes the repository, the preset, the request
// and what every agent turn does (good work, wrong work, nothing, an error, a
// quota limit, a revoked login, a hang, a crash, unusable answers, damage to
// the work folder), so a failing seed replays exactly:
//   node evals/chaos.ts --seed 1234
//
// Used by test/chaos.test.ts (a fixed set of seeds on every change) and by
// evals/chaos.ts (many seeds at once).

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AgentBackend, AgentRequest, AgentResult } from "../../src/backends/types.ts";
import { applyRun } from "../../src/engine/apply.ts";
import { resumeRun, startRun } from "../../src/engine/run.ts";
import type { EngineContext } from "../../src/engine/run.ts";
import { loadState } from "../../src/engine/store.ts";
import type { NeuromeshEvent } from "../../src/engine/store.ts";
import type { RoleChain, RoleConfig, RunState } from "../../src/engine/types.ts";
import { FEATURES } from "../../src/features.ts";
import type { Preset } from "../../src/presets/presets.ts";
import { estimateCost } from "../../src/usage/prices.ts";
import { git } from "../../src/workspace/git.ts";

export interface ChaosOptions {
  /** A folder the run may fill and that the caller removes. */
  scratch: string;
  /** Most agent turns before the run is called a runaway. */
  maxCalls?: number;
  /** Most milliseconds before the run is called hung. */
  deadlineMs?: number;
  /** Print every event and agent turn as it happens. */
  trace?: boolean;
  /**
   * Kill this very process (SIGKILL, as a crash or a closed laptop would) a
   * moment after this agent turn starts. Run the seed in a child process.
   */
  killAt?: number;
  /** Carry on a run that a killed process left in `scratch`, the way `neuromesh resume` would. */
  resume?: boolean;
}

export interface ChaosResult {
  seed: number;
  /** One line: what this seed set up. */
  scenario: string;
  status: string;
  reason?: string;
  calls: number;
  resumes: number;
  ms: number;
  /** Rules the run broke; empty when it kept them all. */
  violations: string[];
}

/** mulberry32: small, fast, and the same on every machine. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Dice {
  chance(p: number): boolean;
  int(lo: number, hi: number): number;
  pick<T>(items: readonly T[]): T;
  weighted<T extends string>(table: Record<T, number>): T;
}

function dice(seed: number): Dice {
  const next = prng(seed);
  return {
    chance: (p) => next() < p,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: (items) => items[Math.floor(next() * items.length)]!,
    weighted: (table) => {
      const entries = Object.entries(table) as [string, number][];
      let at = next() * entries.reduce((n, [, w]) => n + w, 0);
      for (const [key, w] of entries) {
        at -= w;
        if (at <= 0) return key as never;
      }
      return entries[entries.length - 1]![0] as never;
    },
  };
}

// Through the engine's own git helper, which survives a lock held for a moment and Xcode being away.
const sh = (cwd: string, ...args: string[]): string => git(cwd, "-c", "user.name=t", "-c", "user.email=t@t", ...args);

const props = (r: AgentRequest): Record<string, unknown> => (r.outputSchema?.properties as Record<string, unknown> | undefined) ?? {};
type Call = "scout" | "spec" | "plan" | "review" | "advice" | "build";
function callKind(r: AgentRequest): Call {
  const p = props(r);
  if ("facts" in p) return "scout";
  if ("design" in p) return "spec";
  if ("tasks" in p) return "plan";
  if ("verdict" in p) return "review";
  if ("diagnosis" in p) return "advice";
  return "build";
}

/** Answers no parser should choke on. */
const GARBAGE: unknown[] = [null, "not json at all", {}, [], 42, { tasks: [null] }, { tasks: "three" }, { tasks: [{ id: 7 }] }, { verdict: 5, findings: "none" }, { verdict: "fail" }, { verdict: "fail", findings: [null, 3] }, { status: 3, summary: null }, { diagnosis: [], steps: "do it" }, { facts: "one" }, { name: 1, tasks: [{}], acceptance: "run it" }, { summary: "x".repeat(200_000) }];

// The features that keep a run alive are never switched off here: the rules below rest on them.
const PROTECTIVE = ["heal-worktree", "adapter-guard", "sync-before-checks", "leftover-stop"];
const OPTIONAL = FEATURES.filter((f) => f.optional && !PROTECTIVE.includes(f.key)).map((f) => f.key);
// Features that start other programs the harness does not model (a terminal recorder, package installs).
const ALWAYS_OFF = ["screen-check"];

export async function runChaos(seed: number, options: ChaosOptions): Promise<ChaosResult> {
  let d = dice(seed);
  const started = Date.now();
  const maxCalls = options.maxCalls ?? 160;
  const deadlineMs = options.deadlineMs ?? 120_000;
  const violations: string[] = [];
  const broke = (rule: string): void => {
    if (!violations.includes(rule)) violations.push(rule);
  };

  // ---- The repository: its check passes when every listed file says "ok".
  const repo = join(options.scratch, `repo-${seed}`);
  const home = join(options.scratch, `home-${seed}`);
  if (!options.resume) mkdirSync(repo, { recursive: true });
  const fileCount = d.int(1, 4);
  const files = Array.from({ length: fileCount }, (_, i) => d.pick([`f${i + 1}.txt`, `src/part${i + 1}.txt`, `dir with space/f${i + 1}.txt`]));
  const withChecks = d.chance(0.85);
  const slowCheck = d.chance(0.05);
  if (options.resume) {
    // The repository is already there, from the process that was killed.
  } else if (withChecks) {
    writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "chaos", private: true, scripts: { test: "node check.js" } }));
    writeFileSync(
      join(repo, "check.js"),
      `const fs=require('fs');${slowCheck ? "const t=Date.now();while(Date.now()-t<400){}" : ""}for(const f of ${JSON.stringify(files)}){if(!fs.existsSync(f)||fs.readFileSync(f,'utf8').trim()!=='ok'){console.error('expected '+f+' to say ok');process.exit(1)}}`,
    );
  } else {
    writeFileSync(join(repo, "README.md"), "a project without checks\n");
  }
  if (!options.resume) {
    sh(repo, "init", "-q", "-b", "main");
    sh(repo, "add", "-A");
    sh(repo, "commit", "-q", "-m", "seed");
  }
  const before = { head: sh(repo, "rev-parse", "HEAD").trim(), branch: sh(repo, "rev-parse", "--abbrev-ref", "HEAD").trim() };

  // ---- The preset.
  const pricedExpert = d.chance(0.5);
  const EXPERT: RoleConfig = { backend: "fake", model: pricedExpert ? "claude-opus-5-5" : "fake-expert", tier: "expert" };
  const rungs = d.int(0, 3);
  const ladder: RoleConfig[] = Array.from({ length: rungs }, (_, i) => ({ backend: "fake", model: `worker-${i + 1}`, tier: "worker" as const }));
  const roles: RoleChain = { worker: d.chance(0.15) ? [{ backend: "fake", model: "worker-a", tier: "worker" }, { backend: "fake", model: "worker-b", tier: "worker" }] : [ladder.at(-1) ?? { backend: "fake", model: "worker-1", tier: "worker" }] };
  if (d.chance(0.6)) roles.tester = [{ backend: "fake", model: "fake-tester", tier: "worker" }];
  const expertShape = d.weighted({ both: 5, orchestrator: 1.5, escalation: 1.5, none: 2 });
  if (expertShape === "both" || expertShape === "orchestrator") roles.orchestrator = [EXPERT];
  if (expertShape === "both" || expertShape === "escalation") roles.escalation = d.chance(0.2) ? [EXPERT, { backend: "fake", model: "fake-expert-2", tier: "expert" }] : [EXPERT];
  const briefer = d.weighted({ expert: 4, worker: 2, none: 3 });
  if (briefer === "expert") roles.briefer = [EXPERT];
  if (briefer === "worker") roles.briefer = [{ backend: "fake", model: "fake-briefer", tier: "worker" }];
  const off = [...ALWAYS_OFF, ...Array.from({ length: d.weighted({ "0": 5, "1": 2, "2": 2, "4": 1 }) === "0" ? 0 : d.int(1, 4) }, () => d.pick(OPTIONAL))];
  const preset: Preset = {
    name: "chaos",
    description: "",
    mode: d.pick(["solo", "team", "team"] as const),
    roles,
    repairs: d.int(0, 2),
    maxTasks: d.int(2, 5),
    maxParallel: d.int(1, 3),
    turnTimeoutMinutes: 1,
    intake: d.chance(0.5),
    brief: d.chance(0.7),
    routing: d.pick(["rules", "worker-first"] as const),
    advise: d.chance(0.6),
    test: d.pick(["always", "always", "no-checks"] as const),
    workerLadder: rungs > 0 ? ladder : undefined,
    expertBudgetUsd: d.weighted({ none: 4, tiny: 2, small: 3, large: 2 }) === "none" ? undefined : d.pick([0.05, 0.3, 0.6, 3]),
    expertBudget: d.chance(0.1) ? d.pick([2_000, 50_000]) : undefined,
    disable: off,
  };
  const prompt = d.pick([
    "make the test pass",
    "make the test pass",
    `build a command-line tool that writes ${fileCount} files`,
    `build a command-line tool that writes ${fileCount} files`,
    "fix the typo in the readme",
    "refactor the check so it is easier to read, keeping its behaviour",
  ]);
  // How badly the agents behave in this run: none at all (the engine must then
  // succeed), or a share of the turns.
  const trouble = d.weighted({ none: 1.5, some: 4, much: 3, most: 1 });
  const p = { none: 0, some: 0.12, much: 0.3, most: 0.55 }[trouble];
  // Drawn either way, so a seed sets up the same scenario with and without a kill.
  const interruptDrawn = [d.chance(0.25), d.int(0, 12)] as const;
  const interruptAt = interruptDrawn[0] && options.killAt === undefined && !options.resume ? interruptDrawn[1] : -1;
  const killDelay = d.int(0, 700);
  // Good agents on a run nobody stopped: the engine must then waste nothing.
  const calm = trouble === "none" && interruptAt < 0 && options.killAt === undefined && !options.resume;
  // After a kill the agents draw from a new sequence; the scenario above is the same one.
  if (options.resume) d = dice(seed + 7_777_777);
  const scenario = `files=${fileCount}${withChecks ? "" : " no-checks"} mode=${preset.mode} ladder=${rungs} tester=${roles.tester ? "y" : "n"} expert=${expertShape}${pricedExpert ? "$" : ""} briefer=${briefer} brief=${preset.brief} repairs=${preset.repairs} par=${preset.maxParallel} budget=${preset.expertBudgetUsd ?? "-"} trouble=${trouble} interrupt=${interruptAt} off=[${off.slice(1).join(",")}] "${prompt.slice(0, 28)}"`;

  // ---- The world the agents act in: which task builds which files.
  const owners = new Map<string, string[]>();
  const taskOf = (cwd: string): string | undefined => /[\\/]tasks[\\/]([^\\/]+)[\\/](?:worktree|tester)/.exec(cwd)?.[1];
  const mine = (cwd: string): string[] => owners.get(taskOf(cwd) ?? "") ?? files;
  const put = (cwd: string, file: string, text: string): void => {
    mkdirSync(dirname(join(cwd, file)), { recursive: true });
    writeFileSync(join(cwd, file), `${text}\n`);
  };
  /** A plan over the given files; sometimes one a parser must refuse. */
  const planFor = (list: string[], prefix: string, idBase: string): unknown => {
    const shape = d.weighted({ good: 8, one: 1.5, cycle: p * 2, dup: p * 2, unknownDep: p * 2, tooMany: p * 2, noBrief: p * 1.5 });
    const count = shape === "one" ? 1 : shape === "tooMany" ? 9 : d.int(2, Math.max(2, Math.min(4, list.length + 1)));
    const tasks = Array.from({ length: count }, (_, i) => {
      const id = `${idBase}${i + 1}`;
      const share = list.filter((_, n) => n % count === i);
      const owned = share.length > 0 ? share : [`extra-${prefix}${id}.txt`];
      owners.set(`${prefix}${id}`, owned);
      return {
        id,
        title: `part ${id}`,
        brief: shape === "noBrief" && i === 0 ? "" : `Write ${owned.join(", ")}`,
        owned: d.chance(0.1) ? [] : owned,
        depends_on: i > 0 && d.chance(0.6) ? [`${idBase}${d.int(1, i)}`] : [],
        owner: d.chance(0.2) ? "expert" : "worker",
      };
    });
    if (shape === "cycle" && tasks.length > 1) {
      tasks[0]!.depends_on = [tasks[1]!.id];
      tasks[1]!.depends_on = [tasks[0]!.id];
    }
    if (shape === "dup" && tasks.length > 1) tasks[1]!.id = tasks[0]!.id;
    if (shape === "unknownDep") tasks[0]!.depends_on = ["nowhere"];
    return { summary: "a plan", tasks };
  };

  const calls: AgentRequest[] = [];
  let aborter = new AbortController();
  let runaway = false;
  const never = new Promise<Partial<AgentResult>>(() => {});
  let sessions = 0;

  const act = (req: AgentRequest, index: number): Partial<AgentResult> | Promise<Partial<AgentResult>> => {
    if (index >= maxCalls) {
      runaway = true;
      aborter.abort();
      return never;
    }
    if (index === interruptAt) {
      aborter.abort();
      return never;
    }
    if (index === options.killAt) setTimeout(() => process.kill(process.pid, "SIGKILL"), killDelay);
    const kind = callKind(req);
    const expert = req.model === EXPERT.model;
    const usage = d.chance(0.7) ? { input: d.int(1, 50), cacheRead: d.int(0, 50_000), cacheWrite: d.int(0, 20_000), output: d.int(100, expert ? 12_000 : 40_000) } : {};
    const extra: Partial<AgentResult> = { usage, peakPrompt: d.chance(0.1) ? d.int(95_000, 180_000) : d.int(5_000, 60_000), quotaUsed: d.chance(0.5) ? { five_hour: 0.2 + index / 500 } : undefined };
    // Trouble any turn can have.
    if (d.chance(p)) {
      const fault = d.weighted({ transient: 3, error: 3, quota: 1.5, auth: 0.7, unavailable: 1, timeout: 1.5, crash: 1, garbage: 3, text: 1, cut: expert ? 3 : 0 });
      if (fault === "transient") return { stop: "error", detail: d.pick(["ECONNRESET", "stream was interrupted", "503 overloaded"]) };
      if (fault === "error") return { stop: "error", detail: d.pick(["boom", "the model refused", "", "exit code 1"]), exitCode: 1 };
      if (fault === "quota") return { stop: "quota", detail: "usage limit reached, resets in 5 minutes" };
      if (fault === "auth") return { stop: "auth", detail: "OAuth token revoked" };
      if (fault === "unavailable") return { stop: d.pick(["error", "auth"] as const), detail: "model not found" };
      if (fault === "timeout") return never;
      if (fault === "crash") throw new Error("the backend itself crashed");
      if (fault === "garbage") return { ...extra, structured: d.pick(GARBAGE) };
      if (fault === "text") return { ...extra, finalText: d.pick(["", "I could not finish.", '{"status": "done"', "```json\n{}\n```"]) };
      if (fault === "cut") {
        // Part of the work, then spending past any budget.
        if (kind === "build" && req.access === "write") for (const f of mine(req.cwd).slice(0, 1)) put(req.cwd, f, "ok");
        req.onUsage?.({ input: 100, cacheRead: 0, cacheWrite: 500_000, output: 5_000 });
        return {};
      }
    }
    if (kind === "scout") return { ...extra, structured: { facts: d.chance(0.5) ? ["node is installed"] : [] } };
    if (kind === "spec") {
      const plan = planFor(files, "", "t") as { tasks: unknown[] };
      return {
        ...extra,
        structured: {
          name: "chaos",
          summary: "s",
          features: ["f"],
          behaviour: [],
          out_of_scope: [],
          design: ["files"],
          acceptance: d.chance(0.6) ? [{ command: d.pick([`cat "${files[0]}"`, "false", "exit 3", "definitely-not-a-command", "node -e \"setTimeout(()=>{},300)\""]), expect: "says ok" }] : [],
          tasks: d.chance(0.25) ? plan.tasks.slice(0, 1) : plan.tasks,
        },
      };
    }
    if (kind === "plan") {
      const id = taskOf(req.cwd);
      return { ...extra, structured: id ? planFor(owners.get(id) ?? files, `${id}.`, "p") : planFor(files, "", "t") };
    }
    if (kind === "advice") return { ...extra, structured: { diagnosis: "the file is wrong", steps: ["write ok into it"] } };
    if (kind === "review") {
      const view = d.weighted({ pass: 6, blocker: p * 8, phantom: p * 6, minor: p * 6, noCheck: p * 4, vandal: p * 2 });
      if (view === "vandal") rmSync(req.cwd, { recursive: true, force: true });
      if (view === "pass" || view === "vandal") return { ...extra, structured: { verdict: "pass", summary: "fine", findings: [] } };
      const check = view === "blocker" ? "false" : view === "phantom" ? d.pick(["true", "definitely-not-a-command"]) : "";
      return { ...extra, structured: { verdict: "fail", summary: "a problem", findings: [{ problem: "it is wrong", file: files[0], reproduce: "run it", severity: view === "minor" ? "minor" : "blocker", check }] } };
    }
    // A build, repair or fix turn.
    const report = (status: string, summary: string, notes = ""): Partial<AgentResult> => ({ ...extra, sessionId: `s${++sessions}`, structured: { status, summary, notes, run: "" } });
    if (req.access !== "write") return report("done", "looked");
    // A split is asked for where the engine offers one; a troubled worker may ask anyway.
    const offered = /answer with status "split"/.test(req.prompt);
    const work = d.weighted({ good: 10, wrong: p * 8, partial: p * 6, nothing: p * 5, blocked: p * 3, split: offered ? p * 4 + (p > 0 ? 0.6 : 0) : p, outside: p * 3, vandal: p * 3 });
    const own = mine(req.cwd);
    if (work === "good") {
      for (const f of own) put(req.cwd, f, "ok");
      return report("done", "built it");
    }
    if (work === "wrong") {
      for (const f of own) put(req.cwd, f, "not ok");
      return report("done", "built it, I think");
    }
    if (work === "partial") {
      for (const f of own.slice(0, Math.max(0, own.length - 1))) put(req.cwd, f, "ok");
      return report(d.pick(["done", "unknown"]), "most of it");
    }
    if (work === "nothing") return report("done", "nothing to do");
    if (work === "blocked") return report("blocked", "could not finish", d.pick(["pip install failed: no network access", "I do not understand the task", "ModuleNotFoundError: No module named 'requests'"]));
    if (work === "split") {
      for (const f of own.slice(0, 1)) put(req.cwd, f, "ok");
      return report("split", "too big", "several parts");
    }
    if (work === "outside") {
      for (const f of files) put(req.cwd, f, d.chance(0.5) ? "ok" : "someone else's idea");
      put(req.cwd, "notes -- draft.md", "scratch");
      return report("done", "did everything, and more");
    }
    // Damage an agent can really do to its work folder.
    const damage = d.weighted({ commit: 3, branch: 2, deleteChecks: 2, deleteFolder: 1.5, lock: 1, junk: 2 });
    try {
      if (damage === "commit") {
        for (const f of own) put(req.cwd, f, "ok");
        sh(req.cwd, "add", "-A");
        sh(req.cwd, "commit", "-q", "-m", "the agent committed by itself");
      } else if (damage === "branch") {
        for (const f of own) put(req.cwd, f, "ok");
        sh(req.cwd, "checkout", "-q", "-b", `agent-branch-${index}`);
      } else if (damage === "deleteChecks") {
        rmSync(join(req.cwd, "check.js"), { force: true });
        rmSync(join(req.cwd, "package.json"), { force: true });
      } else if (damage === "deleteFolder") {
        rmSync(req.cwd, { recursive: true, force: true });
      } else if (damage === "lock") {
        const gitDir = sh(req.cwd, "rev-parse", "--git-dir").trim();
        writeFileSync(join(gitDir.startsWith("/") ? gitDir : join(req.cwd, gitDir), "index.lock"), "");
      } else {
        put(req.cwd, "-leading-dash.txt", "x");
        put(req.cwd, "big.bin", "0".repeat(300_000));
        mkdirSync(join(req.cwd, "nested"), { recursive: true });
        sh(join(req.cwd, "nested"), "init", "-q");
      }
    } catch {
      // The damage itself may fail; the turn still ends.
    }
    return report("done", `did something (${damage})`);
  };

  const backend: AgentBackend = {
    id: "fake",
    displayName: "Chaos",
    version: async () => "chaos-1",
    async run(request: AgentRequest): Promise<AgentResult> {
      const t = Date.now();
      const index = calls.length;
      calls.push(request);
      const base = (partial: Partial<AgentResult>): AgentResult => ({ stop: "done", finalText: "", usage: {}, exitCode: 0, sessionId: `fake-${index}`, model: request.model, ...partial, durationMs: Date.now() - t });
      const cancelled = new Promise<Partial<AgentResult>>((resolve) => {
        if (request.signal?.aborted) resolve({ stop: "cancelled", exitCode: null });
        request.signal?.addEventListener("abort", () => resolve({ stop: "cancelled", exitCode: null }), { once: true });
      });
      let timer: NodeJS.Timeout | undefined;
      const timedOut = new Promise<Partial<AgentResult>>((resolve) => {
        timer = setTimeout(() => resolve({ stop: "timeout", exitCode: null }), request.timeoutMs);
      });
      try {
        return base(await Promise.race([Promise.resolve().then(() => act(request, index)), cancelled, timedOut]));
      } finally {
        clearTimeout(timer);
      }
    },
  };

  const events: NeuromeshEvent[] = [];
  const context = (): EngineContext => {
    aborter = new AbortController();
    return {
      home,
      backends: { fake: backend },
      signal: aborter.signal,
      onEvent: (e) => {
        events.push(e);
        if (options.trace && e.type !== "agent.activity") console.error(JSON.stringify(e).slice(0, 330));
      },
      turnTimeoutMs: 250,
      checkTimeoutMs: 20_000,
    };
  };

  // ---- The run, resumed after a pause or an interruption like a person would.
  let state: RunState | undefined;
  let resumes = 0;
  let hung = false;
  const within = async (work: Promise<RunState>): Promise<RunState | undefined> => {
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<undefined>((resolve) => {
      timer = setTimeout(() => {
        hung = true;
        aborter.abort();
        resolve(undefined);
      }, Math.max(1_000, deadlineMs - (Date.now() - started)));
    });
    try {
      return await Promise.race([work, late]);
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    // After a kill: the newest run the dead process left, if it got as far as saving one.
    const left = ((): string | undefined => {
      if (!options.resume) return undefined;
      const projects = join(home, "projects");
      for (const project of existsSync(projects) ? readdirSync(projects) : []) {
        const runs = join(projects, project, "runs");
        const ids = existsSync(runs) ? readdirSync(runs).sort() : [];
        if (ids.length > 0 && existsSync(join(runs, ids.at(-1)!, "run.json"))) return join(runs, ids.at(-1)!);
      }
      return undefined;
    })();
    const leftState = left ? loadState(left) : undefined;
    // The process may have finished the run just before it died.
    if (leftState && ["finished", "applied", "discarded"].includes(leftState.status)) state = leftState;
    else state = await within(leftState ? resumeRun(leftState, context()) : startRun({ cwd: repo, prompt, preset }, context()));
    while (state && (state.status === "paused" || state.status === "interrupted") && resumes < 4 && !runaway && !hung) {
      resumes += 1;
      // Time passes: quota limits reset.
      rmSync(join(home, "cooldowns.json"), { force: true });
      const dir = state.dir;
      state = await within(resumeRun(loadState(dir), context()));
    }
  } catch (error) {
    broke(`the engine threw instead of ending the run: ${error instanceof Error ? (error.stack ?? error.message).split("\n").slice(0, 3).join(" | ") : String(error)}`);
  }
  if (hung) broke(`the run did not end within ${Math.round(deadlineMs / 1000)} s (${calls.length} agent turns)`);
  if (runaway) broke(`runaway: more than ${maxCalls} agent turns`);

  // ---- The rules.
  if (state) {
    const saved = ((): RunState | undefined => {
      try {
        return loadState(state.dir);
      } catch (error) {
        broke(`the saved state cannot be read: ${error instanceof Error ? error.message : String(error)}`);
        return undefined;
      }
    })();
    if (saved && saved.status !== state.status) broke(`the saved status (${saved.status}) differs from the returned one (${state.status})`);
    if (!["finished", "failed", "paused", "interrupted"].includes(state.status)) broke(`the run ended with status "${state.status}"`);
    if (state.status !== "finished" && !state.reason?.trim()) broke(`a ${state.status} run gives no reason`);
    if (state.status === "failed" && state.failure === "engine" && !/^environment: /.test(state.reason ?? "")) broke(`engine failure: ${state.reason}`);
    if (Object.keys(state.inFlight).length > 0) broke("turns are still marked in flight after the run ended");
    if (state.pid !== undefined) broke("the run still names an engine process after it ended");
    if (state.status === "finished") {
      const open = state.tasks.filter((t) => t.status !== "passed" && t.status !== "failed");
      if (open.length > 0) broke(`finished with tasks still ${open.map((t) => `${t.id}:${t.status}`).join(", ")}`);
      if (!state.outcome) broke("finished without an outcome");
      if (!existsSync(join(state.dir, "diff.patch"))) broke("finished without a patch file");
      if (state.outcome?.checks === "passed" && withChecks && existsSync(join(state.worktree, "check.js"))) {
        try {
          execFileSync("node", ["check.js"], { cwd: state.worktree, stdio: "ignore" });
        } catch {
          broke("the run says its checks passed, but the check fails on the result");
        }
      }
      if (trouble === "none" && interruptAt < 0 && withChecks && state.outcome?.checks !== "passed") broke(`every agent did its work, yet the checks ${state.outcome?.checks}`);
      if (trouble === "none" && interruptAt < 0 && state.tasks.some((t) => t.status === "failed")) broke(`every agent did its work, yet task ${state.tasks.find((t) => t.status === "failed")!.id} failed: ${state.tasks.find((t) => t.status === "failed")!.error}`);
    }
    if (trouble === "none" && interruptAt < 0 && state.status !== "finished") broke(`every agent did its work, yet the run ${state.status}: ${state.reason}`);
    // Good work is not redone, repaired or sent to the expert.
    if (calm) {
      const waste = state.attempts.filter((a) => ["repair", "review-fix", "advised-fix", "climb", "redo", "continue", "advice", "escalation", "integration"].includes(a.kind));
      if (waste.length > 0) broke(`every agent did its work, yet the engine spent ${waste.length} extra turn(s): ${[...new Set(waste.map((a) => a.kind))].join(", ")}`);
    }
    // Finished or failed for good: nothing of the tasks is left behind.
    const trees = sh(repo, "worktree", "list", "--porcelain").split("\n").filter((l) => l.startsWith("worktree ")).map((l) => l.slice(9));
    if (trees.some((t) => /[\\/]tester$/.test(t))) broke("a reviewer's copy was left behind");
    if (state.status === "finished") {
      const left = trees.filter((t) => /[\\/]tasks[\\/]/.test(t));
      if (left.length > 0) broke(`task work folders left after a finished run: ${left.map((t) => t.split("/tasks/")[1]).join(", ")}`);
      const branches = sh(repo, "branch", "--list", "neuromesh-task/*").trim();
      if (branches) broke(`task branches left after a finished run: ${branches.replace(/\s+/g, " ")}`);
    }
    // The person's own checkout is never touched.
    if (sh(repo, "rev-parse", "HEAD").trim() !== before.head || sh(repo, "rev-parse", "--abbrev-ref", "HEAD").trim() !== before.branch) broke("the repository's own branch or commit changed");
    if (sh(repo, "status", "--porcelain").trim() !== "") broke(`the repository's own files changed: ${sh(repo, "status", "--porcelain").trim().split("\n").slice(0, 3).join("; ")}`);
    // Expert spending: no expert turn starts once the dollar budget is spent.
    if (state.expertBudgetUsd !== undefined && !off.includes("dollar-budget")) {
      const expertTurns = state.attempts.filter((a) => a.tier === "expert");
      for (const [i, a] of expertTurns.entries()) {
        const at = Date.parse(a.startedAt);
        const spent = expertTurns.slice(0, i).filter((b) => Date.parse(b.startedAt) + b.durationMs <= at).reduce((n, b) => n + (estimateCost(b.model, b.usage) ?? 0), 0);
        if (spent >= state.expertBudgetUsd) {
          broke(`an expert turn (${a.kind}${a.task ? ` on ${a.task}` : ""}) started with $${spent.toFixed(2)} of the $${state.expertBudgetUsd} budget already spent`);
          break;
        }
      }
    }
    // A task is not worked on forever.
    const perTask = new Map<string, number>();
    for (const a of state.attempts) perTask.set(a.task ?? "-", (perTask.get(a.task ?? "-") ?? 0) + 1);
    for (const [task, n] of perTask) if (n > 40) broke(`${n} turns on ${task === "-" ? "planning" : `task ${task}`}`);
    // A task starts only after what it depends on has passed.
    const mergedAt = new Map<string, number>();
    events.forEach((e, i) => {
      if (e.type === "task.merged" || e.type === "task.split") mergedAt.set(String(e.task), i);
    });
    events.forEach((e, i) => {
      if (e.type !== "task.started") return;
      const t = state!.tasks.find((x) => x.id === e.task);
      for (const dep of t?.dependsOn ?? []) {
        const at = mergedAt.get(dep);
        const depTask = state!.tasks.find((x) => x.id === dep);
        if (depTask && depTask.status === "passed" && (at === undefined || at > i)) broke(`task ${t!.id} started before ${dep} was merged`);
      }
    });
    // The event log tells the whole story.
    if (events.length > 0 && events[0]?.type !== (options.resume && state.attempts.length > 0 && events[0]?.type === "run.resumed" ? "run.resumed" : "run.started")) broke(`the first event is ${events[0]?.type}`);
    const startedTurns = events.filter((e) => e.type === "agent.started").length;
    const finishedTurns = events.filter((e) => e.type === "agent.finished").length;
    if (startedTurns !== finishedTurns && state.status !== "interrupted") broke(`${startedTurns} turns started but ${finishedTurns} finished in the event log`);
    const last = events.at(-1)?.type;
    if (!hung && !runaway && events.length > 0 && last !== `run.${state.status}`) broke(`the last event is ${last}, for a run that is ${state.status}`);
    // The event file on disk is whole.
    let damaged = 0;
    for (const line of readFileSync(join(state.dir, "events.jsonl"), "utf8").split("\n")) {
      try {
        if (line.trim()) JSON.parse(line);
      } catch {
        damaged += 1;
      }
    }
    // A kill may cut the line being written; nothing else may damage the log.
    if (damaged > (options.resume ? 1 : 0)) broke(`the event log on disk has ${damaged} damaged line(s)`);
    // Last, what the person does next: apply the result. What the run built is what they get.
    if (state.status === "finished" && state.outcome?.checks !== "failed" && !hung && !runaway) {
      const built = new Map<string, string | undefined>();
      for (const f of state.outcome?.files ?? []) built.set(f.path, existsSync(join(state.worktree, f.path)) ? readFileSync(join(state.worktree, f.path), "utf8") : undefined);
      try {
        applyRun(loadState(state.dir));
        for (const [path, text] of built) {
          const got = existsSync(join(repo, path)) ? readFileSync(join(repo, path), "utf8") : undefined;
          if (got !== text) {
            broke(`after applying, ${path} in the repository is not what the run built`);
            break;
          }
        }
        if (state.outcome?.checks === "passed" && withChecks && existsSync(join(repo, "check.js"))) {
          try {
            execFileSync("node", ["check.js"], { cwd: repo, stdio: "ignore" });
          } catch {
            broke("the checks passed in the run, but fail in the repository after applying it");
          }
        }
        const after = sh(repo, "worktree", "list", "--porcelain").split("\n").filter((l) => l.startsWith("worktree ")).length;
        if (after !== 1) broke(`${after - 1} work folder(s) left after applying`);
        if (sh(repo, "branch", "--list", "neuromesh*").trim()) broke("run branches left after applying");
      } catch (error) {
        broke(`applying the finished run failed: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
      }
    }
  } else if (!hung && violations.length === 0) {
    broke("the run returned nothing");
  }

  return { seed, scenario, status: state?.status ?? "none", reason: state?.reason, calls: calls.length, resumes, ms: Date.now() - started, violations };
}
