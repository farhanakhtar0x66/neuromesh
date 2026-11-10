// Ending a run: apply its diff to the user's repository, or throw it away.

import { existsSync, readFileSync } from "node:fs";
import { applyPatch, deleteBranches, removeWorktree, snapshot, writePatch } from "../workspace/workspace.ts";
import { EventLog, runPaths, saveState } from "./store.ts";
import type { RunState } from "./types.ts";

/** The run's current diff, read fresh from its worktree when it still exists. */
export function currentPatch(state: RunState): string {
  const paths = runPaths(state.dir);
  if (existsSync(state.worktree)) {
    const diff = snapshot(state.worktree, state.base, state.prepared);
    writePatch(paths.patch, diff.patch);
    return diff.patch;
  }
  return existsSync(paths.patch) ? readFileSync(paths.patch, "utf8") : "";
}

function cleanUp(state: RunState): void {
  for (const task of state.tasks ?? []) removeWorktree(state.repo, task.worktree, task.branch);
  removeWorktree(state.repo, state.worktree, state.branch);
  deleteBranches(state.repo, `neuromesh-task/${state.id}/`);
}

export interface ApplyResult {
  method: "clean" | "three-way" | "nothing";
  files: number;
}

export function applyRun(state: RunState, options: { force?: boolean; keep?: boolean } = {}): ApplyResult {
  if (state.status === "applied") throw new Error(`Run ${state.id} was already applied.`);
  if (state.status === "discarded") throw new Error(`Run ${state.id} was discarded.`);
  if (state.status === "running") throw new Error(`Run ${state.id} is still running.`);
  if (!options.force) {
    if (state.status !== "finished") {
      throw new Error(`Run ${state.id} is ${state.status}, not finished. Resume it, or use --force to apply what it has.`);
    }
    if (state.outcome?.checks === "failed") {
      throw new Error(`Run ${state.id} finished with failing checks. Review it with "neuromesh diff", then use --force to apply anyway.`);
    }
  }

  const patch = currentPatch(state);
  const paths = runPaths(state.dir);
  let result: ApplyResult = { method: "nothing", files: 0 };
  if (patch.trim() !== "") {
    const method = applyPatch(state.repo, paths.patch);
    const files = (patch.match(/^diff --git /gm) ?? []).length;
    result = { method, files };
  }

  if (!options.keep) cleanUp(state);
  state.status = "applied";
  saveState(state);
  new EventLog(paths.events, state.id).emit("run.applied", { ...result });
  return result;
}

export function discardRun(state: RunState): void {
  if (state.status === "running") throw new Error(`Run ${state.id} is still running. Stop it first.`);
  if (state.status === "applied") throw new Error(`Run ${state.id} was applied; there is nothing to discard.`);
  cleanUp(state);
  state.status = "discarded";
  saveState(state);
  new EventLog(runPaths(state.dir).events, state.id).emit("run.discarded");
}
