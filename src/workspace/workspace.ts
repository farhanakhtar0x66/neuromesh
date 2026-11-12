// The run's workspace: a git worktree of the user's repository, so agents never
// touch the user's own files. Changes come back as one patch the user applies.

import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
    // A copy, so the agent's changes never reach the user's own folder:
    // copy-on-write where the system can (macOS `cp -c`, GNU `--reflink=auto`),
    // else a plain copy. A link to the original is the last resort.
    const tries = process.platform === "darwin" ? [["-cR"], ["-R"]] : [["-R", "--reflink=auto"], ["-R"]];
    let copied = false;
    for (const flags of tries) {
      try {
        execFileSync("cp", [...flags, source, target], { stdio: "ignore" });
        copied = true;
        break;
      } catch {
        rmSync(target, { recursive: true, force: true });
      }
    }
    if (!copied) symlinkSync(source, target);
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

// ---- Team runs: task branches merged into one integration branch ----

const ENGINE_IDENTITY = ["-c", "user.name=Neuromesh", "-c", "user.email=neuromesh@localhost", "-c", "commit.gpgsign=false"];

export function headCommit(worktree: string): string {
  return git(worktree, "rev-parse", "HEAD").trim();
}

/** Commit everything the agent changed (except copied dependency folders). Returns the new HEAD. */
export function commitAll(worktree: string, message: string, exclude: string[] = []): string {
  const notIgnored = exclude.filter((dir) => tryGit(worktree, "check-ignore", "-q", dir) === undefined);
  git(worktree, "add", "-A", "--", ".", ...notIgnored.map((dir) => `:(exclude)${dir}`));
  if (git(worktree, "diff", "--cached", "--name-only").trim() !== "") {
    git(worktree, ...ENGINE_IDENTITY, "commit", "-q", "--no-verify", "-m", message);
  }
  return headCommit(worktree);
}

/** Merge a task branch into the integration worktree. On a conflict nothing is changed. */
export function mergeBranch(worktree: string, branch: string, message: string): "merged" | "conflict" {
  try {
    git(worktree, ...ENGINE_IDENTITY, "merge", "--no-ff", "--no-verify", "-q", "-m", message, branch);
    return "merged";
  } catch {
    tryGit(worktree, "merge", "--abort");
    return "conflict";
  }
}

/** Put a worktree back to a commit, keeping ignored files such as copied dependencies. */
export function resetTo(worktree: string, commit: string): void {
  git(worktree, "reset", "-q", "--hard", commit);
  git(worktree, "clean", "-q", "-fd");
}

/** A throwaway checkout of a commit, for the tester. */
export function createDetachedWorktree(repoRoot: string, path: string, commit: string): void {
  if (existsSync(path)) tryGit(repoRoot, "worktree", "remove", "--force", path);
  mkdirSync(dirname(path), { recursive: true });
  git(repoRoot, "worktree", "add", "--quiet", "--detach", path, commit);
}

export function removeDetachedWorktree(repoRoot: string, path: string): void {
  if (existsSync(path)) tryGit(repoRoot, "worktree", "remove", "--force", path);
  tryGit(repoRoot, "worktree", "prune");
}

/** Delete every branch under a prefix, such as a run's task branches. */
export function deleteBranches(repoRoot: string, prefix: string): void {
  const list = tryGit(repoRoot, "for-each-ref", "--format=%(refname:short)", `refs/heads/${prefix}`) ?? "";
  for (const branch of list.split("\n").filter(Boolean)) tryGit(repoRoot, "branch", "-D", branch);
}

/** Paths changed by a diff that fall outside the owned paths (prefixes or simple globs). */
export function outsideOwned(files: string[], owned: string[]): string[] {
  if (owned.length === 0) return [];
  const matchers = owned.map((pattern) => {
    const clean = pattern.replace(/^\.\//, "").replace(/\/+$/, "");
    if (/[*?]/.test(clean)) {
      const regex = new RegExp(
        "^" + clean.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\u0000/g, ".*").replace(/\?/g, ".") + "$",
      );
      return (path: string) => regex.test(path);
    }
    return (path: string) => path === clean || path.startsWith(`${clean}/`);
  });
  return files.filter((f) => !matchers.some((m) => m(f)));
}

/** Do two sets of owned paths possibly touch the same files? */
export function ownedOverlap(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) return true;
  const norm = (p: string): string => p.replace(/^\.\//, "").replace(/\/+$/, "").replace(/\*.*$/, "");
  return a.some((x) => b.some((y) => {
    const p = norm(x);
    const q = norm(y);
    return p === "" || q === "" || p === q || p.startsWith(q.endsWith("/") ? q : `${q}/`) || q.startsWith(p.endsWith("/") ? p : `${p}/`) || (/[*?]/.test(x) && q.startsWith(p)) || (/[*?]/.test(y) && p.startsWith(q));
  }));
}
