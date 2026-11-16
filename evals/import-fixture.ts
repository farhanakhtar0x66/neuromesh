// Turn ProofBench's ready-made coding fixtures into tasks (batch 2a). No model is called.
//
//   node evals/import-fixture.ts evals/real-tasks-2/proofbench.json [--fixtures <dir>] [--only name,name] [--out-root dir] [--runs 3]
//
// A fixture is a folder with workspace/ (a small Rust crate with its tests in tests/), sometimes solution/ (the
// files that fix it), and a task.json whose prompt was written for a benchmark that SHOWS the tests to the agent.
// The result is the same task folder make-task.ts makes from a commit, so the eval runner, validate-task.ts and
// the fake backend treat it alike:
//
//   seed        workspace/ without tests/ and target/, plus a .gitignore for target/ (the agent cannot see the tests)
//   hidden/     workspace/tests/ (laid over the workspace to grade), the grader, spec.json
//   reference/  solution/ where the fixture has one; otherwise references/<name>/ next to the manifest, written by hand
//   prompt.md   prompts/<name>.md next to the manifest: the fixture's prompt after the leak audit (see README.md)
//   fail-to-pass / pass-to-pass  found by running `cargo test` on the seed and on the reference, as make-task.ts does
//
// Manifest entries: { name, fixture, kind, difficulty?, notes? }. Each task is then validated (validate-task.ts).
// Exit 0 only if every task is valid.

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyReference } from "./make-task.ts";
import { overlay, runTests } from "./real-task/grade.ts";
import type { TaskSpec } from "./real-task/grade.ts";
import { validateTask } from "./validate-task.ts";

const here = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_FIXTURES = join(homedir(), "Projects", "Global AI Hack", "proofbench", "fixtures", "coding-tasks");
const TEST_COMMAND = "cargo test --offline --no-fail-fast";

export interface FixtureEntry {
  name: string;
  /** The fixture's folder name under the fixtures directory. */
  fixture: string;
  kind: string;
}

export interface ImportedTask {
  dir: string;
  testFiles: string[];
  referenceFrom: "solution/" | "hand-written";
  referenceFiles: string[];
  failToPass: string[];
  passToPass: string[];
}

/** Every file under `dir`, as paths relative to it. */
function listFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(p.slice(dir.length + 1));
    }
  };
  if (existsSync(dir)) walk(dir);
  return out.sort();
}

