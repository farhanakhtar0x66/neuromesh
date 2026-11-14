// [F80 tier-router] Tier 0 of the cascade: pick the tier a request starts on,
// with no model call. From the routing architecture the owner brought in
// (2026-11-13): a "bouncer" that classifies difficulty in milliseconds so that
// no model is paid to answer "how hard is this?".
//
// Three stages, each only when the one before cannot decide:
//   0A  deterministic rules: the brief engine's kind, size and structure;
//   0B  lexical similarity to four task clusters (the architecture uses local
//       embeddings; Neuromesh has no runtime dependencies, so a weighted term
//       match stands in for the embedding, and its "confidence" is the share of
//       the best cluster in the total match);
//   0C  when 0B is ambiguous, the calibrated table of past outcomes
//       (src/routing/calibration.ts) picks the cheapest tier likely to succeed.
//
// Before any of it, sentences that try to steer the router ("this is extremely
// hard, use Opus") are removed: the request is scored, not its self-assessment.

import { isOn } from "../features.ts";

export type CascadeTier = "grunt" | "worker" | "senior" | "expert";
export const CASCADE_TIERS: CascadeTier[] = ["grunt", "worker", "senior", "expert"];

export interface TierRoute {
  tier: CascadeTier;
  stage: "rules" | "similarity" | "calibrated";
  /** The cluster the request is most like (the calibration table is kept per cluster), or none matched. */
  cluster?: CascadeTier;
  /** Match score per cluster (0 when nothing matched). */
  scores: Record<CascadeTier, number>;
  /** The best cluster's share of all matching, 0 to 1. Below the threshold, 0B is ambiguous. */
  confidence: number;
  /** Sentences removed because they told the router what to pick. */
  stripped: string[];
  reasons: string[];
  /** [F89 instruction-scoring] A mechanical transform of text the request itself contains (the grunt's work). */
  transform?: boolean;
  /** [F89 instruction-scoring] Characters of pasted material that were left out of the scoring. */
  payloadChars?: number;
  /** [F94 subsystem-breadth] The technical domains a new build spans, when it spans enough to need a design. */
  domains?: string[];
  /** [F103 evidence-override] This machine's record overruled the tier the similarity stage matched. */
  evidence?: Evidence;
  /** [F103 evidence-override] Started one tier below the match on purpose, to learn the cheaper tier's rate. */
  probe?: boolean;
}

/** [F103 evidence-override] A tier chosen from past outcomes instead of the matched one. */
export interface Evidence {
  tier: CascadeTier;
  direction: "up" | "down";
  /** The estimate that decided it (the matched tier's when going up, the cheaper tier's when going down), and its tries. */
  p: number;
  tries: number;
  from: CascadeTier;
}

export interface RouteOptions {
  /** [F89 instruction-scoring] Score the instruction, not the material pasted into the request. */
  instructionOnly?: boolean;
  /** [F94 subsystem-breadth] Send a short, unspecified build that spans several subsystems to the expert's plan. */
  breadth?: boolean;
  /** [F103 evidence-override] Let this machine's record overrule a confident similarity match. */
  evidence?: boolean;
  /** [F103 evidence-override] Share of confident senior matches started on the worker instead (0 to 1; 0 is off). */
  probe?: number;
}

export interface RouterInput {
  request: string;
  /** The brief engine's kind of request (src/intake/brief.ts). */
  kind?: "trivial" | "bug" | "feature" | "refactor" | "greenfield" | "other";
  /** Words in the request and its attached documents together. */
  totalWords?: number;
  /** Files the request names. */
  namedFiles?: number;
}

/** Below this share for the best cluster, the similarity stage is ambiguous (the architecture's 0.65). */
export const AMBIGUOUS_BELOW = 0.65;

