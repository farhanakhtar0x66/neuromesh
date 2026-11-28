#!/usr/bin/env node
// Neuromesh command line.

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { NOTICE, allowed as telemetryAllowed, endpoint, flush, outbox, pull, queue, ratingReport, runReport } from "../telemetry/telemetry.ts";
import { ISSUES_URL, writeReport } from "../telemetry/report.ts";
import { formatTesterSummary, parseSince, readInbox, runViews, summarize } from "../telemetry/summary.ts";
import { loadSettings, saveSettings } from "../tui/store.ts";
import { join, resolve } from "node:path";
import { backends } from "../backends/index.ts";
import { CALLS, formatReports, isConformant, runDoctor } from "../doctor/doctor.ts";
import { missingTools, presetBackends } from "./preflight.ts";
import type { CallName, DoctorReport } from "../doctor/doctor.ts";
import { applyRun, currentPatch, discardRun } from "../engine/apply.ts";
import { clearCooldowns, coolingModels } from "../engine/cooldown.ts";
import { resumeRun, startRun } from "../engine/run.ts";
import type { EngineContext } from "../engine/run.ts";
import { defaultHome, findRun, listRuns, loadState } from "../engine/store.ts";
import type { NeuromeshEvent } from "../engine/store.ts";
import type { RunState } from "../engine/types.ts";
import { buildBrief, renderBrief, repoFacts } from "../intake/brief.ts";
import { askRating, entryFor, readLog, recordRating, recordRun, report, usageDir } from "../usage/log.ts";
import { FeatureError, disable, enable, feature, featureTable, hint, inFeature, isOn } from "../features.ts";
import { DEFAULT_PRESET, describeRole, listPresets, loadPreset } from "../presets/presets.ts";
import { findRepo } from "../workspace/workspace.ts";
import { evalDir, loadReport, loadTasks, recheckEval, recountEval, runEval } from "../eval/eval.ts";
import { referenceBackend } from "../eval/reference.ts";
import { claimsDir } from "../eval/isolation.ts";
import { ROUTING_HELP, commandRouting } from "./routing.ts";
import { bold, formatComparison, formatEvalReport, formatEvent, formatRunList, formatSummary, green, red } from "./format.ts";

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
  neuromesh eval                run the task suite against a preset (live model calls; --suite <folder>, --fake for none)
      --preset <name>           preset to measure (default: ${DEFAULT_PRESET})
      --tasks a,b  --kinds k,l  run only some tasks, or some kinds (bug, feature, multi, ...)
      --name <name>             results name; rerunning a name continues where it stopped
      --rerun a,b               run these tasks again even though they have results
      --model <id>              use this worker model instead of the preset's
      --sequential-by-task      wait while another eval runs the same task (shared prompt cache); by default it only warns
  neuromesh eval compare <name> <name>...   compare saved eval results
  neuromesh eval recheck <name>...          rerun hidden checks on applied results (no model calls)
  neuromesh cooldowns [--clear] models waiting for a subscription limit to reset
  neuromesh brief "<request>"   show the brief and staffing the engine would use, without running
${ROUTING_HELP}  neuromesh                     (no command, in a terminal) open the TUI; also \`neuromesh tui\` [--preset <name>]
  neuromesh features            the features added since v0.1, their ids and whether they are on
                                (--disable <id or key,...> switches features off for any command;
                                --enable <id or key,...> switches on those that are off by default)
  neuromesh usage               the usage log: real runs by preset, cost, time and your ratings
  neuromesh rate <run> <1-5>    rate a run against your usual way of working (--usual "<what>")
  neuromesh presets             list presets
  neuromesh report [run]        report a bad run: writes a file with the run's timeline, the agents' reports
      --note "<what went wrong>" and your request, with code, paths, names and keys removed; nothing is sent
  neuromesh telemetry [on|off|pull|summary]
                                share run reports with Neuromesh's author (asked once in the TUI),
                                stop sharing, or (the author) fetch everyone's reports, or
                                read them: summary [--since 7d] [--offline]
  neuromesh doctor              check each backend with a few small live calls

  [run] is a run id, the end of one, or "last" (the default).
  --repo <path> works with any command to point at another repository.
`;

