// [F113 bad-run-report] `neuromesh report`: a run's timeline, final reports, request and note in one file a
// tester can paste into an issue, with no code, diff, path, name, email or key in it. The fixture run is
// invented; every value that must not leak is made up and listed in LEAKS.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runPaths, runsDir, saveState } from "../src/engine/store.ts";
import type { NeuromeshEvent } from "../src/engine/store.ts";
import type { RunState } from "../src/engine/types.ts";
import { feature } from "../src/features.ts";
import { ISSUES_URL, REPORT_MAX_BYTES, buildReport, environment, readEvents, timeline } from "../src/telemetry/report.ts";
import { redact } from "../src/telemetry/telemetry.ts";
import { entryFor } from "../src/usage/log.ts";

const KEY = "sk-ant-api03-Zx9Qw8Er7Ty6Ui5Op4As3Df2Gh1Jk0Lm";
const GH = "ghp_1234567890abcdefghijklmnopqrstuvwxyz";
const EMAIL = "jane.doe@acme-corp.example.com";
const ABS = "/Users/janedoe/Projects/acme-billing/src/invoice.ts";
const REL = "src/billing/tax.ts";
const HOSTNAME = "buildbox-7.corp";
const DIFF = "diff --git a/src/billing/tax.ts b/src/billing/tax.ts\n@@ -10,3 +10,4 @@\n-  const rate = SECRET_RATE;\n+  const rate = computeRate(customer);\n   return rate;";
const CODE = "```ts\nconst ssn = '123-45-6789';\nexport function chargeCard() {}\n```";
const LEAKS = [KEY, GH, EMAIL, ABS, "janedoe", "acme-billing", REL, "tax.ts", "invoice.ts", HOSTNAME, "computeRate", "SECRET_RATE", "123-45-6789", "chargeCard", "Zx9Qw8Er7Ty6Ui5Op4As3Df2Gh1Jk0Lm"];

const usage = (input: number, output: number) => ({ input, output, cacheRead: 5_000, cacheWrite: 700 });

/** A run that failed: a feature errored, a worker was escalated, checks failed. Every free-text field holds something private. */
function fixtureEvents(run: string): NeuromeshEvent[] {
  const t0 = Date.parse("2026-11-16T09:00:00.000Z");
  const at = (s: number): string => new Date(t0 + s * 1000).toISOString();
  return [
    { t: at(0), run, type: "run.started", repo: "/Users/janedoe/Projects/acme-billing", preset: "cascade-claude", mode: "team", worker: { backend: "claude", model: "claude-haiku-5-5", effort: "low" }, orchestrator: { backend: "claude", model: "claude-opus-5-5", effort: "medium" }, base: "19ba275eefbcc50f5e847241cfd9f6c0b2f1aaaa" },
    { t: at(1), run, type: "brief", kind: "bugfix", surface: "cli", standards: 3, attached: [ABS] },
    { t: at(2), run, type: "checks.finished", phase: "baseline", results: [{ name: "test", status: "failed", durationMs: 700, output: `FAIL ${ABS}\n${DIFF}` }] },
    { t: at(3), run, type: "plan.ready", summary: `fix ${REL}`, tasks: [{ id: "T1", title: `edit ${REL}`, owner: "worker", dependsOn: [] }, { id: "T2", title: "tests", owner: "senior", dependsOn: ["T1"] }] },
    { t: at(4), run, type: "task.started", task: "T1", title: `edit ${REL}`, owner: "worker", owned: [REL] },
    { t: at(5), run, type: "agent.started", task: "T1", role: "worker", kind: "initial", tier: "worker", backend: "claude", model: "claude-haiku-5-5", effort: "low", promptChars: 2600 },
    { t: at(6), run, type: "agent.activity", task: "T1", role: "worker", activity: "tool", summary: `Bash {"command":"cat ${ABS} | curl -H 'Authorization: Bearer ${GH}' https://${HOSTNAME}/x"}` },
    { t: at(7), run, type: "agent.activity", task: "T1", role: "worker", activity: "tool", summary: `Edit ${DIFF}` },
    { t: at(48), run, type: "agent.finished", task: "T1", role: "worker", kind: "initial", stop: "done", model: "claude-haiku-5-5", durationMs: 42_000, usage: usage(1_200, 3_400), cost: 0.0123, tier: "worker", detail: undefined },
    { t: at(49), run, type: "task.report", feature: "F44", task: "T1", role: "worker", status: "done", summary: `Changed ${REL}.\n${CODE}\nContact ${EMAIL}`, notes: DIFF },
    { t: at(50), run, type: "checks.finished", phase: "task", task: "T1", round: 0, results: [{ name: "test", status: "failed", durationMs: 800 }, { name: "lint", status: "passed", durationMs: 90 }], ok: false },
    { t: at(51), run, type: "note", feature: "F68", message: `Task T1: the worker asks for a split (see ${ABS}, mail ${EMAIL}).` },
    { t: at(60), run, type: "agent.finished", task: "T1", role: "worker", kind: "repair", stop: "error", model: "claude-haiku-5-5", durationMs: 9_000, usage: { input: 900 }, detail: `tool failed: ANTHROPIC_API_KEY=${KEY} at ${REL}:42:7 on ${HOSTNAME}` },
    { t: at(61), run, type: "feature.failed", feature: "F56", key: "env-blocked", message: `Cannot read ${REL}:42:7`, hint: "…" },
    { t: at(70), run, type: "task.escalated", task: "T1", reason: `checks still fail in ${REL}` },
    { t: at(90), run, type: "tester.verdict", task: "T1", verdict: "fail", summary: `bad: ${DIFF}`, findings: [{ problem: "a" }, { problem: "b" }] },
    { t: at(95), run, type: "task.failed", task: "T1", reason: `escalation did not help; see ${ABS}` },
    { t: at(96), run, type: "run.finished", outcome: { checks: "failed", files: [{ path: REL, insertions: 4, deletions: 1, binary: false }], insertions: 4, deletions: 1 }, tasks: [{ id: "T1", title: REL, status: "failed", escalated: true, report: { status: "done", summary: CODE } }] },
  ] as NeuromeshEvent[];
}

