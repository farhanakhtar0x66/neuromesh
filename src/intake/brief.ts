// The brief engine: turn a request as typed into the instruction the agents
// work from, and decide the staffing. No model call happens here.
//
// It does four things, all by rule:
//   1. cleans the request (greetings, filler, stray whitespace);
//   2. attaches documents the request points at, so every agent reads the same thing;
//   3. adds working standards that fit the kind of request (what a careful
//      engineer would do without being told);
//   4. decides the staffing: plan or not, how many workers, which worker rung
//      starts, whether a tester reviews, and whether the request is too thin to
//      build from (then a cheap model writes a product spec first).

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export type Kind = "trivial" | "bug" | "feature" | "refactor" | "greenfield" | "other";
export type Surface = "tui" | "cli" | "web" | "library";

export interface RepoFacts {
  /** Tracked files, relative to the repository root. */
  files: string[];
  /** A tracked text file's content, or undefined when missing or too large. */
  read: (path: string) => string | undefined;
  /** Language runtimes found on this machine, e.g. "node 26.13.0". */
  runtimes: string[];
}

export interface Staffing {
  /** The expert plans the work first. */
  plan: boolean;
  /** Most workers at once. */
  agents: number;
  /** Which worker rung starts: the cheapest, or the strongest. */
  rung: "first" | "top";
  /** A tester reviews each task. */
  tester: boolean;
  /** The request is too thin to build from; a cheap model writes a product spec first. */
  spec: boolean;
  reasons: string[];
}

export interface Spec {
  name: string;
  summary: string;
  features: string[];
  behaviour: string[];
  outOfScope: string[];
}

export interface Brief {
  kind: Kind;
  surface?: Surface;
  /** The request after cleaning. */
  request: string;
  attached: { path: string; text: string }[];
  standards: string[];
  staffing: Staffing;
  spec?: Spec;
}

export interface BriefPolicy {
  /** A team preset: the expert may plan. */
  team: boolean;
  maxParallel: number;
  /** A model is available to write a spec for a thin request. */
  canSpec: boolean;
}

const CODE_FILE = /\.(?:[cm]?[jt]sx?|py|rs|go|java|kt|swift|rb|php|c|cc|cpp|h|hpp|cs|lua|sh|zig|ex|exs|hs|ml|scala)$/i;
const DOC_FILE = /[\w./-]+\.(?:md|markdown|txt|rst)\b/gi;
const NAMED_FILE = /[\w./-]+\.(?:[jt]sx?|py|rs|go|md|json|toml|ya?ml|css|html)\b/g;
const MAX_ATTACHMENT = 40_000;

