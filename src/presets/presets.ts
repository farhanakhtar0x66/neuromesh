// Presets are data: which model plays which role. They live in presets/*.json.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RoleConfig } from "../engine/types.ts";

export interface Preset {
  name: string;
  description: string;
  /** "solo": one agent does the whole request. Team modes arrive in M3. */
  mode: "solo";
  worker: RoleConfig;
  /** How many times the agent may fix failing checks. */
  repairs: number;
  /** Time limit for one agent turn. */
  turnTimeoutMinutes: number;
}

export const DEFAULT_PRESET = "solo-flash";

export const PRESET_DIR = fileURLToPath(new URL("../../presets/", import.meta.url));

function validate(raw: unknown, file: string): Preset {
  const p = raw as Partial<Preset>;
  const problem = (what: string): never => {
    throw new Error(`Preset ${file}: ${what}`);
  };
  if (typeof p.name !== "string") problem("missing name");
  if (p.mode !== "solo") problem(`mode must be "solo" (got ${JSON.stringify(p.mode)})`);
  if (typeof p.worker?.backend !== "string") problem("worker.backend is required");
  return {
    name: p.name!,
    description: p.description ?? "",
    mode: "solo",
    worker: { backend: p.worker!.backend, model: p.worker!.model, effort: p.worker!.effort, tier: p.worker!.tier ?? "worker" },
    repairs: typeof p.repairs === "number" && p.repairs >= 0 ? Math.floor(p.repairs) : 1,
    turnTimeoutMinutes: typeof p.turnTimeoutMinutes === "number" && p.turnTimeoutMinutes > 0 ? p.turnTimeoutMinutes : 30,
  };
}

export function listPresets(dir = PRESET_DIR): Preset[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => validate(JSON.parse(readFileSync(join(dir, f), "utf8")), f));
}

export function loadPreset(name: string, dir = PRESET_DIR): Preset {
  const preset = listPresets(dir).find((p) => p.name === name);
  if (!preset) {
    const known = listPresets(dir).map((p) => p.name);
    throw new Error(`Unknown preset "${name}". Known presets: ${known.join(", ")}`);
  }
  return preset;
}
