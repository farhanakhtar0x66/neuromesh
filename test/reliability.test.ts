// Regression tests for what the fault harness found (evals/chaos.ts,
// docs/16-fault-harness.md): each one is a run that used to hang, crash, lose
// work or waste the expert.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { createFakeBackend } from "../src/backends/fake.ts";
import type { FakeScript } from "../src/backends/fake.ts";
import type { AgentRequest } from "../src/backends/types.ts";
import { startRun } from "../src/engine/run.ts";
import type { EngineContext } from "../src/engine/run.ts";
import { EventLog } from "../src/engine/store.ts";
import type { NeuromeshEvent } from "../src/engine/store.ts";
import type { RoleChain } from "../src/engine/types.ts";
import type { Preset } from "../src/presets/presets.ts";
import { git } from "../src/workspace/git.ts";
import { commitAll, createWorktree, healWorktree } from "../src/workspace/workspace.ts";

const scratch = mkdtempSync(join(tmpdir(), "neuromesh-reliability-test-"));
after(() => rmSync(scratch, { recursive: true, force: true }));
let counter = 0;

const sh = (cwd: string, ...args: string[]): string => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, encoding: "utf8" });

function makeRepo(files: Record<string, string>): string {
  const dir = join(scratch, `repo-${++counter}`);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  sh(dir, "init", "-q", "-b", "main");
  sh(dir, "add", "-A");
  sh(dir, "commit", "-q", "-m", "seed");
  return dir;
}

/** The test passes when every listed file says ok. */
function repoNeeding(...files: string[]): string {
  return makeRepo({
    "package.json": JSON.stringify({ name: "demo", scripts: { test: "node check.js" } }),
    "check.js": `const fs=require('fs');for(const f of ${JSON.stringify(files)}){if(!fs.existsSync(f)||fs.readFileSync(f,'utf8').trim()!=='ok'){console.error('expected '+f+' to say ok');process.exit(1)}}`,
  });
}

const EXPERT = { backend: "fake", model: "fake-expert", tier: "expert" as const };
const WORKER = { backend: "fake", model: "fake-worker", tier: "worker" as const };

function preset(roles: RoleChain = {}, extra: Partial<Preset> = {}): Preset {
  return { name: "test", description: "", mode: "solo", roles: { worker: [WORKER], ...roles }, repairs: 1, maxTasks: 5, maxParallel: 1, turnTimeoutMinutes: 1, intake: false, brief: false, routing: "worker-first", advise: false, test: "always", ...extra };
}

function context(script: FakeScript) {
  const events: NeuromeshEvent[] = [];
  const fake = createFakeBackend(script);
  const ctx: EngineContext = { home: join(scratch, `home-${++counter}`), backends: { fake }, onEvent: (e) => events.push(e), turnTimeoutMs: 5_000 };
  return { ctx, fake, events };
}

const props = (r: AgentRequest): Record<string, unknown> => (r.outputSchema?.properties as Record<string, unknown> | undefined) ?? {};
const isPlan = (r: AgentRequest): boolean => "tasks" in props(r) && !("design" in props(r));
const report = (summary: string, status = "done") => ({ structured: { status, summary, notes: "", run: "" } });
const write = (cwd: string, file: string, text: string): void => writeFileSync(join(cwd, file), `${text}\n`);

test("when the expert's fix and its one repair both fail, the task fails and the run ends (it used to rerun the checks forever)", async () => {
  const repo = repoNeeding("a.txt");
  const { ctx, fake } = context((req) => {
    write(req.cwd, "a.txt", "still wrong");
    return report("tried");
  });
  const state = await startRun({ cwd: repo, prompt: "make the test pass", preset: preset({ escalation: [EXPERT] }, { repairs: 0 }) }, ctx);
  assert.equal(state.status, "finished");
  assert.equal(state.tasks[0]?.status, "failed");
  assert.equal(state.tasks[0]?.error, "checks still fail after the expert's attempt");
  assert.equal(state.outcome?.checks, "failed");
  assert.equal(fake.calls.filter((c) => c.model === "fake-expert").length, 2, "the expert's attempt and one repair, no more");
});

