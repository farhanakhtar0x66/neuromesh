import assert from "node:assert/strict";
import { test } from "node:test";
import type { RunState } from "../src/engine/types.ts";
import { buildUp, countUp, ease, progress, scramble, sweep, typed } from "../src/tui/anim.ts";
import { Composer } from "../src/tui/composer.ts";
import { applyEvent, finished, newModel, submitted } from "../src/tui/model.ts";
import type { Model } from "../src/tui/model.ts";
import { stripAnsi, width } from "../src/tui/text.ts";
import { setColorDepth } from "../src/tui/theme.ts";
import { motionNeeded, render } from "../src/tui/view.ts";

const text = (lines: string[]): string => stripAnsi(lines.join("\n"));

function fits(lines: string[], cols: number, rows: number): void {
  assert.equal(lines.length, rows);
  for (const l of lines) assert.ok(width(stripAnsi(l)) <= cols, `wider than ${cols}: ${stripAnsi(l)}`);
}

test("animation helpers start, move and land where they should", () => {
  assert.equal(ease(0), 0);
  assert.equal(ease(1), 1);
  assert.ok(ease(0.5) > 0.5, "eases out");
  assert.equal(progress(undefined, 100, 5), 1, "nothing started means nothing to animate");
  assert.equal(progress(1_000, 100, 1_050), 0.5);
  assert.equal(scramble("Cooking", 1, 3), "Cooking");
  assert.notEqual(scramble("Cooking", 0, 3), "Cooking");
  assert.equal(scramble("a b", 0, 3)[1], " ", "spaces stay spaces");
  assert.equal(typed("hello", 0.4), "he");
  assert.equal(countUp(0, 10, 0, 100, 100), 10);
  assert.equal(countUp(0, 10, 0, 100, 0), 0);
  const line = "###    ####";
  assert.equal(buildUp(line, 0, 7, 0).trim(), "", "nothing at the start");
  assert.equal(buildUp(line, 0, 7, 1), line, "the logo itself at the end");
  assert.match(buildUp(line, 0, 7, 0.45), /[:+]/, "density glyphs on the way");
  for (const t of [0, 500, 9_999]) {
    const at = sweep(t, 40);
    assert.ok(at >= -12 && at < 52);
  }
});

const ev = (type: string, data: Record<string, unknown> = {}) => ({ t: "2026-11-12T10:00:00.000Z", run: "r1", type, ...data });
const at = (m: Model, ms: number, cols = 172, rows = 46): string[] => {
  m.clock = ms;
  return render(m, new Composer(), cols, rows).canvas.toText();
};

test("the logo builds up when the TUI opens, then stays still", () => {
  setColorDepth("true");
  const m = newModel("p", "app");
  m.motion = true;
  m.introAt = 1_000;
  const early = text(at(m, 1_050));
  const late = text(at(m, 5_000));
  assert.notEqual(early, late);
  assert.equal(text(at(m, 6_000)), late, "still once it has built");
});

test("the line after a finished step grows into an arrow", () => {
  setColorDepth("true");
  const m = newModel("p", "app");
  m.motion = true;
  submitted(m, "go");
  applyEvent(m, ev("agent.started", { role: "orchestrator", kind: "plan", model: "x" }));
  applyEvent(m, ev("agent.finished", { role: "orchestrator", kind: "plan", model: "x", stop: "done", usage: {} }));
  applyEvent(m, ev("agent.started", { role: "worker", task: "main", kind: "initial", model: "y" }));
  const start = m.stageAt!;
  const pipe = (ms: number): string => at(m, start + ms).find((l) => l.includes("Plan"))!;
  assert.doesNotMatch(pipe(50), /Plan\s+─+▶/, "not an arrow yet");
  assert.match(pipe(800), /Plan\s+─+▶/, "an arrow once grown");
});

test("the brand shimmers when clicked, the status lights up when it changes", () => {
  setColorDepth("true");
  const m = newModel("p", "app");
  m.motion = true;
  m.brandAt = 10_000;
  const brand = (ms: number): number[] => {
    m.clock = ms;
    const f = render(m, new Composer(), 172, 46);
    return [2, 4, 6, 8].map((x) => f.canvas.fg[x]!);
  };
  assert.notDeepEqual(brand(10_300), brand(10_700), "a light runs along it");
  assert.deepEqual(brand(13_000), brand(14_000), "then it rests");
  m.statusAt = 20_000;
  const fill = (ms: number): number => {
    m.clock = ms;
    const f = render(m, new Composer(), 172, 46);
    return f.canvas.bg[170]!;
  };
  assert.notEqual(fill(20_050), fill(21_000));
});

test("frames: fast while something moves, slow for a scrolling name, none when still", () => {
  const m = newModel("p", "app");
  m.motion = true;
  m.clock = 100_000;
  assert.equal(motionNeeded(m, 172), "none");
  m.projectName = "terminal-ascii-screensaver-with-a-long-name";
  assert.equal(motionNeeded(m, 172), "slow", "the name scrolls, slowly");
  m.projectName = "app";
  m.brandAt = 99_800;
  assert.equal(motionNeeded(m, 172), "fast");
  m.brandAt = undefined;
  submitted(m, "go");
  m.clock = Date.now();
  assert.equal(motionNeeded(m, 172), "fast", "a run is going");
  m.motion = false;
  assert.equal(motionNeeded(m, 172), "slow", "without motion, a calm tick for the clock");
});

test("every animation stays inside the screen at every moment", () => {
  setColorDepth("true");
  const m = newModel("p", "a-project-name-long-enough-to-scroll-in-the-top-bar");
  m.motion = true;
  m.introAt = 0;
  submitted(m, "go");
  applyEvent(m, ev("agent.started", { role: "worker", task: "main", kind: "initial", model: "gpt-6-luna" }));
  m.brandAt = 0;
  m.statusAt = 0;
  m.palette = { index: 0, at: 0 };
  for (const [cols, rows] of [[172, 46], [100, 30], [60, 16]] as const) {
    for (const t of [0, 40, 120, 300, 700, 1_500, 4_600, 9_000]) {
      const lines = at(m, t, cols, rows);
      assert.equal(lines.length, rows);
      for (const l of lines) assert.equal(width(l), cols, `${cols}x${rows} at ${t}`);
    }
  }
  finished(m, { id: "r1", status: "finished", preset: "p", outcome: { files: [], insertions: 0, deletions: 0, checks: "passed" } } as unknown as RunState);
  m.palette = undefined;
  for (const t of [0, 200, 2_000]) fits(render(m, new Composer(), 120, 35).lines, 120, 35), void t;
});
