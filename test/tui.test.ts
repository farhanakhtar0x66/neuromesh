import assert from "node:assert/strict";
import { test } from "node:test";
import type { NeuromeshEvent } from "../src/engine/store.ts";
import type { RunState } from "../src/engine/types.ts";
import { Composer } from "../src/tui/composer.ts";
import { applyEvent, finished, newModel, pipeline, submitted } from "../src/tui/model.ts";
import { parseKeys } from "../src/tui/term.ts";
import { cellWidth, stripAnsi, width, wrap } from "../src/tui/text.ts";
import { setColorDepth } from "../src/tui/theme.ts";
import { render } from "../src/tui/view.ts";

test("keys: arrows with modifiers, Alt+Enter, Shift+Tab, control keys and typed bursts", () => {
  const { keys } = parseKeys("\x1b[A\x1b[1;5C\x1b\r\x1b[Z\x03hello\x7f\x1bOP\x1b[5~");
  assert.deepEqual(
    keys.map((k) => [k.name, k.text, k.ctrl, k.alt, k.shift]),
    [
      ["up", undefined, undefined, undefined, undefined],
      ["right", undefined, true, undefined, undefined],
      ["enter", undefined, undefined, true, undefined],
      ["tab", undefined, undefined, undefined, true],
      ["c", undefined, true, undefined, undefined],
      ["char", "hello", undefined, undefined, undefined],
      ["backspace", undefined, undefined, undefined, undefined],
      ["f1", undefined, undefined, undefined, undefined],
      ["pageup", undefined, undefined, undefined, undefined],
    ],
  );
  assert.deepEqual(parseKeys("\x1b[13;2u").keys[0], { name: "enter", shift: true }, "Shift+Enter in the keyboard protocol");
  assert.equal(parseKeys("👍🏽é").keys[0]?.text, "👍🏽é");
});

test("keys: a bracketed paste is one key, even across reads", () => {
  const first = parseKeys("\x1b[200~line one\nline");
  assert.equal(first.keys.length, 0);
  const second = parseKeys(" two\x1b[201~x", first.pending);
  assert.deepEqual(second.keys, [{ name: "paste", text: "line one\nline two" }, { name: "char", text: "x" }]);
});

test("text is measured in cells: wide characters take two, accents none", () => {
  assert.equal(width("abc"), 3);
  assert.equal(width("日本"), 4);
  assert.equal(width("é"), 1);
  assert.equal(cellWidth("👍"), 2);
  assert.equal(width("\x1b[31mred\x1b[0m"), 3);
  assert.deepEqual(wrap("the quick brown fox", 9), ["the quick", "brown fox"]);
  assert.deepEqual(wrap("abcdefghij", 4), ["abcd", "efgh", "ij"]);
  assert.deepEqual(wrap("one\n\ntwo", 10), ["one", "", "two"]);
});

test("the composer edits by grapheme and keeps its column moving up and down", () => {
  const c = new Composer();
  c.insert("héllo 👍🏽");
  c.handle({ name: "backspace" }, 40);
  assert.equal(c.text, "héllo ");
  c.handle({ name: "enter", alt: true }, 40);
  c.insert("ab");
  c.handle({ name: "up" }, 40);
  c.insert("X");
  assert.equal(c.text, "héX" + "llo \nab");
  assert.equal(c.handle({ name: "enter" }, 40), false, "plain Enter is for sending, not editing");
  c.text = "abcdefghij";
  const { lines, row, col } = c.layout(4);
  assert.deepEqual(lines, ["abcd", "efgh", "ij"]);
  assert.deepEqual([row, col], [2, 2]);
  c.handle({ name: "u", ctrl: true }, 40);
  assert.equal(c.isEmpty, true);
});

function linesFit(frame: { lines: string[] }, cols: number, rows: number): void {
  assert.equal(frame.lines.length, rows, "one line per terminal row");
  for (const [i, l] of frame.lines.entries()) assert.ok(width(stripAnsi(l)) <= cols, `line ${i} is ${width(stripAnsi(l))} cells, wider than ${cols}: ${stripAnsi(l)}`);
}

