// [F139 laya-gate] A zero-dependency client for a local Laya sidecar (`laya-serve`, Apache-2.0, run by the
// owner; docs/29-laya-sidecar.md). Neuromesh is MIT and never imports Laya or its optional noncommercial
// calibration package: it only speaks HTTP to a process on this machine.
//
// One request per decision asks three typed yes/no questions about the probe's plain-English state text
// (F138's layaStateText, which holds no code and no file names). The answers keep Laya 0.5's conformal fields
// (route, abstain, prediction_set, unbound); the gate (laya-policy.ts) acts only on route "auto" with no
// abstention and a single-answer prediction set.
//
// Fail-safe: a refused connection, a timeout, an HTTP error, an oversized or malformed body, or the feature
// being off all give `{ status: "unavailable", route: "review", reason }`. Nothing here throws, and a sidecar
// found down is not asked again for a while, so a run never stalls on it.
//
// The wire format (paths, request body, answer list) is in two functions, layaRequestBody and
// parseLayaResponse. It follows the field names of the Laya 0.5 contract as given to us (2026-11-28); the
// paths and the request shape are not published anywhere we could check, so they are configurable and must be
// checked against the owner's laya-serve before live use (docs/29).

import { isOn } from "../features.ts";

export type QuestionId = "is_mechanical_or_localized" | "has_implied_invariants" | "cheap_will_resolve";

export interface LayaQuestion {
  id: QuestionId;
  type: "noul";
  question: string;
}

/** The three questions, in a fixed order and wording: the same text every call, so answers stay comparable. */
export const ROUTING_QUESTIONS: readonly LayaQuestion[] = [
  { id: "is_mechanical_or_localized", type: "noul", question: "Is this task a localized, mechanical, or boilerplate edit with explicit requirements and no hidden cross-module invariants?" },
  { id: "has_implied_invariants", type: "noul", question: "Does resolving this task correctly depend on unstated edge cases, subtle cross-module invariants, or architectural judgement beyond what is written?" },
  { id: "cheap_will_resolve", type: "noul", question: "Based on the repository structure and observed progress so far, will the current lower-tier model resolve this cleanly without looping or missing hidden tests?" },
];

export interface LayaAnswer {
  id: QuestionId;
  /** The yes/no answer; undefined when Laya said it does not know (or gave a set of more than one answer). */
  value?: boolean;
  route: "auto" | "review";
  abstain: boolean;
  /** Laya 0.5's conformal set, when given. */
  predictionSet?: unknown[];
  /** Kept for the record only: never a reason to escalate by itself (many false positives). */
  unbound?: boolean;
  /** The answer carried Laya 0.5's conformal fields (route and abstain). */
  conformal: boolean;
}

export type LayaDecision =
  | { status: "ok"; answers: Record<QuestionId, LayaAnswer>; version?: string; ms: number }
  | { status: "unavailable"; route: "review"; reason: string; ms: number };

export interface LayaConfig {
  url: string;
  apiKey?: string;
  timeoutMs: number;
  healthPath: string;
  askPath: string;
  /** Trust Laya 0.3/0.4 answers (no conformal fields) as "auto": only when the owner has calibrated them. */
  legacyCalibrated: boolean;
  /** How long a health result is kept. */
  healthTtlMs: number;
}

const MAX_BODY = 64 * 1024;

function positive(raw: string | undefined, fallback: number): number {
  const n = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Configuration from the environment. */
export function layaConfig(env: NodeJS.ProcessEnv = process.env): LayaConfig {
  return {
    url: (env.NEUROMESH_LAYA_URL || "http://127.0.0.1:8787").replace(/\/+$/, ""),
    apiKey: env.NEUROMESH_LAYA_API_KEY || undefined,
    timeoutMs: positive(env.NEUROMESH_LAYA_TIMEOUT_MS, 500),
    healthPath: env.NEUROMESH_LAYA_HEALTH_PATH || "/health",
    askPath: env.NEUROMESH_LAYA_ASK_PATH || "/v1/ask",
    legacyCalibrated: env.NEUROMESH_LAYA_LEGACY_CALIBRATED === "1",
    healthTtlMs: positive(env.NEUROMESH_LAYA_HEALTH_TTL_MS, 30_000),
  };
}

/** The request body: the state text and the three typed questions. */
export function layaRequestBody(stateText: string): Record<string, unknown> {
  return { context: stateText, questions: ROUTING_QUESTIONS.map((q) => ({ id: q.id, type: q.type, question: q.question })) };
}

const obj = (v: unknown): Record<string, unknown> | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined);

/** A yes/no value from the forms Laya may give it; undefined for "unknown" or anything else. */
function noulValue(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "yes" || s === "true") return true;
    if (s === "no" || s === "false") return false;
  }
  return undefined;
}

/**
 * The answers in a response body, checked strictly. Laya 0.5: each answer has route and abstain (and
 * usually prediction_set and unbound). Laya 0.3/0.4 (no route or abstain): taken as "review" unless
 * `legacyCalibrated`. Missing questions, wrong types or an unknown route make the whole response unusable.
 */
