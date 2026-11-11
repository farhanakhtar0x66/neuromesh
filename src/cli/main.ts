#!/usr/bin/env node
// Neuromesh command line.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { backends } from "../backends/index.ts";
import { CALLS, formatReports, isConformant, runDoctor } from "../doctor/doctor.ts";
import type { CallName, DoctorReport } from "../doctor/doctor.ts";
import { applyRun, currentPatch, discardRun } from "../engine/apply.ts";
import { clearCooldowns, coolingModels } from "../engine/cooldown.ts";
import { resumeRun, startRun } from "../engine/run.ts";
import type { EngineContext } from "../engine/run.ts";
import { defaultHome, findRun, listRuns } from "../engine/store.ts";
import type { NeuromeshEvent } from "../engine/store.ts";
import type { RunState } from "../engine/types.ts";
import { DEFAULT_PRESET, describeRole, listPresets, loadPreset } from "../presets/presets.ts";
import { findRepo } from "../workspace/workspace.ts";
import { evalDir, loadReport, loadTasks, recheckEval, runEval } from "../eval/eval.ts";
import { formatComparison, formatEvalReport, formatEvent, formatRunList, formatSummary, green, red } from "./format.ts";

const HELP = `neuromesh: a multi-agent coding engine built like a factory floor

  neuromesh run "<request>"     work on a request in the current git repository
      --preset <name>           which models to use (default: ${DEFAULT_PRESET}); see "neuromesh presets"
      --backend <id>            override the worker's backend (agy, claude, codex)
      --model <id>              override the worker's model
      --effort <level>          override the worker's effort
      --repairs <n>             extra worker turns per task for failing checks or review findings
      --solo / --team           with a team preset: skip the orchestrator, or always use it
      --expert-budget <tokens>  most expert tokens (fresh input + output) this run may spend
      --prompt-file <path>      read the request from a file
      --json                    print events as JSON lines instead of progress text

  neuromesh status [run]        list runs, or show one run
  neuromesh diff [run]          print a run's changes as a patch
  neuromesh apply [run]         apply a finished run's changes to your working tree
      --force                   apply even if checks failed or the run did not finish
      --keep                    keep the run's worktree afterwards
  neuromesh discard [run]       throw a run's changes away
  neuromesh resume [run]        continue an interrupted, paused or failed run
  neuromesh eval                run the task suite against a preset (live model calls)
      --preset <name>           preset to measure (default: ${DEFAULT_PRESET})
      --tasks a,b  --kinds k,l  run only some tasks, or some kinds (bug, feature, multi, ...)
      --name <name>             results name; rerunning a name continues where it stopped
      --rerun a,b               run these tasks again even though they have results
  neuromesh eval compare <name> <name>...   compare saved eval results
  neuromesh eval recheck <name>...          rerun hidden checks on applied results (no model calls)
  neuromesh cooldowns [--clear] models waiting for a subscription limit to reset
  neuromesh presets             list presets
  neuromesh doctor              check each backend with a few small live calls

  [run] is a run id, the end of one, or "last" (the default).
  --repo <path> works with any command to point at another repository.
`;

const BOOLEAN_FLAGS = new Set(["json", "force", "keep", "help", "verbose", "solo", "team", "clear"]);

interface Parsed {
  positional: string[];
  flags: Map<string, string>;
}

function parseArgs(argv: string[]): Parsed {
  const positional: string[] = [];
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const [key, inline] = arg.slice(2).split("=", 2) as [string, string | undefined];
    if (inline !== undefined) flags.set(key, inline);
    else if (BOOLEAN_FLAGS.has(key)) flags.set(key, "true");
    else {
      const value = argv[i + 1];
      if (value === undefined) throw new Error(`--${key} needs a value`);
      flags.set(key, value);
      i++;
    }
  }
  return { positional, flags };
}

