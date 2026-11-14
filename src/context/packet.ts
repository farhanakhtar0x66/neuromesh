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

// [F100 start-here] Where one task most likely begins: the definitions whose
// names match the task, as line ranges, and the body of the best match when it
// is short. The packet (F12) maps the repository once for the request; this is
// per task, from the task's own brief, and it points instead of mapping.
//
// The match is lexical, so it can be wrong. Two things follow from that: it is
// worded as a starting point, never as a boundary ("do not look elsewhere"
// would turn a wrong guess into a failed task), and when nothing matches by
// name it says nothing at all.

export interface StartHere {
  text: string;
  /** The files it points at, best first. */
  files: string[];
}

export interface StartHereOptions {
  /** Size limit in characters. */
  maxChars?: number;
  /** Most files to point at. */
  maxFiles?: number;
  /** Longest definition whose body is shown, in lines. */
  maxBodyLines?: number;
}

export const TEST_PATH = /(^|\/)(test|tests|__tests__|spec)\/|\.(test|spec)\.|_test\.|(^|\/)test_[^/]*\.py$/;
/** What a definition scores when the task names it outright, written as an identifier. */
const STRONG = 6;
/** The least a file must score to be pointed at: one definition named outright, or several weaker matches together. */
const START_MIN = 6;

/** Files the last commits touched, and files changed since the last one: where work is going on. */
function recentFiles(dir: string): Set<string> {
  const out = new Set<string>();
  const log = spawnSync("git", ["log", "-n", "15", "--name-only", "--pretty=format:"], { cwd: dir, encoding: "utf8" });
  if (log.status === 0) for (const f of log.stdout.split("\n")) if (f.trim()) out.add(f.trim());
  const status = spawnSync("git", ["status", "--porcelain"], { cwd: dir, encoding: "utf8" });
  if (status.status === 0) for (const l of status.stdout.split("\n")) if (l.length > 3) out.add(l.slice(3).trim());
  return out;
}

/**
 * [F100 start-here] The words of a task, by how much a match on them says.
 * Strong: written like an identifier (compactNotes, max_size, `flush`,
 * render()), which a person only types when they mean that definition. Plain:
 * ordinary words, which also name things by accident ("entry", "layout").
 */
export function leadTerms(request: string): { strong: Set<string>; plain: Set<string> } {
  const strong = new Set<string>();
  for (const m of request.matchAll(/`([A-Za-z_$][\w$]*)`|\b([A-Za-z_$][\w$]*)\s*\(|\b([A-Za-z]+[a-z][A-Z]\w*|[A-Za-z]\w*_\w+)\b/g)) {
    const word = (m[1] ?? m[2] ?? m[3])!.toLowerCase();
    if (word.length >= 4) strong.add(word);
  }
  const plain = new Set(terms(request).filter((w) => !strong.has(w)));
  return { strong, plain };
}

/**
 * [F100 start-here] The definitions in `dir` that `request` most likely means,
 * or undefined when none matches by name (an empty repository, or a request
 * that names nothing in it).
 */
export function startHere(dir: string, request: string, options: StartHereOptions = {}): StartHere | undefined {
  const maxChars = options.maxChars ?? 2_500;
  const maxFiles = options.maxFiles ?? 3;
  const maxBody = options.maxBodyLines ?? 60;
  const { strong, plain } = leadTerms(request);
  const named = new Set((request.match(/[\w./-]+\.[A-Za-z]{1,5}\b/g) ?? []).map((n) => n.replace(/^\.\//, "")));
  if (strong.size === 0 && plain.size === 0 && named.size === 0) return undefined;
  const recent = recentFiles(dir);

  interface Hit { file: FileInfo; score: number; symbols: { sym: SymbolLine; score: number }[]; named: boolean }
  const hits: Hit[] = [];
  for (const file of scanRepo(dir)) {
    if (language(file.path) === undefined) continue;
    const base = file.path.slice(file.path.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "").toLowerCase();
    // The task gives the file's path, or one of its words is the file's own name.
    const isNamed = named.has(file.path) || [...named].some((n) => file.path.endsWith(`/${n}`));
    const isCalled = base.length >= 5 && (strong.has(base) || plain.has(base));
    const symbols = file.symbols
      .map((sym) => {
        const name = sym.name.toLowerCase();
        let s = 0;
        for (const w of strong) s += name === w ? STRONG : name.includes(w) ? STRONG / 2 : 0;
        for (const w of plain) s += name === w ? STRONG / 2 : w.length >= 5 && name.includes(w) ? STRONG / 4 : 0;
        return { sym, score: s };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || a.sym.line - b.sym.line);
    if (!isNamed && !isCalled && symbols.length === 0) continue;
    const path = file.path.toLowerCase();
    let s = (isNamed ? 50 : 0) + (isCalled ? 8 : 0) + symbols.slice(0, 3).reduce((n, x) => n + x.score, 0) + [...strong, ...plain].filter((w) => path.includes(w)).length * 2;
    // Recent work breaks ties between files that match; it is not a match by itself.
    if (recent.has(file.path)) s += 1;
    if (TEST_PATH.test(file.path) && !isNamed) s *= 0.6;
    hits.push({ file, score: s, symbols, named: isNamed || isCalled });
  }
  hits.sort((a, b) => b.score - a.score || a.file.path.localeCompare(b.file.path));
  // A lead is a file that clears the bar by itself and is not far behind the best one: next to a definition
  // the task names outright, a file that only shares two ordinary words with it is noise.
  const best = hits[0]?.score ?? 0;
  const top = hits.filter((h) => h.score >= START_MIN && h.score >= best * 0.67).slice(0, maxFiles);
  if (top.length === 0) return undefined;

  const out: string[] = ["Start here (Neuromesh matched these to your task by name, with no model call; they are where to look first, not a limit on where you may look):"];
  let used = out[0]!.length;
  const add = (line: string): boolean => {
    if (used + line.length + 1 > maxChars) return false;
    out.push(line);
    used += line.length + 1;
    return true;
  };
  let shown: { path: string; start: number; lines: string[] } | undefined;
  for (const hit of top) {
    const full = join(dir, hit.file.path);
    const text = existsSync(full) ? readFileSync(full, "utf8") : "";
    if (hit.symbols.length === 0) {
      // Named by the task, nothing in it matched by name: its first definitions.
      const first = hit.file.symbols.slice(0, 4).map((s) => `${s.name} (${s.line})`).join(", ");
      if (!add(`- ${hit.file.path} [${hit.file.lines} lines]${first ? `: ${first}` : ""}`)) break;
      continue;
    }
    for (const { sym } of hit.symbols.slice(0, 3)) {
      const body = symbolBody(hit.file.path, text, sym.name);
      const end = body ? body.start + body.lines.length - 1 : sym.line;
      if (!add(`- ${hit.file.path}:${sym.line}-${end}  ${sym.text}`)) break;
      // The body only of a definition the task names outright: lines spent on a weaker guess are wasted more often than not.
      if (!shown && body && body.lines.length <= maxBody && hit.symbols[0]!.score >= STRONG && sym === hit.symbols[0]!.sym) shown = { path: hit.file.path, start: body.start, lines: body.lines };
    }
  }
  if (out.length === 1) return undefined;
  if (shown) {
    const lines = shown;
    const block = [`\n${lines.path}:${lines.start}-${lines.start + lines.lines.length - 1}, as it is now:`, "```", ...lines.lines.map((l, i) => `${lines.start + i}: ${l}`), "```"].join("\n");
    if (used + block.length + 1 <= maxChars) out.push(block);
  }
  return { text: out.join("\n"), files: top.map((h) => h.file.path) };
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
