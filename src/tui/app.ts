// [F19 tui] The TUI: one landing canvas, then a live workspace for the run.
// It drives the same engine as `neuromesh run`, through the engine's events
// and run records only, so it works on any branch with that engine.

import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { backends } from "../backends/index.ts";
import { applyRun, currentPatch, discardRun } from "../engine/apply.ts";
import { resumeRun, startRun } from "../engine/run.ts";
import { defaultHome, listRuns, runPaths } from "../engine/store.ts";
import type { NeuromeshEvent } from "../engine/store.ts";
import type { RunState } from "../engine/types.ts";
import { FEATURES, feature, hint, inFeature, isOn } from "../features.ts";
import { DEFAULT_PRESET, listPresets, loadPreset } from "../presets/presets.ts";
import type { Preset } from "../presets/presets.ts";
import { entryFor, readLog, recordRating, recordRun } from "../usage/log.ts";
import { findRepo } from "../workspace/workspace.ts";
import { COMMANDS, SLASH, commandAt } from "./commands.ts";
import type { Command } from "./commands.ts";
import { Composer } from "./composer.ts";
import { FileIndex, History, bestMatches } from "./files.ts";
import { applyEvent, finished, newModel, submitted, toast } from "./model.ts";
import type { Choice, Model, SessionView } from "./model.ts";
import { Terminal } from "./term.ts";
import type { Key } from "./term.ts";
import { setTheme, themeName } from "./theme.ts";
import { pickerChoices, render } from "./view.ts";

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

function runsOf(home: string, repoRoot: string | undefined): RunState[] {
  if (!repoRoot) return [];
  try {
    return listRuns(home, repoRoot).reverse().slice(0, 60);
  } catch {
    return [];
  }
}

const titleOf = (r: RunState): string => (r.request ?? r.prompt).split("\n").find((l) => l.trim())?.trim() ?? "(empty request)";

function sessionView(r: RunState): SessionView {
  return { id: r.id, title: titleOf(r), status: r.status, at: r.updatedAt, files: r.outcome?.files.length };
}