const ev = (type: string, data: Record<string, unknown> = {}): NeuromeshEvent => ({ t: "2026-11-12T10:00:00.000Z", run: "r1", type, ...data });

test("the landing screen fits every size, and the cursor sits in the composer", () => {
  setColorDepth("true");
  for (const [cols, rows] of [[160, 45], [120, 35], [80, 24], [60, 18], [40, 12]] as const) {
    const m = newModel("factory-opus-luna", "my-app");
    const c = new Composer();
    c.insert("build a typing test");
    const frame = render(m, c, cols, rows);
    linesFit(frame, cols, rows);
    assert.ok(frame.cursor && frame.cursor.row < rows && frame.cursor.col < cols);
    assert.match(stripAnsi(frame.lines[frame.cursor.row]!), /build a typing test/);
  }
  const small = render(newModel("p"), new Composer(), 30, 10);
  assert.match(stripAnsi(small.lines.join("\n")), /Too small/);
  setColorDepth("none");
  const plain = render(newModel("p", "repo"), new Composer(), 80, 24);
  assert.ok(plain.lines.every((l) => !l.includes("\x1b")), "NO_COLOR draws no colour codes");
});

test("the workspace shows the request at once, then agents, cost and the outcome from real events", () => {
  setColorDepth("256");
  const m = newModel("factory-opus-luna", "my-app");
  submitted(m, "build a typing test for the terminal");
  const c = new Composer();
  let frame = render(m, c, 80, 24);
  linesFit(frame, 80, 24);
  assert.match(stripAnsi(frame.lines.join("\n")), /build a typing test for the terminal/);

  applyEvent(m, ev("agent.started", { role: "briefer", kind: "spec", model: "claude-opus-5-5", tier: "expert" }));
  applyEvent(m, ev("agent.finished", { role: "briefer", kind: "spec", model: "claude-opus-5-5", tier: "expert", stop: "done", durationMs: 60_000, usage: { input: 0, cacheWrite: 10_000, output: 5_000 }, cost: 0.18 }));
  applyEvent(m, ev("agent.started", { role: "worker", task: "main", kind: "initial", model: "gpt-6-luna", tier: "worker" }));
  applyEvent(m, ev("agent.activity", { role: "worker", task: "main", activity: "command", summary: "npm test" }));
  assert.equal(m.stage, "building");
  assert.deepEqual(pipeline(m).map((p) => p.state), ["done", "active", "todo", "todo"]);
  for (const [cols, rows] of [[160, 45], [120, 35], [80, 24], [40, 12]] as const) {
    frame = render(m, c, cols, rows);
    linesFit(frame, cols, rows);
  }
  const wide = stripAnsi(render(m, c, 160, 45).lines.join("\n"));
  assert.match(wide, /AGENTS/);
  assert.match(wide, /Spec writer/);
  assert.match(wide, /\$0\.18/);
  assert.match(wide, /npm test/, "the live activity line");
  assert.equal(m.expertCost, 0.18);

  finished(m, { id: "r1", status: "finished", outcome: { checks: "passed", files: [{ path: "a.js" }], insertions: 12, deletions: 1 }, featureErrors: [] } as unknown as RunState);
  frame = render(m, c, 120, 35);
  linesFit(frame, 120, 35);
  const text = stripAnsi(frame.lines.join("\n"));
  assert.match(text, /Finished, the project's checks pass/);
  assert.match(text, /1 file \(\+12 −1\)/);
  assert.match(text, /a +Apply/);
  assert.equal(frame.cursor, undefined, "the outcome card has focus, not the composer");
});

test("the diff view colours additions and removals and fits the screen", () => {
  setColorDepth("256");
  const m = newModel("p", "repo");
  m.focus = "diff";
  m.diff = { lines: ["diff --git a/x b/x", "@@ -1 +1 @@", "-old line", "+new line that is much longer than the screen ".repeat(5)], scroll: 0 };
  const frame = render(m, new Composer(), 60, 15);
  linesFit(frame, 60, 15);
  assert.match(stripAnsi(frame.lines.join("\n")), /▸ x[\s\S]*1   - old line[^\n]*\n[┃ ]*1 \+ new line/, "file header, then old and new line numbers");
});

test("the landing screen is only the logo and the prompt; the bottom bar shows the commands key and the folder", async () => {
  const { setColorDepth: depth, setTheme } = await import("../src/tui/theme.ts");
  depth("none");
  setTheme("terminal");
  const m = newModel("factory-opus-luna", "my-app");
  m.cwd = "/work/projects/my-app";
  const frame = render(m, new Composer(), 120, 35);
  const text = frame.lines.join("\n");
  assert.doesNotMatch(text, /Cheap agents|Alt\+Enter|Ctrl\+U/, "no slogan and no key list on the landing screen");
  assert.match(frame.lines.at(-1)!, /^┗━ \[ctrl\+p\] menu .*━ factory-opus-luna \/work\/projects\/my-app ━┛$/, "the frame's bottom edge holds the keys and the folder");
  assert.match(frame.lines[0]!, /^┏━ NEUROMESH  my-app ━+ \[ready\] ━┓$/, "and its top edge the name, project and status");
  for (const l of frame.lines.slice(1, -1)) assert.match(l, /^┃.*┃$/, "a heavy frame all round");
  assert.match(text, /┏━+┓[^\n]*\n.*› What should we build\?/);
});

test("the command popup lists every command over the screen, and the three panes appear on wide terminals", async () => {
  const { setColorDepth: depth } = await import("../src/tui/theme.ts");
  depth("256");
  const m = newModel("factory-opus-luna", "my-app");
  m.sessions = [{ id: "r0", title: "add a --json flag", status: "applied", at: new Date().toISOString(), files: 2 }];
  m.team = [{ role: "lead", model: "claude-opus-5-5 medium" }];
  submitted(m, "build a typing test");
  m.palette = { index: 5 };
  for (const [cols, rows] of [[160, 45], [100, 30], [60, 18]] as const) {
    const frame = render(m, new Composer(), cols, rows);
    linesFit(frame, cols, rows);
    assert.match(stripAnsi(frame.lines.join("\n")), /Commands[\s\S]*› \/stop +esc esc +Stop the run/);
  }
  m.palette = undefined;
  const wide = stripAnsi(render(m, new Composer(), 160, 45).lines.join("\n"));
  assert.match(wide, /SESSIONS[\s\S]*add a --json flag/);
  assert.match(wide, /TEAM[\s\S]*lead +claude-opus-5-5 medium/);
  assert.doesNotMatch(wide, /Chat +Plan +Diff/, "no tabs");
});

test("a finished run shows its diff in the stream", () => {
  const m = newModel("p", "repo");
  submitted(m, "fix it");
  finished(m, { id: "r1", status: "finished", outcome: { checks: "passed", files: [{ path: "a.js", insertions: 1, deletions: 1, binary: false }], insertions: 1, deletions: 1 } } as unknown as RunState);
  m.items.push({ kind: "diff", text: "Changes: 1 file (+1 −1)", lines: ["diff --git a/a.js b/a.js", "@@ -1 +1 @@", "-old", "+new"] });
  const text = stripAnsi(render(m, new Composer(), 120, 35).lines.join("\n"));
  assert.match(text, /◆ Changes: 1 file \(\+1 −1\)[^\n]*\n[^\n]*\n[┃ ]*▸ a\.js[\s\S]*1   - old[^\n]*\n[┃ ]*1 \+ new/);
  assert.match(text, /CHANGES +\+1 −1[\s\S]*a\.js +\+1 −1/);
  assert.match(text, /WAITING FOR YOU/);
});
