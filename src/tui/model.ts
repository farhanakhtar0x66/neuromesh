// [F19 tui] What the TUI shows, built only from the engine's own events and
// run records: nothing is guessed. Unknown numbers stay unknown.
//
// The conversation is a log of entries: what you typed, every engine event,
// and a few notes of the TUI's own. The stream (blocks.ts) is drawn from that
// log, so changing the verbosity redraws the same history differently.

import type { Question } from "../engine/run.ts";
import type { NeuromeshEvent } from "../engine/store.ts";
import type { RunState } from "../engine/types.ts";
import { estimateCost } from "../usage/prices.ts";
import { tidyStep } from "./blocks.ts";
import type { Access, Verbosity } from "./store.ts";
import type { Tone } from "./theme.ts";

export type Stage = "idle" | "planning" | "building" | "checking" | "reviewing" | "finished" | "failed" | "stopped" | "paused";

export type Entry =
  | { kind: "you"; text: string; at: number; attachments?: string[] }
  | { kind: "event"; e: NeuromeshEvent; at: number }
  | { kind: "note"; text: string; tone?: Tone; at: number }
  | { kind: "error"; text: string; at: number }
  | { kind: "diff"; text: string; lines: string[]; at: number }
  /** [F47 tui-markdown] The agents' final report, in markdown. */
  | { kind: "final"; text: string; role: string; model?: string; at: number }
  | { kind: "result"; at: number };

/** A session in the sidebar. */
export interface SessionView {
  id: string;
  title: string;
  status: string;
  at: string;
  files?: number;
  repo: string;
  dir: string;
  /** [F49 follow-up] Every run of the session, oldest first. */
  runs?: string[];
}

export interface ProjectView {
  name: string;
  path: string;
  sessions: SessionView[];
}

export interface AgentView {
  key: string;
  /** Engine role: orchestrator, briefer, worker, tester, escalation. */
  roleId: string;
  /** Shown name: Orchestrator, Spec writer, Worker, Tester, Expert. */
  role: string;
  task?: string;
  model: string;
  effort?: string;
  working: boolean;
  turns: number;
  tokens: number;
  /** Estimated cost; undefined when not priced. */
  cost?: number;
  last?: string;
  failed?: boolean;
  startedAt?: number;
  doneAt?: number;
  /** [F41 tui-context] What the current or last turn was made of. */
  promptChars?: number;
  contextChars?: number;
  lastUsage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
}

/** [F43 quota-windows] A model's subscription windows, as its tool last reported them. */
export interface Quota {
  used: Record<string, number>;
  resets?: Record<string, number>;
  at: number;
}

export interface TaskView {
  id: string;
  title: string;
  state: "waiting" | "working" | "checking" | "done" | "failed" | "expert";
  note?: string;
}

export type Dialog =
  | { kind: "confirm"; title: string; body: string[]; yes: string; action: string; danger?: boolean; at: number }
  | {
      kind: "form";
      title: string;
      fields: { label: string; value: string; placeholder?: string; browse?: "folder" | "file" }[];
      focus: number;
      submit: string;
      action: string;
      error?: string;
      at: number;
    }
  | { kind: "settings"; index: number; at: number }
  /** [F51 tui-teams] The Custom team: a model (or none) for each place. */
  | { kind: "team"; team: { expert: string; worker: string; tester: string }; labels: Record<string, string>; index: number; error?: string; at: number }
  /** [F50 opencode] The four tools Neuromesh drives, and whether each is signed in. */
  | { kind: "connect"; index: number; status: Record<string, { version?: string; state: string; tone: Tone }>; at: number }
  /** [F52 telemetry] Asked once: share reports with the owner, or not. */
  | { kind: "consent"; at: number };