test("a backend adapter that throws is a failed turn: the expert takes over and the run finishes", async () => {
  const repo = repoNeeding("a.txt");
  const { ctx, events } = context((req) => {
    if (req.model === "fake-worker") throw new Error("spawn claude ENOENT");
    write(req.cwd, "a.txt", "ok");
    return report("fixed");
  });
  const state = await startRun({ cwd: repo, prompt: "make the test pass", preset: preset({ escalation: [EXPERT] }) }, ctx);
  assert.equal(state.status, "finished", state.reason);
  assert.equal(state.outcome?.checks, "passed");
  const crashed = state.attempts.find((a) => a.model === "fake-worker")!;
  assert.equal(crashed.stop, "error");
  assert.match(crashed.detail ?? "", /the fake adapter failed: spawn claude ENOENT/);
  assert.equal(events.filter((e) => e.type === "agent.started").length, events.filter((e) => e.type === "agent.finished").length, "every turn that started is recorded as finished");
});

test("two tasks built at the same time: the later one is tested with the earlier one's work, with no repair and no expert", async () => {
  const repo = repoNeeding("a.txt", "b.txt");
  let release: (() => void) | undefined;
  const firstMerged = new Promise<void>((resolve) => (release = resolve));
  const { ctx, fake, events } = context(async (req) => {
    if (isPlan(req)) {
      return {
        structured: {
          summary: "two parts",
          tasks: [
            { id: "t1", title: "part a", brief: "Write a.txt", owned: ["a.txt"], depends_on: [], owner: "worker" },
            { id: "t2", title: "part b", brief: "Write b.txt", owned: ["b.txt"], depends_on: [], owner: "worker" },
          ],
        },
      };
    }
    if (/Your task: part a/.test(req.prompt)) {
      write(req.cwd, "a.txt", "ok");
      return report("a");
    }
    // Part b finishes its turn only after part a has merged.
    write(req.cwd, "b.txt", "ok");
    await firstMerged;
    return report("b");
  });
  ctx.onEvent = (e) => {
    events.push(e);
    if (e.type === "task.merged" && e.task === "t1") release?.();
  };
  const state = await startRun({ cwd: repo, prompt: "make the test pass", preset: preset({ orchestrator: [EXPERT], escalation: [EXPERT] }, { mode: "team", maxParallel: 2 }), mode: "team" }, ctx);
  assert.equal(state.status, "finished", state.reason);
  assert.deepEqual(state.tasks.map((t) => [t.id, t.status]), [["t1", "passed"], ["t2", "passed"]]);
  assert.equal(state.outcome?.checks, "passed");
  assert.ok(events.some((e) => e.type === "task.synced" && e.feature === "F75" && e.task === "t2"));
  assert.deepEqual(state.attempts.map((a) => a.kind), ["plan", "initial", "initial"], "no repair, no expert");
  assert.equal(fake.calls.length, 3);
});

test("a team preset without an orchestrator hands the request to a worker instead of pausing for quota", async () => {
  const repo = repoNeeding("a.txt");
  const { ctx } = context((req) => {
    write(req.cwd, "a.txt", "ok");
    return report("done");
  });
  const state = await startRun({ cwd: repo, prompt: "make the test pass", preset: preset({}, { mode: "team" }), mode: "team" }, ctx);
  assert.equal(state.status, "finished", state.reason);
  assert.equal(state.outcome?.checks, "passed");
});

test("a worker is offered a split only while someone can do the dividing", async () => {
  const repo = repoNeeding("a.txt");
  const { ctx, fake } = context((req) => {
    write(req.cwd, "a.txt", "ok");
    return report("done");
  });
  await startRun({ cwd: repo, prompt: "make the test pass", preset: preset() }, ctx);
  assert.doesNotMatch(fake.calls[0]!.prompt, /answer with status "split"/, "no lead engineer in this preset");
  const second = context((req) => {
    write(req.cwd, "a.txt", "ok");
    return report("done");
  });
  await startRun({ cwd: repoNeeding("a.txt"), prompt: "make the test pass", preset: preset({ orchestrator: [EXPERT] }) }, second.ctx);
  assert.match(second.fake.calls[0]!.prompt, /answer with status "split"/);
});

