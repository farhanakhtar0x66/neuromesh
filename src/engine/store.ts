// Where runs live and how their state is saved.
//
// Everything for a run is kept outside the user's repository, under
// ~/.neuromesh/projects/<repo>-<id>/runs/<run-id>/:
//   run.json      the current state; resume reads this
//   events.jsonl  everything that happened, one JSON object per line
//   worktree/     the agent's copy of the repository
//   agent/        raw event streams from the agent tools
//   checks/       full output of every check
//   diff.patch    the final change

import { createHash, randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { isOn } from "../features.ts";
import { recordLinesFor } from "../record/record.ts";
import { appendRecord } from "../record/record.ts";
import type { RunState } from "./types.ts";

export function defaultHome(): string {
  return process.env.NEUROMESH_HOME ?? join(homedir(), ".neuromesh");
}

export function projectDir(home: string, repoRoot: string): string {
  const id = createHash("sha256").update(repoRoot).digest("hex").slice(0, 8);
  return join(home, "projects", `${basename(repoRoot)}-${id}`);
}

export function runsDir(home: string, repoRoot: string): string {
  return join(projectDir(home, repoRoot), "runs");
}

export function newRunId(now = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${date}-${time}-${randomBytes(2).toString("hex")}`;
}

export function runPaths(dir: string) {
  return {
    dir,
    state: join(dir, "run.json"),
    events: join(dir, "events.jsonl"),
    worktree: join(dir, "worktree"),
    agentLogs: join(dir, "agent"),
    checkLogs: join(dir, "checks"),
    patch: join(dir, "diff.patch"),
  };
}

/** Save atomically, so a crash never leaves a half-written run.json. */
export function saveState(state: RunState): void {
  state.updatedAt = new Date().toISOString();
  const path = runPaths(state.dir).state;
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.tmp`;
  writeFileSync(temp, JSON.stringify(state, null, 2) + "\n");
  renameSync(temp, path);
}

export function loadState(dir: string): RunState {
  const path = runPaths(dir).state;
  if (!existsSync(path)) throw new Error(`No run found at ${dir}`);
  return JSON.parse(readFileSync(path, "utf8")) as RunState;
}

export function listRuns(home: string, repoRoot: string): RunState[] {
  const root = runsDir(home, repoRoot);
  if (!existsSync(root)) return [];
  const runs: RunState[] = [];
  for (const id of readdirSync(root).sort()) {
    try {
      runs.push(loadState(join(root, id)));
    } catch {
      // A folder without a readable run.json is not a run.
    }
  }
  return runs;
}

/** Find a run by full id, unique prefix, or "last". */
export function findRun(home: string, repoRoot: string, ref: string | undefined): RunState {
  const runs = listRuns(home, repoRoot);
  if (runs.length === 0) throw new Error("There are no runs for this repository yet.");
  if (ref === undefined || ref === "last") return runs[runs.length - 1]!;
  const matches = runs.filter((r) => r.id === ref || r.id.startsWith(ref) || r.id.endsWith(ref));
  if (matches.length === 1) return matches[0]!;
  if (matches.length === 0) throw new Error(`No run matches "${ref}".`);
  throw new Error(`"${ref}" matches ${matches.length} runs; use more of the id.`);
}

export interface NeuromeshEvent {
  t: string;
  run: string;
  type: string;
  [key: string]: unknown;
}

export class EventLog {
  private readonly path: string;
  private readonly run: string;
  private readonly sink?: (event: NeuromeshEvent) => void;
  /** [F108 run-record] Where the record is kept; no record when absent. */
  private readonly recordHome?: string;
  private recordBroken = false;

  constructor(path: string, run: string, sink?: (event: NeuromeshEvent) => void, recordHome?: string) {
    this.path = path;
    this.run = run;
    this.sink = sink;
    this.recordHome = recordHome;
    mkdirSync(dirname(path), { recursive: true });
    // An engine that was killed may have left its last line half written: the
    // next event starts on a line of its own, so only that one line is lost.
    try {
      const text = readFileSync(path, "utf8");
      if (text !== "" && !text.endsWith("\n")) appendFileSync(path, "\n");
    } catch {
      // No log yet.
    }
  }

  emit(type: string, data: Record<string, unknown> = {}): void {
    const event: NeuromeshEvent = { t: new Date().toISOString(), run: this.run, type, ...data };
    appendFileSync(this.path, JSON.stringify(event) + "\n");
    this.record(event);
    this.sink?.(event);
  }

  /**
   * [F108 run-record] The same event, as lines of the one record. A failure here
   * never touches the run: the record is switched off for the rest of the run
   * and the event says so, tagged with the feature.
   */
  private record(event: NeuromeshEvent): void {
    if (!this.recordHome || this.recordBroken || !isOn("run-record")) return;
    try {
      if (process.env.NEUROMESH_FAULT?.split(",").includes("run-record")) throw new Error("injected fault (NEUROMESH_FAULT)");
      appendRecord(this.recordHome, recordLinesFor(event, this.path));
    } catch (error) {
      this.recordBroken = true;
      const message = error instanceof Error ? error.message : String(error);
      const failed: NeuromeshEvent = { t: new Date().toISOString(), run: this.run, type: "feature.failed", feature: "F108", key: "run-record", message, hint: "This came from F108 run-record (src/record/record.ts). To run without it: --disable run-record, or NEUROMESH_DISABLE=run-record." };
      appendFileSync(this.path, JSON.stringify(failed) + "\n");
      this.sink?.(failed);
    }
  }
}
