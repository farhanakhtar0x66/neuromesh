// [F19 tui] What the TUI shows, built only from the engine's own events and
// run records: nothing is guessed. Unknown numbers stay unknown.

import { formatEvent } from "../cli/format.ts";
import type { NeuromeshEvent } from "../engine/store.ts";
import type { RunState } from "../engine/types.ts";
import { estimateCost } from "../usage/prices.ts";
import { stripAnsi } from "./text.ts";
import type { Tone } from "./theme.ts";

export type Stage = "idle" | "planning" | "building" | "checking" | "reviewing" | "finished" | "failed" | "stopped" | "paused";

export interface Item {
  kind: "you" | "neuromesh" | "activity" | "note" | "error" | "outcome";
  text: string;
  tone?: Tone;
}

export interface AgentView {
  key: string;
  role: string;
  task?: string;
  model: string;
  working: boolean;
  turns: number;
  tokens: number;
  /** Estimated cost; undefined when not priced. */
  cost?: number;
  last?: string;
  failed?: boolean;
}

export interface Model {
  screen: "landing" | "workspace";
  repo?: string;
  repoError?: string;
  preset: string;
  items: Item[];
  agents: Map<string, AgentView>;
  stage: Stage;
  planned: boolean;
  runId?: string;
  run?: RunState;
  startedAt?: number;
  endedAt?: number;
  cost: number;
  expertCost: number;
  costUnknown: boolean;
  focus: "composer" | "outcome" | "diff";
  diff?: { lines: string[]; scroll: number };
  scroll: number;
  toast?: { text: string; tone: Tone; until: number };
  confirm?: "stop" | "discard" | "quit";
  rating?: number;
}

export function newModel(preset: string, repo?: string, repoError?: string): Model {
  return { screen: "landing", preset, repo, repoError, items: [], agents: new Map(), stage: "idle", planned: false, cost: 0, expertCost: 0, costUnknown: false, focus: "composer", scroll: 0 };
}

export function toast(m: Model, text: string, tone: Tone = "jade", ms = 4_000): void {
  m.toast = { text, tone, until: Date.now() + ms };
}

/** Start a new run in the workspace: the user's words appear at once, before any model answers. */
export function submitted(m: Model, prompt: string): void {
  m.screen = "workspace";
  m.items.push({ kind: "you", text: prompt });
  m.stage = "planning";
  m.planned = false;
  m.agents = new Map();
  m.run = undefined;
  m.runId = undefined;
  m.startedAt = Date.now();
  m.endedAt = undefined;
  m.cost = 0;
  m.expertCost = 0;
  m.costUnknown = false;
  m.focus = "composer";
  m.rating = undefined;
  m.scroll = 0;
}

const ROLE_NAME: Record<string, string> = { orchestrator: "Planner", escalation: "Expert", worker: "Worker", tester: "Tester", briefer: "Spec writer" };

function agentKey(e: NeuromeshEvent): string {
  return `${String(e.role ?? "agent")}${e.task ? `:${String(e.task)}` : ""}`;
}

function totalTokens(u: Record<string, number | undefined> | undefined): number {
  return u ? (u.input ?? 0) + (u.output ?? 0) + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0) : 0;
}

