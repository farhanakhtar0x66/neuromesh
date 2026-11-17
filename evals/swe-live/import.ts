// Turn SWE-bench-Live instances into Neuromesh eval tasks (no model calls).
//
//   node evals/swe-live/import.ts [--ids a,b,c | --list evals/swe-live/instances.json] [--no-validate] [--runs 2]
//
// Needs, once: the colima profile "swe" running x86 images through Rosetta
// (colima start swe --vm-type vz --vz-rosetta --cpu 4 --memory 8 --disk 120), and the official harness with its
// dataset in ~/.neuromesh/swe-live (harness/, .venv/ with Python 3.12, rows/<instance>.json: see evals/swe-live/README.md).
//
// Each task (evals/swe-live/tasks/<instance>, not committed: it is rebuilt from the dataset) is:
//   seed/        the repository as the instance's Docker image has it in /testbed, without .git
//   prompt.md    the issue text, then one paragraph on running commands in the project's environment
//   task.json    checks: the existing test files the fix's tests touch, run in the image (they pass on the seed)
//   hidden/      grade.sh + instance.jsonl: the workspace's diff, graded by the official harness (resolved or not)
//   reference/   the real fix (gold patch) as changed files, for the fake backend and validation
// The agent works on the host; ~/.neuromesh/swe-live/run/<instance> runs a command in the image with the
// repository mounted at /testbed and no network. Validation: the seed must fail the hidden check and the gold fix
// must pass it in each of --runs runs; a task that does not is moved to tasks-rejected/.

import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SWE = join(homedir(), ".neuromesh", "swe-live");
const SOCKET = `unix://${join(homedir(), ".colima", "swe", "docker.sock")}`;
const ENV = { ...process.env, DOCKER_HOST: SOCKET };

interface Instance {
  instance_id: string;
  repo: string;
  base_commit: string;
  patch: string;
  test_patch: string;
  problem_statement: string;
  created_at: string;
  test_cmds: string[];
  rebuild_cmds: string[];
  docker_image: string;
  FAIL_TO_PASS: string[];
  PASS_TO_PASS: string[];
}

function run(cmd: string, args: string[], options: { cwd?: string; input?: string; timeoutSec?: number } = {}): { code: number; out: string } {
  const r = spawnSync(cmd, args, { cwd: options.cwd, env: ENV, input: options.input, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, timeout: (options.timeoutSec ?? 1800) * 1000 });
  return { code: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function must(cmd: string, args: string[], options: { cwd?: string; input?: string } = {}): string {
  const r = run(cmd, args, options);
  if (r.code !== 0) throw new Error(`${cmd} ${args.slice(0, 3).join(" ")} failed: ${r.out.slice(-600)}`);
  return r.out;
}

const q = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

/** Paths a unified diff touches (the b/ side; /dev/null for a deletion is skipped). */
export function touchedPaths(diff: string): string[] {
  return [...new Set([...diff.matchAll(/^diff --git a\/(\S+) b\/(\S+)$/gm)].map((m) => m[2]!))];
}

function wrapper(row: Instance): string {
  const rebuild = row.rebuild_cmds.filter((c) => c.trim()).join(" && ");
  return [
    "#!/bin/sh",
    `# Run one command in the environment of ${row.instance_id} (Docker image ${row.docker_image}),`,
    "# with this repository mounted at /testbed and no network. Pass the command as one argument.",
    'root=$(git rev-parse --show-toplevel 2>/dev/null || pwd)',
    'rel=${PWD#"$root"}',
    `exec env DOCKER_HOST=${SOCKET} docker run --rm -i --platform linux/amd64 --network none -v "$root":/testbed -w "/testbed$rel" ${row.docker_image} bash -c ${rebuild ? `"${rebuild.replace(/"/g, '\\"')} >/dev/null 2>&1; $*"` : '"$*"'}`,
    "",
  ].join("\n");
}

