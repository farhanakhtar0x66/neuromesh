// The one interface every model backend implements.
//
// A backend is a complete coding agent run in its headless mode. Neuromesh
// treats it as a black box: a prompt goes in, and a final answer, usage numbers
// and whatever it changed on disk come out.

export type Access = "read-only" | "write";

/** Why an agent run ended. Only "done" means the agent finished its turn. */
export type StopReason =
  | "done"
  | "quota" // subscription or rate limit reached; the run can be resumed later
  | "auth" // not logged in, or the account cannot use this tool
  | "permission" // the tool refused an action it could not ask about
  | "timeout"
  | "cancelled"
  | "error";

/**
 * Token counts as reported by the tool. A field the tool did not report stays
 * undefined; it is never filled in with 0.
 *
 * `input` is fresh input only. Tokens read from cache are in `cacheRead`.
 */
export interface Usage {
  input?: number;
  output?: number;
  reasoning?: number;
  cacheRead?: number;
  cacheWrite?: number;
  /**
   * [F66 tier-pricing] The part of this usage from model calls whose prompt was
   * over LONG_PROMPT tokens, which some models charge more for. Output is
   * shared out by number of calls (an estimate).
   */
  long?: Usage;
  /**
   * [F70 cut-usage] Counted from a turn's stream because it stopped before its
   * final report: input and cache counts are exact, output is estimated.
   */
  estimated?: boolean;
}

/** [F66 tier-pricing] Prompt size above which a call is priced at a model's long-context rates. */
export const LONG_PROMPT = 100_000;

export interface Activity {
  kind: "text" | "tool" | "info";
  summary: string;
}

export interface AgentRequest {
  cwd: string;
  prompt: string;
  model?: string;
  effort?: string;
  access: Access;
  /**
   * Programs a write-mode agent may run, for tools that take an allow list.
   * Leave out to allow any command.
   */
  allowCommands?: string[];
  /** JSON Schema the final answer must match. */
  outputSchema?: Record<string, unknown>;
  /** Continue an earlier session of the same backend. */
  resumeSessionId?: string;
  timeoutMs: number;
  /** Stop the turn when the tool prints nothing for this long (a stalled connection). */
  idleMs?: number;
  /** Where to save the raw event stream. */
  logPath?: string;
  signal?: AbortSignal;
  /**
   * [F53 write-sandbox] The folders this turn may write in, when the tool runs
   * in Neuromesh's sandbox (macOS). Undefined: not sandboxed by Neuromesh.
   */
  writable?: string[];
  /**
   * [F55 worker-network] A writing turn may reach the network from inside its
   * sandbox (Codex keeps it off by default). Other tools already have it.
   */
  network?: boolean;
  /** [F54 work-env] Extra environment variables for the tool and the commands it runs. */
  env?: Record<string, string>;
  /**
   * [F60 no-rebuild] Called with the turn's usage so far, as the tool reports
   * it during the turn (Claude Code does, per model call). Lets the engine stop
   * a turn that runs past the expert budget.
   */
  onUsage?: (usage: Usage) => void;
  /** Display only. Never used to make decisions. */
  onActivity?: (activity: Activity) => void;
  /** Called with the tool's process id (also its process group) once started. */
  onSpawn?: (pid: number) => void;
}

export interface AgentResult {
  stop: StopReason;
  finalText: string;
  structured?: unknown;
  sessionId?: string;
  /** The model that actually answered, when the tool reports it. */
  model?: string;
  usage: Usage;
  /** Tool-reported cost at list prices. An estimate, not money spent. */
  costUsdEquivalent?: number;
  /** Fraction of the subscription window used (0 to 1), when reported. */
  quotaUsed?: Record<string, number>;
  /** [F43 quota-windows] When each of those windows resets (Unix seconds), when reported. */
  quotaResets?: Record<string, number>;
  durationMs: number;
  /**
   * [F67 session-cap] The largest prompt (input, cache read and cache write
   * together) any model call of the turn sent, when the tool reports per call.
   */
  peakPrompt?: number;
  exitCode: number | null;
  /** Error or refusal text, when there is one. */
  detail?: string;
  logPath?: string;
}

export interface AgentBackend {
  id: string;
  displayName: string;
  /** Installed version, or undefined when the tool is not installed. */
  version(): Promise<string | undefined>;
  run(request: AgentRequest): Promise<AgentResult>;
  /**
   * A resumed session reports usage as running totals for the whole session,
   * not for the turn (Codex does). The engine subtracts the earlier turns.
   */
  sessionTotals?: boolean;
}

export function addUsage(a: Usage, b: Usage): Usage {
  const sum = (x?: number, y?: number): number | undefined =>
    x === undefined && y === undefined ? undefined : (x ?? 0) + (y ?? 0);
  const long = a.long || b.long ? addUsage(a.long ?? {}, b.long ?? {}) : undefined;
  return {
    input: sum(a.input, b.input),
    output: sum(a.output, b.output),
    reasoning: sum(a.reasoning, b.reasoning),
    cacheRead: sum(a.cacheRead, b.cacheRead),
    cacheWrite: sum(a.cacheWrite, b.cacheWrite),
    ...(long ? { long } : {}),
  };
}

/**
 * One turn's usage from a session's running totals: the totals minus what the
 * session's earlier turns used. Never below zero (an earlier turn may have been
 * recorded with more than the tool later counted).
 */
export function usageSince(totals: Usage, earlier: Usage[]): Usage {
  const before = earlier.reduce((sum, u) => addUsage(sum, u), {} as Usage);
  const minus = (x?: number, y?: number): number | undefined => (x === undefined ? undefined : Math.max(0, x - (y ?? 0)));
  return {
    input: minus(totals.input, before.input),
    output: minus(totals.output, before.output),
    reasoning: minus(totals.reasoning, before.reasoning),
    cacheRead: minus(totals.cacheRead, before.cacheRead),
    cacheWrite: minus(totals.cacheWrite, before.cacheWrite),
  };
}

/** Recognise quota and login failures from the text a tool printed. */
export function classifyFailure(text: string): StopReason {
  if (
    /usage limit|rate.?limit|quota|resource.?exhausted|too many requests|\b429\b|limit reached|out of credits|AI Credits|purchase more|upgrade your (subscription|plan)/i.test(
      text,
    )
  ) {
    return "quota";
  }
  if (
    /not logged in|log ?in required|please (log|sign) ?in|authenticat|unauthori[sz]ed|\b401\b|invalid api key|ineligibletier|no longer supported|credential/i.test(
      text,
    )
  ) {
    return "auth";
  }
  if (/permission (check failed|denied)|denied permission|not permitted|operation not permitted/i.test(text)) {
    return "permission";
  }
  return "error";
}