// Each cluster is the architecture's description of a tier's work, turned into
// weighted patterns for coding requests. A pattern's weight is how strongly it
// alone says "this tier".
const CLUSTERS: Record<CascadeTier, [RegExp, number][]> = {
  grunt: [
    [/\b(typos?|spelling|misspell\w*|wording|whitespace|indent\w*)\b/i, 3],
    [/\b(format(ting)?|reformat|prettier|lint(ing)?|sort (the )?imports)\b/i, 2],
    [/\b(docstrings?|comments?|jsdoc|doxygen|readme|changelog)\b/i, 2],
    [/\b(rename|bump|version number|boilerplate|scaffold)\b/i, 2],
    [/\b(convert|translate)\b.{0,40}\b(json|csv|yaml|toml|xml|markdown)\b/i, 2],
    [/\b(strip|remove|clean ?up)\b.{0,30}\b(html|logs?|whitespace|comments|unused)\b/i, 2],
    [/\b(extract|pull out)\b.{0,30}\b(fields?|emails?|urls?|entities|regex)\b/i, 1.5],
  ],
  worker: [
    [/\b(crud|endpoint|route|handler|controller)\b/i, 2],
    [/\bunit tests?\b|\btest (cases?|harness)\b|\badd tests?\b/i, 2],
    [/\b(add|new)\b.{0,20}\b(flag|option|command|subcommand|field|column|setting)\b/i, 2],
    [/\b(validate|validation|parse (the )?arguments|argparse|config(uration)? file)\b/i, 1.5],
    [/\b(summari[sz]e|summary|report)\b/i, 1],
    [/\b(script|cli|command[- ]line tool|small tool|utility|helper)\b/i, 1],
    [/\b(fix|bug)\b/i, 1],
  ],
  senior: [
    [/\b(refactor\w*|restructure|across (the )?(modules|files|codebase)|multi[- ]file)\b/i, 2.5],
    [/\b(sql|query|queries|joins?|migrations?|schema)\b/i, 2],
    [/\b(pipeline|etl|ingest\w*|data flow)\b/i, 2],
    [/\b(parser|parsing|tokeni[sz]er|lexer|grammar|state machine)\b/i, 2.5],
    [/\b(stateful|state management|cache|caching|invalidation|undo|redo)\b/i, 2],
    [/\b(debug\w*|intermittent|flaky|memory leak|regression)\b/i, 2],
    [/\b(tui|terminal ui|async|await|websocket|streaming|api integration|oauth|authentication)\b/i, 1.5],
    [/\b(edge cases?|many rules|interacting rules)\b/i, 1],
  ],
  expert: [
    [/\b(distributed|consensus|raft|paxos|replicat\w*|sharding|partition tolerance)\b/i, 3],
    [/\b(concurren\w*|race conditions?|deadlocks?|lock[- ]free|atomics?|memory (ordering|model)|thread[- ]safe\w*)\b/i, 3],
    [/\b(formal(ly)? (verif\w*|proof)|prove|invariants?|model check\w*)\b/i, 2.5],
    [/\b(novel algorithm|new algorithm|algorithm design|np[- ]hard|optimi[sz]er|query planner)\b/i, 2.5],
    [/\b(compiler|interpreter|virtual machine|garbage collector|database engine|sql engine|storage engine|b[- ]?tree)\b/i, 3],
    [/\b(architecture|architect)\b.{0,40}\b(system|service|platform)\b/i, 1.5],
    [/\b(cryptograph\w*|zero[- ]knowledge|scheduler|real[- ]time guarantees?)\b/i, 2],
  ],
};