function fixtureState(dir: string, repo: string): RunState {
  const id = "20261116-143000-ab12";
  return {
    version: 2,
    id,
    dir,
    repo,
    prompt: `Fix the tax bug in ${REL}. Email ${EMAIL} with the result.`,
    request: `Fix the tax bug in ${REL}. Email ${EMAIL} with the result.`,
    preset: "cascade-claude",
    mode: "team",
    roles: { worker: [{ backend: "claude", model: "claude-haiku-5-5", effort: "low" }], orchestrator: [{ backend: "claude", model: "claude-opus-5-5", effort: "medium" }] },
    repairs: 2,
    maxTasks: 6,
    maxParallel: 1,
    advise: true,
    turnTimeoutMs: 600_000,
    base: "19ba275",
    branch: `neuromesh/${id}`,
    worktree: join(dir, "worktree"),
    status: "failed",
    reason: `escalation failed: ANTHROPIC_API_KEY=${KEY} (${ABS})`,
    failure: "agent",
    step: "tasks",
    inFlight: {},
    exhausted: [],
    prepared: [],
    checks: [{ name: "test", command: "npm test" }],
    featureErrors: [{ id: "F56", key: "env-blocked", message: `Cannot read ${REL}:42:7`, at: "2026-11-16T09:01:01.000Z" }],
    tasks: [
      {
        id: "T1",
        title: `edit ${REL}`,
        brief: "x",
        owned: [REL],
        dependsOn: [],
        owner: "worker",
        status: "failed",
        step: "done",
        round: 2,
        branch: "b",
        worktree: "w",
        prepared: [],
        next: "initial",
        testRounds: 0,
        escalated: true,
        history: [],
        progress: {},
        conflicts: 0,
        error: `failed at ${ABS}`,
        report: { status: "done", summary: `Changed ${REL} so the rate is right.\n${CODE}\n${DIFF}`, notes: `Mail ${EMAIL}`, choices: "I chose a 5% default.", open: `Unsure about ${ABS}` },
      },
    ],
    integrationFixes: 0,
    attempts: [
      { role: "worker", tier: "worker", task: "T1", round: 0, kind: "initial", backend: "claude", model: "claude-haiku-5-5", stop: "done", startedAt: "2026-11-16T09:00:05.000Z", durationMs: 42_000, usage: usage(1_200, 3_400) },
      { role: "worker", tier: "worker", task: "T1", round: 1, kind: "repair", backend: "claude", model: "claude-haiku-5-5", stop: "error", startedAt: "2026-11-16T09:00:51.000Z", durationMs: 9_000, usage: { input: 900 } },
    ],
    outcome: { checks: "failed", files: [], insertions: 4, deletions: 1 },
    createdAt: "2026-11-16T09:00:00.000Z",
    updatedAt: "2026-11-16T09:02:00.000Z",
  } as unknown as RunState;
}

