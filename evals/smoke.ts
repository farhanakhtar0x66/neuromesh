#!/usr/bin/env node
// Runs the smoke tasks end to end through the real command line:
// seed repository -> `neuromesh run` -> `neuromesh apply` -> hidden check.
//
//   node evals/smoke.ts [--preset solo-flash] [--tasks js-slugify-bug,rust-roman]
//
// This makes live model calls. M2 turns it into the full task suite.

import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { duration, formatEvent, usageText } from "../src/cli/format.ts";
import { usageByModel } from "../src/engine/run.ts";
import type { ModelUsage } from "../src/engine/run.ts";
import { defaultHome, findRun } from "../src/engine/store.ts";
import type { NeuromeshEvent } from "../src/engine/store.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const tasksDir = join(here, "smoke");
const cli = join(here, "..", "src", "cli", "main.ts");

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const preset = flag("preset") ?? "solo-flash";
const only = flag("tasks")?.split(",");
const tasks = readdirSync(tasksDir)
  .filter((t) => existsSync(join(tasksDir, t, "task.json")))
  .filter((t) => !only || only.includes(t))
  .sort();

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outDir = join(defaultHome(), "evals", `smoke-${preset}-${stamp}`);
mkdirSync(outDir, { recursive: true });

interface Row {
  task: string;
  status: string;
  checks: string;
  hidden: "pass" | "fail" | "not run";
  hiddenTail?: string;
  files: number;
  turns: number;
  wallMs: number;
  usage: ModelUsage[];
  reason?: string;
  engineExitCode: number | null;
}

function sh(cwd: string, command: string): { code: number | null; output: string } {
  const r = spawnSync("sh", ["-c", `${command} 2>&1`], { cwd, encoding: "utf8", timeout: 10 * 60_000 });
  return { code: r.status, output: (r.stdout ?? "").trim() };
}

function seedRepo(task: string): string {
  const work = join(outDir, task);
  cpSync(join(tasksDir, task, "seed"), work, { recursive: true });
  const git = (...args: string[]): void => {
    spawnSync("git", ["-c", "user.name=neuromesh-eval", "-c", "user.email=eval@localhost", ...args], { cwd: work });
  };
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("commit", "-q", "-m", "seed");
  return realpathSync(work);
}

function runCli(cwd: string, args: string[]): Promise<number | null> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd, stdio: ["ignore", "pipe", "inherit"] });
    createInterface({ input: child.stdout }).on("line", (line) => {
      try {
        const text = formatEvent(JSON.parse(line) as NeuromeshEvent);
        if (text !== undefined) process.stderr.write(`  ${text}\n`);
      } catch {
        process.stderr.write(`  ${line}\n`);
      }
    });
    child.on("close", resolve);
  });
}

const rows: Row[] = [];
for (const task of tasks) {
  process.stderr.write(`\n=== ${task} (${preset}) ===\n`);
  const config = JSON.parse(readFileSync(join(tasksDir, task, "task.json"), "utf8")) as { hiddenCheck: string };
  const work = seedRepo(task);
  const started = Date.now();
  const exit = await runCli(work, ["run", "--json", "--preset", preset, "--prompt-file", join(tasksDir, task, "prompt.md")]);
  const wallMs = Date.now() - started;
  const state = findRun(defaultHome(), work, "last");

  let hidden: Row["hidden"] = "not run";
  let hiddenTail: string | undefined;
  if (state.status === "finished") {
    await runCli(work, ["apply", state.id, "--force"]);
    cpSync(join(tasksDir, task, "hidden"), join(work, "hidden"), { recursive: true });
    const result = sh(work, config.hiddenCheck);
    hidden = result.code === 0 ? "pass" : "fail";
    if (hidden === "fail") hiddenTail = result.output.split("\n").slice(-15).join("\n");
  }

  const row: Row = {
    task,
    status: state.status,
    checks: state.outcome?.checks ?? "-",
    hidden,
    hiddenTail,
    files: state.outcome?.files.length ?? 0,
    turns: state.attempts.length,
    wallMs,
    usage: usageByModel(state.attempts),
    reason: state.reason,
    engineExitCode: exit,
  };
  rows.push(row);
  process.stderr.write(`  -> ${row.status}, checks ${row.checks}, hidden ${row.hidden}, ${duration(wallMs)}\n`);
  if (hiddenTail) process.stderr.write(hiddenTail.replace(/^/gm, "     ") + "\n");
}

writeFileSync(join(outDir, "results.json"), JSON.stringify({ preset, stamp, rows }, null, 2) + "\n");

console.log(`\nPreset ${preset}`);
console.log("task                 status     checks  hidden   turns  files  time     tokens");
for (const r of rows) {
  const tokens = r.usage.map((u) => usageText(u.usage)).join(" | ");
  console.log(
    `${r.task.padEnd(20)} ${r.status.padEnd(10)} ${r.checks.padEnd(7)} ${r.hidden.padEnd(8)} ${String(r.turns).padEnd(6)} ${String(r.files).padEnd(6)} ${duration(r.wallMs).padEnd(8)} ${tokens}`,
  );
}
const passed = rows.filter((r) => r.hidden === "pass").length;
const engineFailures = rows.filter((r) => r.status === "failed" && /engine error/.test(r.reason ?? "")).length;
console.log(`\nHidden tests passed: ${passed}/${rows.length}. Engine failures: ${engineFailures}. Results: ${join(outDir, "results.json")}`);
