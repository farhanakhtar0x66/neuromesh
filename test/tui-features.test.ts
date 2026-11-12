import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { COMMANDS, SLASH } from "../src/tui/commands.ts";
import { Composer } from "../src/tui/composer.ts";
import { diffRows } from "../src/tui/diff.ts";
import { History, bestMatches, fuzzy } from "../src/tui/files.ts";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { gist } from "../src/tui/blocks.ts";
import { renderMarkdown } from "../src/tui/markdown.ts";
import { applyEvent, newModel, prettyModel, submitted } from "../src/tui/model.ts";
import { DEFAULT_SETTINGS, allSessions, loadProjects, loadSettings, saveProjects, saveSettings, trashSession } from "../src/tui/store.ts";
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

test("markdown is drawn, not shown: headings, emphasis, lists, code, tables and quotes", () => {
  const rows = renderMarkdown(
    ["# Title", "", "Some **bold**, *italic* and `code`, and a [link](https://x.y).", "", "- one", "  - nested", "1. first", "- [x] done", "", "```ts", "const a = 1;", "```", "", "| A | B |", "| --- | --- |", "| 1 | 2 |", "", "> quoted", "", "---"].join("\n"),
    40,
  );
  const plain = rows.map((r) => r.spans.map((s) => s.text).join(""));
  const all = plain.join("\n");
  assert.doesNotMatch(all, /\*\*|`|^#|\[link\]|\(https/m, "no markup left");
  assert.equal(plain[0], "Title");
  assert.ok(rows[0]!.spans[0]!.bold, "a heading is bold");
  const para = rows.find((r) => r.spans.some((s) => s.text === "bold"))!;
  assert.ok(para.spans.find((s) => s.text === "bold")!.bold);
  assert.ok(para.spans.find((s) => s.text === "italic")!.italic);
  assert.ok(para.spans.find((s) => s.text === "code")!.code);
  assert.ok(para.spans.find((s) => s.text === "link")!.underline);
  assert.ok(plain.includes("• one") && plain.includes("  ◦ nested") && plain.includes("1. first") && plain.includes("• ☑ done"));
  assert.ok(rows.some((r) => r.block && r.spans[0]!.text === "const a = 1;"), "code keeps its own lines");
  assert.ok(plain.some((l) => /^A\s+│ B/.test(l)) && plain.some((l) => /^─+┼─+$/.test(l)), "tables line up");
  assert.ok(plain.includes("▎ quoted"));
  for (const l of plain) assert.ok(width(l) <= 40, `wider than the box: ${l}`);
  // A long paragraph wraps on words, with list items hanging under their text.
  const wrapped = renderMarkdown("- a list item that is long enough to wrap onto a second line here", 24).map((r) => r.spans.map((s) => s.text).join(""));
  assert.ok(wrapped.length > 1);
  assert.ok(wrapped[1]!.startsWith("  ") && !wrapped[1]!.startsWith("  •"), "the second line hangs under the text");
});

test("names and gists: model ids as people say them, and a report's first real sentence", () => {
  assert.equal(prettyModel("claude-opus-5-5"), "Opus 5.5");
  assert.equal(prettyModel("gpt-6-luna"), "GPT-6 Luna");
  assert.equal(prettyModel("gpt-6.1-sol"), "GPT-6.1 Sol");
  assert.equal(prettyModel("claude/claude-fable-5-2"), "Fable 5.2");
  assert.equal(gist("## What I did\n\n- Built the **list**\nmore"), "Built the **list**");
});

test("settings and projects are kept between sessions; a deleted session goes to the trash", () => {
  const home = mkdtempSync(join(tmpdir(), "nm-store-"));
  assert.deepEqual(loadSettings(home), DEFAULT_SETTINGS);
  saveSettings(home, { ...DEFAULT_SETTINGS, transparent: true, fps: 120, access: "turbo" });
  assert.equal(loadSettings(home).fps, 120);
  writeFileSync(join(home, "tui", "settings.json"), JSON.stringify({ fps: 33, verbose: "loud" }));
  assert.equal(loadSettings(home).fps, 60, "only known values are used");
  assert.equal(loadSettings(home).verbose, "medium");
  saveProjects(home, { projects: [{ name: "hayate", path: "/x/hayate" }], folded: ["recents"] });
  assert.deepEqual(loadProjects(home).projects, [{ name: "hayate", path: "/x/hayate" }]);
  // A session record, in a real repository.
  const repo = mkdtempSync(join(tmpdir(), "nm-repo-"));
  execFileSync("git", ["init", "-q"], { cwd: repo });
  const dir = join(home, "projects", "app-1234", "runs", "r1");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "run.json"), JSON.stringify({ id: "r1", repo, dir, prompt: "do it", status: "finished", updatedAt: "2026-11-12T10:00:00Z", preset: "p", tasks: [] }));
  const [s] = allSessions(home);
  assert.equal(s?.title, "do it");
  const where = trashSession(home, s!);
  assert.ok(existsSync(join(where, "run.json")) && !existsSync(dir));
  assert.equal(allSessions(home).length, 0);
});

test("popups draw within the screen: the dropdown, the picker, settings and a form", () => {
  setColorDepth("256");
  const m = newModel("p", "app");
  m.suggest = { kind: "slash", start: 0, index: 1, items: SLASH.slice(0, 4).map((c) => ({ id: c.slash!, label: c.slash!, detail: c.label })) };
  const c = new Composer();
  c.insert("/");
  for (const [cols, rows] of [[120, 35], [70, 20]] as const) fits(render(m, c, cols, rows).lines, cols, rows);
  assert.match(stripAnsi(render(m, c, 120, 35).lines.join("\n")), new RegExp(`${SLASH[1]!.slash}\\s+${SLASH[1]!.label.slice(0, 10)}`));
  m.suggest = undefined;
  m.picker = { kind: "presets", title: "Team presets", query: "luna", all: [{ id: "a", label: "factory-luna", detail: "cheap" }, { id: "b", label: "solo-opus", detail: "one model" }], index: 0 };
  assert.deepEqual(pickerChoices(m).map((x) => x.id), ["a"]);
  fits(render(m, c, 100, 30).lines, 100, 30);
  m.picker = undefined;
  m.settings = { transparent: "false", theme: "terminal", fps: "120" };
  m.dialog = { kind: "settings", index: 0, at: 0 };
  const settings = render(m, c, 120, 35);
  assert.match(stripAnsi(settings.lines.join("\n")), /Frame rate\s+◂ 120 Hz while something moves ▸/);
  assert.ok(settings.regions.some((r) => r.id === "set:transparent"));
  m.dialog = { kind: "form", title: "New project", fields: [{ label: "Name", value: "app" }, { label: "Folder", value: "", browse: "folder" }], focus: 1, submit: "Create", action: "new-project", at: 0 };
  const form = render(m, c, 120, 35);
  assert.ok(form.regions.some((r) => r.id === "dlg:browse:1") && form.regions.some((r) => r.id === "dlg:yes"));
  assert.ok(form.cursor, "the cursor is in the focused field");
});

test("while a run works: an animated verb for the stage and the time", () => {
  setColorDepth("256");
  const m = newModel("factory-opus-luna", "app");
  submitted(m, "build it");
  applyEvent(m, ev("agent.started", { role: "worker", task: "main", kind: "initial", model: "gpt-6-luna", tier: "worker" }));
  const text = stripAnsi(render(m, new Composer(), 120, 30).lines.join("\n"));
  const verb = verbFor("building", 0);
  assert.ok(VERBS.building!.includes(verb));
  assert.match(text, new RegExp(`${verb}…\\s+\\d+s`));
  assert.match(text, /esc\s+stop/, "how to stop is on the bottom bar");
  assert.notEqual(verbFor("building", 0), verbFor("building", 5_000), "the verb changes every few seconds");
});
