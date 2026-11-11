import { antigravity } from "./antigravity.ts";
import { claude } from "./claude.ts";
import { codex } from "./codex.ts";
import { demo } from "./demo.ts";
import type { AgentBackend } from "./types.ts";

/** Real backends, Gemini route first. */
export const backends: Record<string, AgentBackend> = {
  agy: antigravity,
  claude,
  codex,
  // [F19 tui] Scripted; calls no model. For trying the interface: --preset demo.
  demo,
};

export type { AgentBackend, AgentRequest, AgentResult, Access, StopReason, Usage, Activity } from "./types.ts";
