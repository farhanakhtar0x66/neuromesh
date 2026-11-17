// Writes hidden/spec.json: which of the hidden check's tests fail on the seed and pass on the reference (fail-to-pass),
// and which pass on both (pass-to-pass). Run from anywhere:  node evals/hard-tasks/<id>/hidden/make-spec.ts
// Builder's tool, not part of the check. No model is called.

import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyReference } from "../../../make-task.ts";
import { overlay, runTests } from "../../../real-task/grade.ts";

const hidden = dirname(fileURLToPath(import.meta.url));
const task = dirname(hidden);
const testCommand = "cargo test --offline --no-fail-fast";
const spec = { runner: "cargo" as const, testCommand };

const tmp = mkdtempSync(join(tmpdir(), "hd-make-spec-"));
try {
  const seed = join(tmp, "seed");
  cpSync(join(task, "seed"), seed, { recursive: true });
  overlay(join(hidden, "tests"), seed);
  const onSeed = runTests(seed, spec);
  const ref = join(tmp, "ref");
  applyReference(join(task, "seed"), join(task, "reference"), ref);
  overlay(join(hidden, "tests"), ref);
  const onRef = runTests(ref, spec);
  if (onRef.results.size === 0) throw new Error(`nothing readable on the reference:\n${onRef.output.slice(-800)}`);
  const failToPass: string[] = [];
  const passToPass: string[] = [];
  for (const [id, ok] of onRef.results) {
    if (!ok) throw new Error(`${id} fails on the reference`);
    (onSeed.results.get(id) === true ? passToPass : failToPass).push(id);
  }
  failToPass.sort();
  passToPass.sort();
  writeFileSync(join(hidden, "spec.json"), `${JSON.stringify({ ...spec, failToPass, passToPass }, null, 2)}\n`);
  console.log(`fail-to-pass ${failToPass.length}, pass-to-pass ${passToPass.length}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
