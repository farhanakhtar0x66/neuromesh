// [F12 context-packet] A compact picture of a repository for the agents, made
// with no model call: a map of its files and the signatures most relevant to
// the request, within a fixed size. Agents get it in their first prompt, so
// they spend fewer turns (and tokens) listing directories and reading whole
// files to find their way. This is the dependency-free cousin of the
// tree-sitter and LSP slicer from the earlier Rust research (M1): regular
// expressions per language instead of a parser, which is enough for a map.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";

export interface SymbolLine {
  line: number;
  text: string;
  name: string;
}

export interface FileInfo {
  path: string;
  lines: number;
  symbols: SymbolLine[];
}

const SKIP = /(^|\/)(node_modules|dist|build|target|vendor|\.venv|venv|__pycache__|\.git|coverage)\/|(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|poetry\.lock)$|\.(png|jpe?g|gif|ico|svg|woff2?|ttf|pdf|zip|gz|lock|map|min\.js)$/i;
const MAX_FILE_BYTES = 200_000;

// One pattern per language: a definition line, and the name it defines.
const PATTERNS: Record<string, RegExp[]> = {
  js: [
    /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/,
    /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/,
    /^\s*(?:export\s+)?(?:interface|type|enum)\s+([A-Za-z_$][\w$]*)/,
    /^\s*export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/,
    /^\s*(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/,
    /^\s{2,4}(?:static\s+|async\s+|get\s+|set\s+|public\s+|private\s+|protected\s+)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::\s*[^{]+)?\{\s*$/,
  ],
  py: [/^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/, /^\s*class\s+([A-Za-z_]\w*)/],
  rs: [/^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)/, /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:struct|enum|trait|type|mod)\s+([A-Za-z_]\w*)/, /^\s*impl(?:<[^>]*>)?\s+(?:[\w:<>]+\s+for\s+)?([A-Za-z_]\w*)/],
  go: [/^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/, /^type\s+([A-Za-z_]\w*)/],
};

