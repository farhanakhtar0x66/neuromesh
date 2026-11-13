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
}

export interface RouteOptions {
  /** [F89 instruction-scoring] Score the instruction, not the material pasted into the request. */
  instructionOnly?: boolean;
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
    if (inline && open(inline[1]!) === 0 && (inline[2]!.match(/[\d,|/;=-]/g) ?? []).length >= 6) {
      kept.push(inline[1]!);
      payload.push(inline[2]!);
      continue;
    }
    kept.push(line);
  }
  return { instruction: kept.join("\n").replace(/\s+/g, " ").trim(), payload: payload.join("\n").trim() };
}

/** [F89 instruction-scoring] A transform of given text that asks for no judgement. */
export function isTransform(instruction: string): boolean {
  const said = instruction.replace(NEGATED, " ");
  return TRANSFORM.test(said) && !JUDGEMENT.test(said);
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

  // ---- 0B: similarity.
  if (best && confidence >= AMBIGUOUS_BELOW) {
    // Biased one step down from a grunt-only match on a request with code to write:
    // a short mechanical request is the grunt's, anything new is at least a worker's.
    const tier = best === "grunt" && (input.kind === "greenfield" || input.kind === "feature") ? "worker" : best;
    return { ...base, tier, stage: "similarity", reasons: [...reasons, `most like ${best} work (${Math.round(confidence * 100)}% of the match)${tier !== best ? `, but it builds something: ${tier}` : ""}`] };
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
