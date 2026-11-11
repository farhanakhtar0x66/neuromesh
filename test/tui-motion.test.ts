import assert from "node:assert/strict";
import { test } from "node:test";
import type { RunState } from "../src/engine/types.ts";
import { buildUp, countUp, ease, progress, scramble, sweep, typed } from "../src/tui/anim.ts";
import { Composer } from "../src/tui/composer.ts";
import { applyEvent, finished, newModel, push, submitted } from "../src/tui/model.ts";
import { stripAnsi, width } from "../src/tui/text.ts";
import { setColorDepth } from "../src/tui/theme.ts";
import { render } from "../src/tui/view.ts";

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

test("the logo builds up when the TUI opens, then stays still", () => {
  setColorDepth("256");
  const m = newModel("p", "repo");
  m.motion = true;
  m.introAt = 10_000;
  m.clock = 10_000;
  const start = text(render(m, new Composer(), 120, 35).lines);
  assert.doesNotMatch(start, /#/, "no bright glyphs at the first frame");
  m.clock = 10_600;
  const middle = text(render(m, new Composer(), 120, 35).lines);
  assert.match(middle, /[:+]/);
  m.clock = 12_000;
  const end = text(render(m, new Composer(), 120, 35).lines);
  m.motion = false;
  assert.equal(end, text(render(m, new Composer(), 120, 35).lines), "after the intro it is exactly the still logo");
});

test("every animation stays inside the screen at every moment", () => {
  setColorDepth("256");
  const m = newModel("factory-opus-luna", "repo");
  m.motion = true;
  submitted(m, "build a typing test");
  applyEvent(m, { t: "", run: "r1", type: "agent.started", role: "worker", task: "main", model: "gpt-6-luna" });
  const c = new Composer();
  c.insert("next");
  for (const dt of [0, 33, 200, 450, 900, 4_600, 5_000]) {
    m.clock = (m.startedAt ?? 0) + dt;
    for (const [cols, rows] of [[160, 45], [100, 30], [60, 18]] as const) fits(render(m, c, cols, rows).lines, cols, rows);
  }
  m.clock = (m.startedAt ?? 0) + 300;
  assert.match(text(render(m, c, 120, 35).lines).split("\n")[2]!, /─{20,}|━/, "the scanner track runs under the pipeline while the team works");
  m.motion = false;
  assert.equal(text(render(m, c, 120, 35).lines).split("\n")[2]!.split("│")[0]!.trim(), "", "and is gone without motion");
  m.motion = true;
});

test("the outcome card drops in, the diff unrolls, and popups unfold", () => {
  setColorDepth("256");
  const m = newModel("p", "repo");
  m.motion = true;
  submitted(m, "fix it");
  finished(m, { id: "r1", status: "finished", outcome: { checks: "passed", files: [{ path: "a.js", insertions: 1, deletions: 1, binary: false }], insertions: 1, deletions: 1 } } as unknown as RunState);
  const t0 = m.endedAt!;
  push(m, { kind: "diff", text: "Changes: 1 file (+1 −1)", lines: ["diff --git a/a.js b/a.js", "@@ -1 +1 @@", "-old", "+new"], at: t0 });

  m.clock = t0;
  const early = text(render(m, new Composer(), 120, 35).lines);
  assert.doesNotMatch(early, /Finished, the project's checks pass/, "the card has not dropped in yet");
  assert.doesNotMatch(early, /\+ new/, "the diff has not unrolled yet");
  m.clock = t0 + 1_000;
  const later = text(render(m, new Composer(), 120, 35).lines);
  assert.match(later, /Finished, the project's checks pass [✦✧⋆]/, "with a sparkle");
  assert.match(later, /a apply  d diff  x discard  1-5 rate/);
  assert.match(later, /1 \+ new/);
  m.clock = t0 + 5_000;
  assert.doesNotMatch(text(render(m, new Composer(), 120, 35).lines), /checks pass [✦✧⋆]/, "the sparkle fades");

  m.palette = { index: 0, at: t0 };
  m.clock = t0 + 20;
  const opening = text(render(m, new Composer(), 120, 35).lines);
  m.clock = t0 + 400;
  const open = text(render(m, new Composer(), 120, 35).lines);
  assert.doesNotMatch(opening, /↑↓ choose/, "the popup is still unfolding from its middle");
  assert.match(open, /Commands[\s\S]*↑↓ choose/, "and then fully open");
});
