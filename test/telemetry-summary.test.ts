// [F111 telemetry-summary] The weekly reader, on fixture reports (invented; none is a real tester's), and
// the delivery fixes that came with it: a refused report no longer blocks the ones behind it, a waiting
// report says why, and a pull goes on past one page.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { feature } from "../src/features.ts";
import { KINDS, classify, formatTesterSummary, parseSince, readInbox, runViews, summarize } from "../src/telemetry/summary.ts";
import { flush, outbox, pull, queue, ratingReport, runReport } from "../src/telemetry/telemetry.ts";
import type { RunReport } from "../src/telemetry/telemetry.ts";

const NOW = new Date("2026-11-16T12:00:00.000Z");

/** A run report as a tester's install sends it. */
function run(id: string, at: string, over: Partial<RunReport["run"]> = {}, install = "aaaaaaaa-1111"): RunReport {
  return {
    schema: 1,
    type: "run",
    install,
    version: "0.3.0",
    os: "darwin 25",
    at,
    run: { run: id, at, preset: "cascade-claude", request: `request for ${id}`, status: "finished", checks: "passed", minutes: 2, turns: 3, escalated: false, models: [], tokens: { expert: 0, worker: 1000 }, files: 1, insertions: 5, deletions: 0, cost: 0.1, finalReport: `report for ${id}`, ...over } as RunReport["run"],
  };
}
const rating = (id: string, score: number, note?: string, install = "aaaaaaaa-1111", at = "2026-11-15T10:00:00.000Z") => ({ schema: 1, type: "rating", install, version: "0.3.0", at, run: id, score, note });

/** One of each kind of run, a good one, a stopped one, a resumed one and an old one. */
const FIXTURES: unknown[] = [
  run("20261115-100000-aaaa", "2026-11-15T10:00:00.000Z", { cost: 0.3 }),
  rating("20261115-100000-aaaa", 5),
  // engine: a tagged engine error, with a feature that failed
  run("20261115-110000-bbbb", "2026-11-15T11:00:00.000Z", { status: "failed", checks: "-", failure: "engine", reason: "engine error in F56 env-blocked: boom", featureErrors: ["F56 env-blocked: boom", "F77 one-answer: late"] }),
  rating("20261115-110000-bbbb", 1, "it crashed"),
  // environment: the tool was signed out
  run("20261115-120000-cccc", "2026-11-15T12:00:00.000Z", { status: "paused", checks: "-", reason: "the worker's tool is no longer signed in (OAuth token revoked). Sign in again" }),
  // wrong code: the checks failed after the repairs
  run("20261114-130000-dddd", "2026-11-14T13:00:00.000Z", { status: "failed", checks: "failed", failure: "agent", reason: "checks still fail (npm test)", preset: "factory-opus-haiku", cost: undefined }),
  rating("20261114-130000-dddd", 2, "tests red", "bbbbbbbb-2222"),
  // unclear request: the tester's note says so
  run("20261114-140000-eeee", "2026-11-14T14:00:00.000Z", { checks: "passed", finalReport: "Built a to-do app." }, "bbbbbbbb-2222"),
  rating("20261114-140000-eeee", 2, "I asked for a CLI; the request was vague and it misread it", "bbbbbbbb-2222"),
  // unknown: checks passed, rated low, nothing says why
  run("20261113-150000-ffff", "2026-11-13T15:00:00.000Z", { preset: "factory-opus-haiku", cost: 0.5 }),
  rating("20261113-150000-ffff", 1),
  // stopped by the tester: not a bad run
  run("20261113-160000-gggg", "2026-11-13T16:00:00.000Z", { status: "interrupted", checks: "-", reason: "stopped by the user" }),
  // resumed: first paused, then finished; counts once, as finished
  run("20261113-170000-hhhh", "2026-11-13T17:00:00.000Z", { status: "paused", checks: "-", reason: "subscription limits reached" }),
  run("20261113-170000-hhhh", "2026-11-13T19:00:00.000Z", { status: "finished" }),
  rating("20261113-170000-hhhh", 4),
  // older than the week
  run("20261101-090000-iiii", "2026-11-01T09:00:00.000Z", { status: "failed", failure: "engine", reason: "engine error: old" }),
  // not reports
  { type: "something-else" },
  "not an object",
];

