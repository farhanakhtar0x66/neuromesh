// Make and validate a batch of real-repository tasks from a manifest (plan item M1). No model is called.
//
//   node evals/make-batch.ts evals/real-tasks/batch-1.json [--only name,name] [--out-root dir] [--runs 3]
//
// The manifest lists, for each task, the repository (a path, "~" allowed, or a URL), the commit, the kind,
// the language, the runner and test command, and optionally which files are the tests. Each task's prompt is
// prompts/<name>.md next to the manifest. A task folder that does not exist yet is made; every task is then
// validated (evals/validate-task.ts). Exit 0 only if every task is valid.

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTask } from "./make-task.ts";
import { validateTask } from "./validate-task.ts";
import type { Runner } from "./real-task/grade.ts";

interface Entry {
  name: string;
  repo: string;
  commit: string;
  kind: string;
  language: string;
  runner: Runner;
  testCommand: string;
  setup?: string;
  tests?: string[];
  checks?: string;
}

function main(): number {
  const argv = process.argv.slice(2);
  const manifest = argv.find((a, i) => !a.startsWith("--") && !["--only", "--out-root", "--runs"].includes(argv[i - 1] ?? ""));
  if (!manifest) {
    console.error("usage: node evals/make-batch.ts <manifest.json> [--only a,b] [--out-root dir] [--runs 3]");
    return 2;
  }
  const opt = (k: string): string | undefined => argv[argv.indexOf(`--${k}`) + 1] && argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : undefined;
  const only = opt("only")?.split(",");
  const root = resolve(opt("out-root") ?? dirname(resolve(manifest)));
  const runs = Number(opt("runs") ?? 3);
  const entries = JSON.parse(readFileSync(manifest, "utf8")) as Entry[];
  let bad = 0;
  for (const e of entries) {
    if (only && !only.includes(e.name)) continue;
    const dir = join(root, e.name);
    try {
      if (!existsSync(dir)) {
        makeTask({
          repo: e.repo.replace(/^~/, homedir()), commit: e.commit, name: e.name, runner: e.runner, testCommand: e.testCommand, setup: e.setup,
          kind: e.kind, language: e.language, tests: e.tests, checks: e.checks, out: dir, prompt: readFileSync(join(dirname(resolve(manifest)), "prompts", `${e.name}.md`), "utf8"),
        });
      }
      const v = validateTask(dir, { runs });
      if (!v.ok) bad++;
      const spec = JSON.parse(readFileSync(join(dir, "hidden", "spec.json"), "utf8")) as { failToPass: string[]; passToPass: string[] };
      console.log(`${v.ok ? "valid  " : "INVALID"} ${e.name.padEnd(26)} ${e.kind.padEnd(8)} fail-to-pass ${String(spec.failToPass.length).padStart(3)}  pass-to-pass ${String(spec.passToPass.length).padStart(3)}${v.ok ? "" : `   ${v.checks.filter((c) => !c.ok).map((c) => c.name).join("; ")}`}`);
    } catch (err) {
      bad++;
      console.log(`FAILED  ${e.name.padEnd(26)} ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
    }
  }
  console.log(bad === 0 ? "every task is valid" : `${bad} task(s) not valid`);
  return bad === 0 ? 0 : 1;
}

const entry = process.argv[1];
if (entry && fileURLToPath(import.meta.url) === resolve(entry)) process.exitCode = main();