const BOOLEAN_FLAGS = new Set(["json", "force", "keep", "help", "verbose", "solo", "team", "clear", "quota", "no-log", "no-rate", "fake", "offline", "sequential-by-task"]);

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

async function finish(state: RunState, flags: Map<string, string>): Promise<number> {
  if (!flags.has("json")) process.stdout.write("\n" + formatSummary(state) + "\n");
  // Every real run goes into the usage log (~/.neuromesh/usage), unless --no-log.
  // [F11 usage-log]
  if (!flags.has("no-log") && isOn("usage-log") && state.preset !== "demo" && state.status !== "running") {
    const home = defaultHome();
    try {
      const entry = entryFor(state, (b) => backends[b]?.sessionTotals === true);
      recordRun(home, entry);
      const ended = state.status === "finished" || state.status === "failed";
      const rating = ended && !flags.has("json") && !flags.has("no-rate") ? await askRating(state.id) : undefined;
      if (rating) recordRating(home, rating);
      // [F52 telemetry] With the tester's consent, the same as a report for the owner.
      if (isOn("telemetry") && telemetryAllowed(loadSettings(home).telemetry)) {
        queue(home, runReport(home, state, entry));
        if (rating) queue(home, ratingReport(home, state.id, rating.score, rating.note));
        const sent = await flush(home);
        // [F111 telemetry-summary] Say when a report did not go, and why.
        if (sent.problem && isOn("telemetry-summary") && !flags.has("json")) process.stdout.write(`Report not sent yet: ${sent.problem}.\n`);
      }
      if (!flags.has("json")) process.stdout.write(`Recorded in ${join(usageDir(home), "USAGE.md")}\n`);
    } catch (error) {
      process.stderr.write(`Could not write the usage log: ${error instanceof Error ? error.message : String(error)}\n${hint(feature("usage-log"))}\n`);
    }
  }
  return exitCodeFor(state);
}

const NO_TOKEN = "No admin token: run telemetry-endpoint/deploy.sh (it keeps one in ~/.neuromesh/telemetry/admin-token), or set NEUROMESH_TELEMETRY_ADMIN.\n";

/** The token deploy.sh made, or NEUROMESH_TELEMETRY_ADMIN. */
function adminToken(home: string): string | undefined {
  const file = join(home, "telemetry", "admin-token");
  return process.env.NEUROMESH_TELEMETRY_ADMIN ?? (existsSync(file) ? readFileSync(file, "utf8").trim() : undefined);
}

