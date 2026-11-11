import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { runProcess } from "../src/backends/proc.ts";

function alive(marker: string): number {
  const out = execFileSync("ps", ["-axo", "command="], { encoding: "utf8" });
  return out.split("\n").filter((l) => l.includes(marker)).length;
}

test("runProcess delivers output lines and the exit code", async () => {
  const lines: string[] = [];
  const result = await runProcess({
    command: "node",
    args: ["-e", "console.log('a'); console.log('b'); process.exit(3)"],
    cwd: process.cwd(),
    timeoutMs: 10_000,
    onLine: (l) => lines.push(l),
  });
  assert.deepEqual(lines, ["a", "b"]);
  assert.equal(result.exitCode, 3);
  assert.equal(result.timedOut, false);
});

test("runProcess sends the prompt on standard input", async () => {
  const lines: string[] = [];
  await runProcess({
    command: "node",
    args: ["-e", "process.stdin.on('data', d => console.log('got:' + d))"],
    cwd: process.cwd(),
    timeoutMs: 10_000,
    stdin: "hello",
    onLine: (l) => lines.push(l),
  });
  assert.deepEqual(lines, ["got:hello"]);
});

test("a timeout stops the process and the children it started", async () => {
  const marker = `NM_PROC_TEST_${process.pid}_${Date.now()}`;
  // A parent that starts a long-lived child, the way an agent starts a command.
  const parent = `require('child_process').spawn('node',['-e','setTimeout(()=>{},60000)','${marker}'],{stdio:'ignore'}); setTimeout(()=>{},60000)`;
  const result = await runProcess({
    command: "node",
    args: ["-e", parent, marker],
    cwd: process.cwd(),
    timeoutMs: 800,
  });
  assert.equal(result.timedOut, true);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(alive(marker), 0);
});

test("cancel also stops a child that moved to its own process group", async () => {
  const marker = `NM_PROC_DETACHED_${process.pid}_${Date.now()}`;
  // Codex starts commands this way: in a new group that a group kill misses.
  const parent = `require('child_process').spawn('node',['-e','setTimeout(()=>{},60000)','${marker}'],{stdio:'ignore',detached:true}); setTimeout(()=>{},60000)`;
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 2_500);
  const result = await runProcess({
    command: "node",
    args: ["-e", parent, marker],
    cwd: process.cwd(),
    timeoutMs: 30_000,
    signal: controller.signal,
  });
  assert.equal(result.cancelled, true);
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(alive(marker), 0);
});

test("cancel stops the process", async () => {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 300);
  const result = await runProcess({
    command: "node",
    args: ["-e", "setTimeout(()=>{},60000)"],
    cwd: process.cwd(),
    timeoutMs: 30_000,
    signal: controller.signal,
  });
  assert.equal(result.cancelled, true);
  assert.ok(result.durationMs < 5_000);
});

test("a missing program is reported, not thrown", async () => {
  const result = await runProcess({
    command: "nm-definitely-not-installed",
    args: [],
    cwd: process.cwd(),
    timeoutMs: 5_000,
  });
  assert.ok(result.spawnError);
});

test("a tool that keeps running after its final event is stopped, and its result kept", async () => {
  const { runCli } = await import("../src/backends/shared.ts");
  const { antigravityParser } = await import("../src/backends/antigravity.ts");
  const script =
    "console.log(JSON.stringify({event:'result',result:{status:'SUCCESS',response:'done',usage:{input_tokens:5,output_tokens:1}}})); setTimeout(()=>{},60000)";
  const request = { cwd: process.cwd(), prompt: "x", access: "read-only" as const, timeoutMs: 30_000 };
  const started = Date.now();
  const result = await runCli({ command: "node", args: ["-e", script], request, parser: antigravityParser({}), lingerMs: 300 });
  assert.equal(result.stop, "done");
  assert.equal(result.finalText, "done");
  assert.ok(Date.now() - started < 10_000, "did not wait for the time limit");
});