// Names the hidden tests need that the issue does not state (interfaces.json): without them a right fix fails on a guessed name.
const INTERFACES: Record<string, string> = JSON.parse(readFileSync(new URL("./interfaces.json", import.meta.url), "utf8"));

function prompt(row: Instance, runner: string): string {
  const iface = INTERFACES[row.instance_id];
  return `${row.problem_statement.trim()}
${iface ? `\n---\n\nInterface the maintainers expect (the tests use these names): ${iface}\n` : ""}
---

Fix this in the repository in the current folder (${row.repo}). The project's Python environment, with its dependencies
installed, is in a Docker image, not on this machine: run any command that needs it through \`${runner}\`, which runs one
command in that environment with this folder mounted at /testbed, for example
\`${runner} 'python -m pytest -q tests/some_test.py'\`. It has no network. Do not look this issue or its fix up online.
`;
}

const GRADE = (id: string): string => `#!/bin/sh
# Hidden check: this workspace's change, graded by the official SWE-bench-Live harness for ${id}.
here=$(cd "$(dirname "$0")" && pwd); ws=$(cd "$here/.." && pwd)
SWE="$HOME/.neuromesh/swe-live"
tmp=$(mktemp -d "\${TMPDIR:-/tmp}/swe-grade-XXXXXX")
root=$(git -C "$ws" rev-list --max-parents=0 HEAD | tail -1)
git -C "$ws" add -A >/dev/null 2>&1
git -C "$ws" diff --cached --binary "$root" -- . ':(exclude)hidden' ':(exclude)neuromesh.json' > "$tmp/model.patch"
"$SWE/.venv/bin/python" -c 'import json,sys; json.dump({sys.argv[2]: {"model_patch": open(sys.argv[1]).read()}}, open(sys.argv[3], "w"))' "$tmp/model.patch" ${id} "$tmp/preds.json"
cd "$SWE/harness" && DOCKER_HOST=${SOCKET} "$SWE/.venv/bin/python" -m evaluation.evaluation --dataset "$here/instance.jsonl" --instance_ids ${id} --platform linux --patch_dir "$tmp/preds.json" --output_dir "$tmp/out" --workers 1 --overwrite 1 > "$tmp/eval.log" 2>&1
"$SWE/.venv/bin/python" - "$tmp/out/${id}/report.json" "$here/instance.jsonl" "$tmp/eval.log" <<'PY'
import json, os, sys
report_path, inst_path, log_path = sys.argv[1:]
inst = json.loads(open(inst_path).readline())
if not os.path.exists(report_path):
    print("NO REPORT (empty patch, or the harness failed):")
    print(open(log_path).read()[-1500:])
    print("SCORE 0/%d" % len(inst["FAIL_TO_PASS"]))
    sys.exit(1)
r = json.load(open(report_path))
f2p_ok = set(r["FAIL_TO_PASS"]["success"])
for t in inst["FAIL_TO_PASS"]:
    print(("PASS" if t in f2p_ok else "FAIL") + " fail-to-pass: " + t)
for t in r["PASS_TO_PASS"]["failure"]:
    print("FAIL pass-to-pass: " + t)
print("SCORE %d/%d" % (len(f2p_ok & set(inst["FAIL_TO_PASS"])), len(inst["FAIL_TO_PASS"])))
sys.exit(0 if r.get("resolved") else 1)
PY
code=$?
rm -rf "$tmp"
exit $code
`;

