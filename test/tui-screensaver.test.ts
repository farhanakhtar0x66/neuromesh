import assert from "node:assert/strict";
import { test } from "node:test";
import { EFFECTS, EFFECT_MS, advance, fitArt, gradient, newSaver, saverFrame, shuffled } from "../src/tui/screensaver.ts";
import { parseKeys } from "../src/tui/term.ts";
import { stripAnsi, width } from "../src/tui/text.ts";
import { LOGO_WIDE } from "../src/tui/view.ts";

test("each effect plays once per cycle, and a cycle never starts with the effect that just ended", () => {
  let previous: string | undefined;
  for (let i = 0; i < 50; i++) {
    const cycle = shuffled(previous);
    assert.deepEqual([...cycle].sort(), [...EFFECTS].sort());
    assert.notEqual(cycle[0], previous);
    previous = cycle.at(-1);
  }
  const s = newSaver(0);
  const first = s.order[0];
  advance(s, EFFECT_MS * EFFECTS.length + 10);
  assert.equal(s.index, 0, "a full cycle later it starts a new one");
  assert.notEqual(s.order[0], s.previous);
  assert.ok(first);
});

test("the logo is scaled to fit small terminals, keeping its shape", () => {
  const fitted = fitArt(LOGO_WIDE, 60, 20);
  assert.ok(Math.max(...fitted.map((l) => [...l].length)) <= 56);
  assert.ok(fitted.length < LOGO_WIDE.length);
  assert.deepEqual(fitArt(LOGO_WIDE, 200, 50), LOGO_WIDE.map((l) => l.trimEnd()), "unchanged when it fits");
});

test("every effect draws within the screen at every moment, and shows the logo once settled", () => {
  for (const effect of EFFECTS) {
    for (const [cols, rows] of [[150, 40], [80, 24], [40, 12]] as const) {
      for (const t of [0, 250, 1_000, 3_000, 6_000, 8_900]) {
        const s = newSaver(0);
        s.order = [effect, ...EFFECTS.filter((e) => e !== effect)];
        const lines = saverFrame(s, LOGO_WIDE, cols, rows, t, "true", "neuromesh is still working · move the mouse or press a key");
        assert.equal(lines.length, rows, `${effect} ${cols}x${rows} at ${t}`);
        for (const l of lines) assert.ok(width(stripAnsi(l)) <= cols, `${effect} wider than ${cols} at ${t}`);
      }
    }
    const s = newSaver(0);
    s.order = [effect];
    const settled = stripAnsi(saverFrame(s, LOGO_WIDE, 150, 40, 8_000, "none", "status").join("\n"));
    assert.match(settled, /:::/, `${effect} shows the logo`);
    assert.match(settled, /status/);
  }
});

test("the gradient wraps smoothly, and the mouse is read as input only as a whole report", () => {
  assert.deepEqual(gradient(0), gradient(1));
  assert.notDeepEqual(gradient(0.3), gradient(0.6));
  assert.deepEqual(parseKeys("\x1b[<35;80;20M").keys, [{ name: "mouse" }]);
});