test("runs are joined to their ratings, resumed runs count once, and what is not a report is left out", () => {
  const views = runViews(FIXTURES);
  assert.equal(views.length, 9, "nine different runs");
  const resumed = views.find((v) => v.id === "20261113-170000-hhhh")!;
  assert.equal(resumed.run.status, "finished");
  assert.equal(resumed.rating?.score, 4);
  assert.equal(views.find((v) => v.id === "20261114-130000-dddd")!.rating, undefined, "a rating from another install is not this run's");
});

test("classify labels each kind of bad run by fixed rules, and leaves good and stopped runs alone", () => {
  const verdict = (id: string) => classify(runViews(FIXTURES).find((v) => v.id === id)!);
  assert.equal(verdict("20261115-100000-aaaa").bad, false);
  assert.equal(verdict("20261115-110000-bbbb").kind, "engine");
  assert.equal(verdict("20261115-120000-cccc").kind, "environment");
  assert.equal(verdict("20261114-130000-dddd").kind, "wrong code");
  assert.equal(verdict("20261114-140000-eeee").kind, "unclear request");
  assert.equal(verdict("20261113-150000-ffff").kind, "unknown");
  assert.match(verdict("20261113-150000-ffff").why ?? "", /rated 1 though the checks passed/);
  assert.deepEqual(verdict("20261113-160000-gggg"), { bad: false }, "stopped by the tester is not bad");
  assert.equal(verdict("20261113-170000-hhhh").bad, false, "the later report says it finished");
  // A sign-in failure is the setup's even when the engine tagged it as an agent failure; a hang is the engine's.
  const base = runViews(FIXTURES)[0]!;
  assert.equal(classify({ ...base, run: { ...base.run, status: "failed", failure: "agent", reason: "escalation auth: Failed to authenticate: OAuth token revoked" } }).kind, "environment");
  assert.equal(classify({ ...base, run: { ...base.run, status: "failed", failure: "agent", reason: "escalation error: sandbox-exec: execvp() of 'claude' failed: No such file or directory" } }).kind, "environment", "a tool that is not installed");
  assert.equal(classify({ ...base, run: { ...base.run, status: "failed", failure: "agent", reason: "worker timeout: no output for 10 minutes" } }).kind, "engine");
  assert.equal(classify({ ...base, run: { ...base.run, status: "failed", failure: "engine", reason: "environment: npm install failed" } }).kind, "environment");
});

