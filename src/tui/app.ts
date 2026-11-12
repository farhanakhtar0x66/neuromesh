// [F19 tui] The TUI: projects and sessions on the left, the run in the middle,
// the team and its numbers on the right. It drives the same engine as
// `neuromesh run`, through the engine's events and run records only.

import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, readSync, closeSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { backends } from "../backends/index.ts";
import { applyRun, currentPatch, discardRun } from "../engine/apply.ts";
import { resumeRun, startRun } from "../engine/run.ts";
import type { Answer, EngineContext, Question } from "../engine/run.ts";
import { defaultHome, loadState, runsDir } from "../engine/store.ts";
import type { NeuromeshEvent } from "../engine/store.ts";
import type { RunState } from "../engine/types.ts";
import { FEATURES, feature, hint, inFeature, isOn } from "../features.ts";
import { DEFAULT_PRESET, listPresets, loadPreset } from "../presets/presets.ts";
import type { Preset } from "../presets/presets.ts";
import { entryFor, readLog, recordRating, recordRun } from "../usage/log.ts";
import { findRepo } from "../workspace/workspace.ts";
import { hitTest } from "./canvas.ts";
import type { Region } from "./canvas.ts";
import { COMMANDS, SLASH, commandAt } from "./commands.ts";
import type { Command } from "./commands.ts";
import { Composer } from "./composer.ts";
import { FileIndex, History, bestMatches } from "./files.ts";
import { applyEvent, finished, newModel, note, submitted, toast } from "./model.ts";
import type { Choice, Dialog, Model, SessionView } from "./model.ts";
import { newSaver, saverFrame } from "./screensaver.ts";
import type { Paint, Saver } from "./screensaver.ts";
import { allSessions, branchOf, loadProjects, loadSettings, saveProjects, saveSettings, titleOf, trashSession } from "./store.ts";
import type { ProjectsFile, SessionRecord, Settings } from "./store.ts";
import { Terminal, readColourReplies } from "./term.ts";
import { CUSTOM, FAVOURITES, modelChoices, opencodeModels, saveTeam, teamProblem } from "./team.ts";
import type { ModelChoice, Team } from "./team.ts";
import { allowed as telemetryAllowed, flush as flushReports, queue as queueReport, ratingReport, runReport } from "../telemetry/telemetry.ts";
import type { Key, Mouse } from "./term.ts";
import { setTerminalColours, setTheme, setTransparent } from "./theme.ts";
import { LOGO_WIDE, SETTINGS_ROWS, composerWidth, layoutOf, motionNeeded, pickerChoices, render, sidebarRows } from "./view.ts";
import type { Frame } from "./view.ts";

export interface TuiOptions {
  cwd: string;
  preset?: string;
}

const ROLE_LABEL: Record<string, string> = { orchestrator: "lead", briefer: "spec", worker: "worker", tester: "tester", escalation: "expert" };

/** Who does what in a preset, for the right pane before a run starts. */
export function teamOf(preset: Preset): { role: string; model: string }[] {
  const out: { role: string; model: string }[] = [];
  const seen = new Set<string>();
  const add = (role: string, c: { backend: string; model?: string; effort?: string } | undefined): void => {
    if (!c) return;
    const model = `${c.model ?? c.backend}${c.effort ? ` ${c.effort}` : ""}`;
    if (seen.has(`${role}/${model}`)) return;
    seen.add(`${role}/${model}`);
    out.push({ role, model });
  };
  for (const role of ["orchestrator", "briefer"] as const) add(ROLE_LABEL[role]!, preset.roles[role]?.[0]);
  if (preset.workerLadder) for (const c of preset.workerLadder) add("worker", c);
  else add("worker", preset.roles.worker?.[0]);
  add("tester", preset.roles.tester?.[0]);
  add("expert", preset.roles.escalation?.[0]);
  return out;
}

function readEvents(state: RunState): NeuromeshEvent[] {
  const path = join(state.dir, "events.jsonl");
  if (!existsSync(path)) return [];
  const out: NeuromeshEvent[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as NeuromeshEvent);
    } catch {
      // A damaged line is skipped.
    }
  }
  return out;
}

const view = (s: SessionRecord): SessionView => ({ id: s.id, title: s.title, status: s.status, at: s.at, files: s.files, repo: s.repo, dir: s.dir, runs: s.runs });

/** [F38 attachments] A file's text, when it is a text file of a sensible size. */
function readAttachment(path: string): string | undefined {
  try {
    const size = statSync(path).size;
    if (size > 200_000) return undefined;
    const fd = openSync(path, "r");
    const head = Buffer.alloc(Math.min(size, 8_192));
    readSync(fd, head, 0, head.length, 0);
    closeSync(fd);
    if (head.includes(0)) return undefined;
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

/** [F34 tui-projects] [F38 attachments] The system's own file chooser, where there is one. */
function choose(kind: "folder" | "files"): Promise<string[] | undefined> {
  return new Promise((done) => {
    let cmd: string;
    let args: string[];
    if (process.platform === "darwin") {
      cmd = "osascript";
      args =
        kind === "folder"
          ? ["-e", 'POSIX path of (choose folder with prompt "Choose the project\'s folder")']
          : ["-e", 'set fs to choose file with prompt "Attach files to the request" with multiple selections allowed', "-e", 'set out to ""', "-e", "repeat with f in fs", "-e", "set out to out & POSIX path of f & linefeed", "-e", "end repeat", "-e", "return out"];
    } else if (spawnSync("sh", ["-c", "command -v zenity"]).status === 0) {
      cmd = "zenity";
      args = kind === "folder" ? ["--file-selection", "--directory"] : ["--file-selection", "--multiple", "--separator=\n"];
    } else return done(undefined);
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString("utf8")));
    child.on("error", () => done(undefined));
    child.on("exit", (code) => done(code === 0 ? out.split("\n").map((l) => l.trim().replace(/\/$/, "")).filter(Boolean) : []));
  });
}

