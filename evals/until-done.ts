#!/usr/bin/env node
// Run evals one after another until each has no paused task, waiting out
// subscription limits in between. For long measurements that span several
// quota windows.
//
//   node evals/until-done.ts --preset factory-luna e1-luna-1 e1-luna-2 e1-luna-3
//
// Each name is an eval (see `neuromesh eval --name`); finished tasks are
// skipped, paused ones are retried. Gives up after --hours (default 24).

import { spawn } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { coolingModels } from "../src/engine/cooldown.ts";
import { defaultHome } from "../src/engine/store.ts";
import { loadReport } from "../src/eval/eval.ts";

const cli = join(fileURLToPath(new URL(".", import.meta.url)), "..", "src", "cli", "main.ts");
const args = process.argv.slice(2);
const flag = (name: string, fallback: string): string => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const value = args[i + 1] ?? fallback;
  args.splice(i, 2);
  return value;
};
const preset = flag("preset", "factory-luna");
const hours = Number(flag("hours", "24"));
const names = args;
const deadline = Date.now() + hours * 3_600_000;
const home = defaultHome();

const log = (message: string): void => console.log(`[${new Date().toLocaleTimeString()}] ${message}`);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function runEval(name: string): Promise<number | null> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cli, "eval", "--preset", preset, "--name", name], { stdio: ["ignore", "inherit", "inherit"] });
    child.on("close", resolve);
  });
}

function paused(name: string): number {
  const report = loadReport(home, name);
  return report ? Object.values(report.results).filter((r) => r.status === "paused").length : 0;
}

for (const name of names) {
  while (Date.now() < deadline) {
    // Wait until the models this preset needs are out of cooldown.
    const cooling = Object.entries(coolingModels(home));
    if (cooling.length > 0) {
      const until = Math.max(...cooling.map(([, c]) => Date.parse(c.until)));
      if (until > Date.now()) {
        log(`waiting until ${new Date(until).toLocaleTimeString()} for ${cooling.map(([m]) => m).join(", ")}`);
        await sleep(until - Date.now() + 60_000);
        continue;
      }
    }
    log(`running eval ${name}`);
    await runEval(name);
    const left = paused(name);
    if (left === 0) {
      log(`eval ${name} has no paused tasks`);
      break;
    }
    log(`eval ${name} paused with ${left} task(s) left`);
    await sleep(60_000);
  }
}
log("done");
