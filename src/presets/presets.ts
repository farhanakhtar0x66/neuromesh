// Presets are data: which models play which role. They live in presets/*.json.
//
// A role is a list of models to try in order; the next one takes over when one
// runs out of quota or is no longer offered. "escalation" may name another
// role ("orchestrator") to reuse its list.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Role, RoleChain, RoleConfig, Tier } from "../engine/types.ts";

export interface Preset {
  name: string;
  description: string;
  /** "solo": one agent does the whole request. "team": an orchestrator plans and workers build. */
  mode: "solo" | "team";
  roles: RoleChain;
  /** Extra worker turns per task: repairs after failing checks or a failed review. */
  repairs: number;
  /** Most tasks the orchestrator may plan. */
  maxTasks: number;
  /** Most tasks worked on at the same time. */
  maxParallel: number;
  /** Time limit for one agent turn. */
  turnTimeoutMinutes: number;
  /** Team presets: let small requests skip the orchestrator. */
  intake: boolean;
  /**
   * Run the brief engine (src/intake/brief.ts): clean and complete the request and
   * choose the staffing by rule. On for team presets unless set; with it on, the
   * brief engine decides about planning instead of `routing`.
   */
  brief: boolean;
  /** Features to switch off for this preset (ids or keys; see src/features.ts). */
  disable?: string[];
  /** How the intake decides; see src/intake/intake.ts. */
  routing: "rules" | "worker-first";
  /** A stuck worker first gets the expert's advice; the expert takes over only if that fails. */
  advise: boolean;
  /** Most expert tokens (fresh input + output) one run may spend. */
  expertBudget?: number;
  /** [F16 dollar-budget] Most expert spending one run may have, in estimated US dollars at API list prices. */
  expertBudgetUsd?: number;
  /** When the tester reviews a task: always, or only when the project has no automatic checks. */
  test: "always" | "no-checks";
  /**
   * Worker rungs, cheapest first (for example one model at low, then high effort).
   * Every task starts on the first rung; a stuck worker climbs before the expert is asked.
   */
  workerLadder?: RoleConfig[];
  /**
   * [F78 three-tier] Mid-priced rungs above the worker rungs. The lead engineer
   * marks a moderately hard part "senior" and it starts here; a worker stuck on
   * its last rung climbs here before the expert is asked.
   */
  seniorLadder?: RoleConfig[];
  /**
   * [F77 direct-build] Workers write a planned part in one answer with no
   * tools; Neuromesh writes the files and runs the checks. Experimental.
   */
  direct?: boolean;
}

export const DEFAULT_PRESET = "factory-opus-luna";

export const PRESET_DIR = fileURLToPath(new URL("../../presets/", import.meta.url));

const DEFAULT_TIER: Record<Role, Tier> = { orchestrator: "expert", escalation: "expert", worker: "worker", tester: "worker", briefer: "worker" };
const ROLES: Role[] = ["orchestrator", "worker", "tester", "escalation", "briefer"];

function chain(raw: unknown, role: Role, file: string): RoleConfig[] {
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map((entry) => {
    const c = entry as Partial<RoleConfig>;
    if (typeof c?.backend !== "string") throw new Error(`Preset ${file}: every ${role} entry needs a backend`);
    return { backend: c.backend, model: c.model, effort: c.effort, tier: c.tier ?? DEFAULT_TIER[role] };
  });
}