/** [F52 telemetry] neuromesh telemetry [on|off|pull|summary|status] */
async function commandTelemetry({ positional, flags }: Parsed): Promise<number> {
  const home = defaultHome();
  const what = positional[0] ?? "status";
  const settings = loadSettings(home);
  if (what === "on" || what === "off") {
    saveSettings(home, { ...settings, telemetry: what });
    process.stdout.write(what === "on" ? `Sharing run reports. ${NOTICE[2]}\n` : "Not sharing run reports. Nothing more is sent.\n");
    if (what === "on") await flush(home);
    return 0;
  }
  if (what === "pull") {
    const token = adminToken(home);
    if (!token) {
      process.stderr.write(NO_TOKEN);
      return 2;
    }
    const n = await pull(home, token);
    process.stdout.write(`${n} report${n === 1 ? "" : "s"} saved in ${join(home, "telemetry", "inbox")}\n`);
    return 0;
  }
  // [F111 telemetry-summary] The author's weekly reader.
  if (what === "summary") {
    if (!isOn("telemetry-summary")) {
      process.stderr.write(`The summary is switched off (F111 telemetry-summary). Run without --disable, or read the reports by hand in ${join(home, "telemetry", "inbox")}.\n`);
      return 1;
    }
    const since = parseSince(flags.get("since") ?? "7d");
    try {
      return await inFeature("telemetry-summary", async () => {
        const token = adminToken(home);
        if (!flags.has("offline") && token) {
          try {
            const n = await pull(home, token);
            process.stderr.write(`Fetched ${n} report${n === 1 ? "" : "s"} from the endpoint.\n`);
          } catch (error) {
            process.stderr.write(`Could not fetch new reports (${error instanceof Error ? error.message : String(error)}); reading what the inbox already holds.\n`);
          }
        } else if (!flags.has("offline")) {
          process.stderr.write(`${NO_TOKEN.trim()} Reading what the inbox already holds.\n`);
        }
        const { reports, unreadable } = readInbox(home);
        process.stdout.write(formatTesterSummary(summarize(runViews(reports), since), unreadable));
        return 0;
      });
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n${hint(feature("telemetry-summary"))}\n`);
      return 1;
    }
  }
  let waiting = outbox(home).length;
  let sending = "";
  // [F111 telemetry-summary] Waiting reports are tried now, so the person sees whether they arrive.
  if (waiting > 0 && isOn("telemetry-summary") && telemetryAllowed(settings.telemetry) && endpoint()) {
    const r = await flush(home);
    waiting = r.waiting;
    sending = r.problem ? `Could not send them: ${r.problem}.` : `Sent ${r.sent}.`;
  }
  process.stdout.write(
    [
      `Sharing: ${settings.telemetry === "on" ? "on" : settings.telemetry === "off" ? "off" : "not asked yet (the TUI asks before the first run)"}${process.env.NEUROMESH_TELEMETRY === "off" ? " (but NEUROMESH_TELEMETRY=off)" : ""}`,
      ...(settings.telemetry === "unasked" && isOn("tool-preflight") ? ["To share: `neuromesh telemetry on`. Not to: `neuromesh telemetry off`."] : []),
      `Endpoint: ${endpoint() ?? "not set yet; reports wait in the outbox"}`,
      `Waiting to be sent: ${waiting}${sending ? `. ${sending}` : ""}`,
      "",
      ...NOTICE,
    ].join("\n") + "\n",
  );
  return 0;
}

/** Rate a run after trying its result: neuromesh rate <run> <1-5> [note...] */
function commandRate({ positional, flags }: Parsed): number {
  const [ref, scoreText, ...note] = positional;
  const score = Number.parseInt(scoreText ?? "", 10);
  if (!ref || !(score >= 1 && score <= 5)) {
    process.stderr.write("Usage: neuromesh rate <run|last> <1-5> [note]   (1 much worse ... 5 much better than your usual way)\n");
    return 2;
  }
  const state = findRun(defaultHome(), repoRoot(flags), ref);
  recordRating(defaultHome(), { run: state.id, at: new Date().toISOString(), score, usual: flags.get("usual"), note: note.join(" ") || undefined });
  process.stdout.write(`Rated run ${state.id}: ${score}. Report: ${join(usageDir(defaultHome()), "USAGE.md")}\n`);
  return 0;
}

function commandUsage(): number {
  const log = readLog(defaultHome());
  // [F112 tool-preflight] An empty report said nothing; now it says how a run gets in it.
  if (log.runs.length === 0 && isOn("tool-preflight")) {
    process.stdout.write('No runs recorded yet. A real run, from the TUI (`neuromesh`) or `neuromesh run "..."`, is recorded here once it ends; demo runs are not.\n');
    return 0;
  }
  process.stdout.write(report(log));
  return 0;
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
  // [F112 tool-preflight] A tool that is not installed ends here, saying what to do, not after five retries.
  if (isOn("tool-preflight") && preset.name !== "demo" && !flags.has("backend")) {
    try {
      const missing = await inFeature("tool-preflight", () => missingTools(preset, backends));
      if (missing.length > 0) {
        process.stderr.write(missing.join("\n") + "\n");
        return 2;
      }
    } catch (error) {
      process.stderr.write(`Could not check the tools first (${error instanceof Error ? error.message : String(error)}); going on. ${hint(feature("tool-preflight"))}\n`);
    }
  }
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

/** Show what the brief engine makes of a request, without running anything. */
function commandBrief({ positional, flags }: Parsed): number {
  const file = flags.get("prompt-file");
  const prompt = (file ? readFileSync(file, "utf8") : positional.join(" ")).trim();
  if (prompt === "") {
    process.stderr.write('Give a request: neuromesh brief "build a typing test for the terminal"\n');
    return 2;
  }
  const preset = loadPreset(flags.get("preset") ?? DEFAULT_PRESET);
  const repo = findRepo(flags.get("repo") ?? process.cwd());
  const brief = buildBrief(prompt, repoFacts(repo.root), { team: preset.mode === "team", maxParallel: preset.maxParallel, canSpec: preset.roles.briefer !== undefined, expertSpec: preset.roles.briefer?.[0]?.tier === "expert" });
  const s = brief.staffing;
  process.stdout.write(
    `${bold("Kind")}: ${brief.kind}${brief.surface ? `, ${brief.surface}` : ""}\n` +
      `${bold("Staffing")}: ${s.plan ? `the expert plans; up to ${s.agents} workers at once` : "one worker"}, starting on the ${s.rung === "top" ? "strongest" : "cheapest"} rung; ` +
      `${s.tester ? "tester on" : "no tester"}${s.spec ? "; a cheap model writes a product spec first" : ""}\n` +
      s.reasons.map((r) => `  - ${r}`).join("\n") +
      `\n\n${bold("The brief the agents get")}:\n${renderBrief(brief)}\n`,
  );
  return 0;
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
  if (positional[0] === "recount") {
    for (const n of positional.slice(1)) {
      for (const c of recountEval(home, n)) {
        if (c.before !== c.after) process.stdout.write(`${n}  ${c.task.padEnd(22)} ${Math.round(c.before / 1000)}k -> ${Math.round(c.after / 1000)}k tokens\n`);
      }
    }
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
  // --suite: another folder of tasks, e.g. evals/builds for the judged build tests.
  const tasks = loadTasks(flags.get("suite") ? resolve(flags.get("suite")!) : undefined, {
    names: flags.get("tasks")?.split(",").filter(Boolean),
    kinds: flags.get("kinds")?.split(",").filter(Boolean),
  });
  const name = flags.get("name") ?? `${preset.name}-${new Date().toISOString().slice(0, 10)}`;
  const controller = interruptible();
  const ctx = engineContext(new Map(), controller.signal);
  const verbose = flags.has("verbose");
  // --fake: no model calls. Every build turn writes the task's reference solution (a task folder with a reference/,
  // as the real-repository tasks have), to test seeding, grading and the record end to end for free.
  let currentTask: { dir: string } | undefined;
  if (flags.has("fake")) ctx.backends = { claude: referenceBackend(() => currentTask) };
  ctx.onEvent = (event) => {
    if (!verbose && (event.type === "agent.activity" || event.type === "checks.detected" || event.type === "workspace.ready")) return;
    const line = formatEvent(event);
    if (line !== undefined) process.stderr.write(`    ${line}\n`);
  };
  process.stderr.write(`Eval ${name}: ${tasks.length} task(s) on preset ${preset.name}. Results: ${evalDir(home, name)}\n`);
  // --quota: read the Claude subscription quota around every task (one one-word Haiku call each).
  const quotaProbe = flags.has("quota")
    ? async (): Promise<Record<string, number> | undefined> => {
        const dir = mkdtempSync(join(tmpdir(), "neuromesh-quota-"));
        try {
          const r = await ctx.backends.claude!.run({ cwd: dir, prompt: "Reply with the single word: ok", model: "claude-haiku-5-5", effort: "low", access: "read-only", timeoutMs: 120_000, idleMs: 120_000 });
          return r.quotaUsed;
        } catch {
          return undefined;
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      }
    : undefined;
  // --spec-from <eval>: build each task from the spec an earlier eval's run wrote (no spec turn).
  const specSource = flags.get("spec-from") ? loadReport(home, flags.get("spec-from")!) : undefined;
  if (flags.get("spec-from") && !specSource) throw new Error(`No eval results named "${flags.get("spec-from")}"`);
  const specFor = specSource
    ? (task: { name: string }) => {
        const runId = specSource.results[task.name]?.runId;
        const projects = join(home, "projects");
        const dir = runId && existsSync(projects) ? readdirSync(projects).map((p) => join(projects, p, "runs", runId)).find((d) => existsSync(join(d, "run.json"))) : undefined;
        return dir ? loadState(dir).brief?.spec : undefined;
      }
    : undefined;
  const report = await runEval({
    name,
    preset,
    tasks,
    ctx,
    quotaProbe,
    specFor,
    rerun: flags.get("rerun")?.split(",").filter(Boolean),
    workerModel: flags.get("model"),
    // [F142 replay-harness] One claim folder per machine (the cache is per account); --fake keeps them in its own home.
    isolation: { dir: flags.has("fake") ? join(home, "eval-claims") : claimsDir(), mode: flags.has("sequential-by-task") ? "sequential" : "warn", warn: (m) => process.stderr.write(`  ! ${m}\n`) },
    onTaskStart: (task, i, total) => {
      currentTask = task;
      process.stderr.write(`\n[${i + 1}/${total}] ${task.name} (${task.kind}, ${task.language})\n`);
    },
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

/** [F113 bad-run-report] neuromesh report [run] [--note "..."]: a file to read and paste into an issue. Nothing is sent. */
function commandReport({ positional, flags }: Parsed): number {
  if (!isOn("bad-run-report")) {
    process.stderr.write(`The report command is switched off (F113 bad-run-report). Run without --disable.\n`);
    return 1;
  }
  try {
    const home = defaultHome();
    const state = findRun(home, repoRoot(flags), positional[0]);
    const done = inFeature("bad-run-report", () => writeReport(home, state, flags.get("note"), (b) => backends[b]?.sessionTotals === true));
    const kb = (done.bytes / 1024).toFixed(1);
    process.stdout.write(
      [
        `Wrote ${done.path} (${kb} KB; ${done.eventsShown} of ${done.eventsTotal} events).`,
        "",
        "Next:",
        "  1. Read the file first. It holds no code, diffs, file paths, names, emails or keys, but you know your work best.",
        `  2. Open ${ISSUES_URL}`,
        "     and paste the file's text there, or attach the file.",
        "Nothing has been sent anywhere.",
        ...(flags.has("note") ? [] : ["(No note: add --note \"what went wrong\" and run it again, so the file says what you saw.)"]),
        "",
      ].join("\n"),
    );
    return 0;
  } catch (error) {
    // Only a failure inside the feature is the feature's: "no runs yet" is just the answer.
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n${error instanceof FeatureError ? `${hint(feature("bad-run-report"))}\n` : ""}`);
    return 1;
  }
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
    if (p.workerLadder) process.stdout.write(`  worker  ${p.workerLadder.map((c) => `${c.backend} ${c.model ?? "(default)"}${c.effort ? ` ${c.effort}` : ""}`).join("  →  ")}  (climbs when stuck)\n`);
    else process.stdout.write(`  worker  ${describeRole(p.roles.worker)}\n`);
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
  const ids = (flags.get("backend") ?? Object.keys(backends).filter((id) => id !== "demo").join(",")).split(",").filter(Boolean);
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

  // [F112 tool-preflight] Said before it starts: it does call the models, a little.
  if (isOn("tool-preflight")) process.stderr.write(`Checking ${ids.join(", ")}: a few tiny live calls to each tool that is installed (a few cents of your plan's quota; a tool that is not installed is skipped). This takes a minute or two.\n`);
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
  // [F112 tool-preflight] What the result means for the default preset, and the next step.
  if (isOn("tool-preflight") && !flags.has("json")) {
    const needed = presetBackends(loadPreset(DEFAULT_PRESET));
    const mine = reports.filter((r) => needed.includes(r.backend));
    if (mine.length === needed.length && mine.every(isConformant)) {
      process.stdout.write(`\nReady: ${needed.join(" and ")} passed, which is all the default preset (${DEFAULT_PRESET}) needs${reports.every(isConformant) ? "" : "; a FAIL above for another tool only matters if you pick a preset that uses it"}.\nNext: open a git repository and run \`neuromesh\` (or \`neuromesh tui --preset demo\` to look around first).\n`);
    } else if (mine.length === needed.length) {
      process.stdout.write(`\nNot ready: the default preset (${DEFAULT_PRESET}) needs ${needed.join(" and ")} to pass, and a FAIL above says why. Fix that (run \`${needed[0]}\` once to sign in if it says not signed in), then run \`neuromesh doctor --backend ${needed.join(",")}\` again.\n`);
    }
  }
  return reports.every(isConformant) ? 0 : 1;
}