export async function runTui(options: TuiOptions): Promise<number> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write("The Neuromesh TUI needs an interactive terminal. Use `neuromesh run \"<request>\"` in scripts.\n");
    return 2;
  }
  const home = defaultHome();
  // [F45 tui-settings]
  const settings: Settings = isOn("tui-settings") ? loadSettings(home) : loadSettings("/nonexistent");
  if (!process.env.NEUROMESH_THEME) setTheme(settings.theme);
  setTransparent(settings.transparent);
  let projectsFile: ProjectsFile = isOn("tui-projects") ? loadProjects(home) : { projects: [], folded: [] };
  let preset = loadPreset(options.preset ?? DEFAULT_PRESET);
  let repoRoot: string | undefined;
  let repoError: string | undefined;
  let files = new FileIndex(undefined);
  const history = new History(home);
  let motion = process.env.NEUROMESH_MOTION !== "off" && isOn("tui-motion") && settings.motion;

  const projectName = (root: string | undefined): string | undefined => (root ? (projectsFile.projects.find((p) => p.path === root)?.name ?? basename(root)) : undefined);

  const applySettings = (m: Model): void => {
    m.motion = motion;
    m.verbose = settings.verbose;
    m.access = settings.access;
    m.showSidebar = settings.sidebar;
    m.showInfo = settings.info;
    m.settings = Object.fromEntries(Object.entries(settings).map(([k, v]) => [k, String(v)]));
  };

  /** Work in another folder from now on (a project, or a session's folder). */
  const setRepo = (path: string): boolean => {
    try {
      repoRoot = findRepo(path).root;
      repoError = undefined;
    } catch (error) {
      repoRoot = undefined;
      repoError = error instanceof Error ? error.message.split("\n")[0]! : String(error);
    }
    files = new FileIndex(repoRoot);
    return repoRoot !== undefined;
  };
  setRepo(options.cwd);
  let cwd = repoRoot ?? options.cwd;

  const refreshSidebar = (m: Model): void => {
    if (!isOn("tui-projects")) return;
    try {
      const all = allSessions(home);
      const inProject = new Set(projectsFile.projects.map((p) => p.path));
      m.projects = projectsFile.projects.map((p) => ({ name: p.name, path: p.path, sessions: all.filter((s) => s.repo === p.path).slice(0, 40).map(view) }));
      m.recents = all.filter((s) => !inProject.has(s.repo)).slice(0, 60).map(view);
      m.folded = new Set(projectsFile.folded);
    } catch (error) {
      toast(m, `Sessions could not be listed: ${error instanceof Error ? error.message : String(error)}`, "red");
    }
  };

  const fresh = (): Model => {
    const m = newModel(preset.name, repoRoot ? basename(repoRoot) : undefined, repoError);
    applySettings(m);
    m.cwd = cwd;
    m.repoRoot = repoRoot;
    m.projectName = projectName(repoRoot);
    m.branch = branchOf(repoRoot);
    m.team = teamOf(preset);
    m.budgetUsd = preset.expertBudgetUsd;
    refreshSidebar(m);
    return m;
  };
  let model = fresh();
  model.introAt = Date.now();
  const composer = new Composer();
  const term = new Terminal();
  let controller: AbortController | undefined;
  let running: Promise<RunState> | undefined;
  let steer: { compact?: boolean } = {};
  let answerAsk: ((a: Answer) => void) | undefined;
  let quitting = false;
  let lastEsc = 0;
  let lastInput = Date.now();
  let saver: Saver | undefined;
  let external: ChildProcess | undefined;
  const saverSetting = process.env.NEUROMESH_SCREENSAVER ?? "on";
  const afterSetting = process.env.NEUROMESH_SCREENSAVER_AFTER;
  const idleMs = afterSetting === "off" ? Infinity : Math.max(10, Number(afterSetting ?? 240) || 240) * 1_000;
  const session = { runs: 0, cost: 0, unapplied: new Set<string>() };
  let resolveExit: (code: number) => void = () => {};
  const exited = new Promise<number>((r) => (resolveExit = r));
  let frame: Frame | undefined;

  const persist = (): void => {
    if (!isOn("tui-settings")) return;
    try {
      saveSettings(home, settings);
    } catch (error) {
      toast(model, `Settings not saved: ${error instanceof Error ? error.message : String(error)}`, "red");
    }
  };
  const persistProjects = (): void => {
    try {
      projectsFile.folded = [...model.folded];
      saveProjects(home, projectsFile);
    } catch (error) {
      toast(model, `Projects not saved: ${error instanceof Error ? error.message : String(error)}`, "red");
    }
  };

  // [F28 tui-notify] The title says what is happening, so it shows in tabs and docks.
  const setTitle = (): void => {
    if (!isOn("tui-notify")) return;
    const where = model.projectName ?? "neuromesh";
    term.title(running ? `● ${where} · ${model.stage}` : model.run ? `${where} · ${model.run.status}` : `neuromesh · ${where}`);
  };

  // ---------------------------------------------------------------------------
  // [F46 tui-fps] Drawing: at once after input or an event; then at the frame
  // rate while something moves, four times a second for slow motion, and not
  // at all when still.

  const draw = (): void => {
    if (external) return;
    const { cols, rows } = term.size();
    if (saver) {
      try {
        const elapsed = model.startedAt ? Date.now() - model.startedAt : 0;
        const mins = Math.floor(elapsed / 60_000);
        const status = running
          ? `neuromesh is still working · ${model.stage} · ${mins > 0 ? `${mins}m ` : ""}${Math.floor((elapsed % 60_000) / 1_000)}s · move the mouse or press a key`
          : "move the mouse or press a key";
        const paint: Paint = process.env.NO_COLOR ? "none" : /truecolor|24bit/i.test(process.env.COLORTERM ?? "") ? "true" : "256";
        term.draw(saverFrame(saver, LOGO_WIDE, cols, rows, Date.now(), paint, status));
      } catch (error) {
        stopSaver();
        toast(model, `Screensaver failed: ${error instanceof Error ? error.message : String(error)}. ${hint(feature("tui-screensaver"))}`, "red", 8_000);
      }
      return;
    }
    try {
      frame = render(model, composer, cols, rows);
      term.drawCanvas(frame.canvas, frame.cursor);
    } catch (error) {
      // A drawing bug must not leave the terminal unusable: show it, tagged.
      term.draw([`Neuromesh TUI drawing error: ${error instanceof Error ? error.message : String(error)}`, hint(feature("tui")), "Ctrl+Q quits."]);
    }
  };

  let timer: NodeJS.Timeout | undefined;
  let soon = false;
  const loop = (): void => {
    timer = undefined;
    const now = Date.now();
    // [F31 tui-screensaver] A long run and nobody at the keyboard or mouse: show the screensaver.
    if (!saver && !external && running && isOn("tui-screensaver") && saverSetting !== "off" && now - lastInput >= idleMs && !model.palette && !model.picker && !model.dialog && !model.ask) startSaver();
    draw();
    plan();
  };
  const plan = (): void => {
    if (timer) clearTimeout(timer);
    const fps = isOn("tui-fps") ? settings.fps : 30;
    const need = saver ? "fast" : motionNeeded(model, term.size().cols);
    const delay = need === "fast" ? 1000 / fps : need === "slow" ? 250 : running ? 1_000 : 0;
    timer = delay > 0 ? setTimeout(loop, delay) : undefined;
  };
  const redraw = (): void => {
    if (soon) return;
    soon = true;
    setImmediate(() => {
      soon = false;
      loop();
    });
  };

  // ---------------------------------------------------------------------------
  // Runs.

  /** [F47 tui-markdown] The final report: what the agents said they did, from this run's reports. */
  const finalReport = (m: Model): { text: string; role: string; model?: string } | undefined => {
    const since = m.log.map((e) => e.kind).lastIndexOf("you");
    const reports = m.log.slice(since + 1).flatMap((e) => (e.kind === "event" && e.e.type === "task.report" ? [e.e] : []));
    // The last report of each task is the one that counts.
    const byTask = new Map<string, NeuromeshEvent>();
    for (const r of reports) byTask.set(String(r.task ?? "main"), r);
    if (byTask.size === 0) return undefined;
    const last = [...byTask.values()].at(-1)!;
    const role = String(last.role ?? "worker");
    const model = m.agents.get(`${role}:${String(last.task ?? "")}`)?.model;
    const body = (r: NeuromeshEvent): string => [String(r.summary ?? "").trim(), r.notes ? String(r.notes).trim() : ""].filter(Boolean).join("\n\n");
    if (byTask.size === 1) return { text: body(last), role, model };
    const title = (id: string): string => m.tasks.get(id)?.title ?? id;
    return { text: [...byTask.entries()].map(([id, r]) => `## ${id} · ${title(id)}\n\n${body(r)}`).join("\n\n"), role, model };
  };

  const settle = (m: Model, state: RunState): void => {
    finished(m, state);
    m.brandAt = Date.now();
    if (isOn("tui-markdown")) {
      const report = finalReport(m);
      if (report && report.text) {
        m.log.push({ kind: "final", ...report, at: Date.now() });
        m.readFrom = "final";
      }
    }
    try {
      const patch = state.status === "finished" || state.status === "applied" ? currentPatch(state) : "";
      if (patch.trim()) {
        const o = state.outcome;
        m.log.push({ kind: "diff", text: `Changes: ${o?.files.length ?? 0} file${o?.files.length === 1 ? "" : "s"} (+${o?.insertions ?? 0} −${o?.deletions ?? 0})`, lines: patch.trimEnd().split("\n"), at: Date.now() });
      }
    } catch {
      // The diff is a convenience; the result card still offers it.
    }
    m.log.push({ kind: "result", at: Date.now() });
  };

  /** [F39 ask-first] The engine's question waits here until the person answers. */
  const ask = (q: Question): Promise<Answer> =>
    new Promise((resolveAnswer) => {
      answerAsk = (a) => {
        answerAsk = undefined;
        resolveAnswer(a);
      };
      void q;
      if (isOn("tui-notify")) term.bell();
      redraw();
    });

  const answer = (a: Answer): void => {
    if (!answerAsk) return;
    answerAsk(a);
    redraw();
  };

  /** Run the engine (a new run, or a resumed one) with this model receiving its events. */
  const drive = (m: Model, go: (ctx: EngineContext) => Promise<RunState>): void => {
    controller = new AbortController();
    steer = {};
    const ctx: EngineContext = {
      home,
      backends,
      signal: controller.signal,
      onEvent: (e: NeuromeshEvent) => (applyEvent(m, e), setTitle(), redraw()),
      steer,
      // Asked only in Normal mode, and read when the question comes, so switching mode mid-run counts.
      get ask() {
        return isOn("ask-first") && settings.access === "normal" ? ask : undefined;
      },
    };
    running = go(ctx);
    session.runs += 1;
    const costBefore = m.cost;
    running
      .then((state) => {
        settle(m, state);
        session.cost += m.cost - costBefore;
        if (state.status === "finished" && (state.outcome?.files.length ?? 0) > 0) session.unapplied.add(state.id);
        // [F11 usage-log] Real runs from the TUI are recorded too; demo runs never.
        if (isOn("usage-log") && preset.name !== "demo") {
          try {
            const entry = entryFor(state, (b) => backends[b]?.sessionTotals === true);
            recordRun(home, entry);
            // [F52 telemetry] With consent, the same as a report for the author.
            if (isOn("telemetry") && telemetryAllowed(settings.telemetry)) {
              queueReport(home, runReport(home, state, entry));
              void flushReports(home);
            }
          } catch (error) {
            toast(m, `Usage log not written: ${error instanceof Error ? error.message : String(error)}`, "red");
          }
        }
        refreshSidebar(m);
        files.refresh();
        if (isOn("tui-notify")) term.bell();
      })
      .catch((error: unknown) => {
        m.log.push({ kind: "error", text: `Engine error: ${error instanceof Error ? error.message : String(error)}`, at: Date.now() });
        m.stage = "failed";
      })
      .finally(() => {
        running = undefined;
        controller = undefined;
        answerAsk = undefined;
        if (saver || external) stopSaver();
        setTitle();
        redraw();
        if (quitting) resolveExit(0);
      });
    refreshSidebar(m);
    setTitle();
    redraw();
  };

  const start = (prompt: string): void => {
    if (!repoRoot) return void toast(model, repoError ?? "Not in a git repository", "red", 8_000);
    const m = model;
    if (isOn("tui-history")) history.add(prompt);
    const attached = m.attachments.map((a) => ({ path: a.path, text: readAttachment(a.path) }));
    // [F49 follow-up] The run this one follows: the session's latest, read before the new one clears it.
    const previous = m.runId;
    submitted(m, prompt, m.attachments.map((a) => a.path));
    m.attachments = [];
    composer.clear();
    model.suggest = undefined;
    const root = repoRoot;
    // [F49 follow-up] In a session that already has a run, this one follows it.
    let follows: RunState | undefined;
    if (isOn("follow-up") && previous) {
      try {
        follows = loadState(join(runsDir(home, root), previous));
      } catch {
        follows = undefined;
      }
    }
    drive(m, (ctx) => startRun({ cwd: root, prompt, preset, attachments: attached.length ? attached : undefined, follows }, ctx));
  };

  // [F24 tui-sessions] [F49 follow-up] Reopen an earlier session (of any folder): each of its runs, in order.
  const openSession = (dir: string): void => {
    if (running) return void toast(model, "A run is going; stop it before opening another session.", "amber");
    const group = [...model.recents, ...model.projects.flatMap((p) => p.sessions)].find((s) => s.dir === dir || s.runs?.includes(dir));
    let states: RunState[];
    try {
      states = (group?.runs ?? [dir]).map((d) => loadState(d));
    } catch {
      return void toast(model, "That session is gone.", "red");
    }
    const state = states.at(-1)!;
    if (state.repo !== repoRoot) {
      setRepo(state.repo);
      cwd = repoRoot ?? state.repo;
    }
    const m = fresh();
    for (const s of states) {
      submitted(m, s.request ?? s.prompt);
      for (const e of readEvents(s)) applyEvent(m, e);
      m.runId = s.id;
      m.startedAt = Date.parse(s.createdAt);
      settle(m, s);
      m.endedAt = Date.parse(s.updatedAt);
    }
    m.brandAt = undefined;
    if (state.status === "running") toast(m, "This run is still going in another process; this is a snapshot.", "amber", 8_000);
    model = m;
    composer.clear();
    setTitle();
  };

  const resume = (): void => {
    const r = model.run;
    if (running) return void toast(model, "A run is already going.", "amber");
    if (!r || !["interrupted", "paused", "failed"].includes(r.status)) return void toast(model, "Nothing to resume here.", "amber");
    const m = model;
    m.run = undefined;
    m.focus = "composer";
    m.stage = "building";
    m.statusAt = Date.now();
    m.startedAt = Date.now();
    m.endedAt = undefined;
    note(m, "Resuming the run where it stopped.");
    drive(m, (ctx) => resumeRun(r, ctx));
  };

  const quit = (): void => {
    if (running) {
      if (model.confirm !== "quit") {
        model.confirm = "quit";
        toast(model, "A run is going. Ctrl+Q again stops it (it can be resumed) and quits.", "amber", 5_000);
        return;
      }
      quitting = true;
      controller?.abort();
      toast(model, "Stopping the run…", "amber", 60_000);
      return;
    }
    resolveExit(0);
  };

  const stop = (now = false): void => {
    if (!running) return;
    if (!now && model.confirm !== "stop") {
      model.confirm = "stop";
      toast(model, "Press Esc again to stop the run. It can be resumed.", "amber");
      return;
    }
    model.confirm = undefined;
    controller?.abort();
    toast(model, "Stopping…", "amber");
  };

  const showDiff = (): void => {
    const r = model.run;
    if (!r) return void toast(model, "No finished run to show yet.", "amber");
    try {
      const patch = currentPatch(r);
      const o = r.outcome;
      model.diff = { title: `Diff · ${o?.files.length ?? 0} files  +${o?.insertions ?? 0} −${o?.deletions ?? 0}`, lines: patch ? patch.split("\n") : ["(no changes)"], scroll: 0 };
      model.focus = "diff";
    } catch (error) {
      toast(model, error instanceof Error ? error.message : String(error), "red");
    }
  };

  /** [F41 tui-context] context.md: the repository map every agent of the run gets. */
  const showContext = (): void => {
    let packet = model.run?.contextPacket;
    if (!packet && model.runId && repoRoot) {
      try {
        packet = loadState(join(runsDir(home, repoRoot), model.runId)).contextPacket;
      } catch {
        // Not written yet.
      }
    }
    if (!packet) return void toast(model, "No context.md yet: it is made at the start of a run.", "muted");
    model.diff = { title: `context.md · ${packet.length.toLocaleString("en-US")} characters, about ${Math.round(packet.length / 4).toLocaleString("en-US")} tokens`, lines: packet.split("\n"), scroll: 0 };
    model.focus = "diff";
  };

  const apply = (): void => {
    const r = model.run;
    if (!r || r.status !== "finished") return void toast(model, "Nothing to apply.", "amber");
    try {
      const result = applyRun(r);
      model.run = { ...r, status: "applied" };
      model.statusAt = Date.now();
      session.unapplied.delete(r.id);
      refreshSidebar(model);
      files.refresh();
      toast(model, `Applied ${result.files} file${result.files === 1 ? "" : "s"} to your repository.`);
    } catch (error) {
      toast(model, error instanceof Error ? error.message : String(error), "red", 8_000);
    }
  };

  const discard = (): void => {
    const r = model.run;
    if (!r || r.status !== "finished") return void toast(model, "Nothing to discard.", "amber");
    try {
      discardRun(r);
      model.run = { ...r, status: "discarded" };
      model.statusAt = Date.now();
      session.unapplied.delete(r.id);
      refreshSidebar(model);
      toast(model, "Discarded.", "amber");
    } catch (error) {
      toast(model, error instanceof Error ? error.message : String(error), "red");
    }
  };

  const rate = (n: number): void => {
    const r = model.run;
    if (!r) return;
    if (preset.name === "demo" || r.preset === "demo") return void toast(model, "Demo runs are not rated.", "muted");
    model.rating = n;
    try {
      recordRating(home, { run: r.id, at: new Date().toISOString(), score: n });
      if (isOn("telemetry") && telemetryAllowed(settings.telemetry)) {
        queueReport(home, ratingReport(home, r.id, n));
        void flushReports(home);
      }
      toast(model, `Rated ${n}. Recorded in the usage log.`);
    } catch (error) {
      toast(model, `Rating not saved: ${error instanceof Error ? error.message : String(error)}`, "red");
    }
  };

  const newSession = (): void => {
    if (running) return void toast(model, "A run is going; stop it first (Esc twice).", "amber");
    model = fresh();
    composer.clear();
    setTitle();
  };

  // ---------------------------------------------------------------------------
  // [F45 tui-settings]

  const setSetting = (key: string, value: string): void => {
    const s = settings as unknown as Record<string, unknown>;
    const current = s[key];
    s[key] = typeof current === "boolean" ? value === "true" : typeof current === "number" ? Number(value) : value;
    if (key === "transparent") setTransparent(settings.transparent);
    if (key === "theme") setTheme(settings.theme);
    if (key === "motion") motion = settings.motion && isOn("tui-motion");
    if (key === "mouse") term.mouse(settings.mouse && isOn("tui-mouse"));
    if (key === "access") toast(model, settings.access === "turbo" ? "Turbo: agents go ahead without asking. Applying stays yours." : "Normal: Neuromesh asks before the plan is carried out and before the expert is called.", settings.access === "turbo" ? "amber" : "blue");
    applySettings(model);
    term.invalidate();
    persist();
  };
  const cycleSetting = (key: string, dir = 1): void => {
    const row = SETTINGS_ROWS.find((r) => r.key === key);
    if (!row) return;
    const cur = model.settings[key] ?? row.values[0]!;
    const i = row.values.indexOf(cur);
    setSetting(key, row.values[(i + dir + row.values.length) % row.values.length]!);
  };
  const cycleVerbose = (): void => {
    const order = ["medium", "full", "none"];
    setSetting("verbose", order[(order.indexOf(settings.verbose) + 1) % order.length]!);
    toast(model, `Verbosity: ${settings.verbose}`, "muted", 1_500);
  };

  // ---------------------------------------------------------------------------
  // [F34 tui-projects]

  const openDialog = (d: Dialog): void => {
    model.palette = undefined;
    model.picker = undefined;
    model.suggest = undefined;
    model.dialog = d;
  };

  const newProjectDialog = (): void =>
    openDialog({
      kind: "form",
      title: "New project",
      fields: [
        { label: "Name", value: "", placeholder: "what to call it" },
        { label: "Folder", value: repoRoot && !projectsFile.projects.some((p) => p.path === repoRoot) ? repoRoot : "", placeholder: "~/Projects/my-app (made if it is not there)", browse: "folder" },
      ],
      focus: 0,
      submit: "Create",
      action: "new-project",
      at: Date.now(),
    });

  const renameDialog = (path: string | undefined = repoRoot): void => {
    if (!path) return void toast(model, "Not in a project folder.", "amber");
    openDialog({ kind: "form", title: "Rename project", fields: [{ label: "Name", value: projectName(path) ?? "" }], focus: 0, submit: "Rename", action: `rename:${path}`, at: Date.now() });
  };

  const switchProject = (path: string): void => {
    if (running) return void toast(model, "A run is going; stop it before switching projects.", "amber");
    setRepo(path);
    cwd = repoRoot ?? path;
    model = fresh();
    composer.clear();
    setTitle();
  };

  const createProject = (name: string, folder: string): string | undefined => {
    const path = resolve(folder.replace(/^~(?=$|\/)/, process.env.HOME ?? "~"));
    if (!name.trim()) return "Give the project a name.";
    if (!folder.trim()) return "Choose a folder.";
    if (!existsSync(path)) {
      mkdirSync(path, { recursive: true });
      // A new folder becomes a repository with one empty commit, which the engine needs.
      if (spawnSync("git", ["init", "-q", path]).status !== 0) return "The folder was made, but git init failed there.";
      spawnSync("git", ["-C", path, "commit", "-q", "--allow-empty", "-m", "Start the project"]);
    }
    let root: string;
    try {
      root = findRepo(path).root;
    } catch (error) {
      return error instanceof Error ? error.message.split("\n")[0]! : String(error);
    }
    projectsFile.projects = [...projectsFile.projects.filter((p) => p.path !== root), { name: name.trim(), path: root }];
    persistProjects();
    switchProject(root);
    toast(model, `Project ${name.trim()} added.`);
    return undefined;
  };

  const submitDialog = (): void => {
    const d = model.dialog;
    if (!d || d.kind === "settings") return;
    if (d.kind === "confirm") {
      model.dialog = undefined;
      return confirmed(d.action);
    }
    if (d.kind === "team") return saveCustomTeam();
    if (d.kind === "connect") return login(TOOLS[d.index]!.id);
    if (d.kind === "consent") return consent(true);
    const values = d.fields.map((f) => f.value);
    if (d.action === "new-project") {
      const error = createProject(values[0] ?? "", values[1] ?? "");
      if (error) d.error = error;
      else model.dialog = undefined;
      return;
    }
    if (d.action.startsWith("rename:")) {
      const path = d.action.slice(7);
      const name = values[0]?.trim();
      if (!name) return void (d.error = "The name cannot be empty.");
      const existing = projectsFile.projects.find((p) => p.path === path);
      if (existing) existing.name = name;
      else projectsFile.projects.push({ name, path });
      persistProjects();
      model.dialog = undefined;
      if (path === repoRoot) model.projectName = name;
      refreshSidebar(model);
      toast(model, `Renamed to ${name}.`);
      return;
    }
    if (d.action === "change-plan") {
      model.dialog = undefined;
      answer({ ok: false, note: values[0]?.trim() || undefined });
      if (!values[0]?.trim()) toast(model, "No change given: the run stops at the plan.", "amber");
      return;
    }
    if (d.action === "attach-path") {
      model.dialog = undefined;
      attachPaths([values[0] ?? ""]);
    }
  };

  const confirmed = (action: string): void => {
    if (action.startsWith("delete:")) {
      const dir = action.slice(7);
      const s = [...model.recents, ...model.projects.flatMap((p) => p.sessions)].find((x) => x.dir === dir);
      if (!s) return;
      try {
        const where = trashSession(home, { ...s, preset: "" });
        if (model.runId === s.id) newSession();
        refreshSidebar(model);
        toast(model, `Deleted. Its record is in ${where.replace(process.env.HOME ?? "", "~")}.`, "amber", 6_000);
      } catch (error) {
        toast(model, `Not deleted: ${error instanceof Error ? error.message : String(error)}`, "red");
      }
    } else if (action.startsWith("remove:")) {
      const path = action.slice(7);
      projectsFile.projects = projectsFile.projects.filter((p) => p.path !== path);
      persistProjects();
      if (path === repoRoot) model.projectName = basename(path);
      refreshSidebar(model);
      toast(model, "Removed from the sidebar. The folder and its sessions are untouched.", "amber");
    } else if (action === "discard") discard();
  };

  const deleteSession = (dir: string): void => {
    const s = [...model.recents, ...model.projects.flatMap((p) => p.sessions)].find((x) => x.dir === dir);
    if (!s) return;
    if (running && s.id === model.runId) return void toast(model, "That session is running; stop it first.", "amber");
    openDialog({
      kind: "confirm",
      title: "Delete this session?",
      body: [`"${s.title}"`, "Its record moves to ~/.neuromesh/trash and its checkouts are removed. Its branches stay in the repository, so the work can still be found."],
      yes: "Delete",
      danger: true,
      action: `delete:${dir}`,
      at: Date.now(),
    });
  };

  const removeProject = (path: string): void => {
    const p = projectsFile.projects.find((x) => x.path === path);
    if (!p) return;
    openDialog({ kind: "confirm", title: `Remove ${p.name}?`, body: ["It leaves the sidebar. The folder and its sessions are not touched; the sessions show under Recents."], yes: "Remove", danger: true, action: `remove:${path}`, at: Date.now() });
  };

  const toggleFold = (key: string): void => {
    if (model.folded.has(key)) model.folded.delete(key);
    else model.folded.add(key);
    persistProjects();
  };

  // ---------------------------------------------------------------------------
  // [F38 attachments]

  const attachPaths = (paths: string[]): void => {
    for (const raw of paths) {
      const p = resolve(raw.trim().replace(/^~(?=$|\/)/, process.env.HOME ?? "~"));
      if (!raw.trim()) continue;
      if (!existsSync(p)) {
        toast(model, `No such file: ${raw}`, "red");
        continue;
      }
      if (!model.attachments.some((a) => a.path === p)) model.attachments.push({ path: p, name: basename(p) });
    }
    if (model.attachments.length) toast(model, `${model.attachments.length} file${model.attachments.length === 1 ? "" : "s"} attached to the next instruction.`, "cyan");
    redraw();
  };

  const attach = (): void => {
    if (!isOn("attachments")) return void toast(model, "Attachments are switched off (F38).", "muted");
    void choose("files").then((paths) => {
      if (paths === undefined) {
        openDialog({ kind: "form", title: "Attach a file", fields: [{ label: "Path", value: "", placeholder: "/path/to/file" }], focus: 0, submit: "Attach", action: "attach-path", at: Date.now() });
        redraw();
      } else attachPaths(paths);
    });
  };

  const browse = (field: number): void => {
    const d = model.dialog;
    if (d?.kind !== "form") return;
    void choose("folder").then((paths) => {
      if (paths === undefined) return void toast(model, "No folder chooser here: type the path.", "muted");
      const f = model.dialog?.kind === "form" ? model.dialog.fields[field] : undefined;
      if (f && paths[0]) {
        f.value = paths[0];
        const nameField = model.dialog?.kind === "form" ? model.dialog.fields[0] : undefined;
        if (nameField && !nameField.value) nameField.value = basename(paths[0]);
      }
      redraw();
    });
  };

  // ---------------------------------------------------------------------------
  // Commands.

  const openPicker = (kind: "sessions" | "presets" | "allPresets"): void => {
    if (kind === "sessions") {
      const all: Choice[] = allSessions(home)
        .filter((s) => s.repo === repoRoot)
        .map((s) => {
          const state = s.status === "finished" ? "ready to review" : s.status;
          return { id: s.dir, label: s.title, detail: `${state} · ${new Date(s.at).toLocaleString()}${s.files ? ` · ${s.files} file${s.files === 1 ? "" : "s"}` : ""} · ${s.preset}`, tone: s.status === "failed" ? "red" : undefined };
        });
      if (all.length === 0) return void toast(model, "No earlier sessions in this folder yet.", "muted");
      model.picker = { kind, title: "Sessions in this folder", query: "", all, index: 0, at: Date.now() };
    } else if (kind === "presets" && isOn("tui-teams")) {
      // [F51 tui-teams] The two favourites, your own team, and the rest behind one entry.
      const presets = listPresets();
      const fav: Choice[] = FAVOURITES.flatMap((name) => {
        const p = presets.find((x) => x.name === name);
        return p ? [{ id: p.name, label: `★ ${p.name}${p.name === preset.name ? "  (current)" : ""}`, detail: p.description.slice(0, 160) }] : [];
      });
      const own = presets.find((x) => x.name === CUSTOM);
      const all: Choice[] = [
        ...fav,
        { id: "@custom", label: `✎ Custom team${preset.name === CUSTOM ? "  (current)" : ""}`, detail: own ? `${own.description} Enter to change it.` : "Choose the expert, worker and tester yourself, from every model your tools offer." },
        { id: "@others", label: "… Other presets", detail: "Every preset, including the experimental ones." },
      ];
      model.picker = { kind, title: "Team", query: "", all, index: Math.max(0, all.findIndex((c) => c.id === preset.name)), at: Date.now() };
    } else {
      const all: Choice[] = listPresets().map((p) => ({ id: p.name, label: `${p.name}${p.name === preset.name ? "  (current)" : ""}`, detail: p.description.slice(0, 160) }));
      model.picker = { kind: "allPresets", title: "Every preset", query: "", all, index: Math.max(0, all.findIndex((c) => c.id === preset.name)), at: Date.now() };
    }
  };

  /** What a picker's choice does. */
  const picked = (p: NonNullable<Model["picker"]>, id: string): void => {
    if (p.kind === "sessions") return openSession(id);
    if (p.kind === "model") {
      const d = p.back;
      if (d?.kind === "team" && p.role) {
        d.team[p.role] = id;
        d.labels[id] = pickerLabel(id);
        d.error = undefined;
      }
      model.dialog = d;
      return;
    }
    if (id === "@custom") return openTeam();
    if (id === "@others") return openPicker("allPresets");
    choosePreset(id);
  };

  // [F51 tui-teams] The Custom team.
  let extraModels: ModelChoice[] = [];
  const choices = (): ModelChoice[] => modelChoices(extraModels);
  const pickerLabel = (id: string): string => choices().find((c) => c.id === id)?.label ?? id.split("/").slice(1).join("/") ?? id;
  const openTeam = (): void => {
    let team: Team = { expert: "claude/claude-opus-5-5#medium", worker: "codex/gpt-6-luna#high", tester: "codex/gpt-6-luna#medium" };
    try {
      const saved = JSON.parse(readFileSync(join(home, "presets", `${CUSTOM}.json`), "utf8")) as { team?: Team };
      if (saved.team) team = saved.team;
    } catch {
      // No custom team yet: start from the favourite.
    }
    const labels: Record<string, string> = {};
    for (const id of Object.values(team)) labels[id] = pickerLabel(id);
    openDialog({ kind: "team", team, labels, index: 0, at: Date.now() });
    // opencode's models (API-key ones too) come in the background.
    if (isOn("opencode") && extraModels.length === 0) {
      void opencodeModels().then((list) => {
        extraModels = list;
        redraw();
      });
    }
  };
  const pickModel = (role: "expert" | "worker" | "tester"): void => {
    const d = model.dialog;
    if (d?.kind !== "team") return;
    const all: Choice[] = choices().map((c) => ({ id: c.id, label: c.label, detail: c.detail }));
    model.dialog = undefined;
    model.picker = { kind: "model", role, back: d, title: `The ${role}`, query: "", all, index: Math.max(0, all.findIndex((c) => c.id === d.team[role])), at: Date.now() };
  };
  const saveCustomTeam = (): void => {
    const d = model.dialog;
    if (d?.kind !== "team") return;
    const problem = teamProblem(d.team);
    if (problem) return void (d.error = problem);
    try {
      saveTeam(home, d.team, choices());
      model.dialog = undefined;
      choosePreset(CUSTOM);
    } catch (error) {
      d.error = error instanceof Error ? error.message : String(error);
    }
  };

  // [F50 opencode] Signing in: each tool's own login, with the terminal handed to it.
  const TOOLS = [
    { id: "codex", name: "Codex", login: ["codex", ["login"]], status: ["codex", ["login", "status"]] },
    { id: "claude", name: "Claude Code", login: ["claude", ["auth", "login"]], status: ["claude", ["auth", "status"]] },
    { id: "agy", name: "Antigravity", login: ["agy", []], status: ["agy", ["models"]] },
    { id: "opencode", name: "opencode", login: ["opencode", ["auth", "login"]], status: ["opencode", ["auth", "list"]] },
  ] as const;
  const checkTools = (): void => {
    const d = model.dialog;
    if (d?.kind !== "connect") return;
    for (const t of TOOLS) {
      d.status[t.id] = { state: "checking…", tone: "muted" };
      const version = spawnSync(t.id, ["--version"], { encoding: "utf8", timeout: 5_000 });
      if (version.error || version.status !== 0) {
        d.status[t.id] = { state: "not installed", tone: "red" };
        continue;
      }
      const v = (/\d+(?:\.\d+)+/.exec(version.stdout) ?? [""])[0];
      const child = spawn(t.status[0], [...t.status[1]], { stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      // Some tools say it on stderr (codex login status does).
      child.stdout.on("data", (b: Buffer) => (out += b.toString("utf8")));
      child.stderr.on("data", (b: Buffer) => (out += b.toString("utf8")));
      const timer = setTimeout(() => child.kill("SIGTERM"), 20_000);
      child.on("exit", (code) => {
        clearTimeout(timer);
        const ok =
          t.id === "claude" ? /"loggedIn":\s*true/.test(out)
          : t.id === "codex" ? code === 0 && /logged in/i.test(out)
          : t.id === "opencode" ? true
          : code === 0 && out.trim().length > 0;
        const saved = (out.match(/\bstored\b|\boauth\b|\bapi\b/gi) ?? []).length;
        const note = t.id === "opencode" ? `ready · ${saved} login${saved === 1 ? "" : "s"}` : ok ? "signed in" : "not signed in";
        const now = model.dialog;
        if (now?.kind === "connect") now.status[t.id] = { version: v, state: note, tone: ok ? "jade" : "amber" };
        redraw();
      });
    }
  };
  const login = (id: string): void => {
    const t = TOOLS.find((x) => x.id === id);
    if (!t || running) return void toast(model, "Sign in when no run is going.", "amber");
    term.suspend(true);
    process.stdout.write(`\n${t.name}: ${id === "agy" ? "sign in, then type /quit to come back to Neuromesh." : "follow its steps; Neuromesh comes back when it ends."}\n\n`);
    const child = spawn(t.login[0], [...t.login[1]], { stdio: "inherit" });
    const back = (): void => {
      term.resume();
      term.invalidate();
      checkTools();
      extraModels = [];
      redraw();
    };
    child.on("exit", back);
    child.on("error", (error) => {
      back();
      toast(model, `${t.name}: ${error.message}`, "red");
    });
  };
  const openConnect = (): void => {
    openDialog({ kind: "connect", index: 0, status: {}, at: Date.now() });
    checkTools();
  };

  // [F52 telemetry] Asked once, before the first run.
  const consent = (yes: boolean): void => {
    model.dialog = undefined;
    setSetting("telemetry", yes ? "on" : "off");
    toast(model, yes ? "Thank you: reports will be shared. /settings or `neuromesh telemetry off` stops it." : "Nothing will be shared.", yes ? "jade" : "muted", 5_000);
    if (yes) void flushReports(home);
  };

  const choosePreset = (name: string): void => {
    if (running) return void toast(model, "A run is going; the preset changes for the next one.", "amber");
    try {
      preset = loadPreset(name);
      model.preset = preset.name;
      model.team = teamOf(preset);
      model.budgetUsd = preset.expertBudgetUsd;
      toast(model, `Preset: ${preset.name} for the next runs.`);
    } catch (error) {
      toast(model, error instanceof Error ? error.message : String(error), "red");
    }
  };

  const usageSummary = (): void => {
    const log = readLog(home);
    if (log.runs.length === 0) return void toast(model, "The usage log is empty so far.", "muted");
    const byPreset = new Map<string, { n: number; cost: number; rated: number[] }>();
    for (const r of log.runs) {
      const e = byPreset.get(r.preset) ?? { n: 0, cost: 0, rated: [] };
      e.n += 1;
      e.cost += r.cost ?? 0;
      const rating = log.ratings.get(r.run);
      if (rating) e.rated.push(rating.score);
      byPreset.set(r.preset, e);
    }
    note(model, `Usage log: ${log.runs.length} real run${log.runs.length === 1 ? "" : "s"} (~/.neuromesh/usage/USAGE.md)`, "text");
    for (const [p, e] of byPreset) {
      const avg = e.rated.length ? ` · rated ${(e.rated.reduce((a, b) => a + b, 0) / e.rated.length).toFixed(1)}` : "";
      note(model, `${p}: ${e.n} run${e.n === 1 ? "" : "s"} · ≈$${(e.cost / e.n).toFixed(3)} a run${avg}`);
    }
  };

  const featureSummary = (): void => {
    const off = FEATURES.filter((f) => !isOn(f.key));
    note(model, `${FEATURES.length} features since v0.1; ${off.length === 0 ? "all on" : `off: ${off.map((f) => `${f.id} ${f.key}`).join(", ")}`}. Details: neuromesh features.`, "text");
    for (const f of model.run?.featureErrors ?? []) model.log.push({ kind: "error", text: `${f.id} ${f.key} failed: ${f.message}`, at: Date.now() });
  };

  const compact = (): void => {
    if (!isOn("compact")) return void toast(model, "Compaction is switched off (F42).", "muted");
    if (!running) return void toast(model, "Nothing to compact: every new instruction starts fresh agents.", "muted");
    steer.compact = true;
    model.compactAsked = true;
    toast(model, "The next follow-up turn starts a fresh session from the brief and the last report.", "cyan");
  };

  const toggleAccess = (): void => cycleSetting("access");

  const runAction = (cmd: Command): void => {
    model.palette = undefined;
    model.suggest = undefined;
    switch (cmd.action) {
      case "help":
        model.palette = { index: 0, at: Date.now() };
        return;
      case "new":
        return newSession();
      case "sessions":
        return openPicker("sessions");
      case "preset":
        return openPicker("presets");
      case "resume":
        return resume();
      case "diff":
        return showDiff();
      case "apply":
        return apply();
      case "discard":
        return openDialog({ kind: "confirm", title: "Discard this run's changes?", body: ["They are thrown away; your repository is not touched."], yes: "Discard", danger: true, action: "discard", at: Date.now() });
      case "theme":
        cycleSetting("theme");
        return void toast(model, `Theme: ${settings.theme === "github" ? "GitHub dark high contrast" : settings.theme === "terminal" ? "your terminal's colours" : "neuromesh-dark"}`);
      case "transparent":
        cycleSetting("transparent");
        return void toast(model, settings.transparent ? "Transparent: the terminal's own background shows" : "The theme's background");
      case "details":
        return cycleVerbose();
      case "verbose-none":
        return setSetting("verbose", "none");
      case "verbose-medium":
        return setSetting("verbose", "medium");
      case "verbose-full":
        return setSetting("verbose", "full");
      case "access":
        return toggleAccess();
      case "attach":
        return attach();
      case "sidebar":
        return cycleSetting("sidebar");
      case "info":
        return cycleSetting("info");
      case "focus-sidebar":
        model.focus = "sidebar";
        model.sideSel = model.sideSel ?? sidebarRows(model)[0];
        return;
      case "new-project":
        return newProjectDialog();
      case "rename":
        return renameDialog();
      case "compact":
        return compact();
      case "context":
        return showContext();
      case "settings":
        return openDialog({ kind: "settings", index: 0, at: Date.now() });
      case "connect":
        return openConnect();
      case "team":
        return openTeam();
      case "screensaver":
        return startSaver();
      case "motion":
        return cycleSetting("motion");
      case "usage":
        return usageSummary();
      case "features":
        return featureSummary();
      case "stop":
        return stop(true);
      case "quit":
        return quit();
      default:
        toast(model, `${cmd.keys}: ${cmd.label}`, "muted");
    }
  };

  // [F21 tui-slash] [F22 tui-mentions] What the dropdown offers for the word being typed.
  const updateSuggest = (): void => {
    const word = composer.wordAtCursor();
    const text = composer.text;
    if (isOn("tui-slash") && text.startsWith("/") && !text.includes(" ") && !text.includes("\n")) {
      const items = bestMatches(text.slice(1), SLASH, (c) => c.slash!.slice(1), 9).map((c) => ({ id: c.slash!, label: c.slash!, detail: c.label }));
      model.suggest = items.length ? { kind: "slash", items, index: 0, start: 0 } : undefined;
      return;
    }
    if (isOn("tui-mentions") && word.text.startsWith("@") && repoRoot) {
      const items = bestMatches(word.text.slice(1), files.list(), (f) => f, 8).map((f) => ({ id: f, label: f }));
      model.suggest = items.length ? { kind: "file", items, index: 0, start: word.start } : undefined;
      return;
    }
    model.suggest = undefined;
  };

  const acceptSuggest = (run: boolean, index?: number): void => {
    const s = model.suggest!;
    const it = s.items[index ?? s.index]!;
    model.suggest = undefined;
    if (s.kind === "slash") {
      const cmd = COMMANDS.find((c) => c.slash === it.id);
      composer.clear();
      if (cmd && run) runAction(cmd);
      else composer.insert(`${it.id} `);
      return;
    }
    composer.replaceBeforeCursor(s.start, `${it.id} `);
  };

  // [F31 tui-screensaver] Built in by default; the owner's own screensaver with NEUROMESH_SCREENSAVER=external.
  function startSaver(): void {
    if (saver || external) return;
    model.palette = undefined;
    model.picker = undefined;
    if (saverSetting === "external" && spawnSync("sh", ["-c", "command -v screensaver"]).status === 0) {
      try {
        const art = join(home, "screensaver-art.txt");
        mkdirSync(home, { recursive: true });
        writeFileSync(art, LOGO_WIDE.join("\n") + "\n");
        term.suspend();
        external = spawn("screensaver", [art], { stdio: "inherit" });
        external.on("exit", () => {
          external = undefined;
          term.resume();
          lastInput = Date.now();
          redraw();
        });
        return;
      } catch {
        external = undefined;
        term.resume();
      }
    }
    saver = newSaver(Date.now());
    term.mouse(true);
    term.invalidate();
  }

  function stopSaver(): void {
    if (external) {
      external.kill("SIGTERM");
      return;
    }
    if (!saver) return;
    saver = undefined;
    term.mouse(settings.mouse && isOn("tui-mouse"));
    term.invalidate();
    lastInput = Date.now();
    redraw();
  }

  // ---------------------------------------------------------------------------
  // [F33 tui-mouse] Clicks, hover and the wheel.

  let lastDown: { id: string; at: number } | undefined;

  const regionsAt = (x: number, y: number): string[] => (frame?.regions ?? []).filter((r: Region) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h).map((r) => r.id);

  const scrollStreamTo = (stage: string): void => {
    const at = frame?.anchors[stage];
    if (at === undefined) return void toast(model, `Nothing from the ${stage} step yet.`, "muted", 1_500);
    model.scroll = at;
    model.scrollAt = Date.now();
  };

  const click = (id: string, double: boolean): void => {
    const [kind, ...rest] = id.split(":");
    const arg = rest.join(":");
    if (model.dialog && !/^(dlg|set|team|conn|consent):/.test(id) && id !== "popup:inside") {
      if ((id === "popup:outside" || id === "popup:close") && model.dialog.kind !== "consent") model.dialog = undefined;
      return;
    }
    if ((model.palette || model.picker) && !id.startsWith("pal:") && !id.startsWith("pick:") && id !== "popup:inside") {
      model.palette = undefined;
      model.picker = undefined;
      return;
    }
    switch (kind) {
      case "brand":
        model.brandAt = Date.now();
        return;
      case "project-name":
        if (double) renameDialog();
        return;
      case "status":
        model.scroll = 0;
        model.scrollAt = Date.now();
        return;
      case "bar":
        if (arg === "menu") model.palette = { index: 0, at: Date.now() };
        else if (arg === "commands" || arg === "files") {
          model.focus = "composer";
          composer.insert(arg === "commands" ? "/" : composer.isEmpty ? "@" : " @");
          updateSuggest();
        } else if (arg === "verbose") cycleVerbose();
        else if (arg === "stop") stop();
        return;
      case "side": {
        const [what, ...more] = rest;
        const target = more.join(":");
        model.focus = "composer";
        if (what === "head" || what === "fold") return toggleFold(target);
        if (what === "new") return target === "projects" ? newProjectDialog() : newSession();
        if (what === "project") return double ? renameDialog(target) : toggleFold(target);
        if (what === "newin") return switchProject(target);
        if (what === "remove") return removeProject(target);
        if (what === "session") return openSession(target);
        if (what === "delete") return deleteSession(target);
        return;
      }
      case "step":
        return scrollStreamTo(arg);
      case "pipe":
        return cycleVerbose();
      case "box":
        if (model.expanded.has(arg)) model.expanded.delete(arg);
        else model.expanded.add(arg);
        return;
      case "ask":
        if (arg === "yes") return answer({ ok: true });
        if (arg === "no") return answer({ ok: false });
        return openDialog({ kind: "form", title: "What should change in the plan?", fields: [{ label: "Change", value: "", placeholder: "e.g. one task for the UI, one for storage" }], focus: 0, submit: "Send", action: "change-plan", at: Date.now() });
      case "act":
        if (arg === "apply") return apply();
        if (arg === "diff") return showDiff();
        if (arg === "discard") return runAction(COMMANDS.find((c) => c.action === "discard")!);
        if (arg === "resume") return resume();
        return;
      case "rate":
        return rate(Number(arg));
      case "diff":
        return showDiff();
      case "stream":
        if (arg === "end") {
          model.scroll = 0;
          model.scrollAt = Date.now();
        }
        return;
      case "prompt":
        if (arg === "attach") return attach();
        if (arg === "access") return toggleAccess();
        if (arg === "preset") return openPicker("presets");
        if (arg.startsWith("unattach")) {
          model.attachments.splice(Number(arg.split(":")[1]), 1);
          return;
        }
        model.focus = "composer";
        return;
      case "node":
        model.focusAgent = model.focusAgent === arg ? undefined : arg;
        model.contextAt = Date.now();
        return;
      case "ctx":
        if (arg === "compact") return compact();
        return showContext();
      case "suggest":
        if (model.suggest) acceptSuggest(true, Number(arg));
        return;
      case "pal":
        return runAction(commandAt(Number(arg)));
      case "pick": {
        const p = model.picker;
        const it = p ? pickerChoices(model)[Number(arg)] : undefined;
        model.picker = undefined;
        if (p && it) picked(p, it.id);
        else if (p?.back) model.dialog = p.back;
        return;
      }
      case "popup":
        if (arg !== "inside") {
          model.palette = undefined;
          model.picker = undefined;
          model.dialog = undefined;
        }
        return;
      case "set":
        if (model.dialog?.kind === "settings") model.dialog.index = Math.max(0, SETTINGS_ROWS.findIndex((r) => r.key === arg));
        return cycleSetting(arg);
      case "team":
        if (arg === "save") return saveCustomTeam();
        if (model.dialog?.kind === "team") {
          const roles = ["expert", "worker", "tester"] as const;
          model.dialog.index = roles.indexOf(arg as (typeof roles)[number]);
          pickModel(arg as (typeof roles)[number]);
        }
        return;
      case "conn":
        if (model.dialog?.kind === "connect") model.dialog.index = TOOLS.findIndex((t) => t.id === arg);
        return login(arg);
      case "consent":
        return consent(arg === "yes");
      case "dlg": {
        const d = model.dialog;
        if (arg === "yes") return submitDialog();
        if (arg === "no") return void (model.dialog = undefined);
        if (arg.startsWith("field:") && d?.kind === "form") d.focus = Number(arg.slice(6));
        if (arg.startsWith("browse:")) return browse(Number(arg.slice(7)));
        return;
      }
      case "pager":
        if (!model.diff) return;
        if (arg === "back") model.focus = model.run ? "outcome" : "composer";
        else if (arg === "page") model.diff.scroll += term.size().rows - 6;
        else model.diff.scroll += 1;
        return;
      default:
    }
  };

  const onMouse = (ev: Mouse): void => {
    if (!isOn("tui-mouse") || !frame) return;
    const id = hitTest(frame.regions, ev.x, ev.y);
    if (ev.action === "move" || ev.action === "drag") {
      if (id !== model.hover) {
        model.hover = id;
        redraw();
      }
      return;
    }
    if (ev.action === "wheelUp" || ev.action === "wheelDown") {
      const dir = ev.action === "wheelUp" ? 1 : -1;
      const under = regionsAt(ev.x, ev.y);
      if (model.palette) model.palette.index -= dir;
      else if (model.picker) model.picker.index = Math.max(0, model.picker.index - dir);
      else if (model.focus === "diff" && model.diff && under.includes("pager")) {
        model.diff.scroll = Math.max(0, model.diff.scroll - dir * 3);
        model.scrollAt = Date.now();
      } else if (under.includes("side:list:projects") || under.includes("side:list:recents")) {
        const key = under.includes("side:list:projects") ? "projects" : "recents";
        model.sideScroll[key] = Math.max(0, model.sideScroll[key] - dir * 2);
        model.sideScrollAt = Date.now();
      } else if (under.includes("stream")) {
        model.scroll = Math.max(0, model.scroll + dir * 3);
        model.scrollAt = Date.now();
      }
      redraw();
      return;
    }
    if (ev.action === "down" && ev.button === "left") {
      const now = Date.now();
      const target = id ?? "";
      const double = lastDown !== undefined && lastDown.id === target && now - lastDown.at < 400;
      lastDown = { id: target, at: double ? 0 : now };
      if (target) inFeature("tui-mouse", () => click(target, double));
      else if (model.focus === "sidebar") model.focus = "composer";
      redraw();
    }
  };

  // ---------------------------------------------------------------------------
  // Keys.

  const outcomeKey = (key: Key): boolean => {
    const r = model.run;
    if (!r) return false;
    const ch = key.name === "char" && !key.alt ? (key.text ?? "") : "";
    if (/^[1-5]$/.test(ch)) return rate(Number(ch)), true;
    if (ch === "a") return apply(), true;
    if (ch === "d") return showDiff(), true;
    if (ch === "x") {
      if (model.confirm !== "discard") {
        model.confirm = "discard";
        toast(model, "Press x again to throw this run's changes away.", "amber");
      } else {
        model.confirm = undefined;
        discard();
      }
      return true;
    }
    if (ch === "r") return resume(), true;
    if (ch === "i" || key.name === "tab" || key.name === "enter") {
      model.focus = "composer";
      return true;
    }
    return false;
  };

  const dialogKey = (key: Key): void => {
    const d = model.dialog!;
    if (d.kind === "consent") {
      if (key.name === "enter" || key.text === "y") consent(true);
      else if (key.name === "esc" || key.text === "n") consent(false);
      return;
    }
    if (key.name === "esc") return void (model.dialog = undefined);
    if (d.kind === "team") {
      const roles = ["expert", "worker", "tester"] as const;
      if (key.name === "down" || key.name === "tab") d.index = (d.index + 1) % 4;
      else if (key.name === "up") d.index = (d.index + 3) % 4;
      else if (key.name === "enter" || key.name === "space") {
        if (d.index < 3) pickModel(roles[d.index]!);
        else saveCustomTeam();
      } else if (key.text === "s") saveCustomTeam();
      return;
    }
    if (d.kind === "connect") {
      if (key.name === "down" || key.name === "tab") d.index = (d.index + 1) % TOOLS.length;
      else if (key.name === "up") d.index = (d.index - 1 + TOOLS.length) % TOOLS.length;
      else if (key.name === "enter") login(TOOLS[d.index]!.id);
      else if (key.text === "r") checkTools();
      return;
    }
    if (d.kind === "settings") {
      const n = SETTINGS_ROWS.length;
      if (key.name === "down" || key.name === "tab") d.index = (d.index + 1) % n;
      else if (key.name === "up") d.index = (d.index - 1 + n) % n;
      else if (key.name === "left") cycleSetting(SETTINGS_ROWS[d.index]!.key, -1);
      else if (key.name === "right" || key.name === "enter" || key.name === "space") cycleSetting(SETTINGS_ROWS[d.index]!.key, 1);
      return;
    }
    if (d.kind === "confirm") {
      if (key.name === "enter" || key.text === "y") submitDialog();
      else if (key.text === "n") model.dialog = undefined;
      return;
    }
    const f = d.fields[d.focus]!;
    if (key.name === "enter") return submitDialog();
    if (key.name === "tab") d.focus = (d.focus + (key.shift ? d.fields.length - 1 : 1)) % d.fields.length;
    else if (key.name === "down") d.focus = Math.min(d.fields.length - 1, d.focus + 1);
    else if (key.name === "up") d.focus = Math.max(0, d.focus - 1);
    else if (key.name === "backspace") f.value = [...f.value].slice(0, -1).join("");
    else if (key.ctrl && key.name === "u") f.value = "";
    else if (key.ctrl && key.name === "o" && f.browse) browse(d.focus);
    else if ((key.name === "char" || key.name === "space" || key.name === "paste") && !key.ctrl) f.value += (key.text ?? " ").replace(/\n/g, " ");
    d.error = undefined;
  };

  const sidebarKey = (key: Key): void => {
    const ids = sidebarRows(model);
    let i = Math.max(0, ids.indexOf(model.sideSel ?? ""));
    const id = ids[i] ?? "";
    const [, what, ...more] = id.split(":");
    const target = more.join(":");
    const ch = key.name === "char" ? key.text : undefined;
    if (key.name === "esc" || key.name === "tab" || (key.ctrl && key.name === "e")) return void (model.focus = "composer");
    if (key.name === "down") i = Math.min(ids.length - 1, i + 1);
    else if (key.name === "up") i = Math.max(0, i - 1);
    else if (key.name === "enter") {
      if (what === "session") openSession(target);
      else if (what === "project") switchProject(target);
      else if (what === "head") toggleFold(target);
      return;
    } else if (key.name === "space" || key.name === "left" || key.name === "right") {
      if (what === "project" || what === "head") toggleFold(target);
      return;
    } else if (ch === "r" && what === "project") return renameDialog(target);
    else if ((ch === "x" || key.name === "delete" || key.name === "backspace") && what === "session") return deleteSession(target);
    else if ((ch === "x" || key.name === "delete" || key.name === "backspace") && what === "project") return removeProject(target);
    else if (ch === "n") return newProjectDialog();
    model.sideSel = ids[i];
  };

  const onKey = (key: Key): void => {
    if (!(key.ctrl && key.name === "q")) model.confirm = model.confirm === "quit" ? undefined : model.confirm;
    if ((key.ctrl && key.name === "q") || (key.ctrl && key.name === "c")) return quit();
    if (model.dialog) return dialogKey(key);

    // A list popup owns the keyboard: type to filter, arrows to choose, Enter to open.
    if (model.picker) {
      const p = model.picker;
      if (key.name === "esc") {
        model.picker = undefined;
        if (p.back) model.dialog = p.back;
      }
      else if (key.name === "down" || (key.ctrl && key.name === "n")) p.index += 1;
      else if (key.name === "up") p.index = Math.max(0, p.index - 1);
      else if (key.name === "backspace") p.query = [...p.query].slice(0, -1).join("");
      else if (key.name === "char" || key.name === "space" || key.name === "paste") {
        p.query += key.text ?? " ";
        p.index = 0;
      } else if (key.name === "enter") {
        const it = pickerChoices(model)[p.index];
        model.picker = undefined;
        if (it) picked(p, it.id);
      }
      return;
    }
    if (model.palette) {
      if (key.name === "esc" || (key.ctrl && key.name === "p")) model.palette = undefined;
      else if (key.name === "down" || (key.ctrl && key.name === "n")) model.palette.index += 1;
      else if (key.name === "up") model.palette.index -= 1;
      else if (key.name === "enter") runAction(commandAt(model.palette.index));
      return;
    }
    if (key.ctrl && key.name === "p") return void (model.palette = { index: 0, at: Date.now() });
    if (key.ctrl && key.name === "s" && isOn("tui-sessions")) return openPicker("sessions");
    if (key.ctrl && key.name === "k" && isOn("tui-presets")) return openPicker("presets");
    if (key.ctrl && key.name === "n") return newSession();
    if (key.ctrl && key.name === "t") return runAction(COMMANDS.find((c) => c.action === "theme")!);
    if (key.ctrl && key.name === "o") return cycleVerbose();
    if (key.ctrl && key.name === "b") return cycleSetting("sidebar");
    if (key.ctrl && key.name === "g") return cycleSetting("info");
    if (key.ctrl && key.name === "f") return attach();
    if (key.ctrl && key.name === "l") return compact();
    if (key.ctrl && key.name === "r") return renameDialog();
    if (key.ctrl && key.name === "e") {
      if (model.focus === "sidebar") model.focus = "composer";
      else runAction(COMMANDS.find((c) => c.action === "focus-sidebar")!);
      return;
    }
    if (key.name === "tab" && key.shift && !model.suggest) return toggleAccess();
    if (model.focus === "sidebar") return sidebarKey(key);

    if (model.focus === "diff" && model.diff) {
      const page = term.size().rows - 6;
      const ch = key.text ?? "";
      if (key.name === "esc" || ch === "q") model.focus = model.run ? "outcome" : "composer";
      else if (key.name === "down" || ch === "j") model.diff.scroll += 1;
      else if (key.name === "up" || ch === "k") model.diff.scroll -= 1;
      else if (key.name === "pagedown" || key.name === "space") model.diff.scroll += page;
      else if (key.name === "pageup") model.diff.scroll -= page;
      else if (key.name === "home" || ch === "g") model.diff.scroll = 0;
      else if (key.name === "end" || ch === "G") model.diff.scroll = Number.MAX_SAFE_INTEGER;
      model.diff.scroll = Math.max(0, model.diff.scroll);
      model.scrollAt = Date.now();
      return;
    }

    // [F39 ask-first] With the prompt empty, y, c and n answer the question.
    if (model.ask && answerAsk && composer.isEmpty && key.name === "char") {
      const ch = key.text?.toLowerCase();
      if (ch === "y") return answer({ ok: true });
      if (ch === "n") return answer({ ok: false });
      if (ch === "c" && model.ask.question.kind === "plan") return click("ask:change", false);
    }

    // The suggestion dropdown takes arrows, Tab and Enter while it is open.
    if (model.suggest) {
      const s = model.suggest;
      if (key.name === "down") return void (s.index = (s.index + 1) % s.items.length);
      if (key.name === "up") return void (s.index = (s.index - 1 + s.items.length) % s.items.length);
      if (key.name === "tab") return acceptSuggest(false);
      if (key.name === "enter" && !key.alt && !key.shift) return acceptSuggest(true);
      if (key.name === "esc") return void (model.suggest = undefined);
    }

    const page = Math.max(1, term.size().rows - 14);
    if (key.name === "pageup") {
      model.scroll += page;
      model.scrollAt = Date.now();
      return;
    }
    if (key.name === "pagedown") {
      model.scroll = Math.max(0, model.scroll - page);
      model.scrollAt = Date.now();
      return;
    }
    if (model.focus === "outcome" && outcomeKey(key)) return;
    if (key.name === "esc") {
      if (running) return stop();
      // Esc twice clears the prompt, as in Claude Code.
      const now = Date.now();
      if (!composer.isEmpty && now - lastEsc < 600) {
        composer.clear();
        history.stop();
        lastEsc = 0;
        return;
      }
      lastEsc = now;
      if (model.run) model.focus = "outcome";
      else if (!composer.isEmpty) toast(model, "Esc again clears the prompt.", "muted", 1_500);
      return;
    }
    if (key.name === "enter" && !key.alt && !key.shift) {
      if (composer.isEmpty) return;
      const text = composer.text.trim();
      const slash = text.startsWith("/") ? COMMANDS.find((c) => c.slash === text.split(/\s/)[0]) : undefined;
      if (slash) {
        composer.clear();
        return runAction(slash);
      }
      if (text.startsWith("/verbose ")) {
        composer.clear();
        const v = text.split(/\s+/)[1] ?? "";
        if (["none", "medium", "full"].includes(v)) return setSetting("verbose", v);
        return void toast(model, "Verbosity is none, medium or full.", "amber");
      }
      if (running) return void toast(model, "A run is going. Your draft is kept; send it when the run ends.", "amber");
      start(text);
      return;
    }
    // [F23 tui-history] Up on the first line (or while browsing) recalls earlier requests.
    if (isOn("tui-history") && key.name === "up" && composer.onFirstLine && (composer.isEmpty || history.browsing)) {
      const prev = history.previous(composer.text);
      if (prev !== undefined) composer.text = prev;
      return;
    }
    if (isOn("tui-history") && key.name === "down" && history.browsing) {
      const next = history.next();
      if (next !== undefined) composer.text = next;
      return;
    }
    const { cols, rows } = term.size();
    if (composer.handle(key, composerWidth(model, cols, rows))) {
      if (model.focus === "outcome") model.focus = "composer";
      if (key.name !== "up" && key.name !== "down") history.stop();
      updateSuggest();
    }
  };

  term.start(
    (keys) => {
      const moveOnly = keys.every((k) => k.name === "mouse" && (k.mouse?.action === "move" || k.mouse?.action === "drag"));
      lastInput = Date.now();
      if (saver) {
        stopSaver();
        return;
      }
      for (const k of keys) {
        try {
          if (k.name === "mouse") {
            if (k.mouse) onMouse(k.mouse);
            continue;
          }
          inFeature("tui", () => onKey(k));
        } catch (error) {
          toast(model, error instanceof Error ? error.message : String(error), "red", 8_000);
        }
      }
      if (!moveOnly) redraw();
    },
    () => {
      term.invalidate();
      redraw();
    },
  );
  term.mouse(settings.mouse && isOn("tui-mouse"));
  // [F52 telemetry] Ask once; send anything still waiting from earlier.
  if (isOn("telemetry")) {
    if (settings.telemetry === "unasked" && process.env.NEUROMESH_TELEMETRY !== "off") model.dialog = { kind: "consent", at: Date.now() };
    else if (telemetryAllowed(settings.telemetry)) void flushReports(home);
  }
  setTitle();
  draw();
  plan();
  // [F32 tui-layers] Ask the terminal for its colours, then draw again in them.
  if (isOn("tui-layers")) {
    void term.queryColours(300).then((replies) => {
      const c = readColourReplies(replies);
      if (c.bg || c.fg || c.ansi.some(Boolean)) {
        setTerminalColours(c);
        term.invalidate();
        redraw();
      }
    });
  }
  const code = await exited;
  if (timer) clearTimeout(timer);
  term.title("");
  term.stop();
  // [F28 tui-notify] What this session did, on the way out.
  if (isOn("tui-notify") && session.runs > 0) {
    const lines = [`Neuromesh: ${session.runs} run${session.runs === 1 ? "" : "s"} this session, ≈$${session.cost.toFixed(2)} estimated at API list prices.`];
    for (const id of session.unapplied) lines.push(`  Not applied: ${id}. Review with \`neuromesh diff ${id}\`, apply with \`neuromesh apply ${id}\`, or reopen it from the sidebar.`);
    process.stdout.write(lines.join("\n") + "\n");
  }
  return code;
}

// Kept for callers that measured the layout before.
export { layoutOf };