export function validatePreset(raw: unknown, file: string): Preset {
  const p = raw as Partial<Preset> & { worker?: unknown; roles?: Record<string, unknown> };
  if (typeof p.name !== "string") throw new Error(`Preset ${file}: missing name`);
  if (p.mode !== "solo" && p.mode !== "team") throw new Error(`Preset ${file}: mode must be "solo" or "team"`);
  const rawRoles: Record<string, unknown> = { ...(p.roles ?? {}) };
  if (p.worker !== undefined && rawRoles.worker === undefined) rawRoles.worker = p.worker;
  const roles: RoleChain = {};
  for (const role of ROLES) {
    const value = rawRoles[role];
    if (value === undefined || typeof value === "string") continue;
    roles[role] = chain(value, role, file);
  }
  for (const role of ROLES) {
    const value = rawRoles[role];
    if (typeof value === "string") {
      const target = roles[value as Role];
      if (!target) throw new Error(`Preset ${file}: ${role} refers to "${value}", which is not defined`);
      roles[role] = target.map((c) => ({ ...c, tier: DEFAULT_TIER[role] === "expert" ? "expert" : c.tier }));
    }
  }
  if (!roles.worker) throw new Error(`Preset ${file}: a worker role is required`);
  if (p.mode === "team" && !roles.orchestrator) throw new Error(`Preset ${file}: a team preset needs an orchestrator`);
  const int = (value: unknown, fallback: number, min: number): number =>
    typeof value === "number" && Number.isFinite(value) && value >= min ? Math.floor(value) : fallback;
  return {
    name: p.name,
    description: p.description ?? "",
    mode: p.mode,
    roles,
    repairs: int(p.repairs, p.mode === "team" ? 2 : 1, 0),
    maxTasks: int(p.maxTasks, 4, 1),
    maxParallel: int(p.maxParallel, 1, 1),
    turnTimeoutMinutes: typeof p.turnTimeoutMinutes === "number" && p.turnTimeoutMinutes > 0 ? p.turnTimeoutMinutes : 30,
    intake: p.intake ?? p.mode === "team",
    brief: p.brief ?? p.mode === "team",
    disable: Array.isArray(p.disable) ? p.disable.filter((d): d is string => typeof d === "string") : undefined,
    routing: p.routing === "worker-first" ? "worker-first" : "rules",
    advise: p.advise ?? true,
    expertBudget: typeof p.expertBudget === "number" && p.expertBudget > 0 ? p.expertBudget : undefined,
    expertBudgetUsd: typeof p.expertBudgetUsd === "number" && p.expertBudgetUsd > 0 ? p.expertBudgetUsd : undefined,
    test: p.test === "no-checks" ? "no-checks" : "always",
    workerLadder: p.workerLadder === undefined ? undefined : chain(p.workerLadder, "worker", file),
    seniorLadder: p.seniorLadder === undefined ? undefined : chain(p.seniorLadder, "worker", file),
    direct: p.direct === true ? true : undefined,
  };
}

export function listPresets(dir = PRESET_DIR): Preset[] {
  const read = (d: string): Preset[] =>
    existsSync(d)
      ? readdirSync(d)
          .filter((f) => f.endsWith(".json"))
          .sort()
          .map((f) => validatePreset(JSON.parse(readFileSync(join(d, f), "utf8")), f))
      : [];
  // [F51 tui-teams] The owner's own presets (the Custom team) live in ~/.neuromesh/presets.
  const own = dir === PRESET_DIR ? read(join(process.env.NEUROMESH_HOME ?? join(homedir(), ".neuromesh"), "presets")) : [];
  const shipped = read(dir);
  return [...shipped.filter((p) => !own.some((o) => o.name === p.name)), ...own];
}

export function loadPreset(name: string, dir = PRESET_DIR): Preset {
  const preset = listPresets(dir).find((p) => p.name === name);
  if (!preset) {
    const known = listPresets(dir).map((p) => p.name);
    throw new Error(`Unknown preset "${name}". Known presets: ${known.join(", ")}`);
  }
  return preset;
}

export function describeRole(chain: RoleConfig[] | undefined): string {
  if (!chain || chain.length === 0) return "-";
  const first = chain[0]!;
  const name = `${first.backend} ${first.model ?? "(default)"}${first.effort ? ` ${first.effort}` : ""}`;
  return chain.length > 1 ? `${name} (+${chain.length - 1} fallback)` : name;
}