function engineContext(flags: Map<string, string>, signal: AbortSignal): EngineContext {
  const json = flags.has("json");
  return {
    home: defaultHome(),
    backends,
    signal,
    onEvent: (event: NeuromeshEvent) => {
      if (json) {
        process.stdout.write(JSON.stringify(event) + "\n");
        return;
      }
      const line = formatEvent(event);
      if (line !== undefined) process.stderr.write(line + "\n");
    },
  };
}

/** First Ctrl-C stops the run cleanly so it can be resumed; a second one exits at once. */
function interruptible(): AbortController {
  const controller = new AbortController();
  let count = 0;
  const handler = (): void => {
    count += 1;
    if (count === 1) {
      process.stderr.write("\nStopping the run… (press Ctrl-C again to quit immediately)\n");
      controller.abort();
    } else {
      process.exit(130);
    }
  };
  process.on("SIGINT", handler);
  process.on("SIGTERM", handler);
  return controller;
}

function exitCodeFor(state: RunState): number {
  if (state.status === "finished") return state.outcome?.checks === "failed" ? 1 : 0;
  if (state.status === "paused") return 3;
  if (state.status === "interrupted") return 130;
  return 1;
}

function finish(state: RunState, flags: Map<string, string>): number {
  if (!flags.has("json")) process.stdout.write("\n" + formatSummary(state) + "\n");
  return exitCodeFor(state);
}

function repoRoot(flags: Map<string, string>): string {
  return findRepo(flags.get("repo") ?? process.cwd()).root;
}

async function commandRun({ positional, flags }: Parsed): Promise<number> {
  const file = flags.get("prompt-file");
  const prompt = (file ? readFileSync(file, "utf8") : positional.join(" ")).trim();
  if (prompt === "") {
    process.stderr.write('Give a request: neuromesh run "add a --verbose flag to the CLI"\n');
    return 2;
  }
  const preset = loadPreset(flags.get("preset") ?? DEFAULT_PRESET);
  const repairs = flags.has("repairs") ? Number.parseInt(flags.get("repairs")!, 10) : undefined;
  const controller = interruptible();
  const state = await startRun(
    {
      cwd: flags.get("repo") ?? process.cwd(),
      prompt,
      preset,
      worker: { backend: flags.get("backend"), model: flags.get("model"), effort: flags.get("effort") },
      repairs: Number.isInteger(repairs) ? repairs : undefined,
      mode: flags.has("solo") ? "solo" : flags.has("team") ? "team" : undefined,
      expertBudget: flags.has("expert-budget") ? Number.parseInt(flags.get("expert-budget")!, 10) : undefined,
    },
    engineContext(flags, controller.signal),
  );
  return finish(state, flags);
}

async function commandEval({ positional, flags }: Parsed): Promise<number> {
  const home = defaultHome();
  if (positional[0] === "compare") {
    const names = positional.slice(1);
    const reports = names.map((n) => {
      const r = loadReport(home, n);
      if (!r) throw new Error(`No eval results named "${n}" in ${join(home, "evals")}`);
      return r;
    });
    process.stdout.write(formatComparison(reports) + "\n");
    return 0;
  }
  if (positional[0] === "recheck") {
    for (const n of positional.slice(1)) {
      for (const c of recheckEval(home, n, loadTasks())) {
        process.stdout.write(`${n}  ${c.task.padEnd(22)} ${c.before} -> ${c.after}${c.before !== c.after ? "  (changed)" : ""}\n`);
      }
    }
    return 0;
  }
  const preset = loadPreset(flags.get("preset") ?? DEFAULT_PRESET);
  const tasks = loadTasks(undefined, {
    names: flags.get("tasks")?.split(",").filter(Boolean),
    kinds: flags.get("kinds")?.split(",").filter(Boolean),
  });
  const name = flags.get("name") ?? `${preset.name}-${new Date().toISOString().slice(0, 10)}`;
  const controller = interruptible();
  const ctx = engineContext(new Map(), controller.signal);
  const verbose = flags.has("verbose");
  ctx.onEvent = (event) => {
    if (!verbose && (event.type === "agent.activity" || event.type === "checks.detected" || event.type === "workspace.ready")) return;
    const line = formatEvent(event);
    if (line !== undefined) process.stderr.write(`    ${line}\n`);
  };
  process.stderr.write(`Eval ${name}: ${tasks.length} task(s) on preset ${preset.name}. Results: ${evalDir(home, name)}\n`);
  const report = await runEval({
    name,
    preset,
    tasks,
    ctx,
    rerun: flags.get("rerun")?.split(",").filter(Boolean),
    onTaskStart: (task, i, total) => process.stderr.write(`\n[${i + 1}/${total}] ${task.name} (${task.kind}, ${task.language})\n`),
    onTaskDone: (r) =>
      process.stderr.write(
        `  -> ${r.hidden === "pass" ? green("hidden tests pass") : red(`hidden tests ${r.hidden}`)} · ${r.status}` +
          (r.reason ? ` · ${r.reason.slice(0, 160)}` : "") +
          "\n",
      ),
  });
  process.stdout.write("\n" + formatEvalReport(report) + "\n");
  return 0;
}

