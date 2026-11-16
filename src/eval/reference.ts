// A backend that makes no model call and answers every build turn with the task's reference solution.
// It tests the evaluation harness (seeding, grading, the record) end to end for free: a task folder with a
// reference/ (files/ laid over the workspace, deleted.txt listing files to remove) passes its own grader.

import { cpSync, existsSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createFakeBackend } from "../backends/fake.ts";
import type { FakeBackend } from "../backends/fake.ts";

/** Every file under the reference's files/ folder, with its content. */
function referenceFiles(reference: string): { path: string; content: string }[] {
  const root = join(reference, "files");
  const out: { path: string; content: string }[] = [];
  const walk = (dir: string): void => {
    for (const name of existsSync(dir) ? readdirSync(dir) : []) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.push({ path: relative(root, p), content: readFileSync(p, "utf8") });
    }
  };
  walk(root);
  return out;
}

/** Lay the reference over a workspace: its files in, its deleted files out. */
export function applyReferenceTo(reference: string, cwd: string): void {
  if (existsSync(join(reference, "files"))) cpSync(join(reference, "files"), cwd, { recursive: true });
  const gone = existsSync(join(reference, "deleted.txt")) ? readFileSync(join(reference, "deleted.txt"), "utf8").split("\n").filter(Boolean) : [];
  for (const f of gone) rmSync(join(cwd, f), { force: true });
}

/**
 * `current` says which task is being run, so the backend knows whose reference to write. Registered under the
 * name of the tool the preset uses (claude), with the no-tools answer mode on, as the real adapter has it.
 */
export function referenceBackend(current: () => { dir: string } | undefined, id = "claude"): FakeBackend {
  // NEUROMESH_FAKE_QUOTA_AFTER=<n>: after n model turns in this process every turn reports a subscription limit,
  // as the real tool does when the window runs out. For testing the runners that wait and resume (evals/baselines.ts).
  const quotaAfter = Number(process.env.NEUROMESH_FAKE_QUOTA_AFTER ?? "");
  let turns = 0;
  const backend = createFakeBackend((req) => {
    if (!req.prompt.startsWith("Reply with the single word")) {
      turns += 1;
      if (Number.isFinite(quotaAfter) && process.env.NEUROMESH_FAKE_QUOTA_AFTER !== undefined && turns > quotaAfter) return { stop: "quota", detail: "fake usage limit reached" };
    }
    const props = (req.outputSchema?.properties ?? {}) as Record<string, unknown>;
    const reference = current() ? join(current()!.dir, "reference") : undefined;
    if ("files" in props && reference) return { structured: { files: referenceFiles(reference), summary: "wrote the reference", notes: "", run: "" } };
    if ("status" in props) {
      if (req.access === "write" && reference) applyReferenceTo(reference, req.cwd);
      return { structured: { status: "done", summary: "wrote the reference", notes: "", run: "" }, usage: { input: 1000, output: 500 } };
    }
    if ("verdict" in props) return { structured: { verdict: "pass", summary: "fine", findings: [] } };
    if ("diagnosis" in props) return { structured: { diagnosis: "x", steps: ["y"] } };
    if ("tasks" in props) return { structured: { summary: "one task", tasks: [{ id: "t1", title: "the request", brief: "do it", owned: [], depends_on: [], owner: "expert" }] }, usage: { input: 2000, output: 300 } };
    return { structured: {}, usage: { input: 10, output: 1 } };
  }, id);
  (backend as { direct?: boolean }).direct = true;
  return backend;
}
