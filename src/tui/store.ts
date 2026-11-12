// [F34 tui-projects] [F45 tui-settings] What the TUI keeps between sessions:
// its settings, the owner's named projects, and an index of every session
// (run) in every folder. Kept under ~/.neuromesh/tui/. Nothing here touches a
// project's own folder, except that deleting a session removes the run's
// checkouts (its branches stay, so the work can still be found).

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { RunState } from "../engine/types.ts";

export type Verbosity = "none" | "medium" | "full";
export type Access = "normal" | "turbo";

export interface Settings {
  /** Paint no backgrounds, for a see-through terminal. */
  transparent: boolean;
  theme: "terminal" | "github";
  motion: boolean;
  fps: 60 | 120;
  verbose: Verbosity;
  /** [F39 ask-first] Normal asks before the plan and the expert; Turbo goes ahead. */
  access: Access;
  mouse: boolean;
  sidebar: boolean;
  info: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  transparent: false,
  theme: "terminal",
  motion: true,
  fps: 60,
  verbose: "medium",
  access: "normal",
  mouse: true,
  sidebar: true,
  info: true,
};

const dir = (home: string): string => join(home, "tui");

function readJson<T>(path: string): T | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return undefined;
  }
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.tmp`;
  writeFileSync(temp, JSON.stringify(value, null, 2) + "\n");
  renameSync(temp, path);
}

export function loadSettings(home: string): Settings {
  const saved = readJson<Partial<Settings>>(join(dir(home), "settings.json")) ?? {};
  const s = { ...DEFAULT_SETTINGS, ...saved };
  // Whatever is in the file, only known values are used.
  if (s.fps !== 60 && s.fps !== 120) s.fps = 60;
  if (!["none", "medium", "full"].includes(s.verbose)) s.verbose = "medium";
  if (s.access !== "normal" && s.access !== "turbo") s.access = "normal";
  if (s.theme !== "terminal" && s.theme !== "github") s.theme = "terminal";
  return s;
}

export function saveSettings(home: string, s: Settings): void {
  writeJson(join(dir(home), "settings.json"), s);
}

// ---------------------------------------------------------------------------
// Projects: a name for a folder.

export interface Project {
  name: string;
  path: string;
}

export interface ProjectsFile {
  projects: Project[];
  /** Folded lists in the sidebar: the whole Projects or Recents section, or one project. */
  folded: string[];
}

export function loadProjects(home: string): ProjectsFile {
  const f = readJson<Partial<ProjectsFile>>(join(dir(home), "projects.json")) ?? {};
  return {
    projects: (f.projects ?? []).filter((p) => typeof p?.name === "string" && typeof p?.path === "string"),
    folded: Array.isArray(f.folded) ? f.folded.filter((x) => typeof x === "string") : [],
  };
}

export function saveProjects(home: string, f: ProjectsFile): void {
  writeJson(join(dir(home), "projects.json"), f);
}

// ---------------------------------------------------------------------------
// Sessions: every run in every folder.

export interface SessionRecord {
  id: string;
  title: string;
  status: string;
  /** Last change (ISO time). */
  at: string;
  files?: number;
  /** The repository the run worked on. */
  repo: string;
  /** Where its record is. */
  dir: string;
  preset: string;
}

export const titleOf = (r: Pick<RunState, "request" | "prompt">): string =>
  (r.request ?? r.prompt).split("\n").find((l) => l.trim())?.trim() ?? "(empty request)";

export function recordOf(r: RunState): SessionRecord {
  return { id: r.id, title: titleOf(r), status: r.status, at: r.updatedAt, files: r.outcome?.files.length, repo: r.repo, dir: r.dir, preset: r.preset };
}

const cache = new Map<string, { mtime: number; record: SessionRecord }>();

/** Every session under ~/.neuromesh, newest first. Run records are read only when they changed. */
export function allSessions(home: string): SessionRecord[] {
  const root = join(home, "projects");
  if (!existsSync(root)) return [];
  const out: SessionRecord[] = [];
  for (const project of safeList(root)) {
    const runs = join(root, project, "runs");
    for (const id of safeList(runs)) {
      const path = join(runs, id, "run.json");
      try {
        const mtime = statSync(path).mtimeMs;
        const hit = cache.get(path);
        if (hit && hit.mtime === mtime) {
          out.push(hit.record);
          continue;
        }
        const record = recordOf(JSON.parse(readFileSync(path, "utf8")) as RunState);
        cache.set(path, { mtime, record });
        out.push(record);
      } catch {
        // Not a run, or a damaged one: left out.
      }
    }
  }
  return out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

function safeList(path: string): string[] {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}

/**
 * Delete a session: its checkouts are removed from the repository's worktree
 * list (the branches stay), and its record moves to ~/.neuromesh/trash, where
 * it can still be found.
 */
export function trashSession(home: string, s: SessionRecord): string {
  const state = readJson<RunState>(join(s.dir, "run.json"));
  const trees = [state?.worktree, ...(state?.tasks ?? []).map((t) => t.worktree)].filter((w): w is string => typeof w === "string" && existsSync(w));
  for (const w of trees) spawnSync("git", ["-C", s.repo, "worktree", "remove", "--force", w], { stdio: "ignore" });
  const target = join(home, "trash", `${basename(dirname(dirname(s.dir)))}-${s.id}`);
  mkdirSync(dirname(target), { recursive: true });
  renameSync(s.dir, target);
  spawnSync("git", ["-C", s.repo, "worktree", "prune"], { stdio: "ignore" });
  cache.delete(join(s.dir, "run.json"));
  return target;
}

/** The current branch of a repository, if it has one. */
export function branchOf(repo: string | undefined): string | undefined {
  if (!repo) return undefined;
  const r = spawnSync("git", ["-C", repo, "rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" });
  const b = r.status === 0 ? r.stdout.trim() : "";
  return b && b !== "HEAD" ? b : undefined;
}
