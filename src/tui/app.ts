// [F19 tui] The TUI: one landing canvas, then a live workspace for the run.
// It drives the same engine as `neuromesh run`, through the engine's events
// and run records only, so it works on any branch with that engine.

import { basename } from "node:path";
import { backends } from "../backends/index.ts";
import { applyRun, currentPatch, discardRun } from "../engine/apply.ts";
import { startRun } from "../engine/run.ts";
import { defaultHome, listRuns } from "../engine/store.ts";
import type { RunState } from "../engine/types.ts";
import { feature, hint, inFeature, isOn } from "../features.ts";
import { DEFAULT_PRESET, loadPreset } from "../presets/presets.ts";
import type { Preset } from "../presets/presets.ts";
import { entryFor, recordRating, recordRun } from "../usage/log.ts";
import { findRepo } from "../workspace/workspace.ts";
import { Composer } from "./composer.ts";
import { applyEvent, finished, newModel, submitted, toast } from "./model.ts";
import type { Model, SessionView } from "./model.ts";
import { Terminal } from "./term.ts";
import type { Key } from "./term.ts";
import { setTheme, themeName } from "./theme.ts";
import { paletteCommand, render } from "./view.ts";
import type { Command } from "./view.ts";

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

function sessionsOf(home: string, repoRoot: string | undefined): SessionView[] {
  if (!repoRoot) return [];
  try {
    return listRuns(home, repoRoot)
      .reverse()
      .slice(0, 40)
      .map((r) => ({
        id: r.id,
        title: (r.request ?? r.prompt).split("\n").find((l) => l.trim())?.trim() ?? "(empty request)",
        status: r.status,
        at: r.updatedAt,
        files: r.outcome?.files.length,
      }));
  } catch {
    return [];
  }
}