export interface Model {
  screen: "landing" | "workspace";
  repo?: string;
  repoRoot?: string;
  repoError?: string;
  /** The project's name: its name in the sidebar, or the folder's. */
  projectName?: string;
  branch?: string;
  preset: string;
  log: Entry[];
  agents: Map<string, AgentView>;
  tasks: Map<string, TaskView>;
  quotas: Map<string, Quota>;
  stage: Stage;
  planned: boolean;
  runId?: string;
  run?: RunState;
  startedAt?: number;
  endedAt?: number;
  cost: number;
  expertCost: number;
  costUnknown: boolean;
  focus: "composer" | "outcome" | "diff" | "sidebar";
  diff?: { title: string; lines: string[]; scroll: number };
  /** Rows scrolled up from the newest, in the stream. */
  scroll: number;
  toast?: { text: string; tone: Tone; until: number; at?: number };
  confirm?: "stop" | "discard" | "quit";
  rating?: number;
  cwd: string;
  /** [F34 tui-projects] The sidebar. */
  projects: ProjectView[];
  recents: SessionView[];
  folded: Set<string>;
  sideScroll: { projects: number; recents: number };
  /** Keyboard selection in the sidebar (Ctrl+E), as a row id. */
  sideSel?: string;
  palette?: { index: number; at?: number };
  checks: Map<string, string>;
  verdict?: { verdict: string; summary: string };
  team: { role: string; model: string }[];
  budgetUsd?: number;
  motion: boolean;
  /** Time to draw at; tests set it, the app leaves it to the clock. */
  clock?: number;
  introAt?: number;
  stageAt?: number;
  costFrom: number;
  costAt?: number;
  suggest?: Suggest;
  picker?: Picker;
  /** [F35 tui-agent-boxes] How much of each agent's work the stream shows, and boxes opened by hand. */
  verbose: Verbosity;
  expanded: Set<string>;
  /** [F39 ask-first] */
  access: Access;
  ask?: { question: Question; at: number };
  /** [F38 attachments] Files to send with the next instruction. */
  attachments: { path: string; name: string }[];
  /** [F33 tui-mouse] The region under the pointer. */
  hover?: string;
  dialog?: Dialog;
  /** [F35] When the brand last shimmered (a click, or a run that ended). */
  brandAt?: number;
  /** When the status last changed, for its entrance. */
  statusAt?: number;
  /** [F37 tui-scroll] Last scroll in the stream and the sidebar, for their scrollbars. */
  scrollAt?: number;
  sideScrollAt?: number;
  showSidebar: boolean;
  showInfo: boolean;
  /** [F45 tui-settings] The settings as shown in /settings. */
  settings: Record<string, string>;
  /** [F41 tui-context] The agent the context view shows (clicked in the graph). */
  focusAgent?: string;
  contextAt?: number;
  compactAsked?: boolean;
  /** [F47 tui-markdown] Scroll the stream so this block's first line is at the top (once). */
  readFrom?: string;
  /** The last agent to start, and the one before it, for the graph's hand-off. */
  handoff?: { from?: string; to: string; at: number };
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
  /** [F51 tui-teams] "model" chooses a model for one place of the Custom team, then goes back to it. */
  kind: "sessions" | "presets" | "allPresets" | "model";
  role?: "expert" | "worker" | "tester";
  back?: Dialog;
  title: string;
  query: string;
  at?: number;
  all: Choice[];
  index: number;
}

export function newModel(preset: string, repo?: string, repoError?: string): Model {
  return {
    screen: "landing",
    preset,
    repo,
    repoError,
    projectName: repo,
    log: [],
    agents: new Map(),
    tasks: new Map(),
    quotas: new Map(),
    stage: "idle",
    planned: false,
    cost: 0,
    expertCost: 0,
    costUnknown: false,
    focus: "composer",
    scroll: 0,
    cwd: process.cwd(),
    projects: [],
    recents: [],
    folded: new Set(),
    sideScroll: { projects: 0, recents: 0 },
    verbose: "medium",
    expanded: new Set(),
    access: "normal",
    attachments: [],
    motion: false,
    costFrom: 0,
    checks: new Map(),
    team: [],
    showSidebar: true,
    showInfo: true,
    settings: {},
  };
}

/** Add to the log, stamped with the time it arrived. */
export function push(m: Model, entry: Entry): void {
  m.log.push(entry);
}

export function note(m: Model, text: string, tone?: Tone): void {
  m.screen = "workspace";
  m.log.push({ kind: "note", text, tone, at: Date.now() });
}

export function setStage(m: Model, stage: Stage): void {
  if (m.stage !== stage) {
    m.stageAt = Date.now();
    m.statusAt = Date.now();
  }
  m.stage = stage;
}

/** The time to draw at. */
export function nowOf(m: Model): number {
  return m.clock ?? Date.now();
}

export function toast(m: Model, text: string, tone: Tone = "jade", ms = 4_000): void {
  m.toast = { text, tone, until: Date.now() + ms, at: Date.now() };
}

