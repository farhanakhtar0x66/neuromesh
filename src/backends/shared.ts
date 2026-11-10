// Shared plumbing for command-line backends: start the tool, feed each JSON
// event to a parser, and turn the outcome into an AgentResult.

import { classifyFailure } from "./types.ts";
import type { AgentRequest, AgentResult, StopReason, Usage } from "./types.ts";
import { runProcess } from "./proc.ts";

/** What a parser has learned from the event stream. */
export interface ParsedRun {
  /** Set once the tool has reported how the turn ended. */
  stop?: StopReason;
  finalText: string;
  structured?: unknown;
  sessionId?: string;
  model?: string;
  usage: Usage;
  costUsdEquivalent?: number;
  quotaUsed?: Record<string, number>;
  detail?: string;
}

export interface StreamParser {
  onEvent(event: Record<string, unknown>): void;
  result(): ParsedRun;
}

export interface CliInvocation {
  command: string;
  args: string[];
  stdin?: string;
  request: AgentRequest;
  parser: StreamParser;
}

export async function runCli(invocation: CliInvocation): Promise<AgentResult> {
  const { request, parser } = invocation;
  const proc = await runProcess({
    command: invocation.command,
    args: invocation.args,
    cwd: request.cwd,
    timeoutMs: request.timeoutMs,
    signal: request.signal,
    stdin: invocation.stdin,
    logPath: request.logPath,
    onSpawn: request.onSpawn,
    onLine: (line) => {
      if (!line.startsWith("{")) return;
      try {
        parser.onEvent(JSON.parse(line) as Record<string, unknown>);
      } catch {
        // Not JSON after all; the raw line is still in the log.
      }
    },
  });

  const parsed = parser.result();
  const stderrTail = proc.stderr.trim().slice(-2_000);
  let stop: StopReason;
  let detail = parsed.detail;

  if (proc.spawnError) {
    stop = "error";
    detail = `could not start ${invocation.command}: ${proc.spawnError}`;
  } else if (proc.cancelled) {
    stop = "cancelled";
  } else if (proc.timedOut) {
    stop = "timeout";
  } else if (parsed.stop) {
    stop = parsed.stop;
    if (stop !== "done" && !detail) detail = stderrTail || undefined;
  } else if (proc.exitCode === 0) {
    stop = "error";
    detail = "the tool exited without reporting a result";
  } else {
    detail = detail ?? (stderrTail || `exit code ${proc.exitCode}`);
    stop = classifyFailure(detail);
  }

  return {
    stop,
    finalText: parsed.finalText,
    structured: parsed.structured,
    sessionId: parsed.sessionId,
    model: parsed.model ?? request.model,
    usage: parsed.usage,
    costUsdEquivalent: parsed.costUsdEquivalent,
    quotaUsed: parsed.quotaUsed,
    durationMs: proc.durationMs,
    exitCode: proc.exitCode,
    detail,
    logPath: request.logPath,
  };
}

// Small helpers for reading untyped JSON events safely.

export function obj(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function short(value: unknown, limit = 120): string {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > limit ? oneLine.slice(0, limit - 1) + "…" : oneLine;
}

/** Parse the final answer as JSON when a schema was requested. */
export function parseStructured(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed === "") return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
    if (fenced?.[1]) {
      try {
        return JSON.parse(fenced[1]);
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}