async function main(): Promise<number> {
  const [command, ...rest] = process.argv.slice(2);
  // [F19 tui] No command in a terminal opens the TUI.
  if ((command === undefined && process.stdin.isTTY && process.stdout.isTTY) || command === "tui") {
    const parsed = parseArgs(command === "tui" ? rest : []);
    if (parsed.flags.get("disable")) {
      process.env.NEUROMESH_DISABLE = [process.env.NEUROMESH_DISABLE, parsed.flags.get("disable")].filter(Boolean).join(",");
      disable(parsed.flags.get("disable"));
    }
    if (parsed.flags.get("enable")) {
      process.env.NEUROMESH_ENABLE = [process.env.NEUROMESH_ENABLE, parsed.flags.get("enable")].filter(Boolean).join(",");
      enable(parsed.flags.get("enable"));
    }
    const { runTui } = await import("../tui/app.ts");
    return runTui({ cwd: parsed.flags.get("repo") ?? process.cwd(), preset: parsed.flags.get("preset") });
  }
  if (command === "--version" || command === "-v" || command === "version") {
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string };
    process.stdout.write(`neuromesh ${pkg.version}\n`);
    return 0;
  }
  if (command === undefined || command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(HELP);
    return 0;
  }
  const parsed = parseArgs(rest);
  // --disable F04,context-packet: switch features off for this command (see `neuromesh features`).
  if (parsed.flags.get("disable")) {
    process.env.NEUROMESH_DISABLE = [process.env.NEUROMESH_DISABLE, parsed.flags.get("disable")].filter(Boolean).join(",");
    disable(parsed.flags.get("disable"));
  }
  // --enable F101: switch on a feature that is off by default.
  if (parsed.flags.get("enable")) {
    process.env.NEUROMESH_ENABLE = [process.env.NEUROMESH_ENABLE, parsed.flags.get("enable")].filter(Boolean).join(",");
    enable(parsed.flags.get("enable"));
  }
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
    case "report":
      return commandReport(parsed);
    case "diff":
      return commandDiff(parsed);
    case "apply":
      return commandApply(parsed);
    case "discard":
      return commandDiscard(parsed);
    case "eval":
      return commandEval(parsed);
    case "brief":
      return commandBrief(parsed);
    case "rate":
      return commandRate(parsed);
    case "usage":
      return commandUsage();
    case "cooldowns": {
      if (parsed.flags.has("clear")) clearCooldowns(defaultHome());
      const cooling = coolingModels(defaultHome());
      const rows = Object.entries(cooling);
      process.stdout.write(rows.length === 0 ? "No model is cooling down.\n" : rows.map(([m, c]) => `${m.padEnd(36)} until ${new Date(c.until).toLocaleString()}  ${c.reason.slice(0, 80)}`).join("\n") + "\n");
      return 0;
    }
    case "features":
      process.stdout.write(featureTable() + "\n");
      return 0;
    case "presets":
      return commandPresets();
    case "telemetry":
      return commandTelemetry(parsed);
    case "doctor":
      return commandDoctor(parsed);
    case "routing":
      return commandRouting(parsed.positional, parsed.flags, backends);
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
