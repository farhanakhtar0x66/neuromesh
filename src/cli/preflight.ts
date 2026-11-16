// [F112 tool-preflight] Before a run starts, check that the command-line tools
// the preset will call are installed. Without this a missing tool burns every
// retry and escalation, then ends with "execvp() of 'claude' failed: No such
// file or directory", which says nothing about what to do. This runs
// `<tool> --version` only: no model call, no quota.

import type { AgentBackend } from "../backends/types.ts";
import { installHint } from "../doctor/doctor.ts";
import type { Preset } from "../presets/presets.ts";

/** The backends a preset's roles use, each once. */
export function presetBackends(preset: Preset): string[] {
  const ids = new Set<string>();
  for (const chain of Object.values(preset.roles)) for (const role of chain ?? []) ids.add(role.backend);
  return [...ids];
}

/**
 * One message for each tool the preset needs and this machine lacks, each saying
 * what to do next. A tool that cannot be checked (the check itself failed or
 * took too long) is taken as present: the run finds out for itself.
 */
export async function missingTools(preset: Preset, all: Record<string, AgentBackend>, waitMs = 10_000): Promise<string[]> {
  const out: string[] = [];
  for (const id of presetBackends(preset)) {
    const backend = all[id];
    if (!backend) continue;
    let version: string | undefined = "unchecked";
    try {
      version = await Promise.race([backend.version(), new Promise<string>((resolve) => setTimeout(() => resolve("unchecked"), waitMs).unref())]);
    } catch {
      version = "unchecked";
    }
    if (version === undefined) out.push(`${backend.displayName} (\`${id}\`) was not found on this machine, and the ${preset.name} preset needs it. ${installHint(id, backend.displayName)} Then try again; \`neuromesh doctor\` checks every tool.`);
  }
  return out;
}