async function commandResume({ positional, flags }: Parsed): Promise<number> {
  const state = findRun(defaultHome(), repoRoot(flags), positional[0]);
  const controller = interruptible();
  const result = await resumeRun(state, engineContext(flags, controller.signal));
  return finish(result, flags);
}

function commandStatus({ positional, flags }: Parsed): number {
  const root = repoRoot(flags);
  if (positional[0] === undefined) {
    const runs = listRuns(defaultHome(), root);
    if (flags.has("json")) process.stdout.write(JSON.stringify(runs, null, 2) + "\n");
    else process.stdout.write(formatRunList(runs) + "\n");
    return 0;
  }
  const state = findRun(defaultHome(), root, positional[0]);
  if (flags.has("json")) process.stdout.write(JSON.stringify(state, null, 2) + "\n");
  else process.stdout.write(formatSummary(state) + "\n");
  return 0;
}

function commandDiff({ positional, flags }: Parsed): number {
  const state = findRun(defaultHome(), repoRoot(flags), positional[0]);
  const patch = currentPatch(state);
  process.stdout.write(patch === "" ? "(no changes)\n" : patch);
  return 0;
}

function commandApply({ positional, flags }: Parsed): number {
  const state = findRun(defaultHome(), repoRoot(flags), positional[0]);
  const result = applyRun(state, { force: flags.has("force"), keep: flags.has("keep") });
  if (result.method === "nothing") process.stdout.write(`Run ${state.id} made no changes; nothing to apply.\n`);
  else {
    process.stdout.write(
      green(`Applied ${result.files} file${result.files === 1 ? "" : "s"} from run ${state.id}`) +
        (result.method === "three-way" ? " (with a three-way merge; check for conflict markers)" : "") +
        `.\nThe changes are uncommitted in ${state.repo}. Review them with "git diff".\n`,
    );
  }
  return 0;
}

function commandDiscard({ positional, flags }: Parsed): number {
  const state = findRun(defaultHome(), repoRoot(flags), positional[0]);
  discardRun(state);
  process.stdout.write(`Discarded run ${state.id}.\n`);
  return 0;
}

function commandPresets(): number {
  for (const p of listPresets()) {
    process.stdout.write(`${p.name} (${p.mode})\n`);
    if (p.mode === "team") process.stdout.write(`  expert  ${describeRole(p.roles.orchestrator)}\n`);
    process.stdout.write(`  worker  ${describeRole(p.roles.worker)}\n`);
    if (p.roles.tester) process.stdout.write(`  tester  ${describeRole(p.roles.tester)}\n`);
    if (p.mode === "solo" && p.roles.escalation) process.stdout.write(`  expert  ${describeRole(p.roles.escalation)}\n`);
    process.stdout.write(`  ${p.description}\n\n`);
  }
  return 0;
}

