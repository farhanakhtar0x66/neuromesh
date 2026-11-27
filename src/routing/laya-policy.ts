// [F139 laya-gate] The decision gate: a pure function of the probe's facts (F138) and Laya's answers.
//
// Rules (Laya 0.5 contract):
// - An answer counts only when it is conformal-decisive: route "auto", no abstention, a prediction set of
//   exactly one answer when a set is given, and a yes or no. Never a raw confidence number.
// - `unbound` is ignored here: it has a high false-positive rate and is never a reason to escalate.
// - Anything less on any of the three questions (all are required), or Laya unavailable,
//   escalates: to the expert (Opus) on a hard or unclear repository, to the senior (Sonnet) only where the
//   probe shows a small, mechanical, low-coupling edit. It never guesses "cheap".

import type { ProbeFacts } from "./probe.ts";
import type { LayaAnswer, LayaDecision, QuestionId } from "./laya-client.ts";

export type GateAction = "continue_cheap" | "escalate_sonnet" | "escalate_opus";

export interface GateResult {
  action: GateAction;
  reason: string;
  /** All three questions were answered conformal-decisively. */
  conformalAuto: boolean;
}

export interface GateContext {
  /** The tier the task is on now, for the reason only. */
  tier?: string;
}

/** The answer's yes or no, when it may be acted on; undefined otherwise. */
export function decisive(a: LayaAnswer | undefined): boolean | undefined {
  if (!a || a.route !== "auto" || a.abstain) return undefined;
  if (a.predictionSet !== undefined && a.predictionSet.length !== 1) return undefined;
  return a.value;
}

/** Hard or unclear, from the probe alone: anything but a small, low-coupling, mechanical edit to code the request names. */
export function hardOrUnclear(f: ProbeFacts | undefined): boolean {
  if (!f || f.truncated) return true;
  return f.couplingSignal !== "low" || f.mechanicalScore < 0.65 || f.resolvedHits.length === 0 || f.complexitySignals.length > 0;
}

export function evaluateGate(probe: ProbeFacts | undefined, laya: LayaDecision, context: GateContext = {}): GateResult {
  const on = context.tier ? ` (on ${context.tier})` : "";
  const conservative = (why: string): GateResult =>
    hardOrUnclear(probe)
      ? { action: "escalate_opus", reason: `${why}; the probe calls the work hard or unclear, so the expert takes it${on}`, conformalAuto: false }
      : { action: "escalate_sonnet", reason: `${why}; the probe calls it a small mechanical edit with low coupling, so the senior takes it${on}`, conformalAuto: false };
  if (laya.status !== "ok") return conservative(`Laya unavailable (${laya.reason})`);
  const get = (id: QuestionId): LayaAnswer => laya.answers[id];
  const cheap = decisive(get("cheap_will_resolve"));
  const invariants = decisive(get("has_implied_invariants"));
  const mechanical = decisive(get("is_mechanical_or_localized"));
  // All three questions are required: one that is not decisive leaves the gate to the probe alone.
  if (cheap === undefined || invariants === undefined || mechanical === undefined) {
    const which = [cheap === undefined ? "cheap_will_resolve" : "", invariants === undefined ? "has_implied_invariants" : "", mechanical === undefined ? "is_mechanical_or_localized" : ""].filter(Boolean).join(", ");
    return conservative(`Laya was not decisive on ${which} (review, abstained, or more than one answer)`);
  }
  if (cheap && !invariants) return { action: "continue_cheap", reason: `Laya (conformal, auto): the current model will resolve it and nothing is implied beyond the text${on}`, conformalAuto: true };
  const why = cheap ? "Laya (conformal, auto): the work depends on implied invariants" : "Laya (conformal, auto): the current model will not resolve it";
  if (!invariants || mechanical) return { action: "escalate_sonnet", reason: `${why}, and ${!invariants ? "nothing is implied beyond the text" : "the edit is mechanical or localized"}: the senior takes it${on}`, conformalAuto: true };
  return { action: "escalate_opus", reason: `${why}, and it depends on implied invariants: the expert takes it${on}`, conformalAuto: true };
}
