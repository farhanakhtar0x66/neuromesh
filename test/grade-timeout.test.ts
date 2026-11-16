// The real-task grader's time limit ends everything the test command started, not only the shell
// (2026-11-17: a looping seed test outlived spawnSync's timeout and ran for hours as an orphan).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { shGroup } from "../evals/real-task/grade.ts";

const dir = mkdtempSync(join(tmpdir(), "neuromesh-grade-timeout-"));
after(() => rmSync(dir, { recursive: true, force: true }));

const alive = (marker: string): number => {
  const r = spawnSync("pgrep", ["-f", marker], { encoding: "utf8" });
  return r.stdout.split("\n").filter((l) => l.trim() !== "").length;
};

test("a normal command keeps its exit code and output", () => {
  const r = shGroup(dir, "echo hello; echo oops >&2; exit 3", 30, process.env);
  assert.equal(r.code, 3);
  assert.match(r.output, /hello/);
  assert.match(r.output, /oops/);
});

test("at the time limit the command and the loops it started are all gone", () => {
  const marker = `nm-grade-loop-${process.pid}-${Date.now()}`;
  // A child that loops in the background and a foreground that loops too, as a test runner and its worker would.
  const command = `sh -c 'while :; do :; done' ${marker} & sh -c 'while :; do sleep 0.1; done' ${marker}`;
  const started = Date.now();
  const r = shGroup(dir, command, 2, process.env);
  const took = Date.now() - started;
  assert.notEqual(r.code, 0);
  assert.ok(took < 15_000, `ended in ${took} ms`);
  spawnSync("sleep", ["1"]);
  assert.equal(alive(marker), 0, "no process of the command is left");
});

test("a background process the command left behind is ended when the command exits", () => {
  const marker = `nm-grade-left-${process.pid}-${Date.now()}`;
  const r = shGroup(dir, `sh -c 'sleep 300' ${marker} & echo done`, 30, process.env);
  assert.equal(r.code, 0);
  spawnSync("sleep", ["1"]);
  assert.equal(alive(marker), 0);
});