/** Start a new run in the workspace: the user's words appear at once, before any model answers. */
export function submitted(m: Model, prompt: string, attachments: string[] = []): void {
  m.screen = "workspace";
  m.log.push({ kind: "you", text: prompt, at: Date.now(), attachments: attachments.length ? attachments : undefined });
  setStage(m, "planning");
  m.planned = false;
  m.agents = new Map();
  m.tasks = new Map();
  m.run = undefined;
  m.runId = undefined;
  m.startedAt = Date.now();
  m.endedAt = undefined;
  m.cost = 0;
  m.costFrom = 0;
  m.costAt = undefined;
  m.expertCost = 0;
  m.costUnknown = false;
  m.focus = "composer";
  m.rating = undefined;
  m.scroll = 0;
  m.checks = new Map();
  m.verdict = undefined;
  m.ask = undefined;
  m.focusAgent = undefined;
  m.compactAsked = false;
  m.handoff = undefined;
}

export const ROLE_NAME: Record<string, string> = { orchestrator: "Orchestrator", escalation: "Expert", worker: "Worker", tester: "Tester", briefer: "Spec writer" };

function agentKey(e: NeuromeshEvent): string {
  return `${String(e.role ?? "agent")}${e.task ? `:${String(e.task)}` : ""}`;
}

function totalTokens(u: Record<string, number | undefined> | undefined): number {
  return u ? (u.input ?? 0) + (u.output ?? 0) + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0) : 0;
}

/** Fold one engine event into the model. */
export function applyEvent(m: Model, e: NeuromeshEvent): void {
  if (e.run && !m.runId) m.runId = String(e.run);
  m.screen = "workspace";
  m.log.push({ kind: "event", e, at: Date.now() });
  switch (e.type) {
    case "agent.activity": {
      const a = m.agents.get(agentKey(e));
      if (a) a.last = tidyStep(String(e.summary ?? e.activity ?? ""));
      return;
    }
    case "agent.started": {
      const key = agentKey(e);
      const prior = m.agents.get(key);
      const roleId = String(e.role ?? "worker");
      m.agents.set(key, {
        key,
        roleId,
        role: ROLE_NAME[roleId] ?? roleId,
        task: e.task ? String(e.task) : undefined,
        model: String(e.model ?? prior?.model ?? "?"),
        effort: typeof e.effort === "string" ? e.effort : prior?.effort,
        working: true,
        turns: prior?.turns ?? 0,
        tokens: prior?.tokens ?? 0,
        cost: prior?.cost,
        last: undefined,
        startedAt: Date.now(),
        promptChars: typeof e.promptChars === "number" ? e.promptChars : undefined,
        contextChars: typeof e.contextChars === "number" ? e.contextChars : undefined,
        lastUsage: prior?.lastUsage,
      });
      const last = m.handoff?.to;
      m.handoff = { from: last && last !== roleId ? last : m.handoff?.from, to: roleId, at: Date.now() };
      if (roleId === "tester") setStage(m, "reviewing");
      else if (roleId === "worker" || roleId === "escalation") setStage(m, "building");
      else if (roleId === "orchestrator" || roleId === "briefer") setStage(m, "planning");
      if (e.task) {
        const t = m.tasks.get(String(e.task));
        if (t && roleId !== "tester") t.state = roleId === "escalation" ? "expert" : "working";
      }
      return;
    }
    case "agent.finished": {
      const a = m.agents.get(agentKey(e));
      const usage = (e.usage ?? {}) as Record<string, number | undefined>;
      const tokens = totalTokens(usage);
      const cost = typeof e.cost === "number" ? e.cost : estimateCost(String(e.model ?? ""), usage as Record<string, number>);
      if (e.role === "briefer" || e.role === "orchestrator") m.planned = true;
      if (a) {
        a.working = false;
        a.turns += 1;
        a.tokens += tokens;
        if (cost !== undefined) a.cost = (a.cost ?? 0) + cost;
        a.failed = e.stop !== "done";
        a.doneAt = Date.now();
        a.last = undefined;
        a.lastUsage = { input: usage.input, output: usage.output, cacheRead: usage.cacheRead, cacheWrite: usage.cacheWrite };
        if (String(e.model ?? "")) a.model = String(e.model);
        m.contextAt = Date.now();
      }
      if (cost !== undefined) {
        m.costFrom = m.cost;
        m.costAt = Date.now();
        m.cost += cost;
        if (e.tier === "expert") m.expertCost += cost;
      } else if (tokens > 0) m.costUnknown = true;
      // [F43 quota-windows]
      const used = e.quotaUsed as Record<string, number> | undefined;
      if (used && Object.keys(used).length > 0) m.quotas.set(String(e.model ?? ""), { used, resets: e.quotaResets as Record<string, number> | undefined, at: Date.now() });
      return;
    }
    case "plan.ready":
      m.planned = true;
      for (const t of (e.tasks as { id: string; title: string }[] | undefined) ?? []) m.tasks.set(t.id, { id: t.id, title: t.title, state: "waiting" });
      return;
    case "task.started": {
      const id = String(e.task);
      const t = m.tasks.get(id) ?? { id, title: String(e.title ?? id), state: "working" as const };
      t.state = "working";
      t.title = String(e.title ?? t.title);
      m.tasks.set(id, t);
      return;
    }
    case "task.report": {
      const t = m.tasks.get(String(e.task));
      if (t) t.state = "checking";
      return;
    }
    case "task.merged": {
      const t = m.tasks.get(String(e.task));
      if (t) t.state = "done";
      return;
    }
    case "task.failed": {
      const t = m.tasks.get(String(e.task));
      if (t) {
        t.state = "failed";
        t.note = String(e.reason ?? "");
      }
      return;
    }
    case "task.escalated":
    case "task.advised": {
      const t = m.tasks.get(String(e.task));
      if (t) t.state = "expert";
      return;
    }
    case "checks.finished":
      for (const r of (e.results as { name: string; status: string }[] | undefined) ?? []) m.checks.set(r.name, e.phase === "baseline" ? `${r.status} before the change` : r.status);
      if (e.phase !== "baseline") setStage(m, "checking");
      return;
    case "tester.verdict":
      m.verdict = { verdict: String(e.verdict), summary: String(e.summary ?? "") };
      return;
    case "ask":
      m.ask = { question: e.question as Question, at: Date.now() };
      m.statusAt = Date.now();
      return;
    case "answer":
      m.ask = undefined;
      m.statusAt = Date.now();
      return;
    case "context.compacted":
      m.compactAsked = false;
      return;
    default:
  }
}

