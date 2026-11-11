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
  kind: "you" | "neuromesh" | "activity" | "note" | "error" | "outcome" | "diff" | "detail";
  text: string;
  tone?: Tone;
  /** For "diff": the patch lines. */
  lines?: string[];
}

/** A past run of this repository, for the sessions pane. */
export interface SessionView {
  id: string;
  title: string;
  status: string;
  at: string;
  files?: number;
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
  /** The working directory, shown in the bottom bar. */
  cwd: string;
  sessions: SessionView[];
  /** The command popup, when open: the selected row. */
  palette?: { index: number };
  /** Latest result of each check, by name. */
  checks: Map<string, string>;
  /** The tester's latest verdict, in its own words. */
  verdict?: { verdict: string; summary: string };
  /** Who does what in the preset: role and model. */
  team: { role: string; model: string }[];
  /** The preset's expert budget in estimated dollars, if any. */
  budgetUsd?: number;
  /** [F26 tui-details] Show each agent's steps in the stream. */
  details: boolean;
  /** [F21 tui-slash] [F22 tui-mentions] The dropdown above the prompt. */
  suggest?: Suggest;
  /** [F24 tui-sessions] [F25 tui-presets] A list popup with a filter. */
  picker?: Picker;
}

export interface Choice {
  id: string;
  label: string;
  detail?: string;
  tone?: Tone;
}

export interface Suggest {
  kind: "slash" | "file";
  items: Choice[];
  index: number;
  /** Where the word being completed starts, in graphemes. */
  start: number;
}

export interface Picker {
  kind: "sessions" | "presets";
  title: string;
  query: string;
  all: Choice[];
  index: number;
}

export function newModel(preset: string, repo?: string, repoError?: string): Model {
  return {
    screen: "landing",
    preset,
    repo,
    repoError,
    items: [],
    agents: new Map(),
    stage: "idle",
    planned: false,
    cost: 0,
    expertCost: 0,
    costUnknown: false,
    focus: "composer",
    scroll: 0,
    cwd: process.cwd(),
    details: false,
    sessions: [],
    checks: new Map(),
    team: [],
  };
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
  m.checks = new Map();
  m.verdict = undefined;
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
      const what = String(e.summary ?? e.activity ?? "");
      if (a) a.last = what;
      // [F26 tui-details] Kept for Ctrl+O; hidden unless details are on.
      if (what) m.items.push({ kind: "detail", text: `${a?.role ?? ROLE_NAME[String(e.role)] ?? String(e.role)}${e.task && e.task !== "main" ? ` ${String(e.task)}` : ""}: ${what}` });
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
      // A running agent shows on its live line; the stream records it when it finishes.
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
      const secs = Math.round(Number(e.durationMs ?? 0) / 1000);
      const took = secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${String(secs % 60).padStart(2, "0")}s`;
      const name = `${a?.role ?? ROLE_NAME[String(e.role)] ?? String(e.role)}${e.task && e.task !== "main" ? ` ${String(e.task)}` : ""}`;
      const what = e.kind && !["initial", "spec", "test", "plan"].includes(String(e.kind)) ? ` (${String(e.kind)})` : "";
      const tok = tokens > 0 ? ` · ${tokens >= 1000 ? `${Math.round(tokens / 1000)}k` : tokens} tokens` : "";
      const price = cost !== undefined ? ` · ≈$${cost.toFixed(cost < 0.1 ? 3 : 2)}` : "";
      const end = e.stop === "done" ? "" : ` · ${String(e.stop)}${e.detail ? `: ${String(e.detail).slice(0, 120)}` : ""}`;
      m.items.push({ kind: "activity", text: `${name}${what} · ${String(e.model ?? "")} · ${took}${tok}${price}${end}`, tone: e.stop === "done" ? undefined : "red" });
      return;
    }
    case "plan.ready":
      m.planned = true;
      m.items.push({ kind: "neuromesh", text: line() });
      return;
    case "brief": {
      const s = (e.staffing ?? {}) as { plan?: boolean; rung?: string; tester?: boolean; spec?: boolean };
      const kind = String(e.kind ?? "change");
      const what = `${kind === "greenfield" ? "something new" : kind}${e.surface ? `, ${String(e.surface)}` : ""}`;
      const how = [s.spec ? "spec first" : "", s.plan ? "the lead plans" : "one worker", s.rung === "top" ? "strongest worker setting" : "", s.tester ? "with a reviewer" : "no reviewer"].filter(Boolean).join(" · ");
      m.items.push({ kind: "note", text: `Reading this as ${what}: ${how}` });
      return;
    }
    case "task.started":
      if (e.task !== "main") m.items.push({ kind: "note", text: line() });
      return;
    case "spec.ready":
    case "route":
    case "context.ready":
    case "screens.checked":
      m.items.push({ kind: "note", text: line() });
      return;
    case "checks.finished":
      for (const r of (e.results as { name: string; status: string }[] | undefined) ?? []) m.checks.set(r.name, e.phase === "baseline" ? `${r.status} before the change` : r.status);
      if (e.phase !== "baseline") m.stage = "checking";
      m.items.push({ kind: "note", text: line(), tone: e.ok === false ? "amber" : undefined });
      return;
    case "tester.verdict":
      m.verdict = { verdict: String(e.verdict), summary: String(e.summary ?? "") };
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