test("the summary on the fixtures: runs by preset, the spread, kinds, failed features and the five lowest", () => {
  const s = summarize(runViews(FIXTURES), parseSince("7d", NOW));
  assert.equal(s.runs.length, 8, "the run from two weeks back is outside the week");
  assert.equal(s.installs, 2);
  const cascade = s.presets.find((p) => p.preset === "cascade-claude")!;
  const haiku = s.presets.find((p) => p.preset === "factory-opus-haiku")!;
  assert.deepEqual([cascade.runs, cascade.ok, cascade.bad, cascade.stopped], [6, 2, 3, 1]);
  assert.deepEqual([haiku.runs, haiku.ok, haiku.bad], [2, 0, 2]);
  assert.equal(haiku.priced, 1, "an unknown cost is left out of the sum and counted as unpriced, never as 0");
  assert.deepEqual(s.spread, [2, 1, 0, 1, 1], "ratings 1,1,2,4,5 (dddd's rating is another install's)");
  assert.deepEqual(KINDS.map((k) => s.kinds.get(k)!.length), [1, 1, 1, 1, 1]);
  assert.deepEqual(s.featureFailures.map((f) => [f.id, f.key, f.runs]), [["F56", "env-blocked", 1], ["F77", "one-answer", 1]]);
  assert.equal(s.lowest.length, 5);
  assert.deepEqual(s.lowest.map((v) => v.rating!.score), [1, 1, 2, 4, 5]);
  assert.equal(s.lowest[0]!.id, "20261115-110000-bbbb", "the most recent of the 1s first");

  const text = formatTesterSummary(s, 2, NOW);
  assert.match(text, /8 runs from 2 installs, 5 rated, 3 not rated/);
  assert.match(text, /cascade-claude +6 +2 +3 +1 +3\.0 \(4\)/);
  assert.match(text, /factory-opus-haiku +2 +0 +2 +0 +1\.0 \(1\) .* \$0\.50 \(1 of 2 priced\)/);
  assert.match(text, /estimate at API list prices/);
  assert.match(text, /Bad runs: 5 of 8 {2}\(engine 1, environment 1, wrong code 1, unclear request 1, unknown 1\)/);
  assert.match(text, /\[engine\] cascade-claude 20261115-110000-bbbb/);
  assert.match(text, /\[unclear request\] .*\(tester: I asked for a CLI; the request was vague/);
  assert.match(text, /F56 env-blocked: 1 run, e\.g\. boom/);
  assert.match(text, /1\. rated 1 {2}cascade-claude {2}failed, checks - {2}\[engine\]/);
  assert.match(text, /asked: {2}request for 20261115-110000-bbbb/);
  assert.match(text, /result: report for 20261115-110000-bbbb/);
  assert.match(text, /note: {3}it crashed/);
  assert.match(text, /2 files in the inbox could not be read/);
  assert.doesNotMatch(text, /20261101-090000-iiii/);
});

test("an empty week says what to do; a long request and report are cut", () => {
  assert.match(formatTesterSummary(summarize([], parseSince("7d", NOW)), 0, NOW), /No run reports in this period\.\nFetch the newest with `neuromesh telemetry pull`/);
  const long = runViews([run("20261115-100000-zzzz", "2026-11-15T10:00:00.000Z", { request: "x ".repeat(400), finalReport: "y ".repeat(600) }), rating("20261115-100000-zzzz", 1)]);
  const text = formatTesterSummary(summarize(long, parseSince("all", NOW)), 0, NOW);
  assert.match(text, /asked: {2}(x ){100,}x…/);
  assert.ok(text.split("\n").every((l) => l.length < 700));
});

test("--since takes spans, dates and 'all', and says what it takes otherwise", () => {
  assert.equal(parseSince("7d", NOW).toISOString(), "2026-11-09T12:00:00.000Z");
  assert.equal(parseSince("24h", NOW).toISOString(), "2026-11-15T12:00:00.000Z");
  assert.equal(parseSince("2w", NOW).toISOString(), "2026-11-02T12:00:00.000Z");
  assert.equal(parseSince("2026-11-09", NOW).toISOString(), "2026-11-09T00:00:00.000Z");
  assert.equal(parseSince("all", NOW).getTime(), 0);
  assert.throws(() => parseSince("lately", NOW), /span like 7d/);
});

test("the command reads the inbox, is registered as F111, and can be switched off", () => {
  assert.equal(feature("telemetry-summary").id, "F111");
  const home = mkdtempSync(join(tmpdir(), "nm-summary-"));
  const inbox = join(home, "telemetry", "inbox");
  mkdirSync(inbox, { recursive: true });
  FIXTURES.filter((x) => typeof x === "object").forEach((x, i) => writeFileSync(join(inbox, `r${i}.json`), JSON.stringify(x)));
  writeFileSync(join(inbox, "broken.json"), "{not json");
  assert.equal(readInbox(home).unreadable, 1);
  const cli = (...args: string[]) => spawnSync(process.execPath, ["src/cli/main.ts", "telemetry", ...args], { encoding: "utf8", env: { ...process.env, NEUROMESH_HOME: home, NEUROMESH_TELEMETRY_URL: "off", NEUROMESH_TELEMETRY_ADMIN: "" } });
  const all = cli("summary", "--since", "all", "--offline");
  assert.equal(all.status, 0, all.stderr);
  assert.match(all.stdout, /9 runs from 2 installs/);
  assert.match(all.stdout, /Bad runs: 6 of 9/);
  const bad = cli("summary", "--since", "lately", "--offline");
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /span like 7d/);
  const off = cli("summary", "--offline", "--disable", "telemetry-summary");
  assert.equal(off.status, 1);
  assert.match(off.stderr, /F111 telemetry-summary/);
  // With no admin token and no --offline, it says so and still reads the inbox.
  const noToken = spawnSync(process.execPath, ["src/cli/main.ts", "telemetry", "summary", "--since", "all"], { encoding: "utf8", env: { ...process.env, NEUROMESH_HOME: home, NEUROMESH_TELEMETRY_URL: "off", NEUROMESH_TELEMETRY_ADMIN: undefined } as NodeJS.ProcessEnv });
  assert.match(noToken.stderr, /No admin token/);
  assert.match(noToken.stdout, /9 runs/);
});