// A sentence that tells the router what to do, rather than what to build.
const META =
  /\b(use|using|needs?|requires?|requiring|route (this |it )?to|send (this |it )?to|give (this |it )?to|with)\s+(the\s+)?(opus|sonnet|haiku|fable|gpt[-\w.]*|gemini[-\w.]*|luna|sol|frontier|expert|strongest|smartest|best|most capable|biggest)(\s+(model|tier|one))?\b|\b(this|it) is (an? )?(extremely|very|really|super|incredibly) (hard|difficult|complex|tricky)( task| problem)?\b|\b(do not|don't|never) use (a |the )?(cheap|small|weak)(er)? models?\b/i;

/** [F80 tier-router] Remove sentences that try to choose the model; returns the rest and what was removed. */
export function stripMeta(request: string): { text: string; stripped: string[] } {
  const stripped: string[] = [];
  // Line by line, so the request's line structure survives (pasted logs and data are found by their lines, F89).
  const lines = request.split("\n").map((line) => {
    const kept: string[] = [];
    for (const s of line.split(/(?<=[.!?])[ \t]+/)) {
      if (META.test(s)) stripped.push(s.trim());
      else kept.push(s);
    }
    return kept.join(" ");
  });
  return { text: lines.join("\n").trim(), stripped };
}

/** [F80 tier-router] Match score per cluster: the weights of the patterns the text matches. */
export function clusterScores(text: string): Record<CascadeTier, number> {
  const scores = { grunt: 0, worker: 0, senior: 0, expert: 0 } as Record<CascadeTier, number>;
  for (const tier of CASCADE_TIERS) for (const [re, w] of CLUSTERS[tier]) if (re.test(text)) scores[tier] += w;
  return scores;
}

export interface Calibrated {
  /** The cheapest tier whose estimated success is at least the quality bar. */
  pick(cluster: CascadeTier | undefined): { tier: CascadeTier; p: number } | undefined;
  /** [F103 evidence-override] Another tier than the matched one, when enough past runs say so. */
  evidence?(cluster: CascadeTier | undefined, tier: CascadeTier): Evidence | undefined;
}

/** [F103 evidence-override] The same request always probes or never does, so a benchmark repeats. */
export function probeDraw(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10_000) / 10_000;
}

