// [F138 structural-probe] A deterministic, offline picture of a repository and the request, with no model
// call: how big the repository is, what the request names and whether it exists, how coupled the code it
// touches is, whether the work looks mechanical or holds core complexity, whether a spec or reproduction is
// already given, and how the project's tests run. Two forms of the same facts: `facts` (structured, kept in
// run.json) and `layaStateText` (plain English, under 220 tokens, with qualitative words instead of raw
// numbers, for a router that cannot compare numbers reliably).
//
// Rules it keeps:
// - It reads the request as typed (the caller passes it; F109: never the brief's prompt).
// - It only reads files: no command, script or test of the project is run. Node built-ins only.
// - It never throws and never blocks: every loop checks a deadline (500 ms by default), and a probe that runs
//   out of time returns what it found, marked `truncated`. FIFOs, sockets and links are never opened.
// - Its facts hold file paths and names (run.json is local); the event it emits and `layaStateText` hold none.

import { readdirSync, readFileSync, statSync } from "node:fs";
import type { Dirent } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { selfContained } from "./selfcontained.ts";

export type Coupling = "low" | "medium" | "high";

export interface TestRunner {
  runner: "node" | "jest" | "vitest" | "mocha" | "npm" | "pytest" | "unittest" | "cargo" | "go" | "make";
  /** The whole suite. */
  command: string;
  /** One file or test: `{file}` and `{name}` are filled in by the caller. Undefined when the runner has none. */
  single?: string;
  /** The config file it was read from. */
  from: string;
}

export interface ProbeFacts {
  version: 1;
  /** How long the probe took. */
  ms: number;
  /** The deadline was reached; the counts below are lower bounds. */
  truncated: boolean;
  /** Words in the request it was given (the typed request, never the brief's rewrite). */
  requestWords: number;
  repoFileCount: number;
  codeFileCount: number;
  skipped: { links: number; unreadable: number; binary: number; large: number };
  /** Identifiers the request names (backticked, dotted, CamelCase, snake_case, called). */
  namedSymbols: string[];
  /** Paths and file names the request names, stack-trace frames included. */
  namedFiles: string[];
  /** Each named file or symbol found in the repository, with where (a symbol: where it is defined). */
  resolvedHits: { name: string; files: string[] }[];
  unresolvedNames: string[];
  /** The files the work most likely touches (at most 15): resolved hits, else the repository's main hub. */
  candidateFiles: string[];
  /** How many other files import or name each candidate's module. */
  fanIn: { file: string; importers: number }[];
  couplingSignal: Coupling;
  couplingBasis: "named code" | "repository hub" | "none";
  /** 0 (core complexity) to 1 (mechanical); 0.5 when nothing points either way. */
  mechanicalScore: number;
  mechanicalSignals: string[];
  complexitySignals: string[];
  hasExistingSpec: boolean;
  specSignals: string[];
  /** The first runner found (Node, Python, Rust, Go, then make). */
  detectedTestCmd?: TestRunner;
  testRunners: TestRunner[];
  /** F109's one-call test passes on the request and the resolved files, and the coupling is low. */
  trivialSelfContained: boolean;
  /** F130's rule: a small repository, or a request whose names lead to one or two files. */
  skipDossier: boolean;
}

export interface Probe {
  facts: ProbeFacts;
  layaStateText: string;
}

export interface ProbeOptions {
  /** Stop looking after this long (default 500 ms). */
  deadlineMs?: number;
  /** The clock, for tests. */
  now?: () => number;
}

/** Folders never walked. */
const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", "target", "vendor", "third_party", ".venv", "venv", "__pycache__", ".tox", ".mypy_cache", ".pytest_cache", "coverage", ".next", ".cache", "out", "bower_components", ".gradle", ".idea", ".vscode", ".neuromesh"]);
export const CODE_FILE = /\.(?:[cm]?[jt]sx?|py|pyi|rs|go|java|kt|swift|rb|php|c|cc|cpp|h|hpp|cs|lua|sh|scala|ex|exs)$/i;
const MAX_FILES = 50_000;
const MAX_READ = 256 * 1024;
const MAX_CANDIDATES = 15;
/** F130's repository size below which there is no search to save. */
export const SMALL_REPO = 150;
export const MAX_LAYA_TOKENS = 220;

