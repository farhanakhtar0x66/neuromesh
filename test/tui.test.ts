import assert from "node:assert/strict";
import { test } from "node:test";
import type { NeuromeshEvent } from "../src/engine/store.ts";
import type { RunState } from "../src/engine/types.ts";
import { Composer } from "../src/tui/composer.ts";
import { applyEvent, finished, newModel, pipeline, submitted } from "../src/tui/model.ts";
import type { Model } from "../src/tui/model.ts";
import { decodeMouse, parseKeys, readColourReplies } from "../src/tui/term.ts";
import { cellWidth, width, wrap } from "../src/tui/text.ts";
import { DEFAULT, setColorDepth, setTransparent } from "../src/tui/theme.ts";
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
  assert.deepEqual(parseKeys("\r").keys[0], { name: "enter" }, "Enter is a carriage return");
  assert.deepEqual(parseKeys("\n").keys[0], { name: "j", ctrl: true }, "Ctrl+J, a line feed, is a new line");
});

test("keys: a bracketed paste is one key, even across reads; so is a mouse report cut in two", () => {
  const first = parseKeys("\x1b[200~line one\nline");
  assert.equal(first.keys.length, 0);
  const second = parseKeys(" two\x1b[201~x", first.pending);
  assert.deepEqual(second.keys, [{ name: "paste", text: "line one\nline two" }, { name: "char", text: "x" }]);
  const cut = parseKeys("a\x1b[<0;12");
  assert.deepEqual(cut.keys, [{ name: "char", text: "a" }]);
  const rest = parseKeys(";5M", cut.pending);
  assert.deepEqual(rest.keys, [{ name: "mouse", mouse: { x: 11, y: 4, button: "left", action: "down" } }], "never typed into the prompt");
});

test("mouse reports: clicks, releases, movement and the wheel", () => {
  assert.deepEqual(decodeMouse(["<0", "1", "1"], "M"), { x: 0, y: 0, button: "left", action: "down" });
  assert.deepEqual(decodeMouse(["<0", "5", "3"], "m"), { x: 4, y: 2, button: "left", action: "up" });
  assert.equal(decodeMouse(["<35", "9", "9"], "M").action, "move");
  assert.equal(decodeMouse(["<32", "9", "9"], "M").action, "drag");
  assert.equal(decodeMouse(["<64", "9", "9"], "M").action, "wheelUp");
  assert.equal(decodeMouse(["<65", "9", "9"], "M").action, "wheelDown");
});

test("the terminal's colour replies are read, whatever their form", () => {
  const keys = parseKeys("\x1b]11;rgb:0a0a/0c0c/1010\x07\x1b]10;rgb:f0/f3/f6\x1b\\\x1b]4;2;rgb:2626/cdcd/4d4d\x07\x1b[?62;22c").keys;
  assert.deepEqual(keys.map((k) => k.name), ["osc", "osc", "osc", "da"]);
  const c = readColourReplies(keys.filter((k) => k.name === "osc").map((k) => k.text!));
  assert.deepEqual(c.bg, [10, 12, 16]);
  assert.deepEqual(c.fg, [240, 243, 246]);
  assert.deepEqual(c.ansi[2], [38, 205, 77]);
});