// [F89 instruction-scoring] Material pasted into a request: data, logs, quoted messages, code.
const DATA_LINE = /^\s*(\[[\d.:\s-]+\]|\d{4}-\d\d-\d\d|[-*]\s+\S+=|\s{2,}\S|[{}\[\]]|\w[\w.-]*:\s*$|```)/;
// A quotation opens after a space, colon or bracket and closes before punctuation or a space ('react' ... 're' is not one).
const QUOTED = /(^|[\s:(])(["'“‘`])(?=\S)((?:(?!\2)[\s\S]){40,}?)\2(?=[\s.,;:!?)]|$)/g;
const FENCED = /```[\s\S]*?```/g;
/** Verbs that change the form of given text without judging it. */
const TRANSFORM = /\b(turn|convert|transform|reformat|format|rewrite|rephrase|reword|translate|extract|pull out|grab|list|collect|strip|clean ?up|dedupe|de-?duplicate|sort|normali[sz]e|tabulate|parse)\b/i;
/** Verbs that ask for judgement, analysis or new logic: not the grunt's, whatever the input. */
const JUDGEMENT = /\b(flag|summari[sz]e|analy[sz]e|explain|debug|diagnose|why|decide|prioriti[sz]e|recommend|review|fix|optimi[sz]e|refactor|design|implement|architect|prove|derive|find the|root cause|what went wrong)\b|\b(make it|add|thread[- ]?safe|concurren\w*|secure|faster|performan\w*)\b/i;
/** "dont debug it yet": a negated verb is not an instruction. */
const NEGATED = /\b(don'?t|do not|no need to|not yet|never)\s+(\w+\s+){0,2}?\w+/gi;

/**
 * [F89 instruction-scoring] Split a request into its instruction and the
 * material pasted into it (quoted text, fenced code, data and log lines, a
 * block after a line ending in a colon, data after a colon on one line).
 */
export function splitPayload(request: string): { instruction: string; payload: string } {
  const payload: string[] = [];
  let text = request.replace(FENCED, (m) => (payload.push(m), " "));
  text = text.replace(QUOTED, (m, lead: string) => (payload.push(m.slice(lead.length)), `${lead} `));
  const lines = text.split("\n");
  const kept: string[] = [];
  let block = false;
  for (const line of lines) {
    if (block && line.trim() === "") block = false;
    if (block || DATA_LINE.test(line)) {
      payload.push(line);
      continue;
    }
    if (/:\s*$/.test(line) && lines.length > 1) block = true;
    // One line: "do this to the data: <data with digits and separators>".
    const inline = line.match(/^(.{10,}?):\s+(.{40,})$/);
    const open = (x: string): number => (x.match(/\(/g) ?? []).length - (x.match(/\)/g) ?? []).length;
    if (inline && open(inline[1]!) === 0 && (inline[2]!.match(/[\d,|/;=-]/g) ?? []).length >= 6 && inlineData(inline[2]!)) {
      kept.push(inline[1]!);
      payload.push(inline[2]!);
      continue;
    }
    kept.push(line);
  }
  return { instruction: kept.join("\n").replace(/\s+/g, " ").trim(), payload: payload.join("\n").trim() };
}

// [F99 prose-guard] After "In src/x.rs:", an instruction starts with a verb; data does not.
const IMPERATIVE =
  /^\s*(please\s+)?(fix|add|cap|limit|bound|update|verify|check|implement|refactor|make|write|rewrite|change|remove|delete|rename|move|use|keep|ensure|handle|support|return|throw|replace|create|build|test|set|send|store|include|compact|fold|split|merge|convert|sort|extract|list|parse|format|turn|explain|debug|find|investigate|optimi[sz]e|document|clean|drop|guard|wrap|expose|log|cache|retry|migrate|port|translate|summari[sz]e)\b/i;
/** Digits and the punctuation of lists, tables, JSON and logs. */
const DATA_CHAR = /[\d,|/;=:{}[\]"'<>()_.-]/g;

/**
 * [F99 prose-guard] Whether the part after "instruction:" on one line is data:
 * not a sentence that starts with a verb, and mostly digits and punctuation.
 * Prose with a few numbers in it ("fix the race when capacity > 1024 and
 * consumers == 8") is the instruction itself, and must be scored.
 */
function inlineData(after: string): boolean {
  if (!isOn("prose-guard")) return true;
  if (IMPERATIVE.test(after)) return false;
  const chars = after.replace(/\s/g, "");
  return chars.length > 0 && (chars.match(DATA_CHAR) ?? []).length / chars.length >= 0.25;
}

/** [F89 instruction-scoring] A transform of given text that asks for no judgement. */
export function isTransform(instruction: string): boolean {
  const said = instruction.replace(NEGATED, " ");
  return TRANSFORM.test(said) && !JUDGEMENT.test(said);
}

// [F94 subsystem-breadth] Technical domains a build can span. A request that names three or more and
// no code file is short only because several subsystems were compressed into one sentence: nobody has
// decided their modules, interfaces or formats yet, which is the expert's work, however few the words.
const DOMAINS: [string, RegExp][] = [
  ["auth", /\b(log(s|ging)? ?in(to)?|sign(s|ing)? ?in|credentials?|oauth\w*|passwords?|jwts?|bearer|session tokens?|api keys?|authenticat\w*|authori[sz]ation|secrets?)\b/i],
  ["crypto", /\b(encrypt\w*|decrypt\w*|aes|ciphers?|hmac|key derivation|signing keys?)\b/i],
  ["network", /\b(https?|rest|apis?|webhooks?|websockets?|grpc|prox(y|ies)|peer[- ]to[- ]peer|p2p|tcp|udp|mesh|over the network|routes? \w+( \w+)? (via|through))\b/i],
  ["storage", /\b(databases?|sqlite|postgres\w*|mysql|redis|mongo\w*|cach(e|es|ing)|vector (index|store|db)|embeddings?|persist\w*|state (file|store)s?|[\w-]+\.md)\b/i],
  ["runtime", /\b(agents?|daemons?|background (service|worker|process|job)s?|schedul\w*|cron|endless\w*|forever|real[- ]time|watch(es|er|ing)|tails?|servers?)\b/i],
  ["interface", /\b(unix sockets?|sockets?|stdio|ipc|mcp|browser extensions?|cli|tui|gui|dashboards?|web ui|desktop app)\b/i],
  ["ingest", /\b(crawl\w*|scrap\w*|parser|ast|chunk\w*|stdout|stderr|log (files?|lines|streams?)|ingest\w*|streams?)\b/i],
  ["ml", /\b(llms?|ai|ml|inference|embeddings?|language models?)\b/i],
];
const BUILD_SYSTEM = /\b(build|create|make|write|develop|implement|set up)\s+(me\s+)?(a|an)\b/i;
/** The thing to build is one unit of code, however many technologies it touches. */
const ONE_UNIT = /\b(build|create|make|write|develop|implement|set up)\s+(me\s+)?(a|an)\s+(\S+\s+){0,4}?(functions?|methods?|scripts?|class(es)?|hooks?|middlewares?|endpoints?|handlers?|components?|wrappers?|quer(y|ies)|migrations?|helpers?|decorators?|tests?|regex(es)?|one-liners?|snippets?)\b/i;
/** A code file the request names: the request already says where things go. */
const CODE_FILE = /(^|[\s(`'"])[\w./-]+\.(?:[cm]?[jt]sx?|py|rs|go|java|kt|rb|php|c|cc|cpp|h|hpp|cs|swift|toml|ya?ml|sql|sh)\b/i;
const BREADTH_MIN = 3;

/** [F94 subsystem-breadth] The domains a new, unspecified build spans, or nothing when it is not one. */
export function buildBreadth(instruction: string, kind?: RouterInput["kind"]): string[] | undefined {
  if (kind === "trivial" || kind === "bug" || kind === "refactor") return undefined;
  if (!BUILD_SYSTEM.test(instruction) || ONE_UNIT.test(instruction) || CODE_FILE.test(instruction)) return undefined;
  const domains = DOMAINS.filter(([, re]) => re.test(instruction)).map(([name]) => name);
  return domains.length >= BREADTH_MIN ? domains : undefined;
}

/** [F80 tier-router] Tier 0: which tier a request starts on. */
export function routeTier(input: RouterInput, calibrated?: Calibrated, options: RouteOptions = {}): TierRoute {
  const { text: whole, stripped } = stripMeta(input.request);
  // [F89 instruction-scoring]
  const split = options.instructionOnly ? splitPayload(whole) : undefined;
  const hasPayload = split !== undefined && split.payload.length >= 40 && split.instruction.length > 0;
  const text = hasPayload ? split!.instruction.replace(NEGATED, " ") : whole;
  const scores = clusterScores(text);
  const total = CASCADE_TIERS.reduce((n, t) => n + scores[t], 0);
  // Ties go to the cheaper tier: the cascade catches an under-estimate, nothing catches waste.
  const best = CASCADE_TIERS.reduce<CascadeTier | undefined>((b, t) => (scores[t] > 0 && (b === undefined || scores[t] > scores[b]) ? t : b), undefined);
  const confidence = best && total > 0 ? scores[best] / total : 0;
  const reasons: string[] = [];
  if (stripped.length > 0) reasons.push(`ignored ${stripped.length} sentence(s) that asked for a model`);
  const base = { cluster: best, scores, confidence, stripped, ...(hasPayload ? { payloadChars: split!.payload.length } : {}) };
  if (hasPayload) reasons.push(`scored the instruction only (${split!.payload.length} characters of pasted material left out)`);

  // ---- 0A: rules.
  // [F89 instruction-scoring] Changing the form of text the request contains is the grunt's, however scary the text.
  if (hasPayload && isTransform(split!.instruction)) {
    return { ...base, tier: "grunt", stage: "rules", transform: true, reasons: [...reasons, "a mechanical transform of text the request contains: the grunt"] };
  }
  if (input.kind === "trivial") return { ...base, tier: "grunt", stage: "rules", reasons: [...reasons, "a small, mechanical change: the cheapest tier"] };
  // Very long requests are many parts: the expert plans (the brief engine's own sizes decide that); the parts route themselves.
  const words = input.totalWords ?? text.split(/\s+/).filter(Boolean).length;
  if (words >= 800 || (input.namedFiles ?? 0) >= 12) {
    return { ...base, tier: "expert", stage: "rules", reasons: [...reasons, `a large request (${words} words, ${input.namedFiles ?? 0} files named): the expert blueprints it`] };
  }
  // [F94 subsystem-breadth] Short, but several subsystems nobody has designed yet: the expert plans it too.
  const domains = options.breadth ? buildBreadth(text, input.kind) : undefined;
  if (domains) {
    return { ...base, tier: "expert", stage: "rules", domains, reasons: [...reasons, `a new build across ${domains.length} subsystems (${domains.join(", ")}) with no code file named: the expert designs and blueprints it`] };
  }

  // ---- 0B: similarity.
  if (best && confidence >= AMBIGUOUS_BELOW) {
    // Biased one step down from a grunt-only match on a request with code to write:
    // a short mechanical request is the grunt's, anything new is at least a worker's.
    const tier = best === "grunt" && (input.kind === "greenfield" || input.kind === "feature") ? "worker" : best;
    const matched = `most like ${best} work (${Math.round(confidence * 100)}% of the match)${tier !== best ? `, but it builds something: ${tier}` : ""}`;
    // [F103 evidence-override] A confident match is still only a guess about words; enough runs of this kind of work overrule it.
    const e = options.evidence ? calibrated?.evidence?.(best, tier) : undefined;
    // Not down to the grunt for something to build: that rule stands whatever the record says.
    if (e && !(e.tier === "grunt" && (input.kind === "greenfield" || input.kind === "feature"))) {
      const why = e.direction === "up" ? `the ${e.from} tier passed about ${Math.round(e.p * 100)}% of ${e.tries} such tasks here: ${e.tier}` : `the ${e.tier} tier passed about ${Math.round(e.p * 100)}% of ${e.tries} such tasks here, so it starts there`;
      return { ...base, tier: e.tier, stage: "calibrated", evidence: e, reasons: [...reasons, `${matched}; ${why}`] };
    }
    // [F103 evidence-override] Without a try now and then, the cheaper tier's rate on senior work is never learned.
    // The cascade is the safety net: a worker that fails or says the task is beyond it climbs back.
    if (tier === "senior" && (options.probe ?? 0) > 0 && probeDraw(text) < options.probe!) {
      return { ...base, tier: "worker", stage: "similarity", probe: true, reasons: [...reasons, `${matched}; a probe starts it one tier lower, on the worker, to learn whether that is enough (the cascade climbs if not)`] };
    }
    return { ...base, tier, stage: "similarity", reasons: [...reasons, matched] };
  }

  // ---- 0C: calibrated, when similarity cannot decide.
  const picked = calibrated?.pick(best);
  if (picked) {
    return { ...base, tier: picked.tier, stage: "calibrated", reasons: [...reasons, `ambiguous (${best ? `${Math.round(confidence * 100)}% ${best}` : "no cluster matched"}); past runs give ${picked.tier} a ${Math.round(picked.p * 100)}% chance`] };
  }
  // The lowest viable tier: the cascade climbs if it was too low.
  const fallback: CascadeTier = input.kind === "greenfield" ? "worker" : best === "grunt" ? "grunt" : "worker";
  return { ...base, tier: fallback, stage: "similarity", reasons: [...reasons, `ambiguous (${best ? `${Math.round(confidence * 100)}% ${best}` : "no cluster matched"}): the lowest viable tier, ${fallback}`] };
}
