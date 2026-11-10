// The run's workspace: a git worktree of the user's repository, so agents never
// touch the user's own files. Changes come back as one patch the user applies.

import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { git, tryGit } from "./git.ts";

export interface RepoInfo {
  root: string;
  name: string;
  head: string;
  /** Uncommitted changes exist; they are not part of the run. */
  dirty: boolean;
}

export function findRepo(start: string): RepoInfo {
  const root = tryGit(start, "rev-parse", "--show-toplevel")?.trim();
  if (!root) {
    throw new Error(`${start} is not inside a git repository. Neuromesh needs one: run "git init" and commit first.`);
  }
  const head = tryGit(root, "rev-parse", "--verify", "HEAD")?.trim();
  if (!head) {
    throw new Error(`The repository at ${root} has no commits yet. Commit something first.`);
  }
  const status = git(root, "status", "--porcelain", "--untracked-files=normal");
  return { root: realpathSync(root), name: basename(root), head, dirty: status.trim() !== "" };
}

/** Create the worktree, or reuse it when a resumed run already has one. */
export function createWorktree(repoRoot: string, worktree: string, branch: string, base: string): void {
  if (existsSync(join(worktree, ".git"))) return;
  mkdirSync(dirname(worktree), { recursive: true });
  git(repoRoot, "worktree", "add", "--quiet", "-B", branch, worktree, base);
}

// Installed dependencies are not in git, so a fresh worktree lacks them. They
// are cloned from the user's checkout. On APFS `cp -c` makes copy-on-write
// clones, which is fast and costs almost no space. Rust's `target` folder is
// left out: it can be very large and cargo rebuilds small projects quickly.
const DEPENDENCY_DIRS = ["node_modules", ".venv", "venv"];

/** Returns the folders that were prepared, so they can be left out of the diff. */
export function prepareWorktree(repoRoot: string, worktree: string): string[] {
  const prepared: string[] = [];
  for (const dir of DEPENDENCY_DIRS) {
    const source = join(repoRoot, dir);
    const target = join(worktree, dir);
    if (!existsSync(source) || !lstatSync(source).isDirectory() || existsSync(target)) continue;
    // Only folders git ignores; anything tracked is already in the worktree.
    if (tryGit(repoRoot, "check-ignore", "-q", dir) === undefined) continue;
    try {
      execFileSync("cp", ["-cR", source, target], { stdio: "ignore" });
    } catch {
      symlinkSync(source, target);
    }
    prepared.push(dir);
  }
  return prepared;
}

export interface FileChange {
  path: string;
  insertions: number;
  deletions: number;
  binary: boolean;
}

export interface Snapshot {
  patch: string;
  files: FileChange[];
  insertions: number;
  deletions: number;
}

/**
 * Everything the agent changed since the base commit, including new files and
 * anything it committed despite being told not to.
 */
export function snapshot(worktree: string, base: string, exclude: string[] = []): Snapshot {
  // Ignored folders are skipped by git already, and git refuses to be told to
  // exclude them. Only a folder git does not ignore (a symlinked one) needs it.
  const notIgnored = exclude.filter((dir) => tryGit(worktree, "check-ignore", "-q", dir) === undefined);
  const pathspec = [".", ...notIgnored.map((dir) => `:(exclude)${dir}`)];
  git(worktree, "add", "-A", "--", ...pathspec);
  const patch = git(worktree, "diff", "--cached", "--binary", base, "--", ...pathspec);
  const numstat = git(worktree, "diff", "--cached", "--numstat", base, "--", ...pathspec);
  const files: FileChange[] = [];
  let insertions = 0;
  let deletions = 0;
  for (const line of numstat.split("\n")) {
    const [added, removed, ...rest] = line.split("\t");
    if (added === undefined || removed === undefined || rest.length === 0) continue;
    const binary = added === "-";
    const change = {
      path: rest.join("\t"),
      insertions: binary ? 0 : Number(added),
      deletions: binary ? 0 : Number(removed),
      binary,
    };
    insertions += change.insertions;
    deletions += change.deletions;
    files.push(change);
  }
  return { patch, files, insertions, deletions };
}

/** Apply a patch to the user's working tree. Falls back to a three-way merge. */
export function applyPatch(repoRoot: string, patchPath: string): "clean" | "three-way" {
  if (tryGit(repoRoot, "apply", "--check", "--whitespace=nowarn", patchPath) !== undefined) {
    git(repoRoot, "apply", "--whitespace=nowarn", patchPath);
    return "clean";
  }
  git(repoRoot, "apply", "--3way", "--whitespace=nowarn", patchPath);
  return "three-way";
}

export function removeWorktree(repoRoot: string, worktree: string, branch: string): void {
  if (existsSync(worktree)) tryGit(repoRoot, "worktree", "remove", "--force", worktree);
  tryGit(repoRoot, "worktree", "prune");
  tryGit(repoRoot, "branch", "-D", branch);
}

export function writePatch(path: string, patch: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, patch);
}