const SMALL_CHANGE =
  /\b(typos?|spelling|misspell\w*|wording|whitespace|indentation|bump (the )?version|default (port|value|timeout)|change (the )?[\w' -]{1,40} from\b.{1,40}\bto\b)/i;
const DOC_ONLY = /\b(typos?|spelling|misspell\w*|wording)\b/i;
const BUILD_NEW =
  /\b(build|create|make|write|develop)\s+(me\s+)?(a|an)\s+(new\s+)?[^.\n]{0,60}\b(app|application|tool|program|game|website|site|cli|tui|library|package|server|service|bot|clone|script|utility)\b/i;
const BUG = /\b(bugs?|fix(es|ed)?|(is|are|it'?s|seems|still) broken|regression|doesn'?t work|not working|off[- ]by[- ]one)\b/i;
const REFACTOR = /\b(refactor\w*|restructure|clean ?up|simplify|extract|rename|reorgani[sz]e|deduplicate|split\b.{0,40}\binto\b)\b/i;
const FEATURE = /\b(add|adds|implement|support|introduce|extend|allow|enable|new (command|option|flag|function|method|endpoint|field))\b/i;

const TUI = /\b(tui|terminal ui|terminal app\w*|terminal[- ]based|in (the |a )?terminal|curses|ncurses|text user interface|full[- ]?screen terminal)\b/i;
const CLI = /\b(cli|command[- ]line|subcommands?|argv|--[a-z][\w-]+)\b/i;
const WEB = /\b(web ?app|website|web page|browser|html|react|vue|svelte|frontend|front-end)\b/i;
const LIBRARY = /\b(library|package|module|sdk)\b/i;

/** Remove what carries no instruction: greetings, pleading, filler, stray whitespace. */
export function cleanRequest(prompt: string): string {
  let text = prompt.replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
  // Leading greetings and requests-to-request.
  for (let i = 0; i < 4; i++) {
    const before = text;
    text = text
      .replace(/^(hey|hi|hello|yo|ok|okay|so|um+|well)\b[\s,!.:-]*/i, "")
      .replace(/^(please|pls|plz|kindly)\b[\s,]*/i, "")
      .replace(/^(can|could|would|will) (you|u)( please| pls)?\b[\s,]*/i, "")
      .replace(/^(i|we) (want|need|would like|'d like)( you)? to\b[\s,]*/i, "")
      .replace(/^(i|we) (want|need|would like|'d like)\b[\s,]*(?=(a|an|the)\b)/i, "build ")
      .replace(/^(help me|go ahead and|just)\b[\s,]*/i, "");
    if (text === before) break;
  }
  // Trailing sign-offs.
  for (let i = 0; i < 4; i++) {
    const before = text;
    text = text.replace(/[\s,!.]*\b(thanks|thank you|thx|ty|cheers|lol|lmao|asap|please|pls|plz)[\s!.?]*$/i, "").trimEnd();
    if (text === before) break;
  }
  text = text.replace(/([!?])\1+/g, "$1").replace(/[ \t]{2,}/g, " ").trim();
  if (text.length === 0) return prompt.trim();
  const first = text[0]!;
  if (/[a-z]/.test(first) && !/^[\w./-]+\.\w+\b/.test(text)) text = first.toUpperCase() + text.slice(1);
  if (/[A-Za-z0-9)`"']$/.test(text) && !text.includes("\n")) text += ".";
  return text;
}

function words(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function attachments(request: string, facts: RepoFacts): { path: string; text: string }[] {
  const found: { path: string; text: string }[] = [];
  for (const raw of new Set(request.match(DOC_FILE) ?? [])) {
    const path = raw.replace(/^\.\//, "");
    if (!facts.files.includes(path) || found.some((f) => f.path === path)) continue;
    // A README or changelog is usually something to edit, not instructions:
    // attach it only when the request says to follow it.
    if (/(^|\/)(readme|changelog|license|contributing)\b/i.test(path)) {
      const at = request.indexOf(raw);
      if (!/(follow\w*|according to|described in|as per|steps in|outlined in|listed in)\s+(the\s+)?\S{0,12}$/i.test(request.slice(Math.max(0, at - 60), at))) continue;
    }
    const text = facts.read(path);
    if (text !== undefined && text.trim().length > 0) found.push({ path, text: text.trim() });
  }
  return found;
}

function classify(request: string, everything: string, facts: RepoFacts): Kind {
  const hasCode = facts.files.some((f) => CODE_FILE.test(f));
  const small = words(request) <= 60 && SMALL_CHANGE.test(request) && !BUILD_NEW.test(request);
  if (!hasCode) return small && DOC_ONLY.test(request) ? "trivial" : "greenfield";
  if (small) return "trivial";
  if (BUILD_NEW.test(request) && !BUG.test(request)) return "greenfield";
  if (BUG.test(everything)) return "bug";
  if (REFACTOR.test(everything)) return "refactor";
  if (FEATURE.test(everything)) return "feature";
  return "other";
}

function surfaceOf(text: string): Surface | undefined {
  if (TUI.test(text)) return "tui";
  if (WEB.test(text)) return "web";
  if (CLI.test(text)) return "cli";
  if (LIBRARY.test(text)) return "library";
  return undefined;
}

const STACK_NAMED =
  /\b(node(\.?js)?|javascript|typescript|deno|bun|python|rust|cargo|golang|go\b(?= (program|module|binary))|java|kotlin|swift|ruby|php|c\+\+|c#|zig|elixir|haskell|bash|shell script|ratatui|curses|blessed|ink|textual|bubble ?tea)\b/i;

function standardsFor(kind: Kind, surface: Surface | undefined, everything: string, facts: RepoFacts): string[] {
  const s: string[] = [];
  if (kind === "trivial") {
    s.push("Change only what the request names. Do not tidy or reformat anything else.");
    return s;
  }
  if (kind === "bug") {
    s.push("Find the cause before changing code, and fix the cause, not the symptom.");
    s.push("Add or extend a test that fails without the fix, in the project's existing test setup.");
    s.push("Keep the change small. Behaviour the request does not mention must stay as it is.");
    return s;
  }
  if (kind === "refactor") {
    s.push("Behaviour must not change: the existing tests pass before and after, unedited unless the request says otherwise.");
    s.push("Update every caller, import and document that refers to what moved or was renamed.");
    return s;
  }
  if (kind === "feature" || kind === "other") {
    s.push("Follow the project's existing structure, naming and style.");
    s.push("Cover the new behaviour with tests in the project's existing test setup, including the edge cases the request states.");
    s.push("Behaviour the request does not mention must stay as it is.");
    return s;
  }

  // Greenfield.
  const hasCode = facts.files.some((f) => CODE_FILE.test(f));
  if (hasCode) {
    s.push("Use the language, structure and style the project already has.");
  } else if (!STACK_NAMED.test(everything)) {
    const node = facts.runtimes.find((r) => r.startsWith("node "));
    const python = facts.runtimes.find((r) => r.startsWith("python3 "));
    const pick = node
      ? `Node.js (${node.split(" ")[1]} is installed) with no dependencies outside the standard library`
      : python
        ? `Python 3 (${python.split(" ")[1]} is installed) with the standard library only`
        : undefined;
    if (pick) s.push(`The request names no language. Use ${pick}, so it runs here with nothing to install.`);
  } else {
    s.push("Use the language and tools the request names. Keep dependencies few, and only ones that install without extra setup.");
  }
  s.push("One documented command starts it. Write a README.md with that command, what the program does and how to use it.");
  s.push("Keep the logic (state, rules, calculations, parsing) in plain modules separate from input and output, and unit-test those modules.");
  s.push("Provide a test command that runs with no setup (for Node, a `test` script in package.json using `node --test`), and make it pass.");
  s.push("No network access at run time; ship any data the program needs.");
  s.push("Bad input must give a clear message, never a stack trace.");
  if (surface === "tui") {
    s.push("Restore the terminal on every way out (normal quit, Ctrl-C, an unexpected error): leave raw mode, show the cursor, leave the alternate screen.");
    s.push("Redraw correctly when the terminal is resized. Work fully at 80x24 and do not crash at smaller sizes.");
    s.push("Show the available keys on screen. Every screen must offer a visible way to continue and to quit.");
    s.push("Build each screen as a function from state to text, so it can be tested without a terminal.");
    s.push("When standard input is not a terminal, exit with a clear message instead of crashing.");
    s.push("Draw without flicker: update the screen in one write per frame, and use colour so that it stays readable without it.");
  } else if (surface === "cli") {
    s.push("Support --help, print errors to standard error, and exit non-zero on failure.");
  } else if (surface === "web") {
    s.push("It must work by opening or serving the files locally, with no build step unless the request asks for one.");
  }
  return s;
}

/** Sizes above which the expert plans. Measured so far: planning lost on every request below these. */
const PLAN_NUMBERED = 12;
const PLAN_WORDS = 800;
const PLAN_FILES = 12;

function staff(kind: Kind, request: string, everything: string, attached: number, policy: BriefPolicy): Staffing {
  const reasons: string[] = [];
  const total = words(everything);
  const numbered = (everything.match(/^\s*\d+[.)]\s/gm) ?? []).length;
  const files = new Set(everything.match(NAMED_FILE) ?? []).size;

  let plan = false;
  if (policy.team && kind !== "trivial") {
    if (numbered >= PLAN_NUMBERED) {
      plan = true;
      reasons.push(`${numbered} numbered parts: the expert plans it`);
    } else if (total >= PLAN_WORDS) {
      plan = true;
      reasons.push(`a ${total}-word request: the expert plans it`);
    } else if (files >= PLAN_FILES) {
      plan = true;
      reasons.push(`${files} files named: the expert plans it`);
    }
  }
  if (!plan) reasons.push(policy.team ? "one worker starts; the expert steps in only if it gets stuck" : "one agent does the work");

  const rung: Staffing["rung"] = kind === "greenfield" ? "top" : "first";
  reasons.push(rung === "top" ? "building something new: the strongest worker rung starts" : "the cheapest worker rung starts and climbs if it gets stuck");

  const tester = kind !== "trivial";
  reasons.push(tester ? "a tester reviews the work" : "a small change: no tester");

  const lines = (request.match(/^\s*(?:[-*]|\d+[.)])\s/gm) ?? []).length;
  const thin = kind === "greenfield" && attached === 0 && words(request) < 60 && lines < 3;
  const spec = thin && policy.canSpec;
  if (thin) reasons.push(spec ? "a short request for something new: a cheap model writes a product spec first" : "a short request for something new, and no model is set up to write a spec");

  return { plan, agents: plan ? Math.max(1, policy.maxParallel) : 1, rung, tester, spec, reasons };
}

export function buildBrief(prompt: string, facts: RepoFacts, policy: BriefPolicy): Brief {
  const request = cleanRequest(prompt);
  const attached = attachments(request, facts);
  const everything = [request, ...attached.map((a) => a.text)].join("\n\n");
  const kind = classify(request, everything, facts);
  const surface = surfaceOf(everything);
  return {
    kind,
    surface,
    request,
    attached,
    standards: standardsFor(kind, surface, everything, facts),
    staffing: staff(kind, request, everything, attached.length, policy),
  };
}

/** The instruction every agent of the run works from. */
export function renderBrief(brief: Brief): string {
  const parts: string[] = [brief.request];
  for (const a of brief.attached) {
    parts.push(`The file ${a.path}, which the request refers to:\n--- ${a.path} ---\n${a.text}\n--- end of ${a.path} ---`);
  }
  if (brief.spec) {
    const list = (items: string[]): string => items.map((i) => `- ${i}`).join("\n");
    const spec = brief.spec;
    parts.push(
      [
        "Product spec, worked out from the short request above (the request wins wherever they differ):",
        spec.name ? `Working name: ${spec.name}` : "",
        spec.summary,
        spec.features.length > 0 ? `Must have:\n${list(spec.features)}` : "",
        spec.behaviour.length > 0 ? `Exact behaviour:\n${list(spec.behaviour)}` : "",
        spec.outOfScope.length > 0 ? `Out of scope, do not build:\n${list(spec.outOfScope)}` : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
    );
  }
  if (brief.standards.length > 0) {
    parts.push(`Working standards (part of the job; the request wins wherever it says otherwise):\n${brief.standards.map((s) => `- ${s}`).join("\n")}`);
  }
  return parts.join("\n\n");
}

function version(command: string, args: string[]): string | undefined {
  const r = spawnSync(command, args, { encoding: "utf8", timeout: 5_000 });
  if (r.status !== 0) return undefined;
  return `${r.stdout}${r.stderr}`.match(/\d+\.\d+(?:\.\d+)?/)?.[0];
}

let runtimeCache: string[] | undefined;

/** Language runtimes on this machine. Looked up once per process. */
export function detectRuntimes(): string[] {
  if (runtimeCache) return runtimeCache;
  const found: string[] = [];
  const probes: [string, string, string[]][] = [
    ["node", process.execPath, ["--version"]],
    ["python3", "python3", ["--version"]],
    ["cargo", "cargo", ["--version"]],
    ["go", "go", ["version"]],
  ];
  for (const [name, command, args] of probes) {
    const v = version(command, args);
    if (v) found.push(`${name} ${v}`);
  }
  runtimeCache = found;
  return found;
}

/** Facts about a repository at its last commit. */
export function repoFacts(root: string, runtimes = detectRuntimes()): RepoFacts {
  const r = spawnSync("git", ["ls-files"], { cwd: root, encoding: "utf8" });
  const files = r.status === 0 ? r.stdout.split("\n").filter(Boolean) : [];
  return {
    files,
    runtimes,
    read: (path) => {
      const full = join(root, path);
      if (!files.includes(path) || !existsSync(full)) return undefined;
      if (statSync(full).size > MAX_ATTACHMENT) return undefined;
      return readFileSync(full, "utf8");
    },
  };
}