/** A git copy of the seed as the eval makes it (neuromesh.json included), optionally with the reference laid over. */
function workspace(task: string, withReference: boolean): string {
  const ws = mkdtempSync(join(tmpdir(), "swe-ws-"));
  cpSync(join(task, "seed"), ws, { recursive: true });
  const t = JSON.parse(readFileSync(join(task, "task.json"), "utf8")) as { checks?: unknown };
  if (t.checks) writeFileSync(join(ws, "neuromesh.json"), `${JSON.stringify({ checks: t.checks }, null, 2)}\n`);
  for (const args of [["init", "-q", "-b", "main"], ["add", "-A"], ["commit", "-q", "-m", "seed"]]) must("git", ["-c", "user.name=swe", "-c", "user.email=swe@localhost", ...args], { cwd: ws });
  if (withReference) {
    if (existsSync(join(task, "reference", "files"))) cpSync(join(task, "reference", "files"), ws, { recursive: true });
    const deleted = join(task, "reference", "deleted.txt");
    if (existsSync(deleted)) for (const p of readFileSync(deleted, "utf8").split("\n").filter(Boolean)) rmSync(join(ws, p), { force: true });
  }
  cpSync(join(task, "hidden"), join(ws, "hidden"), { recursive: true });
  return ws;
}

function grade(task: string, withReference: boolean): { ok: boolean; secs: number; tail: string } {
  const ws = workspace(task, withReference);
  const started = Date.now();
  // Under the eval's 10-minute limit for the hidden check, with a margin: a grading that takes longer cannot score in a run,
  // so the task is rejected rather than waited on (privacyidea's took 16 minutes).
  const r = run("sh", ["hidden/grade.sh"], { cwd: ws, timeoutSec: 540 });
  if (Date.now() - started >= 539_000) run("pkill", ["-f", ws]); // the harness outlives the killed shell
  rmSync(ws, { recursive: true, force: true });
  return { ok: r.code === 0, secs: Math.round((Date.now() - started) / 1000), tail: r.out.split("\n").slice(-4).join(" | ") };
}