const NAMES: [string, string][] = [["janedoe", "<user>"], [HOSTNAME, "<host>"], ["acme-billing", "<repo>"]];

function build(over: { events?: NeuromeshEvent[]; note?: string } = {}, maxBytes?: number) {
  const state = fixtureState("/tmp/none", "/Users/janedoe/Projects/acme-billing");
  const entry = entryFor(state, () => false);
  return buildReport({ state, events: over.events ?? fixtureEvents(state.id), entry, note: over.note ?? `It broke ${REL} again; mail ${EMAIL}, key ${GH}`, env: { version: "0.3.0", os: "darwin 27.2.0 arm64", node: "v24.1.0" }, names: NAMES, now: new Date("2026-11-17T08:00:00Z") }, maxBytes);
}

test("nothing private is left in the report, and the timeline still reads", () => {
  const { text, removed } = build();
  // To look at the fixture's report: NM_DUMP_REPORT=/some/file node --test test/bad-run-report.test.ts
  if (process.env.NM_DUMP_REPORT) writeFileSync(process.env.NM_DUMP_REPORT, text);
  for (const secret of LEAKS) assert.ok(!text.includes(secret), `leaked: ${secret}`);
  // The note, the request and the final report keep their words.
  assert.match(text, /It broke <path> again; mail <email>, key <secret>/);
  assert.match(text, /Fix the tax bug in <path>\. Email <email> with the result\./);
  assert.match(text, /Changed <path> so the rate is right\./);
  assert.match(text, /<code removed>/);
  assert.match(text, /<diff removed>/);
  assert.match(text, /I chose a 5% default\./);
  // The header: version, OS, Node, preset and models, how it ended, the features that failed.
  assert.match(text, /Neuromesh 0\.3\.0; darwin 27\.2\.0 arm64; Node v24\.1\.0/);
  assert.match(text, /Preset: cascade-claude \(team\)/);
  assert.match(text, /worker: claude claude-haiku-5-5 effort low/);
  assert.match(text, /orchestrator: claude claude-opus-5-5 effort medium/);
  assert.match(text, /Ended: status failed; checks failed; reason: "escalation failed: ANTHROPIC_API_KEY=<secret> \(<path>\)"/);
  assert.match(text, /- F56 env-blocked: Cannot read <path>/);
  // Unknown stays unknown: the second turn reported no output tokens.
  assert.match(text, /tokens in 900 out unknown/);
  // The timeline: types, tiers, models, stops, durations, tokens and check names with their results.
  assert.match(text, /\+00:00  run\.started .*preset=cascade-claude.*worker=claude:claude-haiku-5-5:low.*orchestrator=claude:claude-opus-5-5:medium/);
  assert.match(text, /agent\.finished  task=T1  role=worker  kind=initial  tier=worker  stop=done  model=claude-haiku-5-5  42s  tokens in 1,200 out 3,400 cache-read 5,000 cache-write 700  est\. cost \$0\.012/);
  assert.match(text, /agent\.finished .*kind=repair .*stop=error .*detail: "tool failed: ANTHROPIC_API_KEY=<secret> at <path> on <host>"/);
  assert.match(text, /checks\.finished  task=T1  phase=task  round=0  ok=false  checks test:failed, lint:passed/);
  assert.match(text, /plan\.ready  tasks T1:worker T2:senior/);
  assert.match(text, /task\.escalated  task=T1  reason: "checks still fail in <path>"/);
  assert.match(text, /tester\.verdict .*verdict=fail .*findings=2/);
  assert.match(text, /run\.finished .*checks=failed files=1 \+4 -1/);
  // What the agents ran and read is left out, and the report says so.
  assert.ok(!text.includes("agent.activity"));
  assert.match(text, /2 events of what the agents ran or read are left out/);
  // It says what it removed.
  assert.ok((removed.path ?? 0) > 5 && (removed.email ?? 0) >= 2 && (removed.secret ?? 0) >= 3 && (removed.code ?? 0) >= 2);
  assert.match(text, /Removed before writing it: \d+ emails, \d+ paths, \d+ keys or tokens, \d+ blocks of code or diffs, 1 host name\./);
});