function language(path: string): string | undefined {
  const ext = extname(path).toLowerCase();
  if ([".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".mts", ".cts"].includes(ext)) return "js";
  if (ext === ".py") return "py";
  if (ext === ".rs") return "rs";
  if (ext === ".go") return "go";
  return undefined;
}

const KEYWORDS = new Set(["if", "for", "while", "switch", "catch", "return", "function", "constructor", "else"]);

export function symbolsOf(path: string, text: string): SymbolLine[] {
  const lang = language(path);
  if (!lang) return [];
  const out: SymbolLine[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    for (const pattern of PATTERNS[lang]!) {
      const m = pattern.exec(line);
      if (m && !KEYWORDS.has(m[1]!)) {
        out.push({ line: i + 1, name: m[1]!, text: line.trim().replace(/\s*\{\s*$/, "").slice(0, 160) });
        break;
      }
    }
  }
  return out;
}

export function trackedFiles(dir: string): string[] {
  const r = spawnSync("git", ["ls-files", "-co", "--exclude-standard"], { cwd: dir, encoding: "utf8" });
  if (r.status !== 0) return [];
  return [...new Set(r.stdout.split("\n").filter((f) => f && !SKIP.test(f)))].sort();
}

export function scanRepo(dir: string): FileInfo[] {
  const files: FileInfo[] = [];
  for (const path of trackedFiles(dir)) {
    const full = join(dir, path);
    if (!existsSync(full)) continue;
    const size = statSync(full).size;
    if (size > MAX_FILE_BYTES) {
      files.push({ path, lines: -1, symbols: [] });
      continue;
    }
    const text = readFileSync(full, "utf8");
    if (text.includes("\u0000")) continue;
    files.push({ path, lines: text.split("\n").length, symbols: symbolsOf(path, text) });
  }
  return files;
}

/** Words from the request worth matching: identifiers, file names, and plain words of 4+ letters. */
export function terms(request: string): string[] {
  const words = request.match(/[A-Za-z_][\w.-]*/g) ?? [];
  const stop = new Set(["the", "and", "that", "this", "with", "from", "into", "when", "then", "than", "should", "must", "every", "each", "make", "sure", "also", "they", "them", "their", "there", "which", "what", "have", "does", "only", "were", "will", "your", "about", "after", "before", "file", "files", "code", "function", "test", "tests"]);
  const out = new Set<string>();
  for (const w of words) {
    const lower = w.toLowerCase().replace(/[.-]+$/, "");
    if (lower.length < 4 || stop.has(lower)) continue;
    out.add(lower);
    // camelCase and snake_case parts as well.
    for (const part of w.split(/(?=[A-Z])|_|\./)) if (part.length >= 4) out.add(part.toLowerCase());
  }
  return [...out];
}

function score(file: FileInfo, words: string[], named: Set<string>): number {
  if (named.has(file.path) || [...named].some((n) => file.path.endsWith(`/${n}`))) return 1000;
  const path = file.path.toLowerCase();
  let s = 0;
  for (const w of words) {
    if (path.includes(w)) s += 5;
    for (const sym of file.symbols) if (sym.name.toLowerCase().includes(w)) s += 2;
  }
  if (/(^|\/)(test|tests|__tests__|spec)\//.test(path) || /\.(test|spec)\./.test(path)) s *= 0.6;
  return s;
}

export interface PacketOptions {
  /** Size limit in characters (about four per token). */
  maxChars?: number;
}

/**
 * The packet for `request` in the repository at `dir`, or undefined for an
 * empty repository (nothing to map yet).
 */
export function buildPacket(dir: string, request: string, options: PacketOptions = {}): string | undefined {
  const maxChars = options.maxChars ?? 8_000;
  const files = scanRepo(dir);
  const code = files.filter((f) => language(f.path) !== undefined);
  if (files.length === 0 || (code.length === 0 && files.length <= 2)) return undefined;

  const words = terms(request);
  const named = new Set((request.match(/[\w./-]+\.[A-Za-z]{1,5}\b/g) ?? []).map((n) => n.replace(/^\.\//, "")));
  const ranked = [...files].map((f) => ({ f, s: score(f, words, named) })).sort((a, b) => b.s - a.s || a.f.path.localeCompare(b.f.path));

  const out: string[] = [];
  let used = 0;
  const add = (line: string): boolean => {
    if (used + line.length + 1 > maxChars) return false;
    out.push(line);
    used += line.length + 1;
    return true;
  };

  // Definitions in the files most relevant to the request first: about two thirds of the budget.
  const relevant = ranked.filter(({ f, s }) => f.symbols.length > 0 && s > 0);
  const rest = ranked.filter(({ f, s }) => f.symbols.length > 0 && s === 0);
  const defsBudget = Math.floor(maxChars * 0.65);
  if (relevant.length + rest.length > 0) add(`Definitions${relevant.length > 0 ? ", files most relevant to the request first" : ""} (line: signature):`);
  outer: for (const { f } of [...relevant, ...rest]) {
    if (used > defsBudget || !add(f.path)) break;
    for (const sym of f.symbols.slice(0, 40)) {
      if (used > defsBudget || !add(`  ${sym.line}: ${sym.text}`)) break outer;
    }
  }

  // Then the layout, folder by folder, with line counts.
  add(`\nLayout (${files.length} files; [lines]):`);
  const byDir = new Map<string, FileInfo[]>();
  for (const f of files) {
    const dir = f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/") + 1) : "./";
    byDir.set(dir, [...(byDir.get(dir) ?? []), f]);
  }
  const rank = new Map(ranked.map(({ f, s }, i) => [f.path, s > 0 ? i : ranked.length + i]));
  const dirs = [...byDir.entries()].sort((a, b) => Math.min(...a[1].map((f) => rank.get(f.path)!)) - Math.min(...b[1].map((f) => rank.get(f.path)!)));
  let left = 0;
  for (const [dir, list] of dirs) {
    const names = list.map((f) => `${f.path.slice(dir === "./" ? 0 : dir.length)}${f.lines >= 0 ? ` [${f.lines}]` : ""}`);
    const shown = names.length > 12 ? [...names.slice(0, 12), `+${names.length - 12} more`] : names;
    if (!add(`${dir} ${shown.join(", ")}`)) {
      left += 1;
    }
  }
  if (left > 0) out.push(`(${left} more folders not shown)`);
  return out.join("\n");
}

/** The body of a symbol: from its definition line to the end of its block. */
export function symbolBody(path: string, text: string, name: string): { start: number; lines: string[] } | undefined {
  const sym = symbolsOf(path, text).find((s) => s.name === name);
  if (!sym) return undefined;
  const lines = text.split("\n");
  const start = sym.line - 1;
  const lang = language(path);
  if (lang === "py") {
    const indent = /^\s*/.exec(lines[start]!)![0].length;
    let end = start + 1;
    while (end < lines.length && (lines[end]!.trim() === "" || /^\s*/.exec(lines[end]!)![0].length > indent)) end++;
    return { start: sym.line, lines: lines.slice(start, end) };
  }
  let depth = 0;
  let opened = false;
  for (let i = start; i < lines.length; i++) {
    for (const ch of lines[i]!.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, "")) {
      if (ch === "{") {
        depth++;
        opened = true;
      } else if (ch === "}") depth--;
    }
    if ((opened && depth <= 0) || (!opened && i > start + 3)) return { start: sym.line, lines: lines.slice(start, i + 1) };
  }
  return { start: sym.line, lines: lines.slice(start) };
}