/** The run is over: record its state and outcome. */
export function finished(m: Model, state: RunState): void {
  m.run = state;
  m.endedAt = Date.now();
  for (const a of m.agents.values()) a.working = false;
  m.stageAt = Date.now();
  m.statusAt = Date.now();
  m.ask = undefined;
  // An applied or discarded run had finished first: its steps all happened.
  m.stage =
    state.status === "finished" || state.status === "applied" || state.status === "discarded" ? (state.outcome?.checks === "failed" ? "failed" : "finished")
    : state.status === "paused" ? "paused"
    : state.status === "interrupted" ? "stopped"
    : "failed";
  m.focus = "outcome";
}

/** The pipeline as the design shows it, from what actually happened. */
export function pipeline(m: Model): { label: string; stage: Stage; state: "done" | "active" | "todo" | "failed" | "skipped" }[] {
  const order: Stage[] = ["planning", "building", "checking", "reviewing"];
  const at = order.indexOf(m.stage);
  const over = ["finished", "failed", "stopped", "paused"].includes(m.stage);
  return order.map((s, i) => {
    const label = s === "planning" ? "Plan" : s === "building" ? "Build" : s === "checking" ? "Check" : "Review";
    if (s === "planning" && !m.planned && (i < at || over)) return { label, stage: s, state: "skipped" };
    if (over) return { label, stage: s, state: m.stage === "finished" ? "done" : i === order.length - 1 ? "failed" : "done" };
    return { label, stage: s, state: i < at ? "done" : i === at ? "active" : "todo" };
  });
}

/** Model names as people say them: claude-opus-5-5 is Opus 5.5, gpt-6-luna is GPT-6 Luna. */
export function prettyModel(model: string | undefined): string {
  if (!model) return "?";
  const name = model.replace(/^[a-z]+\//, "");
  const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
  const claude = /^claude-([a-z]+)-(\d+)(?:-(\d+))?/.exec(name);
  if (claude) return `${cap(claude[1]!)} ${claude[2]}${claude[3] ? `.${claude[3]}` : ""}`;
  const gpt = /^gpt-([\d.]+)-([a-z]+)/.exec(name);
  if (gpt) return `GPT-${gpt[1]} ${cap(gpt[2]!)}`;
  const gemini = /^gemini-([\d.]+)-([a-z-]+)/.exec(name);
  if (gemini) return `Gemini ${gemini[1]} ${gemini[2]!.split("-").map(cap).join(" ")}`;
  return name;
}

export const shortEffort = (e: string | undefined): string => (!e ? "" : e === "medium" ? "med" : e);
