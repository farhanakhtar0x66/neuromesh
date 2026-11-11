// [F19 tui] The TUI: one landing canvas, then a live workspace for the run.
// It drives the same engine as `neuromesh run`, through the engine's events
// and run records only, so it works on any branch with that engine.

import { basename } from "node:path";
import { backends } from "../backends/index.ts";
import { applyRun, currentPatch, discardRun } from "../engine/apply.ts";
import { startRun } from "../engine/run.ts";
import { defaultHome } from "../engine/store.ts";
import type { RunState } from "../engine/types.ts";
import { feature, hint, inFeature, isOn } from "../features.ts";
import { DEFAULT_PRESET, loadPreset } from "../presets/presets.ts";
import { entryFor, recordRating, recordRun } from "../usage/log.ts";
import { findRepo } from "../workspace/workspace.ts";
import { Composer } from "./composer.ts";
import { applyEvent, finished, newModel, submitted, toast } from "./model.ts";
import type { Model } from "./model.ts";
import { Terminal } from "./term.ts";
import type { Key } from "./term.ts";
import { render } from "./view.ts";

export interface TuiOptions {
  cwd: string;
  preset?: string;
}

export async function runTui(options: TuiOptions): Promise<number> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write("The Neuromesh TUI needs an interactive terminal. Use `neuromesh run \"<request>\"` in scripts.\n");
    return 2;
  }
  const presetName = options.preset ?? DEFAULT_PRESET;
  const preset = loadPreset(presetName);
  let repoRoot: string | undefined;
  let repoError: string | undefined;
  try {
    repoRoot = findRepo(options.cwd).root;
  } catch (error) {
    repoError = error instanceof Error ? error.message.split("\n")[0]! : String(error);
  }
  const model = newModel(preset.name, repoRoot ? basename(repoRoot) : undefined, repoError);
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
      toast(model, repoError ?? "Not in a git repository", "red");
      return;
    }
    submitted(model, prompt);
    composer.clear();
    controller = new AbortController();
    const ctx = { home: defaultHome(), backends, signal: controller.signal, onEvent: (e: Parameters<typeof applyEvent>[1]) => (applyEvent(model, e), redraw()) };
    running = startRun({ cwd: repoRoot, prompt, preset }, ctx);
    running
      .then((state) => {
        finished(model, state);
        // [F11 usage-log] Real runs from the TUI are recorded too.
        if (isOn("usage-log") && preset.name !== "demo") {
          try {
            recordRun(defaultHome(), entryFor(state, (b) => backends[b]?.sessionTotals === true));
          } catch (error) {
            toast(model, `Usage log not written: ${error instanceof Error ? error.message : String(error)}`, "red");
          }
        }
      })
      .catch((error: unknown) => {
        model.items.push({ kind: "error", text: `Engine error: ${error instanceof Error ? error.message : String(error)}`, tone: "red" });
        model.stage = "failed";
      })
      .finally(() => {
        running = undefined;
        controller = undefined;
        redraw();
        if (quitting) resolveExit(0);
      });
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

  const outcomeKey = (key: Key): boolean => {
    const r = model.run;
    if (!r) return false;
    const ch = key.text ?? "";
    if (key.name === "char" && /^[1-5]$/.test(ch) && model.preset !== "demo") {
      model.rating = Number(ch);
      try {
        recordRating(defaultHome(), { run: r.id, at: new Date().toISOString(), score: model.rating });
        toast(model, `Rated ${ch}. Recorded in the usage log.`);
      } catch (error) {
        toast(model, `Rating not saved: ${error instanceof Error ? error.message : String(error)}`, "red");
      }
      return true;
    }
    if (ch === "a" && r.status === "finished") {
      try {
        const result = applyRun(r);
        model.run = { ...r, status: "applied" };
        toast(model, `Applied ${result.files} file${result.files === 1 ? "" : "s"} to your repository.`);
      } catch (error) {
        toast(model, error instanceof Error ? error.message : String(error), "red", 8_000);
      }
      return true;
    }
    if (ch === "d") {
      try {
        const patch = currentPatch(r);
        model.diff = { lines: patch ? patch.split("\n") : ["(no changes)"], scroll: 0 };
        model.focus = "diff";
      } catch (error) {
        toast(model, error instanceof Error ? error.message : String(error), "red");
      }
      return true;
    }
    if (ch === "x" && r.status === "finished") {
      if (model.confirm !== "discard") {
        model.confirm = "discard";
        toast(model, "Press x again to throw this run's changes away.", "amber");
        return true;
      }
      try {
        discardRun(r);
        model.run = { ...r, status: "discarded" };
        toast(model, "Discarded.", "amber");
      } catch (error) {
        toast(model, error instanceof Error ? error.message : String(error), "red");
      }
      return true;
    }
    if (ch === "i" || key.name === "tab" || key.name === "enter") {
      model.focus = "composer";
      return true;
    }
    return false;
  };

  const onKey = (key: Key): void => {
    if (key.name !== "esc" && key.name !== "q") model.confirm = model.confirm === "quit" && !(key.ctrl && key.name === "q") ? undefined : model.confirm;
    if ((key.ctrl && key.name === "q") || (key.ctrl && key.name === "c" && !running)) return quit();
    if (key.ctrl && key.name === "c" && running) return quit();
    if (model.focus === "diff" && model.diff) {
      const page = term.size().rows - 3;
      if (key.name === "esc" || key.text === "q") model.focus = "outcome";
      else if (key.name === "down" || key.text === "j") model.diff.scroll += 1;
      else if (key.name === "up" || key.text === "k") model.diff.scroll -= 1;
      else if (key.name === "pagedown" || key.name === "space") model.diff.scroll += page;
      else if (key.name === "pageup") model.diff.scroll -= page;
      else if (key.name === "home" || key.text === "g") model.diff.scroll = 0;
      else if (key.name === "end" || key.text === "G") model.diff.scroll = model.diff.lines.length;
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
      if (running) {
        if (model.confirm !== "stop") {
          model.confirm = "stop";
          toast(model, "Press Esc again to stop the run. It can be resumed later with `neuromesh resume`.", "amber");
          return;
        }
        model.confirm = undefined;
        controller?.abort();
        toast(model, "Stopping…", "amber");
        return;
      }
      if (model.run) model.focus = "outcome";
      return;
    }
    if (key.name === "enter" && !key.alt && !key.shift) {
      if (composer.isEmpty) return;
      if (running) {
        toast(model, "A run is going. Your draft is kept; send it when the run ends.", "amber");
        return;
      }
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
  if (model.run && model.run.status === "finished") {
    process.stdout.write(`Run ${model.run.id} is finished and not applied. Review it with \`neuromesh diff ${model.run.id}\`, then \`neuromesh apply ${model.run.id}\`.\n`);
  }
  return code;
}
