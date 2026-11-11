import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { COMMANDS, SLASH } from "../src/tui/commands.ts";
import { Composer } from "../src/tui/composer.ts";
import { diffRows } from "../src/tui/diff.ts";
import { History, bestMatches, fuzzy } from "../src/tui/files.ts";
import { applyEvent, newModel, submitted } from "../src/tui/model.ts";
import { stripAnsi, width } from "../src/tui/text.ts";
import { setColorDepth } from "../src/tui/theme.ts";
import { pickerChoices, render, verbFor, VERBS } from "../src/tui/view.ts";

const ev = (type: string, data: Record<string, unknown> = {}) => ({ t: "2026-11-12T10:00:00.000Z", run: "r1", type, ...data });

function fits(lines: string[], cols: number, rows: number): void {
  assert.equal(lines.length, rows);
  for (const l of lines) assert.ok(width(stripAnsi(l)) <= cols, `wider than ${cols}: ${stripAnsi(l)}`);
}

test("fuzzy matching prefers file names, word starts and runs of letters", () => {
  assert.equal(fuzzy("xyz", "src/app.ts"), undefined);
  const files = ["docs/02-v0.1-plan.md", "src/engine/run.ts", "src/tui/app.ts", "test/tui.test.ts", "src/tui/view.ts"];
  assert.deepEqual(bestMatches("app", files, (f) => f, 2), ["src/tui/app.ts"]);
  assert.equal(bestMatches("tuiview", files, (f) => f, 1)[0], "src/tui/view.ts");
  assert.equal(bestMatches("run", files, (f) => f, 1)[0], "src/engine/run.ts");
});

test("history steps back through earlier requests, keeps the draft, and persists", () => {
  const home = mkdtempSync(join(tmpdir(), "nm-hist-"));
  const h = new History(home);
  h.add("first request");
  h.add("second request");
  h.add("first request");
  assert.equal(h.previous("my draft"), "first request", "a repeated request moves to the end");
  assert.equal(h.previous(""), "second request");
  assert.equal(h.previous(""), undefined, "no further back");
  assert.equal(h.next(), "first request");
  assert.equal(h.next(), "my draft", "past the newest, the draft comes back");
  assert.equal(h.browsing, false);
  assert.equal(new History(home).previous(""), "first request", "kept between sessions");
});

test("the composer knows the word at the cursor and can replace it", () => {
  const c = new Composer();
  c.insert("fix the bug in @src/ap");
  assert.deepEqual(c.wordAtCursor(), { start: 15, text: "@src/ap" });
  c.replaceBeforeCursor(15, "src/app.ts ");
  assert.equal(c.text, "fix the bug in src/app.ts ");
  assert.equal(c.onFirstLine, true);
});

test("every slash command is unique and runs an action", () => {
  const names = SLASH.map((c) => c.slash);
  assert.equal(new Set(names).size, names.length);
  for (const c of SLASH) assert.ok(c.action, `${c.slash} has an action`);
  assert.ok(COMMANDS.some((c) => c.slash === "/sessions") && COMMANDS.some((c) => c.slash === "/preset"));
});

test("a diff gets per-file headers and old and new line numbers", () => {
  const rows = diffRows(["diff --git a/x.js b/x.js", "index 1..2 100644", "--- a/x.js", "+++ b/x.js", "@@ -10,3 +10,3 @@ function f() {", " keep", "-old", "+new", " end"]);
  assert.deepEqual(
    rows.map((r) => [r.kind, r.old, r.new, r.text]),
    [
      ["file", undefined, undefined, "x.js"],
      ["hunk", undefined, undefined, "function f() {"],
      ["ctx", 10, 10, "keep"],
      ["del", 11, undefined, "old"],
      ["add", undefined, 11, "new"],
      ["ctx", 12, 12, "end"],
    ],
  );
});

test("while a run works: an animated verb for the stage, time, how to stop, and one line per active agent", () => {
  setColorDepth("256");
  const m = newModel("factory-opus-luna", "app");
  submitted(m, "build it");
  applyEvent(m, ev("agent.started", { role: "worker", task: "main", kind: "initial", model: "gpt-6-luna", tier: "worker" }));
  applyEvent(m, ev("agent.activity", { role: "worker", task: "main", activity: "command", summary: "npm test" }));
  const text = stripAnsi(render(m, new Composer(), 120, 30).lines.join("\n"));
  const verb = verbFor("building", 0);
  assert.ok(VERBS.building!.includes(verb));
  assert.match(text, new RegExp(`${verb}…  \\d+s`));
  assert.match(text, /esc esc +stop/, "how to stop is on the frame");
  assert.match(text, /⎿ Worker · gpt-6-luna · npm test/);
  assert.doesNotMatch(text, /Worker: npm test/, "agent steps are hidden until ctrl+o");
  m.details = true;
  assert.match(stripAnsi(render(m, new Composer(), 120, 30).lines.join("\n")), /⎿ Worker: npm test/);
  assert.notEqual(verbFor("building", 0), verbFor("building", 5_000), "the verb changes every few seconds");
});

test("the slash dropdown and the list picker draw within the screen", () => {
  setColorDepth("256");
  const m = newModel("p", "app");
  m.suggest = { kind: "slash", start: 0, index: 1, items: SLASH.slice(0, 4).map((c) => ({ id: c.slash!, label: c.slash!, detail: c.label })) };
  const c = new Composer();
  c.insert("/");
  for (const [cols, rows] of [[120, 35], [60, 18]] as const) fits(render(m, c, cols, rows).lines, cols, rows);
  assert.match(stripAnsi(render(m, c, 120, 35).lines.join("\n")), /› \/resume +Resume a stopped or paused run/);

  m.suggest = undefined;
  m.picker = { kind: "presets", title: "Team presets", query: "luna", index: 0, all: [{ id: "factory-luna", label: "factory-luna", detail: "Sol lead" }, { id: "solo-opus", label: "solo-opus", detail: "one Opus" }] };
  assert.deepEqual(pickerChoices(m).map((x) => x.id), ["factory-luna"], "typing filters the list");
  const frame = render(m, new Composer(), 100, 30);
  fits(frame.lines, 100, 30);
  assert.match(stripAnsi(frame.lines.join("\n")), /Team presets[\s\S]*› luna[\s\S]*› factory-luna/);
});