const SPEC_FILE = /^(spec|specs|specification|acceptance|requirements|design)(\.[\w-]+)?\.(md|txt|rst|adoc)$/i;
const ADR_DIR = /(^|\/)(adr|adrs|decisions|architecture-decisions)(\/|$)/i;
const TEST_PATH = /(^|\/)(tests?|__tests__|spec|specs)\/|(^|\/)test_[^/]*\.py$|_test\.(py|go)$|\.(test|spec)\.[cm]?[jt]sx?$/i;
const CONFIG_PATH = /\.(json|ya?ml|toml|ini|cfg|conf|env|properties|xml)$|(^|\/)(config|settings|conf)(\/|\.|$)/i;
const BOILERPLATE_PATH = /(^|\/|_|-|\.)(dto|dtos|schema|schemas|model|models|types?|entity|entities|generated|gen|migrations?|fixtures?|i18n|locales?|proto|openapi|stubs?)(\/|_|-|\.|s?$)|_pb2\.py$|\.pb\.go$|\.d\.ts$/i;
const GENERATED_HEADER = /do not edit|auto-?generated|generated by|code generated/i;

const MECHANICAL_REQUEST = /\b(rename[sd]?|renaming|move|moving|bump|typos?|reformat|format(ting)?|lint|add (a |an |the )?(new )?(field|column|property|option|flag|entry)|update (the )?(version|dependency|dependencies|copyright|docs?|readme)|replace (all|every|each)|docstrings?|comments?|upgrade)\b/i;
const COMPLEX_REQUEST = /\b(race|deadlock|concurren\w*|thread-?safe|parallel|async\w*|lock(ing|s)?|leak\w*|intermittent|flaky|parser|pars(e|ing)|tokeni[sz]\w*|grammar|state machine|transaction\w*|consisten\w*|cache invalidation|performance|optimi[sz]\w*|metaclass|recursion|recursive)\b/i;
const COMPLEX_CODE: [string, RegExp][] = [
  ["async or concurrent code", /\b(async |await |Promise\.all|asyncio|threading|Thread\(|goroutine|go func|chan |tokio::|std::thread|ExecutorService|CompletableFuture)/],
  ["locks or atomics", /\b(Mutex|RwLock|Lock\(\)|Semaphore|atomic|AtomicInteger|sync\.Mutex|synchronized|lock\.acquire)/],
  ["a state machine", /\b(state machine|transition(s|To)?\(|enum State|class \w*State\b|_state\s*=)/i],
  ["metaprogramming", /\b(metaclass|__getattr__|__new__|eval\(|exec\(|Proxy\(|Reflect\.|macro_rules!|reflect\.)/],
  ["SQL", /\b(SELECT\s+[\w*].*\bFROM\b|INSERT INTO|JOIN\s+\w+\s+ON|CREATE TABLE)/i],
  ["a parser or tokenizer", /\b(tokeni[sz]e|lexer|Lexer|parse_\w+|Parser\b|grammar|peek\(\)|advance\(\))/],
];

/** Request words that mark an explicit spec, reproduction or expected result. */
const SPEC_REQUEST: [string, RegExp][] = [
  ["acceptance criteria", /\bacceptance criteria\b|\bgiven\b[^.]{0,80}\bwhen\b[^.]{0,80}\bthen\b/i],
  ["an expected result", /\bexpected (output|result|behaviou?r)\b|\bshould (return|raise|print|output|produce)\b|\bmust (return|raise)\b|\breturns? `[^`]+`; it should\b/i],
  ["steps to reproduce", /\bsteps to reproduce\b|\bto reproduce\b|\breproduc(es|tion)\b/i],
  ["a spec or ADR", /\b(spec(ification)?|ADR|design doc(ument)?)\b/i],
  ["a named failing test", /\btest_\w+|\b\w+\.(test|spec)\.[cm]?[jt]sx?\b|\btests?\/[\w./-]+\.\w+/],
];

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

const words = (text: string): number => text.trim().split(/\s+/).filter(Boolean).length;

/** Tokens a text costs, estimated on the high side (characters / 4, or words × 1.4, whichever is more). */
export function estimateTokens(text: string): number {
  return Math.ceil(Math.max(text.length / 4, words(text) * 1.4));
}

/** Names in a request that may point at code. Files (with stack-trace frames) and symbols apart. */
export function extractNames(request: string): { files: string[]; symbols: string[] } {
  const files = new Set<string>();
  const symbols = new Set<string>();
  const addFile = (raw: string): void => {
    const f = raw.trim().replace(/^[("'`]+|[)"'`,.;:]+$/g, "").replace(/^\.\//, "");
    if (f.length >= 3 && f.length <= 200 && CODE_OR_DATA.test(f)) files.add(f);
  };
  // Stack-trace frames: Python, JavaScript, Rust and Go.
  for (const m of request.matchAll(/File "([^"]+)", line \d+/g)) addFile(m[1]!);
  for (const m of request.matchAll(/\(?((?:[A-Za-z]:)?[\w./@-]+\.\w{1,5}):\d+(?::\d+)?\)?/g)) addFile(m[1]!);
  // Paths and file names.
  for (const m of request.matchAll(/(?:^|[\s`'"(])((?:[\w@.-]+\/)*[\w.-]+\.[A-Za-z]{1,5})\b/g)) addFile(m[1]!);
  const isFileLike = (s: string): boolean => /\.[A-Za-z]{1,5}$/.test(s) && CODE_OR_DATA.test(s);
  // Symbols: backticked, called, dotted, CamelCase, snake_case.
  for (const m of request.matchAll(/`([A-Za-z_][\w.]*)(?:\([^`]*\))?`/g)) if (!isFileLike(m[1]!)) symbols.add(m[1]!);
  for (const m of request.matchAll(/\b([A-Za-z_]\w{2,})\(\)/g)) symbols.add(m[1]!);
  for (const m of request.matchAll(/\b[A-Za-z_]\w*(?:\.[A-Za-z_]\w*){1,4}\b/g)) if (!isFileLike(m[0]) && (/[A-Z_]/.test(m[0]) || m[0].split(".").length > 2)) symbols.add(m[0]);
  // CamelCase, with a leading acronym too (HTTPClient); a single capitalised word is plain English.
  for (const m of request.matchAll(/\b[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]*)+\b|\b[A-Z]{2,}[a-z][A-Za-z0-9]*\b/g)) symbols.add(m[0]);
  for (const m of request.matchAll(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g)) if (m[0].length >= 6) symbols.add(m[0]);
  return { files: [...files].sort().slice(0, 20), symbols: [...symbols].sort().slice(0, 20) };
}
const CODE_OR_DATA = /\.(?:[cm]?[jt]sx?|py|pyi|rs|go|java|kt|swift|rb|php|c|cc|cpp|h|hpp|cs|lua|sh|scala|ex|exs|json|ya?ml|toml|ini|cfg|sql|html|css|md|txt|csv|proto)$/i;

/** The module name other files import a file by. */
export function moduleStem(path: string): string {
  const base = basename(path, extname(path)).replace(/\.(d|test|spec)$/, "");
  if (["index", "__init__", "mod", "lib", "main"].includes(base)) {
    const parent = basename(dirname(path));
    return parent && parent !== "." ? parent : base;
  }
  return base;
}

/** The module names one file imports (JS/TS, Python, Rust, Go, C), as stems. */
export function importedStems(text: string): Set<string> {
  const out = new Set<string>();
  const add = (target: string): void => {
    const clean = target.replace(/\.[cm]?[jt]sx?$|\.py$|\.h$/, "");
    const parts = clean.split(/[/.:]+/).filter((p) => p && p !== "*" && p !== "crate" && p !== "self" && p !== "super");
    const last = parts[parts.length - 1];
    if (last) out.add(last);
  };
  for (const line of text.split("\n")) {
    if (line.length > 400) continue;
    let m: RegExpExecArray | null;
    if ((m = /\bfrom\s+['"]([^'"]+)['"]/.exec(line)) || (m = /\brequire\(\s*['"]([^'"]+)['"]\s*\)/.exec(line)) || (m = /^\s*import\s+['"]([^'"]+)['"]/.exec(line)) || (m = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/.exec(line))) {
      add(m[1]!);
      continue;
    }
    if ((m = /^\s*from\s+(\.*[\w.]*)\s+import\s+\(?([\w, ]+)/.exec(line))) {
      if (m[1]!.replace(/\./g, "")) add(m[1]!);
      for (const name of m[2]!.split(",")) {
        const n = name.trim().split(/\s+as\s+/)[0]!.trim();
        if (/^\w+$/.test(n)) out.add(n);
      }
      continue;
    }
    if ((m = /^\s*import\s+([\w.]+(?:\s*,\s*[\w.]+)*)/.exec(line)) && !/['"]/.test(line)) {
      for (const mod of m[1]!.split(",")) add(mod.trim());
      continue;
    }
    if ((m = /^\s*(?:pub\s+)?(?:use|mod)\s+(\w+(?:::\w+)*)(?:::\{([\w, ]+)\})?/.exec(line))) {
      for (const p of m[1]!.split("::")) if (p && !["crate", "self", "super", "std"].includes(p)) out.add(p);
      if (m[2]) for (const n of m[2].split(",")) if (n.trim()) out.add(n.trim());
      continue;
    }
    if ((m = /^\s*(?:import\s+)?(?:\w+\s+)?"([\w./-]+)"\s*$/.exec(line)) || (m = /^\s*#include\s+"([^"]+)"/.exec(line))) add(m[1]!);
  }
  return out;
}

/** The shape of a file's first lines with names, numbers and strings blanked: files made from one template share it. */
function shapeOf(text: string): string {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/^(#|\/\/|\/\*|\*)/.test(l))
    .slice(0, 6)
    .map((l) => l.replace(/(["'`]).*?\1/g, "S").replace(/\d+/g, "N").replace(/[A-Za-z_]\w*/g, "w"))
    .join("|");
}

function classifyCoupling(fanIn: number, codeFiles: number): Coupling {
  const others = Math.max(1, codeFiles - 1);
  if (fanIn >= 10 || (fanIn >= 4 && fanIn / others >= 0.5)) return "high";
  if (fanIn >= 4 || (fanIn >= 2 && fanIn / others >= 0.25)) return "medium";
  return "low";
}

function readText(full: string): { text?: string; binary?: boolean; large?: boolean } {
  try {
    const st = statSync(full);
    if (!st.isFile()) return {};
    if (st.size > MAX_READ) return { large: true };
    const buf = readFileSync(full);
    if (buf.subarray(0, 8192).includes(0)) return { binary: true };
    return { text: buf.toString("utf8") };
  } catch {
    return {};
  }
}

function readJson(full: string): Record<string, unknown> | undefined {
  const { text } = readText(full);
  if (!text) return undefined;
  try {
    const v = JSON.parse(text) as unknown;
    return v && typeof v === "object" ? (v as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** The project's test runners, from its config files only (nothing is run). */
export function detectTestRunners(dir: string, files: string[]): TestRunner[] {
  const out: TestRunner[] = [];
  const has = (f: string): boolean => files.includes(f);
  if (has("package.json")) {
    const pkg = readJson(join(dir, "package.json"));
    const scripts = (pkg?.scripts ?? {}) as Record<string, unknown>;
    const test = typeof scripts.test === "string" ? scripts.test : "";
    const pm = has("pnpm-lock.yaml") ? "pnpm" : has("yarn.lock") ? "yarn" : has("bun.lock") || has("bun.lockb") ? "bun" : "npm";
    if (test && !/no test specified/.test(test)) {
      const deps = { ...((pkg?.devDependencies ?? {}) as Record<string, unknown>), ...((pkg?.dependencies ?? {}) as Record<string, unknown>) };
      const command = `${pm} test`;
      if (/\bnode\b[^&|;]*--test\b/.test(test)) out.push({ runner: "node", command, single: "node --test {file}", from: "package.json" });
      else if (/\bvitest\b/.test(test) || "vitest" in deps) out.push({ runner: "vitest", command, single: 'npx vitest run {file} -t "{name}"', from: "package.json" });
      else if (/\bjest\b/.test(test) || "jest" in deps) out.push({ runner: "jest", command, single: 'npx jest {file} -t "{name}"', from: "package.json" });
      else if (/\bmocha\b/.test(test) || "mocha" in deps) out.push({ runner: "mocha", command, single: 'npx mocha {file} -g "{name}"', from: "package.json" });
      else out.push({ runner: "npm", command, single: `${pm} test -- {file}`, from: "package.json" });
    }
  }
  const pyConfig = ["pytest.ini", "pyproject.toml", "setup.cfg", "tox.ini", "conftest.py", "setup.py"].find((f) => has(f));
  const pyTests = files.some((f) => /(^|\/)test_[^/]*\.py$|_test\.py$/.test(f));
  if (pyConfig || pyTests) {
    const text = (f: string): string => readText(join(dir, f)).text ?? "";
    const pytest = has("pytest.ini") || has("conftest.py") || /\[tool\.pytest|pytest/.test(text("pyproject.toml")) || /\[tool:pytest\]/.test(text("setup.cfg")) || /\[pytest\]/.test(text("tox.ini")) || files.some((f) => /(^|\/)conftest\.py$/.test(f));
    const from = pyConfig ?? "test files";
    if (pytest) out.push({ runner: "pytest", command: "python -m pytest -q", single: "python -m pytest -q {file}::{name}", from });
    else if (pyTests) out.push({ runner: "unittest", command: "python -m unittest discover -v", single: "python -m unittest -v {module}.{name}", from });
  }
  if (has("Cargo.toml")) out.push({ runner: "cargo", command: "cargo test --quiet", single: "cargo test --quiet {name}", from: "Cargo.toml" });
  if (has("go.mod")) out.push({ runner: "go", command: "go test ./...", single: "go test ./{package} -run '^{name}$'", from: "go.mod" });
  if (has("Makefile") && out.length === 0 && /^test:/m.test(readText(join(dir, "Makefile")).text ?? "")) out.push({ runner: "make", command: "make test", from: "Makefile" });
  return out;
}

const SIZE_WORDS: [number, string][] = [
  [20, "a tiny repository"],
  [SMALL_REPO, "a small repository"],
  [1_000, "a medium-sized repository"],
  [10_000, "a large repository"],
  [Number.POSITIVE_INFINITY, "a very large repository"],
];

/** The facts in plain words, with no file names and no raw counts that would have to be compared. */
export function layaText(f: ProbeFacts): string {
  const size = SIZE_WORDS.find(([n]) => f.repoFileCount <= n)![1];
  const sentences: string[] = [];
  const coupling = { low: "low", medium: "moderate", high: "high" }[f.couplingSignal];
  const where = f.couplingBasis === "named code" ? "on the code the request names" : f.couplingBasis === "repository hub" ? "around the repository's most imported module" : "";
  sentences.push(`${size[0]!.toUpperCase()}${size.slice(1)}${f.codeFileCount === 0 ? " with no source code" : ""}${where ? `, with ${coupling} cross-module coupling ${where}` : ""}.`);
  const named = f.namedFiles.length + f.namedSymbols.length;
  if (named === 0) sentences.push("The request names no file, function or class; the place to change has to be found.");
  else if (f.resolvedHits.length === 0) sentences.push("The request names code, but none of it was found in the repository.");
  else if (f.unresolvedNames.length === 0) sentences.push(f.candidateFiles.length <= 2 ? "The request names code that was found, in one or two files." : "The request names code that was found, spread over several files.");
  else sentences.push("The request names code; some of it was found in the repository and some was not.");
  if (f.mechanicalScore >= 0.65) sentences.push(`The work looks mechanical: ${f.mechanicalSignals.slice(0, 2).join(" and ")}.`);
  else if (f.mechanicalScore <= 0.35) sentences.push(`The code involved holds core complexity: ${f.complexitySignals.slice(0, 3).join(", ")}.`);
  else if (f.complexitySignals.length > 0 || f.mechanicalSignals.length > 0) sentences.push(`Mixed signals: ${[...f.mechanicalSignals.slice(0, 1), ...f.complexitySignals.slice(0, 1)].join("; ")}.`);
  sentences.push(f.hasExistingSpec ? `A concrete spec is given (${f.specSignals.slice(0, 2).join(", ")}).` : "No explicit spec, reproduction or acceptance criteria is given.");
  const t = f.detectedTestCmd;
  sentences.push(t ? `Tests run with ${t.runner}${f.testRunners.length > 1 ? ` (and ${f.testRunners.length - 1} other runner${f.testRunners.length > 2 ? "s" : ""})` : ""}${t.single ? "; a single test can be targeted" : ""}.` : "No test runner was found.");
  if (f.trivialSelfContained) sentences.push("It looks small and self-contained enough for one call with no tools.");
  if (f.skipDossier) sentences.push("A scout's dossier would save no search here.");
  if (f.truncated) sentences.push("The probe ran out of time, so the repository may be larger than described.");
  // Never over the limit: drop the least useful sentences from the end.
  let text = sentences.join(" ");
  while (estimateTokens(text) >= MAX_LAYA_TOKENS && sentences.length > 1) {
    sentences.splice(sentences.length - 1, 1);
    text = sentences.join(" ");
  }
  return text;
}

function emptyFacts(request: string): ProbeFacts {
  return {
    version: 1,
    ms: 0,
    truncated: false,
    requestWords: words(request),
    repoFileCount: 0,
    codeFileCount: 0,
    skipped: { links: 0, unreadable: 0, binary: 0, large: 0 },
    namedSymbols: [],
    namedFiles: [],
    resolvedHits: [],
    unresolvedNames: [],
    candidateFiles: [],
    fanIn: [],
    couplingSignal: "low",
    couplingBasis: "none",
    mechanicalScore: 0.5,
    mechanicalSignals: [],
    complexitySignals: [],
    hasExistingSpec: false,
    specSignals: [],
    testRunners: [],
    trivialSelfContained: false,
    skipDossier: false,
  };
}

/**
 * Probe a repository for a request. `request` is the request as the person typed it. Never throws: on any
 * internal error the facts gathered so far (or empty ones) are returned, marked truncated.
 */
export function probeRepo(dir: string, request: string, options: ProbeOptions = {}): Probe {
  const now = options.now ?? Date.now;
  const started = now();
  const deadline = started + (options.deadlineMs ?? 500);
  const late = (): boolean => now() >= deadline;
  const f = emptyFacts(request);
  try {
    gather(dir, request, f, late);
  } catch {
    f.truncated = true;
  }
  f.ms = Math.max(0, now() - started);
  let text: string;
  try {
    text = layaText(f);
  } catch {
    text = "The repository could not be described.";
  }
  return { facts: f, layaStateText: text };
}

function gather(dir: string, request: string, f: ProbeFacts, late: () => boolean): void {
  // ---- 1. The walk: every file, links never followed, skipped folders never entered.
  const files: string[] = [];
  const stack: string[] = [""];
  while (stack.length > 0) {
    if (late() || files.length >= MAX_FILES) {
      f.truncated = true;
      break;
    }
    const rel = stack.pop()!;
    let entries: Dirent[];
    try {
      entries = readdirSync(join(dir, rel), { withFileTypes: true });
    } catch {
      f.skipped.unreadable += 1;
      continue;
    }
    entries.sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
    for (const e of entries) {
      const path = rel ? `${rel}/${e.name}` : e.name;
      if (e.isSymbolicLink()) f.skipped.links += 1;
      else if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) stack.push(path);
      } else if (e.isFile()) files.push(path);
    }
  }
  files.sort();
  f.repoFileCount = files.length;
  const code = files.filter((p) => CODE_FILE.test(p));
  f.codeFileCount = code.length;

  // ---- 2. What the request names.
  const names = extractNames(request);
  f.namedFiles = names.files;
  f.namedSymbols = names.symbols;
  const hits = new Map<string, Set<string>>();
  for (const name of names.files) {
    const n = name.replace(/^\/+/, "");
    const found = files.filter((p) => p === n || p.endsWith(`/${n}`) || n.endsWith(`/${p}`));
    if (found.length > 0 && found.length <= 5) hits.set(name, new Set(found));
  }

  // ---- 3. One pass over the code: imports (fan-in), definitions of named symbols, shapes, markers.
  const bare = (s: string): string => s.split(".").pop()!;
  const symbolNames = [...new Set(names.symbols.map(bare).filter((s) => /^[A-Za-z_]\w*$/.test(s)))];
  // Where a name is defined, not merely used: a keyword before it, a Go method receiver, or a top-level assignment.
  const alt = symbolNames.join("|");
  const defRe = symbolNames.length > 0 ? new RegExp(`\\b(?:def|class|function|fn|func|struct|enum|interface|type|trait|const|let|var|module)\\s+(${alt})\\b|\\bfunc\\s+\\([^)]*\\)\\s*(${alt})\\s*\\(|^\\s*(?:export\\s+)?(${alt})\\s*(?::[^=]*)?=(?![=>])`) : undefined;
  const definedIn = new Map<string, Set<string>>();
  const importers = new Map<string, Set<string>>();
  const shapes = new Map<string, number>();
  const texts = new Map<string, string>();
  let boilerplate = 0;
  for (const path of code) {
    if (late()) {
      f.truncated = true;
      break;
    }
    const r = readText(join(dir, path));
    if (r.binary) f.skipped.binary += 1;
    if (r.large) f.skipped.large += 1;
    if (r.text === undefined) continue;
    const text = r.text;
    texts.set(path, text);
    const own = moduleStem(path);
    for (const stem of importedStems(text)) {
      if (stem === own) continue;
      const set = importers.get(stem) ?? new Set<string>();
      set.add(path);
      importers.set(stem, set);
    }
    if (BOILERPLATE_PATH.test(path) || GENERATED_HEADER.test(text.slice(0, 400))) boilerplate += 1;
    const shape = shapeOf(text);
    if (shape) shapes.set(shape, (shapes.get(shape) ?? 0) + 1);
    if (defRe) {
      for (const line of text.split("\n")) {
        if (line.length > 400) continue;
        const m = defRe.exec(line);
        if (!m) continue;
        const name = m.slice(1).find(Boolean)!;
        const set = definedIn.get(name) ?? new Set<string>();
        if (set.size < 5) set.add(path);
        definedIn.set(name, set);
      }
    }
  }
  for (const symbol of names.symbols) {
    const where = definedIn.get(bare(symbol));
    // A name defined in many files says nothing about where the change goes (F130).
    if (where && where.size > 0 && where.size <= 3) hits.set(symbol, where);
  }
  f.resolvedHits = [...hits.entries()].map(([name, set]) => ({ name, files: [...set].sort() })).sort((a, b) => a.name.localeCompare(b.name));
  f.unresolvedNames = [...names.files, ...names.symbols].filter((n) => !hits.has(n)).sort();

  // ---- 4. Coupling: fan-in of the named code, else of the repository's main hub.
  const fanInOf = (file: string): number => {
    const set = importers.get(moduleStem(file));
    if (!set) return 0;
    let n = 0;
    for (const p of set) if (p !== file) n += 1;
    return n;
  };
  const named = [...new Set(f.resolvedHits.flatMap((h) => h.files))].sort();
  if (named.length > 0) {
    f.candidateFiles = named.slice(0, MAX_CANDIDATES);
    f.couplingBasis = "named code";
  } else if (code.length > 0) {
    let best: string | undefined;
    let bestN = 0;
    for (const file of code) {
      if (TEST_PATH.test(file)) continue;
      const n = fanInOf(file);
      if (n > bestN) {
        best = file;
        bestN = n;
      }
    }
    if (best) {
      f.candidateFiles = [best];
      f.couplingBasis = "repository hub";
    }
  }
  f.fanIn = f.candidateFiles.map((file) => ({ file, importers: fanInOf(file) }));
  const maxFan = Math.max(0, ...f.fanIn.map((x) => x.importers));
  f.couplingSignal = f.candidateFiles.length > 0 ? classifyCoupling(maxFan, code.length) : "low";

  // ---- 5. Mechanical or core complexity.
  const touched = f.candidateFiles.filter((p) => texts.has(p));
  if (MECHANICAL_REQUEST.test(request)) f.mechanicalSignals.push("the request asks for a rename, move, bump or similar edit");
  const touchedBoiler = touched.filter((p) => BOILERPLATE_PATH.test(p) || GENERATED_HEADER.test(texts.get(p)!.slice(0, 400)));
  if (touched.length > 0 ? touchedBoiler.length * 2 >= touched.length : code.length >= 20 && boilerplate * 2 >= code.length) f.mechanicalSignals.push("the files involved are schemas, models, config or generated code");
  const biggestShape = Math.max(0, ...shapes.values());
  if (code.length >= 20 && biggestShape >= 10 && biggestShape * 10 >= code.length * 3) f.mechanicalSignals.push("many files repeat one pattern");
  const named2 = named.length > 0 && named.every((p) => TEST_PATH.test(p) || CONFIG_PATH.test(p));
  if (named2) f.mechanicalSignals.push("the edit is confined to tests or config");
  const complexText = touched.map((p) => texts.get(p)!).join("\n");
  for (const [label, re] of COMPLEX_CODE) if (re.test(complexText)) f.complexitySignals.push(label);
  if (COMPLEX_REQUEST.test(request)) f.complexitySignals.push("the request describes a concurrency, parsing or consistency problem");
  if (f.couplingSignal === "high") f.complexitySignals.push("the code is imported across the repository");
  f.mechanicalScore = Math.round(clamp01(0.5 + 0.15 * f.mechanicalSignals.length - 0.12 * f.complexitySignals.length) * 100) / 100;

  // ---- 6. A spec, a reproduction or acceptance criteria.
  for (const [label, re] of SPEC_REQUEST) if (re.test(request)) f.specSignals.push(label);
  if (files.some((p) => !p.includes("/") && SPEC_FILE.test(p))) f.specSignals.push("a spec file at the repository root");
  if (files.some((p) => ADR_DIR.test(p) && /\.(md|rst|txt|adoc)$/i.test(p))) f.specSignals.push("architecture decision records");
  if (files.some((p) => /\.feature$/.test(p))) f.specSignals.push("Gherkin feature files");
  f.hasExistingSpec = f.specSignals.length > 0;

  // ---- 7. Test runners, from config files only.
  f.testRunners = detectTestRunners(dir, files);
  f.detectedTestCmd = f.testRunners[0];

  // ---- 8. Fast paths.
  const project = touched.map((p) => ({ path: p, content: texts.get(p)! }));
  f.trivialSelfContained = named.length > 0 && f.couplingSignal === "low" && selfContained(request, project).ok;
  f.skipDossier = f.repoFileCount <= SMALL_REPO || (named.length > 0 && named.length <= 2);
}

/** What the probe's event carries: labels and counts only, no paths or names (the record and telemetry keep none). */
export function probeSummary(p: Probe): Record<string, unknown> {
  const f = p.facts;
  return {
    ms: f.ms,
    truncated: f.truncated,
    repoFileCount: f.repoFileCount,
    codeFileCount: f.codeFileCount,
    named: f.namedFiles.length + f.namedSymbols.length,
    resolved: f.resolvedHits.length,
    coupling: f.couplingSignal,
    couplingBasis: f.couplingBasis,
    mechanicalScore: f.mechanicalScore,
    hasExistingSpec: f.hasExistingSpec,
    testRunner: f.detectedTestCmd?.runner,
    trivialSelfContained: f.trivialSelfContained,
    skipDossier: f.skipDossier,
  };
}