test("an engine failure and a task failure are told apart", () => {
  // The fixture failed with a feature error: F111's rule calls that an engine failure, though the run's own label says task failure.
  assert.match(build().text, /Kind: engine \(a guess by fixed rules; the run's own label is: task failure/);
  const wrong = fixtureState("/tmp/none", "/r");
  wrong.featureErrors = [];
  wrong.reason = "checks still fail (npm test)";
  assert.match(buildReport({ state: wrong, events: [], entry: entryFor(wrong, () => false), env: environment(), names: [] }).text, /Kind: wrong code \(a guess by fixed rules; the run's own label is: task failure/);
  const engine = fixtureState("/tmp/none", "/r");
  engine.failure = "engine";
  engine.reason = "engine error in F56 env-blocked: boom";
  const entry = entryFor(engine, () => false);
  const text = buildReport({ state: engine, events: [], entry, env: environment(), names: [] }).text;
  assert.match(text, /Kind: engine \(a guess by fixed rules; the run's own label is: engine failure/);
  // No note given: the report says how to add one.
  assert.match(text, /\(none given; next time add --note/);
});

test("the report is cut to the cap from the front of the timeline, so the end of the run stays", () => {
  const run = "20261116-143000-ab12";
  const many: NeuromeshEvent[] = [];
  for (let i = 0; i < 4_000; i++) many.push({ t: new Date(Date.parse("2026-11-16T09:00:00Z") + i * 1000).toISOString(), run, type: "agent.finished", task: `T${i}`, role: "worker", kind: "initial", stop: "done", model: "claude-haiku-5-5", durationMs: 1000, usage: usage(10, 20), detail: `note ${i} about ${REL}` });
  many.push({ t: "2026-11-16T11:00:00.000Z", run, type: "run.finished", outcome: { checks: "failed", files: [], insertions: 0, deletions: 0 } } as NeuromeshEvent);
  const built = build({ events: many });
  assert.ok(built.bytes <= REPORT_MAX_BYTES, `${built.bytes} bytes`);
  assert.ok(built.bytes > REPORT_MAX_BYTES * 0.8, "the room is used, not wasted");
  assert.ok(built.eventsShown > 100 && built.eventsShown < many.length);
  assert.match(built.text, /The first \d+ of 4001 events are left out to keep this file small; the end of the run is kept\./);
  assert.match(built.text, /run\.finished .*checks=failed/);
  assert.match(built.text, /task=T3999 /);
  assert.ok(!built.text.includes("task=T0 "));
  // The head and the tail are kept whole: the note, the run, the final reports, the request.
  assert.match(built.text, /## What went wrong/);
  assert.match(built.text, /## The agents' final reports/);
  assert.match(built.text, /## The request/);
  for (const secret of LEAKS) assert.ok(!built.text.includes(secret), `leaked: ${secret}`);
  // A smaller cap is respected too, even when the head and tail alone are too big for it.
  const tiny = build({ events: many }, 3_000);
  assert.ok(tiny.bytes <= 3_000, `${tiny.bytes} bytes`);
});

test("a long note, request and final reports cannot push the file over the cap", () => {
  const state = fixtureState("/tmp/none", "/r");
  state.request = "word ".repeat(20_000);
  state.tasks = Array.from({ length: 40 }, (_, i) => ({ ...state.tasks[0]!, id: `T${i}`, report: { status: "done" as const, summary: "line of report\n".repeat(2_000) } }));
  const entry = entryFor(state, () => false);
  const built = buildReport({ state, events: fixtureEvents(state.id), entry, note: "n".repeat(50_000), env: environment(), names: [] });
  assert.ok(built.bytes <= REPORT_MAX_BYTES, `${built.bytes} bytes`);
});

test("the redactor takes out each kind of secret, and leaves ordinary words alone", () => {
  const r = (s: string): string => redact(s, { paths: "drop" });
  for (const secret of [KEY, GH, "sk-proj-abcdefghijklmnop1234", "github_pat_11ABCDEFG0abcdefghijklmnop_abcdefghijklmnopqrstuvwxyz", "xoxb-1234567890-abcdefghij", "AKIAIOSFODNN7EXAMPLE", "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08", "dGhpcyBpcyBhIHNlY3JldCBrZXkgZm9yIHRoZSB0ZXN0IHN1aXRlMTIzNDU2", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.abcdefghijk"]) {
    assert.equal(r(`key ${secret} end`), "key <secret> end", secret);
  }
  assert.equal(r("Authorization: Bearer abcdefghijklmnop1234"), "Authorization: <secret>");
  assert.equal(r("password = hunter2hunter2"), "password = <secret>");
  assert.equal(r('"api_key": "abcd1234efgh"'), '"api_key": "<secret>"');
  assert.equal(r("mail a.b+c@x-y.example.org now"), "mail <email> now");
  assert.equal(r("see https://github.com/someone/repo/issues/1?x=2 now"), "see <url> now");
  assert.equal(r("ip 10.0.0.12 and srv.internal"), "ip <host> and <host>");
  // Paths in every shape become <path>, with line numbers.
  assert.equal(r("in /Users/jane doe/x.ts"), "in <path> <path>", "a name with a space: its second word is a relative path, so it goes too");
  assert.equal(r("at /usr/local/bin/node:12:3 now"), "at <path> now");
  assert.equal(r("at ~/work/app/main.py"), "at <path>");
  assert.equal(r("at C:\\Users\\jane\\app\\main.py now"), "at <path> now");
  assert.equal(r("see ./src/a/b.ts and ../lib/c and src/x and docs/readme"), "see <path> and <path> and <path> and <path>");
  assert.equal(r("edit package.json, README.md and .env.local"), "edit <path>, <path> and <path>");
  assert.equal(r("fix a/b/c/d"), "fix <path>");
  // Ordinary text is left alone.
  for (const fine of ["pass/fail and input/output", "Node.js and Next.js", "max_tokens: 4096, tokens = 120000", "claude-opus-5-5 and gpt-6.1-sol", "on 2026/11/16 at 5/10", "run 20261116-143000-ab12 finished", "version 0.3.0 and 1.2.3"]) {
    assert.equal(r(fine), fine);
  }
  // Names, when given.
  assert.equal(redact("jane@HOST on Janes-Mac and jane", { paths: "drop", names: [["jane", "<user>"], ["Janes-Mac", "<host>"]] }), "<user>@HOST on <host> and <user>");
  // Fenced code and a diff, wherever they are.
  assert.equal(r("before\n```\nsecret()\n```\nafter"), "before\n<code removed>\nafter");
  assert.equal(r("before\ndiff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+new\n\nafter"), "before\n<diff removed>\n\nafter");
  assert.equal(r("- a bullet\n+ another\nplain"), "- a bullet\n+ another\nplain");
});

test("F52's reports still keep a path's last name, and are now free of keys, emails and code too", () => {
  assert.equal(redact("see /Users/jane/Projects/app/src/a.ts and ~/x/y.ts", { paths: "name" }), "see …/a.ts and …/y.ts");
  assert.equal(redact(`mail ${EMAIL} key ${KEY}\n${CODE}`, { paths: "name" }), "mail <email> key <secret>\n<code removed>");
});

test("the CLI writes the file under ~/.neuromesh/reports, prints the next step, and puts no run data in the URL", () => {
  const home = mkdtempSync(join(tmpdir(), "nm-report-home-"));
  const repo = realpathSync(mkdtempSync(join(tmpdir(), "nm-report-")));
  const git = (...a: string[]) => spawnSync("git", a, { cwd: repo, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t.t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t.t" } });
  git("init", "-q");
  writeFileSync(join(repo, "a.txt"), "a");
  git("add", ".");
  git("commit", "-q", "-m", "x");
  const state = fixtureState("", repo);
  state.dir = join(runsDir(home, repo), state.id);
  state.worktree = join(state.dir, "worktree");
  saveState(state);
  const events = fixtureEvents(state.id);
  writeFileSync(runPaths(state.dir).events, events.map((e) => JSON.stringify(e)).join("\n") + "\n{half a line");
  const cli = (...args: string[]) => spawnSync(process.execPath, ["src/cli/main.ts", ...args, "--repo", repo], { encoding: "utf8", env: { ...process.env, NEUROMESH_HOME: home, NEUROMESH_TELEMETRY_URL: "off" } });

  const out = cli("report", "last", "--note", `it failed in ${REL}, mail ${EMAIL}`);
  assert.equal(out.status, 0, out.stderr);
  const path = join(home, "reports", `${state.id}.md`);
  assert.ok(existsSync(path));
  assert.ok(out.stdout.includes(path), out.stdout);
  assert.ok(out.stdout.includes(ISSUES_URL), out.stdout);
  const issueUrl = out.stdout.split("\n").find((l) => l.includes(ISSUES_URL))!;
  assert.ok(issueUrl.trim().endsWith(ISSUES_URL) && !issueUrl.includes("?"), "no run data in the URL");
  assert.match(out.stdout, /Read the file first/);
  assert.match(out.stdout, /Nothing has been sent anywhere/);
  const file = readFileSync(path, "utf8");
  for (const secret of LEAKS) assert.ok(!file.includes(secret), `leaked into the file: ${secret}`);
  for (const secret of [...LEAKS, home, repo]) assert.ok(!out.stdout.replace(path, "").includes(secret) || secret === home, `leaked into the output: ${secret}`);
  assert.match(file, /it failed in <path>, mail <email>/);
  assert.match(file, /1 lines of the event log could not be read/);
  assert.match(file, /cascade-claude \(team\)/);
  assert.ok(!out.stdout.includes("add --note"), "a note was given");

  // The same run by the end of its id; with no note, it says how to add one; the file is replaced.
  const again = cli("report", "ab12");
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /add --note/);
  assert.match(readFileSync(path, "utf8"), /none given/);

  // Nothing is sent: no outbox, no telemetry folder was made.
  assert.ok(!existsSync(join(home, "telemetry", "outbox")));

  // An unknown run, and the feature switched off.
  const missing = cli("report", "zzzz");
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /No run matches "zzzz"/);
  const off = cli("report", "last", "--disable", "bad-run-report");
  assert.equal(off.status, 1);
  assert.match(off.stderr, /F113 bad-run-report/);
  // A failure inside the feature is tagged with it.
  const fault = spawnSync(process.execPath, ["src/cli/main.ts", "report", "last", "--repo", repo], { encoding: "utf8", env: { ...process.env, NEUROMESH_HOME: home, NEUROMESH_FAULT: "bad-run-report" } });
  assert.equal(fault.status, 1);
  assert.match(fault.stderr, /\[F113 bad-run-report\] injected fault/);
  assert.match(fault.stderr, /--disable bad-run-report/);
});

test("the command is in the help and in the registry", () => {
  const help = spawnSync(process.execPath, ["src/cli/main.ts", "--help"], { encoding: "utf8" });
  assert.match(help.stdout, /neuromesh report \[run\]/);
  assert.match(help.stdout, /--note "<what went wrong>"/);
  const f = feature("F113");
  assert.equal(f.key, "bad-run-report");
  assert.equal(f.optional, true);
});

test("readEvents skips lines it cannot read and counts them; the timeline never prints a field it was not told to", () => {
  const dir = mkdtempSync(join(tmpdir(), "nm-events-"));
  const path = join(dir, "events.jsonl");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, `{"t":"2026-11-16T09:00:00Z","run":"r","type":"brief","kind":"bugfix","newField":"${KEY}","nested":{"x":"${ABS}"}}\nnot json\n[1,2]\n`);
  appendFileSync(path, "\n");
  const { events, unreadable } = readEvents(path);
  assert.equal(events.length, 1);
  assert.equal(unreadable, 2);
  const { lines } = timeline(events, (x) => x);
  assert.equal(lines.length, 1);
  assert.ok(!lines[0]!.includes(KEY) && !lines[0]!.includes(ABS), lines[0]);
  assert.match(lines[0]!, /brief {2}kind=bugfix$/);
});