export function importFixture(entry: FixtureEntry, opts: { fixtures: string; manifestDir: string; out: string }): ImportedTask {
  if (!/^[\w.-]+$/.test(entry.name)) throw new Error(`The task name "${entry.name}" may only hold letters, digits, dots, dashes and underscores`);
  const src = join(opts.fixtures, entry.fixture);
  const workspace = join(src, "workspace");
  if (!existsSync(join(workspace, "Cargo.toml"))) throw new Error(`${src} has no workspace/Cargo.toml`);
  const out = resolve(opts.out);
  if (existsSync(out)) throw new Error(`${out} already exists`);
  const promptFile = join(opts.manifestDir, "prompts", `${entry.name}.md`);
  if (!existsSync(promptFile)) throw new Error(`no prompt: ${promptFile}`);

  const work = mkdtempSync(join(tmpdir(), "neuromesh-import-fixture-"));
  try {
    const stage = join(work, "task");
    // The seed: the crate as the agent sees it, without its tests and without a build folder.
    cpSync(workspace, join(stage, "seed"), { recursive: true, filter: (p) => !/(^|\/)(tests|target)$/.test(p.slice(workspace.length)) });
    // Rust repositories ignore their build folder; without this the engine's own checks leave an untracked target/ in the
    // project and a task's change then conflicts with it when merged (found by the fake run: every task "conflicted").
    if (!existsSync(join(stage, "seed", ".gitignore"))) writeFileSync(join(stage, "seed", ".gitignore"), "target/\n");
    // The hidden tests keep their path from the crate's root: hidden/tests/tests/<file>.rs.
    const testFiles = listFiles(join(workspace, "tests")).map((f) => join("tests", f));
    if (testFiles.length === 0) throw new Error(`${entry.fixture} has no tests in workspace/tests/`);
    cpSync(join(workspace, "tests"), join(stage, "hidden", "tests", "tests"), { recursive: true });

    // The reference: the fixture's own solution/ where it has one, else references/<name>/files (and deleted.txt)
    // next to the manifest, written by hand for the fixtures that ship without one.
    const handWritten = join(opts.manifestDir, "references", entry.name);
    const solution = join(src, "solution");
    const referenceFrom = existsSync(solution) ? "solution/" : "hand-written";
    const filesFrom = existsSync(solution) ? solution : join(handWritten, "files");
    if (!existsSync(filesFrom)) throw new Error(`${entry.fixture} has no solution/ and there is no hand-written ${filesFrom}`);
    cpSync(filesFrom, join(stage, "reference", "files"), { recursive: true });
    const deletedFile = join(handWritten, "deleted.txt");
    writeFileSync(join(stage, "reference", "deleted.txt"), referenceFrom === "hand-written" && existsSync(deletedFile) ? readFileSync(deletedFile, "utf8") : "");
    const referenceFiles = listFiles(join(stage, "reference", "files"));

    writeFileSync(join(stage, "prompt.md"), `${readFileSync(promptFile, "utf8").trim()}\n`);

    // The two lists, from running the tests on the seed and on the reference (as make-task.ts does).
    const spec: TaskSpec = { runner: "cargo", testCommand: TEST_COMMAND, failToPass: [], passToPass: [] };
    const before = join(work, "before");
    cpSync(join(stage, "seed"), before, { recursive: true });
    overlay(join(stage, "hidden", "tests"), before);
    const seedRun = runTests(before, spec);
    const after = join(work, "after");
    applyReference(join(stage, "seed"), join(stage, "reference"), after);
    const diff = spawnSync("git", ["diff", "--no-index", "--no-color", "--", join(stage, "seed"), after], { encoding: "utf8" }).stdout ?? "";
    writeFileSync(join(stage, "reference", "change.patch"), diff.split(`${stage}/seed/`).join("a/").split(`${after}/`).join("b/"));
    overlay(join(stage, "hidden", "tests"), after);
    const refRun = runTests(after, spec);
    if (refRun.results.size === 0) throw new Error(`the tests printed nothing readable on the reference:\n${refRun.output.slice(-800)}`);
    for (const [id, passed] of refRun.results) {
      if (!passed) continue;
      if (seedRun.results.get(id) === true) spec.passToPass.push(id);
      else spec.failToPass.push(id);
    }
    spec.failToPass.sort();
    spec.passToPass.sort();
    if (spec.failToPass.length === 0) throw new Error("no test fails on the seed and passes on the reference");
    const failedOnReference = [...refRun.results].filter(([, ok]) => !ok).map(([id]) => id);
    if (failedOnReference.length > 0) throw new Error(`the reference fails: ${failedOnReference.join("; ")}`);

    writeFileSync(join(stage, "hidden", "spec.json"), `${JSON.stringify(spec, null, 2)}\n`);
    cpSync(join(here, "real-task", "grade.ts"), join(stage, "hidden", "grade.ts"));
    writeFileSync(
      join(stage, "task.json"),
      `${JSON.stringify({ kind: entry.kind, language: "rust", hiddenCheck: "node hidden/grade.ts", source: { fixture: `proofbench/fixtures/coding-tasks/${basename(entry.fixture)}`, referenceFrom }, runner: "cargo", testCommand: TEST_COMMAND, madeAt: new Date().toISOString() }, null, 2)}\n`,
    );
    mkdirSync(dirname(out), { recursive: true });
    cpSync(stage, out, { recursive: true });
    return { dir: out, testFiles, referenceFrom, referenceFiles, failToPass: spec.failToPass, passToPass: spec.passToPass };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function main(): number {
  const argv = process.argv.slice(2);
  const valued = ["--fixtures", "--only", "--out-root", "--runs"];
  const manifest = argv.find((a, i) => !a.startsWith("--") && !valued.includes(argv[i - 1] ?? ""));
  if (!manifest) {
    console.error("usage: node evals/import-fixture.ts <manifest.json> [--fixtures dir] [--only a,b] [--out-root dir] [--runs 3]");
    return 2;
  }
  const opt = (k: string): string | undefined => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : undefined);
  const manifestDir = dirname(resolve(manifest));
  const root = resolve(opt("out-root") ?? manifestDir);
  const fixtures = opt("fixtures")?.replace(/^~/, homedir()) ?? DEFAULT_FIXTURES;
  const only = opt("only")?.split(",");
  const runs = Number(opt("runs") ?? 3);
  const entries = JSON.parse(readFileSync(manifest, "utf8")) as FixtureEntry[];
  let bad = 0;
  for (const e of entries) {
    if (only && !only.includes(e.name)) continue;
    const dir = join(root, e.name);
    try {
      if (!existsSync(dir)) importFixture(e, { fixtures, manifestDir, out: dir });
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