export function importInstance(row: Instance, tasksDir: string): string {
  const id = row.instance_id;
  const task = join(tasksDir, id);
  rmSync(task, { recursive: true, force: true });
  mkdirSync(join(task, "hidden"), { recursive: true });
  if (run("docker", ["image", "inspect", row.docker_image]).code !== 0) must("docker", ["pull", "--platform", "linux/amd64", row.docker_image]);

  // Seed: /testbed as the image has it (with its built files), without the upstream history.
  const cid = must("docker", ["create", "--platform", "linux/amd64", row.docker_image]).trim().split("\n").at(-1)!;
  try {
    must("docker", ["cp", `${cid}:/testbed`, join(task, "seed")]);
  } finally {
    run("docker", ["rm", "-f", cid]);
  }
  if (!existsSync(join(task, "seed", ".git"))) throw new Error(`${id}: /testbed is not the repository root`);
  rmSync(join(task, "seed", ".git"), { recursive: true, force: true });

  // Reference: the gold patch applied to a git copy of the seed, as changed files.
  const ref = mkdtempSync(join(tmpdir(), "swe-ref-"));
  cpSync(join(task, "seed"), ref, { recursive: true });
  for (const args of [["init", "-q"], ["add", "-A"], ["commit", "-q", "-m", "seed"]]) must("git", ["-c", "user.name=swe", "-c", "user.email=swe@localhost", ...args], { cwd: ref });
  must("git", ["apply", "--whitespace=nowarn", "-"], { cwd: ref, input: row.patch });
  const status = must("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: ref }).split("\n").filter(Boolean);
  const deleted: string[] = [];
  for (const line of status) {
    const path = line.slice(3);
    if (line.startsWith(" D") || line.startsWith("D ")) deleted.push(path);
    else {
      mkdirSync(dirname(join(task, "reference", "files", path)), { recursive: true });
      cpSync(join(ref, path), join(task, "reference", "files", path));
    }
  }
  if (deleted.length > 0) writeFileSync(join(task, "reference", "deleted.txt"), `${deleted.join("\n")}\n`);
  writeFileSync(join(task, "reference", "change.patch"), row.patch);
  rmSync(ref, { recursive: true, force: true });

  // The runner the agent uses, outside the workspace so it never shows in a diff.
  const runner = join(SWE, "run", id);
  mkdirSync(dirname(runner), { recursive: true });
  writeFileSync(runner, wrapper(row));
  chmodSync(runner, 0o755);

  // Checks while working: the existing test files the fix's tests touch, if they pass on the seed; else an import check.
  const tests = touchedPaths(row.test_patch).filter((p) => p.endsWith(".py") && existsSync(join(task, "seed", p)));
  let check = tests.length > 0 ? `${runner} ${q(`python -m pytest -q -p no:cacheprovider -x ${tests.join(" ")}`)}` : "";
  if (check) {
    const seedRun = run("sh", ["-c", check], { cwd: join(task, "seed"), timeoutSec: 900 });
    if (seedRun.code !== 0) check = "";
  }
  if (!check) check = `${runner} ${q("python -m compileall -q -x '(^|/)(\\.|build|dist|node_modules)' .")}`;

  writeFileSync(join(task, "prompt.md"), prompt(row, runner));
  writeFileSync(join(task, "hidden", "instance.jsonl"), `${JSON.stringify(row)}\n`);
  writeFileSync(join(task, "hidden", "grade.sh"), GRADE(id));
  writeFileSync(
    join(task, "task.json"),
    `${JSON.stringify(
      {
        kind: "issue",
        language: "python",
        hiddenCheck: "sh hidden/grade.sh",
        checks: [{ name: "tests", command: check }],
        source: { dataset: "SWE-bench-Live", instance: id, repo: row.repo, base_commit: row.base_commit, created_at: row.created_at, image: row.docker_image },
        madeAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );
  return task;
}

function main(): number {
  const argv = process.argv.slice(2);
  const opt = (name: string): string | undefined => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : undefined);
  // One file per instance (rows/<id>.json, split from full.jsonl): the whole dataset is over 512 MB.
  const rowOf = (id: string): Instance | undefined => {
    const f = join(SWE, "rows", `${id}.json`);
    return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as Instance) : undefined;
  };
  const ids = opt("ids")?.split(",") ?? (JSON.parse(readFileSync(resolve(opt("list") ?? join(HERE, "instances.json")), "utf8")) as string[]);
  const runs = Number(opt("runs") ?? 2);
  const tasksDir = join(HERE, "tasks");
  const rejected = join(HERE, "tasks-rejected");
  mkdirSync(tasksDir, { recursive: true });
  const lines: string[] = [];
  for (const id of ids) {
    const row = rowOf(id);
    if (!row) {
      console.log(`${id}: not in the dataset`);
      continue;
    }
    try {
      const started = Date.now();
      const task = importInstance(row, tasksDir);
      let verdict = "imported";
      if (!argv.includes("--no-validate")) {
        const seed = grade(task, false);
        const golds = Array.from({ length: runs }, () => grade(task, true));
        const ok = !seed.ok && golds.every((g) => g.ok);
        verdict = `${ok ? "valid" : "NOT valid"}: seed ${seed.ok ? "PASSES (bad)" : "fails"}; gold ${golds.map((g) => (g.ok ? "pass" : "FAIL")).join(",")}; grading ${golds.map((g) => g.secs).join("/")} s`;
        if (!ok) {
          rmSync(join(rejected, id), { recursive: true, force: true });
          mkdirSync(rejected, { recursive: true });
          renameSync(task, join(rejected, id));
          verdict += ` | ${(golds.find((g) => !g.ok) ?? seed).tail}`;
        }
      }
      const line = `${id}: ${verdict} (${Math.round((Date.now() - started) / 1000)} s in all)`;
      console.log(line);
      lines.push(line);
    } catch (error) {
      const line = `${id}: ERROR ${error instanceof Error ? error.message.slice(0, 400) : String(error)}`;
      console.log(line);
      lines.push(line);
    }
  }
  writeFileSync(join(HERE, "import.log"), `${lines.join("\n")}\n`, { flag: "a" });
  return 0;
}

const entry = process.argv[1];
if (entry && fileURLToPath(import.meta.url) === resolve(entry)) process.exitCode = main();
