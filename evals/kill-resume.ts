#!/usr/bin/env node
// Live check that a run survives being stopped half way and can be resumed.
//
//   node evals/kill-resume.ts [--preset solo-flash] [--signal SIGKILL|SIGINT] [--task js-todo-remove]
//
// SIGKILL kills the engine outright, leaving its agent tool running on its own;
// resume must stop that orphan and finish the run. SIGINT is a normal Ctrl-C.

import { execFileSync, spawn, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { defaultHome, findRun, loadState } from "../src/engine/store.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const cli = join(here, "..", "src", "cli", "main.ts");
const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
};
const preset = arg("preset", "solo-flash");
const signal = arg("signal", "SIGKILL") as NodeJS.Signals;
const task = arg("task", "js-todo-remove");

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const work = join(defaultHome(), "evals", `kill-resume-${signal}-${stamp}`);
mkdirSync(work, { recursive: true });
cpSync(join(here, "tasks", task, "seed"), work, { recursive: true });
for (const args of [["init", "-q", "-b", "main"], ["add", "-A"], ["commit", "-q", "-m", "seed"]]) {
  spawnSync("git", ["-c", "user.name=neuromesh-eval", "-c", "user.email=eval@localhost", ...args], { cwd: work });
}
const repo = realpathSync(work);

function alive(pid: number | undefined): string | undefined {
  if (pid === undefined) return undefined;
  try {
    return execFileSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" }).trim() || undefined;
  } catch {
    return undefined;
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// 1. Start a run and stop it once the agent is busy.
console.log(`Starting a run in ${repo}`);
const child = spawn(process.execPath, [cli, "run", "--json", "--preset", preset, "--prompt-file", join(here, "tasks", task, "prompt.md")], {
  cwd: repo,
  stdio: ["ignore", "pipe", "inherit"],
});
let activities = 0;
const exited = new Promise<number | null>((resolve) => child.on("close", (code) => resolve(code)));
createInterface({ input: child.stdout }).on("line", (line) => {
  const event = JSON.parse(line) as { type: string; summary?: string };
  if (event.type === "agent.activity") {
    activities += 1;
    console.log(`  agent: ${String(event.summary).slice(0, 90)}`);
  }
});
while (activities < 2) {
  await sleep(250);
  if (child.exitCode !== null) throw new Error("the run ended before it could be interrupted");
}
const before = findRun(defaultHome(), repo, "last");
const agentPid = Object.values(loadState(before.dir).inFlight)[0]?.pid;
console.log(`Sending ${signal} to the engine (pid ${child.pid}); agent tool pid ${agentPid}`);
child.kill(signal);
const code = await exited;
await sleep(1_000);
const stopped = loadState(before.dir);
const orphan = alive(agentPid);
console.log(`Engine exit code ${code}; run status "${stopped.status}"; agent tool ${orphan ? `still running: ${orphan.slice(0, 80)}` : "gone"}`);

// 2. Resume.
console.log("Resuming");
const resume = spawnSync(process.execPath, [cli, "resume", stopped.id], { cwd: repo, encoding: "utf8", timeout: 30 * 60_000 });
process.stdout.write(resume.stdout.split("\n").filter((l) => /Run |Agent:|Checks:|Changes:|Reason:/.test(l)).join("\n") + "\n");
if (resume.stderr.trim()) process.stdout.write(resume.stderr.split("\n").filter((l) => /^!|Resuming|Agent (done|error|quota)|Checks after/.test(l)).join("\n") + "\n");
const final = loadState(before.dir);
const orphanAfter = alive(agentPid);

const ok =
  final.status === "finished" &&
  final.outcome?.checks === "passed" &&
  orphanAfter === undefined &&
  final.attempts[0]?.stop === "cancelled" &&
  final.attempts.some((a) => a.kind === "continue" && a.stop === "done");
console.log(
  `\nResult: ${ok ? "PASS" : "FAIL"} · status ${final.status}, checks ${final.outcome?.checks ?? "-"}, ` +
    `attempts ${final.attempts.map((a) => `${a.kind}:${a.stop}`).join(" → ")}, ` +
    `old agent tool ${orphanAfter ? "STILL RUNNING" : "gone"}`,
);
process.exitCode = ok ? 0 : 1;