test("a report the endpoint refuses for good is set aside; the ones behind it still go", async () => {
  const home = mkdtempSync(join(tmpdir(), "nm-flush-"));
  process.env.NEUROMESH_TELEMETRY_URL = "https://example.test";
  try {
    queue(home, ratingReport(home, "r1", 3, "first"));
    queue(home, ratingReport(home, "r2", 4, "second, refused"));
    queue(home, ratingReport(home, "r3", 5, "third"));
    const fake = (async (_url: string, init: RequestInit) => new Response("{}", { status: String(init.body).includes("refused") ? 400 : 201 })) as unknown as typeof fetch;
    const result = await flush(home, fake);
    assert.deepEqual([result.sent, result.waiting, result.rejected], [2, 0, 1]);
    assert.match(result.problem ?? "", /refused a report \(400\)/);
    assert.equal(outbox(home).length, 0);
    assert.equal(readdirSync(join(home, "telemetry", "rejected")).length, 1);
  } finally {
    delete process.env.NEUROMESH_TELEMETRY_URL;
  }
});

test("a waiting report says why: wrong key, endpoint down, or offline", async () => {
  const home = mkdtempSync(join(tmpdir(), "nm-why-"));
  process.env.NEUROMESH_TELEMETRY_URL = "https://example.test";
  try {
    queue(home, ratingReport(home, "r1", 3));
    const answer = (status: number) => (async () => new Response("{}", { status })) as unknown as typeof fetch;
    assert.match((await flush(home, answer(401))).problem ?? "", /did not accept this build's key \(401\): update Neuromesh/);
    assert.match((await flush(home, answer(503))).problem ?? "", /busy or down \(503\)/);
    const offline = await flush(home, (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch);
    assert.match(offline.problem ?? "", /offline/);
    assert.equal(offline.waiting, 1, "still waiting for next time");
    assert.equal(existsSync(join(home, "telemetry", "rejected")), false);
  } finally {
    delete process.env.NEUROMESH_TELEMETRY_URL;
  }
});

test("pull goes on past 1,000 reports and says what a wrong admin token needs", async () => {
  const home = mkdtempSync(join(tmpdir(), "nm-pull-"));
  process.env.NEUROMESH_TELEMETRY_URL = "https://example.test";
  try {
    const at = (i: number) => new Date(Date.UTC(2026, 10, 1) + i * 1000).toISOString();
    const rows = (from: number, n: number) => Array.from({ length: n }, (_, i) => ({ id: `id${from + i}`, received: at(from + i), body: "{}" }));
    const urls: string[] = [];
    const fake = (async (url: string) => {
      urls.push(url);
      const since = decodeURIComponent(new URL(url).searchParams.get("since") ?? "");
      return Response.json(since === "" ? rows(0, 1000) : rows(1000, 3));
    }) as unknown as typeof fetch;
    assert.equal(await pull(home, "token", "", fake), 1003);
    assert.equal(urls.length, 2);
    assert.equal(readdirSync(join(home, "telemetry", "inbox")).length, 1003);
    await assert.rejects(pull(home, "wrong", "", (async () => new Response("{}", { status: 401 })) as unknown as typeof fetch), /did not accept the admin token \(401\)/);
  } finally {
    delete process.env.NEUROMESH_TELEMETRY_URL;
  }
});

test("a report built from a real run state still reads back through the summary", () => {
  const home = mkdtempSync(join(tmpdir(), "nm-roundtrip-"));
  const state = { id: "r9", mode: "solo", tasks: [{ report: { summary: "Added hello.txt" } }] } as never;
  const entry = { run: "r9", at: "2026-11-15T10:00:00.000Z", repo: "x", preset: "p", request: "add hello", status: "finished", checks: "passed", minutes: 1, turns: 1, escalated: false, models: [], tokens: { expert: 0, worker: 1 }, files: 1, insertions: 1, deletions: 0 } as never;
  const report = { ...runReport(home, state, entry), at: "2026-11-15T10:00:00.000Z" };
  const views = runViews([report, { ...ratingReport(home, "r9", 3), at: "2026-11-15T10:05:00.000Z" }]);
  assert.equal(views.length, 1);
  assert.equal(views[0]!.rating?.score, 3);
  assert.equal(views[0]!.run.finalReport, "Added hello.txt");
});

// [F112 tool-preflight] The first-run fixes found while reading what a new tester sees.

test("a missing tool is named with what to do; a tool that is there, or cannot be checked, lets the run start", async () => {
  const { missingTools, presetBackends } = await import("../src/cli/preflight.ts");
  const { loadPreset } = await import("../src/presets/presets.ts");
  const { createFakeBackend } = await import("../src/backends/fake.ts");
  const preset = loadPreset("cascade-claude");
  assert.deepEqual(presetBackends(preset), ["claude"]);
  const absent = { ...createFakeBackend(() => ({}), "claude"), displayName: "Claude Code", version: async () => undefined };
  const [message] = await missingTools(preset, { claude: absent });
  assert.match(message!, /Claude Code \(`claude`\) was not found .* cascade-claude preset needs it\. Install Claude Code from https:\/\/claude\.com\/claude-code, then run `claude` once to sign in\. Then try again/);
  assert.deepEqual(await missingTools(preset, { claude: { ...absent, version: async () => "2.1.0" } }), []);
  assert.deepEqual(await missingTools(preset, { claude: { ...absent, version: async () => { throw new Error("spawn failed"); } } }), [], "a check that fails is not a missing tool");
  assert.deepEqual(await missingTools(preset, { claude: { ...absent, version: () => new Promise<string | undefined>(() => undefined) } }, 20), [], "a check that hangs is not either");
  assert.deepEqual(await missingTools(preset, {}), [], "a backend this build does not know is left to the run");
});

test("neuromesh run with no Claude Code stops at once with the install step; doctor says how to fix a missing tool", () => {
  const home = mkdtempSync(join(tmpdir(), "nm-pre-"));
  const repo = mkdtempSync(join(tmpdir(), "nm-pre-repo-"));
  const git = (...a: string[]) => spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd: repo });
  git("init", "-q", "-b", "main");
  git("commit", "-q", "--allow-empty", "-m", "seed");
  // A PATH with no claude on it: nothing can be called, so this makes no model call.
  const env = { ...process.env, PATH: "/usr/bin:/bin", NEUROMESH_HOME: home, NEUROMESH_TELEMETRY_URL: "off" };
  const run = spawnSync(process.execPath, [join(process.cwd(), "src/cli/main.ts"), "run", "add a readme"], { cwd: repo, encoding: "utf8", env });
  assert.equal(run.status, 2, run.stderr);
  assert.match(run.stderr, /Claude Code \(`claude`\) was not found/);
  assert.doesNotMatch(run.stderr, /execvp|Climbed/);
  const off = spawnSync(process.execPath, [join(process.cwd(), "src/cli/main.ts"), "run", "--disable", "tool-preflight", "add a readme"], { cwd: repo, encoding: "utf8", env, timeout: 60_000 });
  assert.match(off.stdout + off.stderr, /execvp|No such file|failed/, "with the check off, the run starts and fails as it used to");
  const doctor = spawnSync(process.execPath, [join(process.cwd(), "src/cli/main.ts"), "doctor", "--backend", "claude"], { encoding: "utf8", env });
  assert.match(doctor.stdout, /FAIL .*installed .*Install Claude Code from https:\/\/claude\.com\/claude-code/);
  assert.match(doctor.stdout, /Not ready: the default preset \(cascade-claude\) needs claude to pass/);
  assert.match(doctor.stderr, /a few tiny live calls/);
});

test("usage and telemetry status say what to do when there is nothing yet", () => {
  const home = mkdtempSync(join(tmpdir(), "nm-empty-"));
  const cli = (...a: string[]) => spawnSync(process.execPath, ["src/cli/main.ts", ...a], { encoding: "utf8", env: { ...process.env, NEUROMESH_HOME: home, NEUROMESH_TELEMETRY_URL: "off" } });
  assert.match(cli("usage").stdout, /No runs recorded yet\. A real run, from the TUI/);
  assert.match(cli("telemetry", "status").stdout, /To share: `neuromesh telemetry on`\. Not to: `neuromesh telemetry off`\./);
});