// The cheapest model of each backend is enough to test the plumbing.
const DOCTOR_DEFAULTS: Record<string, { model?: string; effort?: string }> = {
  agy: { model: "gemini-3.8-flash-low" },
  claude: { model: "claude-haiku-5-5" },
  codex: { effort: "low" },
};

async function commandDoctor({ flags }: Parsed): Promise<number> {
  const ids = (flags.get("backend") ?? Object.keys(backends).join(",")).split(",").filter(Boolean);
  const models = new Map<string, string>();
  for (const pair of (flags.get("model") ?? "").split(",").filter(Boolean)) {
    const [backend, model] = pair.split("=");
    if (backend && model) models.set(backend, model);
  }
  const only = flags.get("only")?.split(",").filter((c): c is CallName => (CALLS as readonly string[]).includes(c));
  for (const id of ids) {
    if (!backends[id]) {
      process.stderr.write(`unknown backend "${id}". Known: ${Object.keys(backends).join(", ")}\n`);
      return 2;
    }
  }

  // Not the system temp folder: Antigravity refuses writes there.
  const home = defaultHome();
  mkdirSync(home, { recursive: true });
  const workRoot = mkdtempSync(join(home, "doctor-"));
  const reports: DoctorReport[] = await Promise.all(
    ids.map((id) => {
      const defaults = DOCTOR_DEFAULTS[id] ?? {};
      return runDoctor(backends[id]!, {
        model: models.get(id) ?? defaults.model,
        effort: defaults.effort,
        workRoot,
        only,
        onProgress: (probe) => process.stderr.write(`[${id}] ${probe.status.toUpperCase()} ${probe.name}: ${probe.detail}\n`),
      });
    }),
  );

  const saved = join(home, "conformance.json");
  writeFileSync(saved, JSON.stringify({ checkedAt: new Date().toISOString(), reports }, null, 2) + "\n");
  if (flags.has("json")) process.stdout.write(JSON.stringify(reports, null, 2) + "\n");
  else process.stdout.write(formatReports(reports) + "\n");
  process.stderr.write(`\nSaved to ${saved}.` + (flags.has("keep") ? ` Scratch folder kept at ${workRoot}` : "") + "\n");
  if (!flags.has("keep")) rmSync(workRoot, { recursive: true, force: true });
  return reports.every(isConformant) ? 0 : 1;
}

async function main(): Promise<number> {
  const [command, ...rest] = process.argv.slice(2);
  if (command === undefined || command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(HELP);
    return 0;
  }
  const parsed = parseArgs(rest);
  if (parsed.flags.has("help")) {
    process.stdout.write(HELP);
    return 0;
  }
  switch (command) {
    case "run":
      return commandRun(parsed);
    case "resume":
      return commandResume(parsed);
    case "status":
      return commandStatus(parsed);
    case "diff":
      return commandDiff(parsed);
    case "apply":
      return commandApply(parsed);
    case "discard":
      return commandDiscard(parsed);
    case "eval":
      return commandEval(parsed);
    case "cooldowns": {
      if (parsed.flags.has("clear")) clearCooldowns(defaultHome());
      const cooling = coolingModels(defaultHome());
      const rows = Object.entries(cooling);
      process.stdout.write(rows.length === 0 ? "No model is cooling down.\n" : rows.map(([m, c]) => `${m.padEnd(36)} until ${new Date(c.until).toLocaleString()}  ${c.reason.slice(0, 80)}`).join("\n") + "\n");
      return 0;
    }
    case "presets":
      return commandPresets();
    case "doctor":
      return commandDoctor(parsed);
    default:
      process.stderr.write(`Unknown command "${command}".\n\n${HELP}`);
      return 2;
  }
}

try {
  process.exitCode = await main();
} catch (error) {
  process.stderr.write(`neuromesh: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
