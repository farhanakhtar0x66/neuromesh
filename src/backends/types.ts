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
}

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
  /** Where to save the raw event stream. */
  logPath?: string;
  signal?: AbortSignal;
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
  durationMs: number;
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
}

export function addUsage(a: Usage, b: Usage): Usage {
  const sum = (x?: number, y?: number): number | undefined =>
    x === undefined && y === undefined ? undefined : (x ?? 0) + (y ?? 0);
  return {
    input: sum(a.input, b.input),
    output: sum(a.output, b.output),
    reasoning: sum(a.reasoning, b.reasoning),
    cacheRead: sum(a.cacheRead, b.cacheRead),
    cacheWrite: sum(a.cacheWrite, b.cacheWrite),
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
