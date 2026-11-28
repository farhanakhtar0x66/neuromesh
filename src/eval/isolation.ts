// [F142 replay-harness] Cache isolation between evals. Claude's prompt cache is per account, not per Neuromesh
// home: two evals running the same task at the same time (two prompt variants side by side, as swl-trialA and
// swl-trialB were) share cached prefixes, so the second one's cache reads, cost and quota look better than
// they would alone. Each eval claims a task while it runs it; another eval that finds the task held by a live
// process warns (the default) or, with --sequential-by-task, waits until it is free.
//
// A claim is one small file per task: <dir>/<task>.json with the eval's name, preset and pid. A claim whose
// process is gone is stale and taken over.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface Claim {
  task: string;
  eval: string;
  preset: string;
  pid: number;
  at: string;
}

/** Where claims live: one place per machine, whatever the Neuromesh home (the cache is per account). */
export function claimsDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.NEUROMESH_EVAL_CLAIMS || join(homedir(), ".neuromesh", "eval-claims");
}

const safe = (task: string): string => task.replace(/[^\w.-]+/g, "_");

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as { code?: string }).code === "EPERM";
  }
}

function read(path: string): Claim | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Claim;
  } catch {
    return undefined;
  }
}

/** The live claim another eval holds on this task, if any. */
export function heldBy(dir: string, task: string, me: { eval: string; pid?: number }): Claim | undefined {
  const c = read(join(dir, `${safe(task)}.json`));
  if (!c || !alive(c.pid)) return undefined;
  if (c.pid === (me.pid ?? process.pid) && c.eval === me.eval) return undefined;
  return c;
}

/** Claim a task; false when another live eval holds it. Atomic: the file is created only if it does not exist. */
export function tryClaim(dir: string, claim: Omit<Claim, "at" | "pid"> & { pid?: number }): boolean {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${safe(claim.task)}.json`);
  const full: Claim = { ...claim, pid: claim.pid ?? process.pid, at: new Date().toISOString() };
  for (let i = 0; i < 2; i++) {
    try {
      writeFileSync(path, JSON.stringify(full), { flag: "wx" });
      return true;
    } catch (error) {
      if ((error as { code?: string }).code !== "EEXIST") throw error;
      const other = read(path);
      if (other && alive(other.pid) && !(other.pid === full.pid && other.eval === full.eval)) return false;
      rmSync(path, { force: true });
    }
  }
  return false;
}

export function release(dir: string, task: string, me: { eval: string; pid?: number }): void {
  const path = join(dir, `${safe(task)}.json`);
  if (!existsSync(path)) return;
  const c = read(path);
  if (!c || (c.pid === (me.pid ?? process.pid) && c.eval === me.eval)) rmSync(path, { force: true });
}

export function describeClash(task: string, mine: { eval: string; preset: string }, other: Claim): string {
  const variant = other.preset === mine.preset ? `the same preset (${other.preset}), which warms the cache for whichever runs second` : `another preset (${other.preset}): a prompt variant whose shared prefixes would be read from cache`;
  return `Task ${task} is running in eval ${other.eval} (pid ${other.pid}) with ${variant}. Results run side by side on one account are biased; --sequential-by-task waits instead.`;
}

/**
 * Hold the task for this eval. "warn": claim it if free, else call warn and go on unclaimed. "sequential": wait,
 * checking every pollMs, until it is free (or the signal aborts; then it returns false).
 */
export async function claimTask(
  dir: string,
  claim: { task: string; eval: string; preset: string },
  mode: "warn" | "sequential",
  hooks: { warn?: (message: string) => void; signal?: AbortSignal; pollMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<boolean> {
  if (tryClaim(dir, claim)) return true;
  const other = heldBy(dir, claim.task, claim);
  const message = other ? describeClash(claim.task, claim, other) : `Task ${claim.task} is claimed by another eval.`;
  if (mode === "warn") {
    hooks.warn?.(message);
    return false;
  }
  hooks.warn?.(`${message} Waiting for it to finish.`);
  const sleep = hooks.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  while (!hooks.signal?.aborted) {
    await sleep(hooks.pollMs ?? 5000);
    if (tryClaim(dir, claim)) return true;
  }
  return false;
}
