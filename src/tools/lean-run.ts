// [F136 lean-runner] Runs one command for the Bash tool (passed base64 by the hook)
// and prints its combined output through the lean filter, exiting with the
// command's own exit code. Standard input is passed through.

import { spawnSync } from "node:child_process";
import { filterOutput } from "./leanfilter.ts";

const command = Buffer.from(process.argv[2] ?? "", "base64").toString("utf8");
const r = spawnSync("sh", ["-c", `exec 2>&1\n${command}`], { stdio: ["inherit", "pipe", "pipe"], encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
const output = (r.stdout ?? "") + (r.stderr ?? "") + (r.error ? `\n${r.error.message}` : "");
const code = r.status ?? (r.signal ? 128 : 1);
process.stdout.write(`${filterOutput(output, r.status)}\n`);
process.exit(code);
