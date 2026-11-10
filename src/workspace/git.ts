import { execFileSync } from "node:child_process";

const MAX_BUFFER = 256 * 1024 * 1024;

/** Run git and return its output. Throws an error that includes git's message. */
export function git(cwd: string, ...args: string[]): string {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      maxBuffer: MAX_BUFFER,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const e = error as { stderr?: string; message: string };
    const message = (e.stderr?.trim() || e.message).split("\n").slice(0, 6).join("\n");
    throw new Error(`git ${args.join(" ")} failed: ${message}`);
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
