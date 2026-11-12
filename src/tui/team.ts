// [F51 tui-teams] Teams: two favourite presets, and a Custom team the owner
// builds from any model the installed tools offer.
//
// A Custom team has three places: the expert (plans, writes the spec, steps in
// when the work is stuck), the worker (builds) and the tester (reviews). Any
// of them may be "none", but not all three:
//   no expert   one agent does the work, with no planning or expert help
//   no worker   the expert does the work itself
//   no tester   the project's checks alone judge the work

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RoleConfig } from "../engine/types.ts";
import type { Preset } from "../presets/presets.ts";
import { prettyModel } from "./model.ts";

/** The two presets offered first. */
export const FAVOURITES = ["factory-opus-luna", "factory-sol-flash"];
export const CUSTOM = "custom";

export interface ModelChoice {
  /** backend/model#effort, or "none". */
  id: string;
  label: string;
  detail: string;
  config?: RoleConfig;
}

const NONE: ModelChoice = { id: "none", label: "none", detail: "leave this place empty" };

const choice = (backend: string, model: string, effort: string | undefined, detail: string): ModelChoice => ({
  id: `${backend}/${model}${effort ? `#${effort}` : ""}`,
  label: `${prettyModel(model)}${effort ? ` ${effort}` : ""}`,
  detail,
  config: { backend, model, ...(effort ? { effort } : {}) },
});

/** Models through the subscriptions Neuromesh logs in to. */
export const BUILT_IN: ModelChoice[] = [
  choice("claude", "claude-opus-5-5", "medium", "Claude Code"),
  choice("claude", "claude-opus-5-5", "high", "Claude Code"),
  choice("claude", "claude-fable-5-2", "medium", "Claude Code"),
  choice("claude", "claude-sonnet-5-5", "medium", "Claude Code"),
  choice("claude", "claude-haiku-5-5", undefined, "Claude Code"),
  choice("codex", "gpt-6.1-sol", "high", "Codex"),
  choice("codex", "gpt-6.1-sol", "medium", "Codex"),
  choice("codex", "gpt-6.1-terra", "medium", "Codex"),
  choice("codex", "gpt-6-luna", "high", "Codex"),
  choice("codex", "gpt-6-luna", "medium", "Codex"),
  choice("codex", "gpt-6-luna", "low", "Codex"),
  choice("agy", "gemini-3.8-flash-high", undefined, "Antigravity"),
  choice("agy", "gemini-3.8-flash-medium", undefined, "Antigravity"),
  choice("agy", "gemini-3.8-flash-low", undefined, "Antigravity"),
];

/** [F50 opencode] Every model opencode knows (`opencode models`), API-key models included. */
export function opencodeModels(): Promise<ModelChoice[]> {
  return new Promise((done) => {
    let out = "";
    const child = spawn("opencode", ["models"], { stdio: ["ignore", "pipe", "ignore"] });
    const timer = setTimeout(() => child.kill("SIGTERM"), 15_000);
    child.stdout.on("data", (d: Buffer) => (out += d.toString("utf8")));
    child.on("error", () => (clearTimeout(timer), done([])));
    child.on("exit", () => {
      clearTimeout(timer);
      const models = out
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => /^[\w.-]+\/\S+$/.test(l));
      done(models.map((m) => ({ id: `opencode/${m}`, label: m, detail: "opencode", config: { backend: "opencode", model: m } })));
    });
  });
}

export function modelChoices(extra: ModelChoice[] = []): ModelChoice[] {
  return [NONE, ...BUILT_IN, ...extra];
}

export interface Team {
  expert: string;
  worker: string;
  tester: string;
}

/** Why a team cannot run, or undefined when it can. */
export function teamProblem(t: Team): string | undefined {
  if (t.expert === "none" && t.worker === "none" && t.tester === "none") return "Choose at least one model: a team needs someone to do the work.";
  if (t.expert === "none" && t.worker === "none") return "A tester alone cannot build: choose a worker or an expert.";
  return undefined;
}

/** The Custom team as a preset. */
export function teamPreset(t: Team, all: ModelChoice[]): Preset {
  const find = (id: string): RoleConfig | undefined => all.find((c) => c.id === id)?.config;
  const expert = find(t.expert);
  const worker = find(t.worker);
  const tester = find(t.tester);
  const roles: Preset["roles"] = {};
  if (expert) {
    const e: RoleConfig = { ...expert, tier: "expert" };
    roles.orchestrator = [e];
    roles.escalation = [e];
    roles.briefer = [e];
  }
  // With no worker, the expert does the work itself.
  roles.worker = [worker ?? { ...expert!, tier: "worker" }];
  if (tester) roles.tester = [tester];
  const name = (id: string): string => all.find((c) => c.id === id)?.label ?? "none";
  return {
    name: CUSTOM,
    description: `Your own team: expert ${name(t.expert)}, worker ${name(t.worker)}, tester ${name(t.tester)}.`,
    mode: expert && worker ? "team" : "solo",
    routing: "worker-first",
    roles,
    repairs: 2,
    maxTasks: 4,
    maxParallel: 2,
    turnTimeoutMinutes: 30,
    test: tester ? "always" : "no-checks",
    intake: true,
    brief: true,
  } as Preset;
}

/** Save the Custom team where presets are read from (~/.neuromesh/presets/custom.json). */
export function saveTeam(home: string, t: Team, all: ModelChoice[]): Preset {
  const preset = teamPreset(t, all);
  const dir = join(home, "presets");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${CUSTOM}.json`), JSON.stringify({ ...preset, team: t }, null, 2) + "\n");
  return preset;
}
