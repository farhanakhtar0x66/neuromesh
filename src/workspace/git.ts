import { execFileSync } from "node:child_process";

const MAX_BUFFER = 256 * 1024 * 1024;

/**
 * Git refused because something else holds one of its lock files: an agent's
 * own git command in the same repository, or another Neuromesh run. Such a
 * lock is held for moments, so the command is tried again.
 */
const LOCKED = /\.lock': File exists|Unable to create '.*\.lock'|cannot lock ref|could not lock|Another git process seems to be running/i;
const LOCK_WAITS_MS = [120, 300, 700, 1_500];

function pause(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Run git and return its output. Throws an error that includes git's message. */
export function git(cwd: string, ...args: string[]): string {
  for (let attempt = 0; ; attempt++) {
    try {
      return execFileSync("git", args, {
        cwd,
        encoding: "utf8",
        maxBuffer: MAX_BUFFER,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      const e = error as { stderr?: string; message: string };
      const wait = LOCK_WAITS_MS[attempt];
      if (wait !== undefined && LOCKED.test(e.stderr ?? "")) {
        pause(wait);
        continue;
      }
      const message = (e.stderr?.trim() || e.message).split("\n").slice(0, 6).join("\n");
      throw new Error(`git ${args.join(" ")} failed: ${message}`);
    }
  }
}

/** Run git and return its output, or undefined if it failed. */
export function tryGit(cwd: string, ...args: string[]): string | undefined {
  try {
    return git(cwd, ...args);
  } catch {
    return undefined;
  }
}