export async function runTui(options: TuiOptions): Promise<number> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write("The Neuromesh TUI needs an interactive terminal. Use `neuromesh run \"<request>\"` in scripts.\n");
    return 2;
  }
  const home = defaultHome();
  const preset = loadPreset(options.preset ?? DEFAULT_PRESET);
  let repoRoot: string | undefined;
  let repoError: string | undefined;
  try {
    repoRoot = findRepo(options.cwd).root;
  } catch (error) {
    repoError = error instanceof Error ? error.message.split("\n")[0]! : String(error);
  }
  const fresh = (): Model => {
    const m = newModel(preset.name, repoRoot ? basename(repoRoot) : undefined, repoError);
    m.cwd = options.cwd;
    m.team = teamOf(preset);
    m.budgetUsd = preset.expertBudgetUsd;
    m.sessions = sessionsOf(home, repoRoot);
    return m;
  };
  let model = fresh();
  const composer = new Composer();
  const term = new Terminal();
  let controller: AbortController | undefined;
  let running: Promise<RunState> | undefined;
  let quitting = false;
  let resolveExit: (code: number) => void = () => {};
  const exited = new Promise<number>((r) => (resolveExit = r));

  // Redraws are coalesced; a spinner ticks only while a run is going.
  let scheduled = false;
  const draw = (): void => {
    scheduled = false;
    const { cols, rows } = term.size();
    try {
      const frame = render(model, composer, cols, rows);
      term.draw(frame.lines, frame.cursor);
    } catch (error) {
      // A drawing bug must not leave the terminal unusable: show it, tagged.
      term.draw([`Neuromesh TUI drawing error: ${error instanceof Error ? error.message : String(error)}`, hint(feature("tui")), "Ctrl+Q quits."]);
    }
  };
  const redraw = (): void => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(draw, 16);
  };
  const ticker = setInterval(() => {
    if (running || (model.toast && model.toast.until > Date.now() - 200)) redraw();
  }, 120);
  const layoutWidth = (): number => Math.min(term.size().cols - 8, 100);

  const start = (prompt: string): void => {
    if (!repoRoot) {
      toast(model, repoError ?? "Not in a git repository", "red", 8_000);
      return;
    }
    const m = model;
    submitted(m, prompt);
    composer.clear();
    controller = new AbortController();
    const ctx = { home, backends, signal: controller.signal, onEvent: (e: Parameters<typeof applyEvent>[1]) => (applyEvent(m, e), redraw()) };
    running = startRun({ cwd: repoRoot, prompt, preset }, ctx);
    running
      .then((state) => {
        finished(m, state);
        // The change itself, in the conversation.
        try {
          const patch = state.status === "finished" ? currentPatch(state) : "";
          if (patch.trim()) {
            const o = state.outcome;
            m.items.push({ kind: "diff", text: `Changes: ${o?.files.length ?? 0} file${o?.files.length === 1 ? "" : "s"} (+${o?.insertions ?? 0} −${o?.deletions ?? 0})`, lines: patch.trimEnd().split("\n") });
          }
        } catch {
          // The diff is a convenience; the outcome card still offers it.
        }
        // [F11 usage-log] Real runs from the TUI are recorded too; demo runs never.
        if (isOn("usage-log") && preset.name !== "demo") {
          try {
            recordRun(home, entryFor(state, (b) => backends[b]?.sessionTotals === true));
          } catch (error) {
            toast(m, `Usage log not written: ${error instanceof Error ? error.message : String(error)}`, "red");
          }
        }
        m.sessions = sessionsOf(home, repoRoot);
      })
      .catch((error: unknown) => {
        m.items.push({ kind: "error", text: `Engine error: ${error instanceof Error ? error.message : String(error)}`, tone: "red" });
        m.stage = "failed";
      })
      .finally(() => {
        running = undefined;
        controller = undefined;
        redraw();
        if (quitting) resolveExit(0);
      });
    m.sessions = sessionsOf(home, repoRoot);
    redraw();
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
      toast(model, "Press Esc again to stop the run. It can be resumed later with `neuromesh resume`.", "amber");
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
      model.sessions = sessionsOf(home, repoRoot);
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
      model.sessions = sessionsOf(home, repoRoot);
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

  const runCommand = (cmd: Command): void => {
    model.palette = undefined;
    switch (cmd.action) {
      case "new":
        return newSession();
      case "diff":
        return showDiff();
      case "apply":
        return apply();
      case "discard":
        return discard(true);
      case "theme":
        return switchTheme();
      case "stop":
        model.confirm = "stop";
        return stop();
      case "quit":
        return quit();
      default:
        toast(model, `${cmd.keys}: ${cmd.label}`, "muted");
    }
  };

  const outcomeKey = (key: Key): boolean => {
    const r = model.run;
    if (!r) return false;
    const ch = key.name === "char" && !key.alt ? (key.text ?? "") : "";
    if (/^[1-5]$/.test(ch)) {
      if (preset.name === "demo") return void toast(model, "Demo runs are not rated.", "muted"), true;
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
    if (ch === "i" || key.name === "tab" || key.name === "enter") {
      model.focus = "composer";
      return true;
    }
    return false;
  };

  const onKey = (key: Key): void => {
    if (!(key.ctrl && key.name === "q")) model.confirm = model.confirm === "quit" ? undefined : model.confirm;
    if ((key.ctrl && key.name === "q") || (key.ctrl && key.name === "c")) return quit();

    // The command popup owns the keyboard while it is open.
    if (model.palette) {
      if (key.name === "esc" || (key.ctrl && key.name === "p")) model.palette = undefined;
      else if (key.name === "down" || (key.ctrl && key.name === "n")) model.palette.index += 1;
      else if (key.name === "up") model.palette.index -= 1;
      else if (key.name === "enter") runCommand(paletteCommand(model.palette.index));
      return;
    }
    if (key.ctrl && key.name === "p") {
      model.palette = { index: 0 };
      return;
    }
    if (key.ctrl && key.name === "n") return newSession();
    if (key.ctrl && key.name === "t") return switchTheme();

    if (model.focus === "diff" && model.diff) {
      const page = term.size().rows - 3;
      const ch = key.text ?? "";
      if (key.name === "esc" || ch === "q") model.focus = model.run ? "outcome" : "composer";
      else if (key.name === "down" || ch === "j") model.diff.scroll += 1;
      else if (key.name === "up" || ch === "k") model.diff.scroll -= 1;
      else if (key.name === "pagedown" || key.name === "space") model.diff.scroll += page;
      else if (key.name === "pageup") model.diff.scroll -= page;
      else if (key.name === "home" || ch === "g") model.diff.scroll = 0;
      else if (key.name === "end" || ch === "G") model.diff.scroll = model.diff.lines.length;
      model.diff.scroll = Math.max(0, model.diff.scroll);
      return;
    }
    if (key.name === "pageup") {
      model.scroll += Math.max(1, term.size().rows - 12);
      return;
    }
    if (key.name === "pagedown") {
      model.scroll = Math.max(0, model.scroll - Math.max(1, term.size().rows - 12));
      return;
    }
    if (model.focus === "outcome" && outcomeKey(key)) return;
    if (key.name === "esc") {
      if (running) return stop();
      if (model.run) model.focus = "outcome";
      return;
    }
    if (key.name === "enter" && !key.alt && !key.shift) {
      if (composer.isEmpty) return;
      if (running) return void toast(model, "A run is going. Your draft is kept; send it when the run ends.", "amber");
      start(composer.text.trim());
      return;
    }
    composer.handle(key, layoutWidth());
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
  draw();
  const code = await exited;
  clearInterval(ticker);
  term.stop();
  if (model.run && model.run.status === "finished" && (model.run.outcome?.files.length ?? 0) > 0) {
    process.stdout.write(`Run ${model.run.id} is finished and not applied. Review it with \`neuromesh diff ${model.run.id}\`, then \`neuromesh apply ${model.run.id}\`.\n`);
  }
  return code;
}