test("text is measured in cells: wide characters take two, accents none", () => {
  assert.equal(width("abc"), 3);
  assert.equal(width("日本"), 4);
  assert.equal(width("é"), 1);
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

// ---------------------------------------------------------------------------
// Screens

const ev = (type: string, data: Record<string, unknown> = {}): NeuromeshEvent => ({ t: "2026-11-12T10:00:00.000Z", run: "r1", type, ...data });
const screen = (m: Model, cols = 172, rows = 46, c = new Composer()) => {
  const f = render(m, c, cols, rows);
  return { f, text: f.canvas.toText().join("\n"), ids: f.regions.map((r) => r.id) };
};

function teamRun(): Model {
  const m = newModel("factory-opus-luna", "app");
  m.cwd = "/work/projects/app";
  submitted(m, "build the app");
  applyEvent(m, ev("brief", { kind: "greenfield", staffing: { plan: true, tester: true } }));
  applyEvent(m, ev("agent.started", { role: "orchestrator", kind: "plan", model: "claude-opus-5-5", effort: "medium", promptChars: 8_000, contextChars: 4_000 }));
  applyEvent(m, ev("agent.finished", { role: "orchestrator", kind: "plan", model: "claude-opus-5-5", stop: "done", durationMs: 8_000, usage: { input: 2_000, cacheRead: 10_000, output: 500 }, cost: 0.12, tier: "expert", quotaUsed: { five_hour: 0.42, seven_day: 0.08 }, quotaResets: { five_hour: 1_794_460_000 } }));
  applyEvent(m, ev("plan.ready", { summary: "Two parts, **UI** first.", tasks: [{ id: "t1", title: "UI" }, { id: "t2", title: "Storage" }] }));
  return m;
}

test("the landing screen: the logo, a prompt, and the bars; the cursor is in the prompt", () => {
  setColorDepth("true");
  setTransparent(false);
  const m = newModel("factory-opus-luna", "my-app");
  m.cwd = "/work/projects/my-app";
  const { f, text, ids } = screen(m);
  const rows = text.split("\n");
  assert.match(rows[0]!, /NEUROMESH.*my-app.*ready/, "the top bar: brand, project, status");
  assert.match(rows.at(-1)!, /ctrl\+p\s+menu\s+\/\s+commands\s+@\s+files.*\/work\/projects\/my-app/, "the bottom bar: three buttons and the folder");
  assert.match(text, /What should we build\?/);
  assert.match(text, /● Normal/, "the prompt bar shows Normal or Turbo");
  assert.doesNotMatch(text, /⏎/, "no enter icon");
  for (const id of ["brand", "project-name", "status", "bar:menu", "bar:commands", "bar:files", "prompt:attach", "prompt:access"]) assert.ok(ids.includes(id), id);
  assert.ok(f.cursor && rows[f.cursor.row]!.includes("What should we build"), "the cursor sits in the prompt");
});

test("the look: neuromesh-dark by default, framed panes with titles in their edges; transparent paints nothing", () => {
  setColorDepth("true");
  setTransparent(false);
  const m = teamRun();
  const { f, text } = screen(m);
  const bg = (x: number, y: number): number => f.canvas.bg[y * f.canvas.w + x]!;
  assert.equal(bg(5, 20), 0x101010, "the theme's own background, whatever the terminal's");
  assert.equal(bg(60, 20), 0x101010, "one background for every pane");
  assert.notEqual(bg(60, 0), 0x101010, "the bars stand out");
  assert.match(text, /╭─ Projects ─+ ▾ {2}\+ ─╮/);
  assert.match(text, /├─ Recents ─+/);
  assert.match(text, /╭─ Project ─+╮/);
  assert.match(text, /╭─ Orchestrator · Opus 5\.5 med/, "an agent's label sits in its box's top edge");
  assert.doesNotMatch(text, /▌/, "no shaded side bars");
  setTransparent(true);
  const t = screen(teamRun());
  assert.equal(t.f.canvas.bg[20 * t.f.canvas.w + 5], DEFAULT, "the terminal's own background shows");
  assert.match(t.text, /╭─ Projects/, "the same frames");
  setTransparent(false);
});

test("the stream: one box per agent with its role and model; the plan waits for an answer with buttons", () => {
  setColorDepth("true");
  const m = teamRun();
  applyEvent(m, ev("ask", { question: { kind: "plan", summary: "x", tasks: [{ id: "t1", title: "UI", owner: "worker" }, { id: "t2", title: "Storage", owner: "worker" }] } }));
  const { text, ids } = screen(m);
  assert.match(text, /Orchestrator · Opus 5\.5 med/);
  assert.match(text, /Two parts, UI first\./, "inline markdown is drawn, not shown");
  assert.doesNotMatch(text, /\*\*UI\*\*/);
  assert.match(text, /◇ t1 UI/);
  assert.match(text, /plan has 2 tasks\. Carry it out\?/);
  assert.match(text, /y\s+Approve\s+c\s+Change…\s+n\s+Stop/);
  for (const id of ["ask:yes", "ask:change", "ask:no"]) assert.ok(ids.includes(id), id);
  assert.match(text.split("\n")[0]!, /\? approve the plan/, "the status says so too");
  applyEvent(m, ev("answer", { kind: "plan", ok: true }));
  const after = screen(m).text;
  assert.match(after, /✓ yes/);
  assert.doesNotMatch(after, /Approve/);
});

test("verbosity: medium lists the workers' tasks, full shows every step, none only the labels; a click opens a box", () => {
  setColorDepth("true");
  const m = teamRun();
  for (const t of ["t1", "t2"]) {
    applyEvent(m, ev("task.started", { task: t, title: t === "t1" ? "UI" : "Storage" }));
    applyEvent(m, ev("agent.started", { role: "worker", task: t, kind: "initial", model: "gpt-6-luna", effort: "high" }));
    applyEvent(m, ev("agent.activity", { role: "worker", task: t, activity: "tool", summary: `$ npm test ${t}` }));
  }
  applyEvent(m, ev("agent.finished", { role: "worker", task: "t1", stop: "done", model: "gpt-6-luna", durationMs: 3_000, usage: { input: 1_000, output: 100 } }));
  applyEvent(m, ev("task.report", { role: "worker", task: "t1", status: "done", summary: "## Done\n\nBuilt the **list view**." }));
  m.verbose = "medium";
  const medium = screen(m).text;
  assert.match(medium, /Worker · GPT-6 Luna high/, "parallel workers share one box");
  assert.match(medium, /◆ t1 UI/);
  assert.match(medium, /Built the list view\./, "the report's gist, not its heading");
  assert.match(medium, /t2 · \$ npm test t2/, "what a working agent is doing now");
  m.verbose = "full";
  assert.match(screen(m).text, /t1 · \$ npm test t1/);
  m.verbose = "none";
  const none = screen(m);
  assert.doesNotMatch(none.text, /◆ t1 UI/);
  assert.match(none.text, /Worker · GPT-6 Luna high/);
  const box = none.ids.findLast((id) => id.startsWith("box:"))!;
  m.expanded.add(box.slice(4));
  assert.ok(screen(m).text.includes("$ npm test"), "an opened box shows everything");
});

test("the right pane: project, the agent graph with usage, context, changes and cost", () => {
  setColorDepth("true");
  const m = teamRun();
  m.branch = "neuromesh-testing";
  m.team = [{ role: "lead", model: "claude-opus-5-5 medium" }, { role: "worker", model: "gpt-6-luna high" }, { role: "tester", model: "gpt-6-luna" }];
  const { text, ids } = screen(m);
  assert.match(text, /─ Project ─/);
  assert.match(text, /⑂ neuromesh-testing/);
  assert.match(text, /✓ Lead\s+Opus 5\.5[\s\S]*Worker\s+GPT-6 Luna[\s\S]*Tester\s+GPT-6 Luna[\s\S]*Expert\s+none/, "the team as a chain");
  assert.match(text, /▰+▱* 42% 5h/, "Claude's usage window as a bar");
  assert.match(text, /Opus 5\.5 · 5h resets/, "with when it resets");
  assert.match(text, /usage not reported/, "Codex does not report it: unknown, not zero");
  assert.match(text, /─ context\.md ─/);
  assert.match(text, /■ context\.md\s+1\.0k/);
  for (const id of ["node:orchestrator", "node:worker", "ctx:compact"]) assert.ok(ids.includes(id), id);
  assert.match(text, /─ Cost · API estimate ─/);
  assert.match(text, /≈\$0\.12/);
});

test("the sidebar: projects with their sessions, a dotted line, recents; long lists fade at the edge", () => {
  setColorDepth("true");
  const m = newModel("p", "app");
  const now = new Date().toISOString();
  m.projects = [{ name: "hayate", path: "/x/hayate", sessions: [{ id: "s1", title: "make an app", status: "applied", at: now, repo: "/x/hayate", dir: "/d/s1" }] }];
  m.recents = Array.from({ length: 50 }, (_, i) => ({ id: `r${i}`, title: `recent ${i}`, status: "finished", at: now, repo: "/y", dir: `/d/r${i}` }));
  const { f, text, ids } = screen(m);
  assert.match(text, /Projects ─+ ▾ {2}\+/);
  assert.match(text, /▾ hayate/);
  assert.match(text, /✓ make an app/);
  assert.match(text, /├─ Recents ─+ ▾ {2}\+ ─┤/);
  for (const id of ["side:fold:projects", "side:new:projects", "side:project:/x/hayate", "side:session:/d/s1", "side:list:recents"]) assert.ok(ids.includes(id), id);
  // The last visible recent row is faded: its text is closer to the background than a row above it.
  const rowsOf = f.canvas.toText();
  const lastRow = rowsOf.findLastIndex((r) => /recent \d+/.test(r.slice(0, 30)));
  const fg = (y: number): number => f.canvas.fg[y * f.canvas.w + 4]!;
  assert.notEqual(fg(lastRow), fg(lastRow - 5));
  // Hover shows a row's own buttons.
  m.hover = "side:session:/d/s1";
  assert.ok(screen(m).ids.includes("side:delete:/d/s1"));
  m.folded.add("projects");
  assert.doesNotMatch(screen(m).text, /hayate/, "a folded section shows only its header");
});

test("a finished run: the final report as markdown, read from its first line, then changes and buttons", () => {
  setColorDepth("true");
  const m = teamRun();
  for (let i = 0; i < 30; i++) applyEvent(m, ev("note", { message: `note ${i}` }));
  const state = { id: "r1", status: "finished", preset: "p", outcome: { files: [{ path: "a.js", insertions: 1, deletions: 1 }], insertions: 1, deletions: 1, checks: "passed" } } as unknown as RunState;
  finished(m, state);
  const long = Array.from({ length: 40 }, (_, i) => `- point ${i}`).join("\n");
  m.log.push({ kind: "final", text: `## What I did\n\nWrote **a.js**.\n\n- one\n- two\n\n\`\`\`sh\nnpm test\n\`\`\`\n\n${long}`, role: "worker", model: "gpt-6-luna", at: 0 });
  m.log.push({ kind: "diff", text: "Changes: 1 file (+1 −1)", lines: ["diff --git a/a.js b/a.js", "@@ -1 +1 @@", "-old", "+new"], at: 0 });
  m.log.push({ kind: "result", at: 0 });
  m.readFrom = "final";
  const { text, ids } = screen(m);
  const rows = text.split("\n");
  const at = rows.findIndex((r) => r.includes("Final report"));
  assert.ok(at > 0 && at < 12, `the report's first line is at the top of the stream (row ${at})`);
  assert.equal(m.readFrom, undefined, "only once");
  assert.match(text, /What I did/);
  assert.doesNotMatch(text, /## What I did|\*\*a\.js\*\*|```/, "no markdown syntax shows");
  assert.match(text, /• one/);
  m.scroll = 0;
  const bottom = screen(m);
  assert.match(bottom.text, /Finished · the project's checks pass/);
  for (const id of ["act:apply", "act:diff", "act:discard", "rate:3"]) assert.ok(bottom.ids.includes(id), id);
});

test("a reopened session that was applied or discarded shows every step done, not failed", () => {
  for (const status of ["applied", "discarded"]) {
    const m = teamRun();
    finished(m, { id: "r1", status, preset: "p", outcome: { files: [], insertions: 0, deletions: 0, checks: "passed" } } as unknown as RunState);
    assert.equal(m.stage, "finished", status);
    assert.ok(pipeline(m).every((s) => s.state === "done" || s.state === "skipped"), status);
  }
});

test("the pipeline is buttons, built from what happened", () => {
  setColorDepth("true");
  const m = teamRun();
  applyEvent(m, ev("agent.started", { role: "worker", task: "t1", kind: "initial", model: "gpt-6-luna" }));
  assert.deepEqual(pipeline(m).map((s) => s.state), ["done", "active", "todo", "todo"]);
  const { text, ids } = screen(m);
  assert.match(text, /✓ Plan\s+─+▶\s+\S Build\s+╌+\s+○ Check/);
  for (const id of ["step:planning", "step:building", "step:checking", "step:reviewing"]) assert.ok(ids.includes(id), id);
});