/** Fold one engine event into the model. */
export function applyEvent(m: Model, e: NeuromeshEvent): void {
  if (e.run && !m.runId) m.runId = String(e.run);
  const line = (): string => stripAnsi(formatEvent(e) ?? "").trim();
  switch (e.type) {
    case "agent.activity": {
      const a = m.agents.get(agentKey(e));
      if (a) a.last = String(e.summary ?? e.activity ?? "");
      return;
    }
    case "agent.started": {
      const key = agentKey(e);
      const prior = m.agents.get(key);
      const role = String(e.role ?? "worker");
      m.agents.set(key, {
        key,
        role: ROLE_NAME[role] ?? role,
        task: e.task ? String(e.task) : undefined,
        model: String(e.model ?? prior?.model ?? "?"),
        working: true,
        turns: prior?.turns ?? 0,
        tokens: prior?.tokens ?? 0,
        cost: prior?.cost,
        last: undefined,
      });
      if (role === "tester") m.stage = "reviewing";
      else if (role === "worker" || role === "escalation") m.stage = "building";
      else if (role === "orchestrator" || role === "briefer") m.stage = "planning";
      m.items.push({ kind: "activity", text: line() });
      return;
    }
    case "agent.finished": {
      const a = m.agents.get(agentKey(e));
      const tokens = totalTokens(e.usage as Record<string, number | undefined>);
      const cost = typeof e.cost === "number" ? e.cost : estimateCost(String(e.model ?? ""), (e.usage ?? {}) as Record<string, number>);
      if (e.role === "briefer" || e.role === "orchestrator") m.planned = true;
      if (a) {
        a.working = false;
        a.turns += 1;
        a.tokens += tokens;
        if (cost !== undefined) a.cost = (a.cost ?? 0) + cost;
        a.failed = e.stop !== "done";
        a.last = undefined;
      }
      if (cost !== undefined) {
        m.cost += cost;
        if (e.tier === "expert") m.expertCost += cost;
      } else if (tokens > 0) m.costUnknown = true;
      m.items.push({ kind: "activity", text: line(), tone: e.stop === "done" ? undefined : "red" });
      return;
    }
    case "plan.ready":
      m.planned = true;
      m.items.push({ kind: "neuromesh", text: line() });
      return;
    case "spec.ready":
    case "brief":
    case "route":
    case "context.ready":
    case "screens.checked":
      m.items.push({ kind: "note", text: line() });
      return;
    case "checks.finished":
      if (e.phase !== "baseline") m.stage = "checking";
      m.items.push({ kind: "note", text: line(), tone: e.ok === false ? "amber" : undefined });
      return;
    case "tester.verdict":
      m.items.push({ kind: "neuromesh", text: line(), tone: e.verdict === "pass" ? "jade" : "amber" });
      return;
    case "task.merged":
      m.items.push({ kind: "neuromesh", text: line(), tone: "jade" });
      return;
    case "task.failed":
    case "feature.failed":
      m.items.push({ kind: "error", text: line(), tone: "red" });
      return;
    case "task.escalated":
    case "task.advised":
    case "task.climbed":
      m.items.push({ kind: "neuromesh", text: line(), tone: "mauve" });
      return;
    case "run.started":
    case "run.resumed":
    case "workspace.ready":
    case "checks.detected":
    case "run.finished":
      return;
    default: {
      const text = line();
      if (text) m.items.push({ kind: "note", text });
    }
  }
}

/** The run is over: record its state and outcome. */
export function finished(m: Model, state: RunState): void {
  m.run = state;
  m.endedAt = Date.now();
  for (const a of m.agents.values()) a.working = false;
  m.stage =
    state.status === "finished" ? (state.outcome?.checks === "failed" ? "failed" : "finished")
    : state.status === "paused" ? "paused"
    : state.status === "interrupted" ? "stopped"
    : "failed";
  m.focus = "outcome";
}

/** The pipeline as the design shows it, from what actually happened. */
export function pipeline(m: Model): { label: string; state: "done" | "active" | "todo" | "failed" | "skipped" }[] {
  const order: Stage[] = ["planning", "building", "checking", "reviewing"];
  const at = order.indexOf(m.stage);
  const over = ["finished", "failed", "stopped", "paused"].includes(m.stage);
  return order.map((s, i) => {
    const label = s === "planning" ? "PLAN" : s === "building" ? "BUILD" : s === "checking" ? "CHECK" : "REVIEW";
    if (s === "planning" && !m.planned && i < at) return { label, state: "skipped" };
    if (over) return { label, state: m.stage === "finished" ? "done" : i === order.length - 1 ? "failed" : "done" };
    return { label, state: i < at ? "done" : i === at ? "active" : "todo" };
  });
}