function readEvents(state: RunState): NeuromeshEvent[] {
  const path = runPaths(state.dir).events;
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

export async function runTui(options: TuiOptions): Promise<number> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write("The Neuromesh TUI needs an interactive terminal. Use `neuromesh run \"<request>\"` in scripts.\n");
    return 2;
  }
  const home = defaultHome();
  let preset = loadPreset(options.preset ?? DEFAULT_PRESET);
  let repoRoot: string | undefined;
  let repoError: string | undefined;
  try {
    repoRoot = findRepo(options.cwd).root;
  } catch (error) {
    repoError = error instanceof Error ? error.message.split("\n")[0]! : String(error);
  }
  const files = new FileIndex(repoRoot);
  const history = new History(home);
  // [F29 tui-motion] Animations unless switched off (NEUROMESH_MOTION=off, /motion, or --disable tui-motion).
  let motion = process.env.NEUROMESH_MOTION !== "off" && isOn("tui-motion");
  const fresh = (): Model => {
    const m = newModel(preset.name, repoRoot ? basename(repoRoot) : undefined, repoError);
    m.motion = motion;
    m.cwd = options.cwd;
    m.team = teamOf(preset);
    m.budgetUsd = preset.expertBudgetUsd;
    m.sessions = runsOf(home, repoRoot).map(sessionView);
    return m;
  };
  let model = fresh();
  model.introAt = Date.now();
  const composer = new Composer();
  const term = new Terminal();
  let controller: AbortController | undefined;
  let running: Promise<RunState> | undefined;
  let quitting = false;
  let lastEsc = 0;
  const session = { runs: 0, cost: 0, unapplied: new Set<string>() };
  let resolveExit: (code: number) => void = () => {};
  const exited = new Promise<number>((r) => (resolveExit = r));

  // [F28 tui-notify] The title says what is happening, so it shows in tabs and docks.
  const setTitle = (): void => {
    if (!isOn("tui-notify")) return;
    const where = model.repo ?? "neuromesh";
    term.title(running ? `● ${where} · ${model.stage}` : model.run ? `${where} · ${model.run.status}` : `neuromesh · ${where}`);
  };

  // Redraws are coalesced; animations tick only while a run is going.
  let scheduled = false;
  const draw = (): void => {
    scheduled = false;
    const { cols, rows } = term.size();
    try {
      const frame = render(model, composer, cols, rows);
      term.draw(frame.lines, model.palette || model.picker ? undefined : frame.cursor);
    } catch (error) {
      // A drawing bug must not leave the terminal unusable: show it, tagged.
      term.draw([`Neuromesh TUI drawing error: ${error instanceof Error ? error.message : String(error)}`, hint(feature("tui")), "Ctrl+Q quits."]);
    }
  };
  // [F29 tui-motion] Frames come fast while something moves and stop when nothing does.
  let animUntil = Date.now() + 1_500;
  const bump = (ms = 1_500): void => {
    animUntil = Math.max(animUntil, Date.now() + ms);
  };
  const redraw = (): void => {
    bump();
    if (scheduled) return;
    scheduled = true;
    setTimeout(draw, 16);
  };
  let ticks = 0;
  const ticker = setInterval(() => {
    ticks += 1;
    const now = Date.now();
    const toastLive = model.toast !== undefined && model.toast.until > now - 200;
    if (model.motion && (running || now < animUntil)) {
      if (!scheduled) {
        scheduled = true;
        setTimeout(draw, 0);
      }
    } else if ((running || toastLive) && ticks % 3 === 0 && !scheduled) {
      // Without motion: a calm tick for the clock and spinners.
      scheduled = true;
      setTimeout(draw, 0);
    }
  }, 33);
  const layoutWidth = (): number => Math.min(term.size().cols - 8, 100);

  // What a finished (or reopened) run adds to the stream.
  const settle = (m: Model, state: RunState): void => {
    finished(m, state);
    try {
      const patch = state.status === "finished" || state.status === "applied" ? currentPatch(state) : "";
      if (patch.trim()) {
        const o = state.outcome;
        m.items.push({ kind: "diff", text: `Changes: ${o?.files.length ?? 0} file${o?.files.length === 1 ? "" : "s"} (+${o?.insertions ?? 0} −${o?.deletions ?? 0})`, lines: patch.trimEnd().split("\n") });
      }
    } catch {
      // The diff is a convenience; the outcome card still offers it.
    }
  };

  /** Run the engine (a new run, or a resumed one) with this model receiving its events. */
  const drive = (m: Model, go: (ctx: Parameters<typeof startRun>[1]) => Promise<RunState>): void => {
    controller = new AbortController();
    const ctx = { home, backends, signal: controller.signal, onEvent: (e: NeuromeshEvent) => (applyEvent(m, e), setTitle(), redraw()) };
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
            recordRun(home, entryFor(state, (b) => backends[b]?.sessionTotals === true));
          } catch (error) {
            toast(m, `Usage log not written: ${error instanceof Error ? error.message : String(error)}`, "red");
          }
        }
        m.sessions = runsOf(home, repoRoot).map(sessionView);
        files.refresh();
        // [F28 tui-notify] A run can take minutes: say so when it ends.
        if (isOn("tui-notify")) term.bell();
        bump(3_000);
      })
      .catch((error: unknown) => {
        m.items.push({ kind: "error", text: `Engine error: ${error instanceof Error ? error.message : String(error)}`, tone: "red" });
        m.stage = "failed";
      })
      .finally(() => {
        running = undefined;
        controller = undefined;
        setTitle();
        redraw();
        if (quitting) resolveExit(0);
      });
    m.sessions = runsOf(home, repoRoot).map(sessionView);
    setTitle();
    redraw();
  };

  const start = (prompt: string): void => {
    if (!repoRoot) return void toast(model, repoError ?? "Not in a git repository", "red", 8_000);
    const m = model;
    if (isOn("tui-history")) history.add(prompt);
    submitted(m, prompt);
    composer.clear();
    model.suggest = undefined;
    const root = repoRoot;
    drive(m, (ctx) => startRun({ cwd: root, prompt, preset }, ctx));
  };

  // [F24 tui-sessions] Reopen an earlier run from its record and event log.
  const openSession = (id: string): void => {
    if (running) return void toast(model, "A run is going; stop it before opening another session.", "amber");
    const state = runsOf(home, repoRoot).find((r) => r.id === id);
    if (!state) return void toast(model, "That session is gone.", "red");
    const m = fresh();
    submitted(m, titleOf(state));
    m.items = [{ kind: "you", text: state.request ?? state.prompt }];
    for (const e of readEvents(state)) applyEvent(m, e);
    m.runId = state.id;
    m.startedAt = Date.parse(state.createdAt);
    settle(m, state);
    m.endedAt = Date.parse(state.updatedAt);
    if (state.status === "running") toast(m, "This run is still going in another process; this is a snapshot.", "amber", 8_000);
    model = m;
    composer.clear();
  };

  const resume = (): void => {
    const r = model.run;
    if (running) return void toast(model, "A run is already going.", "amber");
    if (!r || !["interrupted", "paused", "failed"].includes(r.status)) return void toast(model, "Nothing to resume here. Ctrl+S opens a stopped session.", "amber");
    const m = model;
    m.run = undefined;
    m.focus = "composer";
    m.stage = "building";
    m.startedAt = Date.now();
    m.endedAt = undefined;
    m.items.push({ kind: "neuromesh", text: "Resuming the run where it stopped." });
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

  const stop = (): void => {
    if (!running) return;
    if (model.confirm !== "stop") {
      model.confirm = "stop";
      toast(model, "Press Esc again to stop the run. It can be resumed (r, or Ctrl+S later).", "amber");
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
      model.diff = { lines: patch ? patch.split("\n") : ["(no changes)"], scroll: 0 };
      model.focus = "diff";
    } catch (error) {
      toast(model, error instanceof Error ? error.message : String(error), "red");
    }
  };

  const apply = (): void => {
    const r = model.run;
    if (!r || r.status !== "finished") return void toast(model, "Nothing to apply.", "amber");
    try {
      const result = applyRun(r);
      model.run = { ...r, status: "applied" };
      session.unapplied.delete(r.id);
      model.sessions = runsOf(home, repoRoot).map(sessionView);
      files.refresh();
      toast(model, `Applied ${result.files} file${result.files === 1 ? "" : "s"} to your repository.`);
    } catch (error) {
      toast(model, error instanceof Error ? error.message : String(error), "red", 8_000);
    }
  };

  const discard = (confirmed = false): void => {
    const r = model.run;
    if (!r || r.status !== "finished") return void toast(model, "Nothing to discard.", "amber");
    if (!confirmed && model.confirm !== "discard") {
      model.confirm = "discard";
      toast(model, "Press x again to throw this run's changes away.", "amber");
      return;
    }
    try {
      discardRun(r);
      model.run = { ...r, status: "discarded" };
      session.unapplied.delete(r.id);
      model.sessions = runsOf(home, repoRoot).map(sessionView);
      toast(model, "Discarded.", "amber");
    } catch (error) {
      toast(model, error instanceof Error ? error.message : String(error), "red");
    }
  };

  const newSession = (): void => {
    if (running) return void toast(model, "A run is going; stop it first (Esc twice).", "amber");
    model = fresh();
    composer.clear();
  };

  const switchTheme = (): void => {
    setTheme(themeName() === "terminal" ? "github" : "terminal");
    term.invalidate();
    toast(model, themeName() === "github" ? "Theme: GitHub dark high contrast" : "Theme: your terminal's colours");
  };

  // [F25 tui-presets]
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

  const openPicker = (kind: "sessions" | "presets"): void => {
    if (kind === "sessions") {
      const all: Choice[] = runsOf(home, repoRoot).map((r) => {
        const v = sessionView(r);
        const state = v.status === "finished" ? "ready to review" : v.status;
        return { id: r.id, label: v.title, detail: `${state} · ${new Date(r.updatedAt).toLocaleString()}${v.files ? ` · ${v.files} file${v.files === 1 ? "" : "s"}` : ""} · ${r.preset}`, tone: v.status === "failed" ? "red" : undefined };
      });
      if (all.length === 0) return void toast(model, "No earlier sessions in this folder yet.", "muted");
      model.picker = { kind, title: "Sessions in this folder", query: "", all, index: 0, at: Date.now() };
    } else {
      const all: Choice[] = listPresets().map((p) => ({ id: p.name, label: `${p.name}${p.name === preset.name ? "  (current)" : ""}`, detail: p.description.slice(0, 160) }));
      model.picker = { kind, title: "Team presets", query: "", all, index: Math.max(0, all.findIndex((c) => c.id === preset.name)), at: Date.now() };
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
    model.screen = "workspace";
    model.items.push({ kind: "neuromesh", text: `Usage log: ${log.runs.length} real run${log.runs.length === 1 ? "" : "s"} (~/.neuromesh/usage/USAGE.md)` });
    for (const [p, e] of byPreset) {
      const avg = e.rated.length ? ` · rated ${(e.rated.reduce((a, b) => a + b, 0) / e.rated.length).toFixed(1)}` : "";
      model.items.push({ kind: "note", text: `${p}: ${e.n} run${e.n === 1 ? "" : "s"} · ≈$${(e.cost / e.n).toFixed(3)} a run${avg}` });
    }
  };

  const featureSummary = (): void => {
    const off = FEATURES.filter((f) => !isOn(f.key));
    model.screen = "workspace";
    model.items.push({ kind: "neuromesh", text: `${FEATURES.length} features since v0.1; ${off.length === 0 ? "all on" : `off: ${off.map((f) => `${f.id} ${f.key}`).join(", ")}`}. Details: neuromesh features.` });
    for (const f of model.run?.featureErrors ?? []) model.items.push({ kind: "error", text: `${f.id} ${f.key} failed: ${f.message}` });
  };

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
        return discard(true);
      case "theme":
        return switchTheme();
      case "details":
        model.details = !model.details;
        return void toast(model, model.details ? "Showing each agent's steps (ctrl+o hides them)" : "Agent steps hidden");
      case "motion":
        motion = !motion;
        model.motion = motion;
        return void toast(model, motion ? "Animations on" : "Animations off");
      case "usage":
        return usageSummary();
      case "features":
        return featureSummary();
      case "stop":
        model.confirm = "stop";
        return stop();
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

  const acceptSuggest = (run: boolean): void => {
    const s = model.suggest!;
    const it = s.items[s.index]!;
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

  const outcomeKey = (key: Key): boolean => {
    const r = model.run;
    if (!r) return false;
    const ch = key.name === "char" && !key.alt ? (key.text ?? "") : "";
    if (/^[1-5]$/.test(ch)) {
      if (preset.name === "demo" || r.preset === "demo") return void toast(model, "Demo runs are not rated.", "muted"), true;
      model.rating = Number(ch);
      try {
        recordRating(home, { run: r.id, at: new Date().toISOString(), score: model.rating });
        toast(model, `Rated ${ch}. Recorded in the usage log.`);
      } catch (error) {
        toast(model, `Rating not saved: ${error instanceof Error ? error.message : String(error)}`, "red");
      }
      return true;
    }
    if (ch === "a") return apply(), true;
    if (ch === "d") return showDiff(), true;
    if (ch === "x") return discard(), true;
    if (ch === "r") return resume(), true;
    if (ch === "i" || key.name === "tab" || key.name === "enter") {
      model.focus = "composer";
      return true;
    }
    return false;
  };

  const onKey = (key: Key): void => {
    if (!(key.ctrl && key.name === "q")) model.confirm = model.confirm === "quit" ? undefined : model.confirm;
    if ((key.ctrl && key.name === "q") || (key.ctrl && key.name === "c")) return quit();

    // A list popup owns the keyboard: type to filter, arrows to choose, Enter to open.
    if (model.picker) {
      const p = model.picker;
      if (key.name === "esc") model.picker = undefined;
      else if (key.name === "down" || (key.ctrl && key.name === "n")) p.index += 1;
      else if (key.name === "up") p.index = Math.max(0, p.index - 1);
      else if (key.name === "backspace") p.query = [...p.query].slice(0, -1).join("");
      else if (key.name === "char" || key.name === "space" || key.name === "paste") {
        p.query += key.text ?? " ";
        p.index = 0;
      } else if (key.name === "enter") {
        const it = pickerChoices(model)[p.index];
        model.picker = undefined;
        if (it) {
          if (p.kind === "sessions") openSession(it.id);
          else choosePreset(it.id);
        }
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
    if (key.ctrl && key.name === "t") return switchTheme();
    if (key.ctrl && key.name === "o" && isOn("tui-details")) return runAction(COMMANDS.find((c) => c.action === "details")!);

    if (model.focus === "diff" && model.diff) {
      const page = term.size().rows - 3;
      const ch = key.text ?? "";
      if (key.name === "esc" || ch === "q") model.focus = model.run ? "outcome" : "composer";
      else if (key.name === "down" || ch === "j") model.diff.scroll += 1;
      else if (key.name === "up" || ch === "k") model.diff.scroll -= 1;
      else if (key.name === "pagedown" || key.name === "space") model.diff.scroll += page;
      else if (key.name === "pageup") model.diff.scroll -= page;
      else if (key.name === "home" || ch === "g") model.diff.scroll = 0;
      else if (key.name === "end" || ch === "G") model.diff.scroll = Number.MAX_SAFE_INTEGER;
      model.diff.scroll = Math.max(0, model.diff.scroll);
      return;
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

    if (key.name === "pageup") return void (model.scroll += Math.max(1, term.size().rows - 12));
    if (key.name === "pagedown") return void (model.scroll = Math.max(0, model.scroll - Math.max(1, term.size().rows - 12)));
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
    if (composer.handle(key, layoutWidth())) {
      if (key.name !== "up" && key.name !== "down") history.stop();
      updateSuggest();
    }
  };

  term.start(
    (keys) => {
      for (const k of keys) {
        try {
          inFeature("tui", () => onKey(k));
        } catch (error) {
          toast(model, error instanceof Error ? error.message : String(error), "red", 8_000);
        }
      }
      redraw();
    },
    redraw,
  );
  setTitle();
  draw();
  const code = await exited;
  clearInterval(ticker);
  term.title("");
  term.stop();
  // [F28 tui-notify] What this session did, on the way out.
  if (isOn("tui-notify") && session.runs > 0) {
    const lines = [`Neuromesh: ${session.runs} run${session.runs === 1 ? "" : "s"} this session, ≈$${session.cost.toFixed(2)} estimated at API list prices.`];
    for (const id of session.unapplied) lines.push(`  Not applied: ${id}. Review with \`neuromesh diff ${id}\`, apply with \`neuromesh apply ${id}\`, or reopen it with Ctrl+S.`);
    process.stdout.write(lines.join("\n") + "\n");
  }
  return code;
}
