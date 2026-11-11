// [F22 tui-mentions] [F23 tui-history] Repository files for @ mentions, fuzzy
// matching, and the prompt history kept between sessions.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { trackedFiles } from "../context/packet.ts";

/**
 * Score `candidate` against `query` as a subsequence match; higher is better,
 * undefined when not every query character appears in order. Matches at the
 * start, after a separator, and in a row score more; shorter candidates win ties.
 */
export function fuzzy(query: string, candidate: string): number | undefined {
  const q = query.toLowerCase();
  const c = candidate.toLowerCase();
  if (q === "") return 0;
  let score = 0;
  let at = -1;
  let streak = 0;
  for (const ch of q) {
    const i = c.indexOf(ch, at + 1);
    if (i < 0) return undefined;
    streak = i === at + 1 ? streak + 1 : 0;
    score += 1 + streak * 2 + (i === 0 || "/._- ".includes(c[i - 1] ?? "") ? 3 : 0);
    at = i;
  }
  // A match in the file name itself counts more than one spread over folders.
  const base = c.slice(c.lastIndexOf("/") + 1);
  if (base.includes(q)) score += 10;
  return score - c.length * 0.01;
}

export function bestMatches<T>(query: string, items: T[], key: (item: T) => string, limit = 8): T[] {
  return items
    .map((item) => ({ item, score: fuzzy(query, key(item)) }))
    .filter((x): x is { item: T; score: number } => x.score !== undefined)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.item);
}

/** The repository's files, read once and refreshed after each run. */
export class FileIndex {
  private files: string[] | undefined;
  private readonly root: string | undefined;

  constructor(root: string | undefined) {
    this.root = root;
  }

  list(): string[] {
    if (!this.root) return [];
    this.files ??= trackedFiles(this.root);
    return this.files;
  }

  refresh(): void {
    this.files = undefined;
  }
}

/** Earlier requests, newest last, shared by every TUI session on this machine. */
export class History {
  private readonly path: string;
  private items: string[];
  /** Where Up/Down are in the list; undefined when not browsing. */
  private at: number | undefined;
  private draft = "";

  constructor(home: string) {
    this.path = join(home, "history.json");
    try {
      const raw = existsSync(this.path) ? (JSON.parse(readFileSync(this.path, "utf8")) as unknown) : [];
      this.items = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
    } catch {
      this.items = [];
    }
  }

  add(prompt: string): void {
    const p = prompt.trim();
    if (!p) return;
    this.items = [...this.items.filter((x) => x !== p), p].slice(-200);
    this.at = undefined;
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(this.path, JSON.stringify(this.items, null, 1) + "\n");
    } catch {
      // History is a convenience; a write failure must not disturb the session.
    }
  }

  get browsing(): boolean {
    return this.at !== undefined;
  }

  /** The previous request, keeping the current draft to come back to. */
  previous(current: string): string | undefined {
    if (this.items.length === 0) return undefined;
    if (this.at === undefined) {
      this.draft = current;
      this.at = this.items.length;
    }
    if (this.at === 0) return undefined;
    this.at -= 1;
    return this.items[this.at];
  }

  next(): string | undefined {
    if (this.at === undefined) return undefined;
    this.at += 1;
    if (this.at >= this.items.length) {
      this.at = undefined;
      return this.draft;
    }
    return this.items[this.at];
  }

  stop(): void {
    this.at = undefined;
  }
}