export function parseLayaResponse(body: unknown, config: Pick<LayaConfig, "legacyCalibrated">, ms = 0): LayaDecision {
  const bad = (reason: string): LayaDecision => ({ status: "unavailable", route: "review", reason: `malformed response: ${reason}`, ms });
  const root = obj(body);
  if (!root) return bad("not a JSON object");
  // The answers as a list ([{id, ...}]) or keyed by question id ({id: {...}}).
  const raw = root.answers;
  const list: Record<string, unknown>[] = [];
  if (Array.isArray(raw)) {
    for (const a of raw) {
      const o = obj(a);
      if (!o) return bad("an answer is not an object");
      list.push(o);
    }
  } else if (obj(raw)) {
    for (const [id, a] of Object.entries(obj(raw)!)) {
      const o = obj(a);
      if (!o) return bad(`answer ${id} is not an object`);
      list.push({ id, ...o });
    }
  } else return bad("no answers");
  const answers = {} as Record<QuestionId, LayaAnswer>;
  for (const q of ROUTING_QUESTIONS) {
    const a = list.find((x) => x.id === q.id);
    if (!a) return bad(`no answer to ${q.id}`);
    const conformal = "route" in a || "abstain" in a;
    let predictionSet: unknown[] | undefined;
    if ("prediction_set" in a) {
      if (!Array.isArray(a.prediction_set)) return bad(`${q.id}: prediction_set is not a list`);
      predictionSet = a.prediction_set;
    }
    if ("unbound" in a && typeof a.unbound !== "boolean") return bad(`${q.id}: unbound is not true or false`);
    let value = noulValue(a.noul ?? a.value ?? a.choice);
    if (value === undefined && predictionSet?.length === 1) value = noulValue(predictionSet[0]);
    if (conformal) {
      if (a.route !== "auto" && a.route !== "review") return bad(`${q.id}: route is ${JSON.stringify(a.route)}`);
      if (typeof a.abstain !== "boolean") return bad(`${q.id}: abstain is not true or false`);
      answers[q.id] = { id: q.id, value, route: a.route, abstain: a.abstain, predictionSet, unbound: a.unbound as boolean | undefined, conformal: true };
    } else {
      // Laya 0.3/0.4: no conformal guarantee, so a person (or a stronger model) reviews, unless the owner calibrated it.
      answers[q.id] = { id: q.id, value, route: config.legacyCalibrated && value !== undefined ? "auto" : "review", abstain: value === undefined, predictionSet, unbound: a.unbound as boolean | undefined, conformal: false };
    }
  }
  const version = typeof root.version === "string" ? root.version : undefined;
  return { status: "ok", answers, ...(version ? { version } : {}), ms };
}

export type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export class LayaClient {
  private health?: { ok: boolean; at: number; reason?: string };
  readonly config: LayaConfig;
  private readonly fetchImpl: Fetch;
  private readonly now: () => number;
  constructor(config: LayaConfig = layaConfig(), fetchImpl: Fetch = fetch as unknown as Fetch, now: () => number = Date.now) {
    this.config = config;
    this.fetchImpl = fetchImpl;
    this.now = now;
  }

  private headers(json: boolean): Record<string, string> {
    return { ...(json ? { "content-type": "application/json" } : {}), accept: "application/json", ...(this.config.apiKey ? { authorization: `Bearer ${this.config.apiKey}` } : {}) };
  }

  /** One HTTP call, with the timeout covering the body too. Never throws. */
  private async call(path: string, body?: unknown): Promise<{ ok: true; status: number; text: string } | { ok: false; reason: string }> {
    const signal = AbortSignal.timeout(this.config.timeoutMs);
    try {
      const res = await this.fetchImpl(`${this.config.url}${path}`, { method: body === undefined ? "GET" : "POST", headers: this.headers(body !== undefined), ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal });
      const text = await res.text();
      if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
      if (text.length > MAX_BODY) return { ok: false, reason: `response over ${MAX_BODY} bytes` };
      return { ok: true, status: res.status, text };
    } catch (error) {
      const e = error as { name?: string; cause?: { code?: string }; message?: string };
      if (e?.name === "TimeoutError" || e?.name === "AbortError" || signal.aborted) return { ok: false, reason: `no answer within ${this.config.timeoutMs} ms` };
      return { ok: false, reason: e?.cause?.code ?? e?.message ?? String(error) };
    }
  }

  /** Is the sidecar up? The result (either way) is kept for `healthTtlMs`, so a down sidecar costs one check per window. */
  async isAvailable(): Promise<boolean> {
    if (this.health && this.now() - this.health.at < this.config.healthTtlMs) return this.health.ok;
    const r = await this.call(this.config.healthPath);
    this.health = { ok: r.ok, at: this.now(), ...(r.ok ? {} : { reason: r.reason }) };
    return r.ok;
  }

  /** Ask the three routing questions about the state text in one request. Never throws, never waits past the timeout. */
  async decideRouting(stateText: string): Promise<LayaDecision> {
    const started = this.now();
    const unavailable = (reason: string): LayaDecision => ({ status: "unavailable", route: "review", reason, ms: Math.max(0, this.now() - started) });
    try {
      if (!isOn("laya-gate")) return unavailable("F139 laya-gate is off");
      // A sidecar found down recently is not asked again until the health result expires.
      if (this.health && !this.health.ok && this.now() - this.health.at < this.config.healthTtlMs) return unavailable(`Laya was unavailable (${this.health.reason ?? "down"}); not asked again yet`);
      const r = await this.call(this.config.askPath, layaRequestBody(stateText));
      if (!r.ok) {
        this.health = { ok: false, at: this.now(), reason: r.reason };
        return unavailable(r.reason);
      }
      this.health = { ok: true, at: this.now() };
      let body: unknown;
      try {
        body = JSON.parse(r.text);
      } catch {
        return unavailable("malformed response: not JSON");
      }
      return parseLayaResponse(body, this.config, Math.max(0, this.now() - started));
    } catch (error) {
      return unavailable(`client error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