test("an agent that damages its work folder does not end the run: deleted folder, own git repository inside, switched branch, stale lock", async () => {
  for (const damage of ["delete", "nested", "branch", "lock"] as const) {
    const repo = repoNeeding("a.txt");
    let turns = 0;
    const { ctx, events } = context((req) => {
      turns += 1;
      if (turns === 1 && damage === "delete") rmSync(req.cwd, { recursive: true, force: true });
      else if (damage === "nested") {
        mkdirSync(join(req.cwd, "lib"), { recursive: true });
        write(req.cwd, "lib/inside.txt", "kept");
        sh(join(req.cwd, "lib"), "init", "-q");
        write(req.cwd, "a.txt", "ok");
      } else if (damage === "branch") {
        write(req.cwd, "a.txt", "ok");
        sh(req.cwd, "checkout", "-q", "-b", "the-agents-own-branch");
        sh(req.cwd, "add", "-A");
        sh(req.cwd, "commit", "-q", "-m", "committed by the agent");
      } else if (damage === "lock") {
        write(req.cwd, "a.txt", "ok");
        writeFileSync(join(sh(req.cwd, "rev-parse", "--absolute-git-dir").trim(), "index.lock"), "");
      } else write(req.cwd, "a.txt", "ok");
      return report("done");
    });
    const state = await startRun({ cwd: repo, prompt: "make the test pass", preset: preset() }, ctx);
    assert.equal(state.status, "finished", `${damage}: ${state.reason}`);
    assert.equal(state.outcome?.checks, "passed", damage);
    assert.ok(events.some((e) => e.type === "worktree.healed" && e.feature === "F73"), `${damage}: healed`);
    assert.equal(readFileSync(join(state.worktree, "a.txt"), "utf8").trim(), "ok", `${damage}: the work reached the result`);
    if (damage === "nested") {
      assert.ok(state.outcome!.files.some((f) => f.path === "lib/inside.txt"), "files under the agent's own git repository are part of the result");
      assert.match(readFileSync(join(state.dir, "diff.patch"), "utf8"), /lib\/inside\.txt/);
    }
  }
});

test("healWorktree reports nothing for a healthy folder and stops a half-done merge", () => {
  const repo = makeRepo({ "f.txt": "one\n" });
  const tree = join(scratch, `tree-${++counter}`);
  createWorktree(repo, tree, "work", sh(repo, "rev-parse", "HEAD").trim());
  assert.deepEqual(healWorktree(repo, tree, "work", "HEAD"), { restored: false, fixed: [] });
  // Two sides change the same line; the agent starts a merge and leaves it.
  writeFileSync(join(tree, "f.txt"), "mine\n");
  commitAll(tree, "mine");
  sh(repo, "checkout", "-q", "-b", "other");
  writeFileSync(join(repo, "f.txt"), "theirs\n");
  sh(repo, "commit", "-q", "-am", "theirs");
  assert.throws(() => sh(tree, "merge", "other"));
  assert.ok(existsSync(join(sh(tree, "rev-parse", "--absolute-git-dir").trim(), "MERGE_HEAD")));
  const healed = healWorktree(repo, tree, "work", "HEAD");
  assert.deepEqual(healed, { restored: false, fixed: ["stopped a half-done merge"] });
  assert.equal(readFileSync(join(tree, "f.txt"), "utf8"), "mine\n");
  assert.equal(git(tree, "status", "--porcelain").trim(), "");
});

test("an event log whose last line was cut by a kill loses only that line", () => {
  const path = join(scratch, `events-${++counter}.jsonl`);
  writeFileSync(path, '{"type":"a"}\n{"type":"b","half":');
  new EventLog(path, "r").emit("c");
  appendFileSync(path, "");
  const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
  assert.equal(lines.length, 3);
  assert.equal((JSON.parse(lines[2]!) as { type: string }).type, "c");
});
