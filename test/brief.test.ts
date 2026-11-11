import assert from "node:assert/strict";
import { test } from "node:test";
import { buildBrief, cleanRequest, renderBrief } from "../src/intake/brief.ts";
import type { BriefPolicy, RepoFacts } from "../src/intake/brief.ts";

function facts(files: Record<string, string> = {}, runtimes = ["node 26.1.0", "python3 3.13.0"]): RepoFacts {
  return { files: Object.keys(files), runtimes, read: (p) => files[p] };
}

const TEAM: BriefPolicy = { team: true, maxParallel: 2, canSpec: true };
const EMPTY = facts({ ".gitignore": "node_modules\n" });
const PROJECT = facts({ "src/app.js": "export const x = 1;\n", "test/app.test.js": "", "README.md": "# App\n", "package.json": "{}" });

test("cleaning removes greetings and filler and keeps the instruction", () => {
  assert.equal(cleanRequest("hey can you please create a monkeytype like typing app in terminal tui lol"), "Create a monkeytype like typing app in terminal tui.");
  assert.equal(cleanRequest("  I want you to add a --json flag!!!   thanks "), "Add a --json flag.");
  assert.equal(cleanRequest("Fix the crash in parse().\r\n\r\n\r\n\r\nIt happens on empty input.  "), "Fix the crash in parse().\n\nIt happens on empty input.");
  assert.equal(cleanRequest("src/app.js has a bug, fix it"), "src/app.js has a bug, fix it.");
  assert.equal(cleanRequest("thanks"), "thanks", "never cleans a request down to nothing");
});

test("a one-line request for a new terminal app gets standards, a spec, the top rung and a tester", () => {
  const brief = buildBrief("create a monkeytype like typing app in terminal tui", EMPTY, TEAM);
  assert.equal(brief.kind, "greenfield");
  assert.equal(brief.surface, "tui");
  assert.deepEqual(
    { plan: brief.staffing.plan, agents: brief.staffing.agents, rung: brief.staffing.rung, tester: brief.staffing.tester, spec: brief.staffing.spec },
    { plan: false, agents: 1, rung: "top", tester: true, spec: true },
  );
  const text = renderBrief(brief);
  assert.match(text, /^Create a monkeytype like typing app in terminal tui\./);
  assert.match(text, /Node\.js \(26\.1\.0 is installed\)/, "names a language when the request does not");
  assert.match(text, /Restore the terminal on every way out/);
  assert.match(text, /every printable key is text/);

  assert.match(text, /README\.md/);
  assert.match(text, /the request wins wherever it says otherwise/);

  const withPython = buildBrief("create a typing app in terminal tui using Python curses", EMPTY, TEAM);
  assert.doesNotMatch(renderBrief(withPython), /Node\.js \(/, "a named language is respected");
  assert.equal(buildBrief("create a typing app in terminal tui", EMPTY, { ...TEAM, canSpec: false }).staffing.spec, false);
});

test("a document the request points at is attached, and a detailed request needs no spec", () => {
  const plan = "# Typing test\n\n1. Word list\n2. Timer\n3. Results screen\n";
  const repo = facts({ "PLAN.md": plan, "README.md": "# Demo\n" });
  const brief = buildBrief("Build the app described in PLAN.md, following its steps in order.", repo, TEAM);
  assert.deepEqual(brief.attached.map((a) => a.path), ["PLAN.md"]);
  assert.equal(brief.staffing.spec, false);
  assert.equal(brief.staffing.plan, false, "three steps are one worker's job");
  assert.match(renderBrief(brief), /--- PLAN\.md ---\n# Typing test/);

  const typos = buildBrief("Fix the spelling mistakes in README.md. Do not change anything else.", PROJECT, TEAM);
  assert.equal(typos.kind, "trivial");
  assert.deepEqual(typos.attached, [], "a README to edit is not instructions");
  assert.equal(typos.staffing.tester, false);
  assert.equal(typos.staffing.rung, "first");
});

test("requests on an existing project are read as bug, refactor or feature", () => {
  const kind = (prompt: string): string => buildBrief(prompt, PROJECT, TEAM).kind;
  assert.equal(kind("The cart total is wrong when a coupon applies. Fix the bug in src/cart.js."), "bug");
  assert.equal(kind("Rename the function getUsr to getUser everywhere and extract the validation into its own module."), "refactor");
  assert.equal(kind("Add a --json flag. Results are sorted, ties broken by name. An unknown flag fails with an error."), "feature");
  assert.equal(kind("Change the server's default port from 3000 to 8080, including where the README mentions it."), "trivial");
  const bug = buildBrief("Fix the bug in src/cart.js.", PROJECT, TEAM);
  assert.match(renderBrief(bug), /fails without the fix/);
  assert.equal(bug.staffing.rung, "first");
  assert.equal(bug.staffing.tester, true);
});

test("only clearly large requests are planned, and never on a solo preset", () => {
  const parts = Array.from({ length: 20 }, (_, i) => `${i + 1}. Build part ${i + 1} in src/part${i + 1}.js`).join("\n");
  const large = buildBrief(`Add these parts:\n${parts}`, PROJECT, TEAM);
  assert.equal(large.staffing.plan, true);
  assert.equal(large.staffing.agents, 2);
  assert.equal(buildBrief(`Add these parts:\n${parts}`, PROJECT, { ...TEAM, team: false }).staffing.plan, false);
  const five = buildBrief("Add these:\n1. a\n2. b\n3. c\n4. d\n5. e", PROJECT, TEAM);
  assert.equal(five.staffing.plan, false, "five small parts are cheaper done by one worker than planned");
});
