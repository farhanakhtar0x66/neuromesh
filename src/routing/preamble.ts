// [F83 early-exit] Gate 2 and 3 of the cascade: a worker or senior developer
// judges the task before working on it, and the engine stops the turn at once
// when it says the task is beyond it.
//
// The architecture reads the first 25 tokens of an API stream and cuts the
// HTTP connection. Neuromesh reaches models only through their CLIs, which give
// no log-probabilities and stream whole messages, so the gate reads the
// agent's first text message (before it has run any tool) and stops the tool's
// process. What is saved is the rest of the turn: every tool call, file read
// and long answer a model would spend on work it has already said it cannot do.
//
// The confidence is the model's own, and self-reported confidence is not
// calibrated. That is why the grunt tier never gets the preamble (Gate 1 is
// deterministic), and why the thresholds are per tier and set in the preset.

export interface Preamble {
  confidence: number;
  escalate: boolean;
  reason: string;
  /** [F84 bottleneck-diagnostic] The one sub-problem it is stuck on, when it escalates. */
  bottleneck?: string;
}

/** The architecture's thresholds: tau_2 for the Haiku-class worker tier, tau_3 for the Sonnet-class senior tier. */
export const DEFAULT_THRESHOLDS = { worker: 0.75, senior: 0.8 };

/** The instruction added to a worker's or senior's first prompt of a task. */
export function preambleInstruction(): string {
  return `

Before you do anything else (before reading files or running any command), judge whether this task is within your ability, and write one line of JSON as your very first message, on its own:
{"confidence": <0.0 to 1.0, how likely you are to finish this task correctly>, "escalate": <true if it needs a stronger developer>, "reason": "<one short sentence>", "bottleneck": "<only when escalating: the exact sub-problem that is beyond you, in at most 150 words>"}
Be honest: a stronger developer takes over at once if you escalate, and nothing is held against you. Then, unless you escalated, do the task.`;
}

/**
 * The preamble in an agent's first message, or undefined when the message is
 * not one (the agent went straight to work: the gate lets it through).
 */
export function parsePreamble(text: string): Preamble | undefined {
  const start = text.indexOf("{");
  if (start < 0 || text.slice(0, start).trim().length > 40) return undefined;
  // The first balanced object: the preamble is one line, but a model may wrap it in a code fence.
  let depth = 0;
  let inString = false;
  let end = -1;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      end = i;
      break;
    }
  }
  if (end < 0) return undefined;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return undefined;
  }
  const confidence = typeof raw.confidence === "number" ? raw.confidence : typeof raw.confidence === "string" ? Number.parseFloat(raw.confidence) : Number.NaN;
  if (!Number.isFinite(confidence) || typeof raw.escalate !== "boolean") return undefined;
  const bottleneck = typeof raw.bottleneck === "string" && raw.bottleneck.trim() ? raw.bottleneck.trim().split(/\s+/).slice(0, 150).join(" ") : undefined;
  return {
    confidence: Math.max(0, Math.min(1, confidence)),
    escalate: raw.escalate,
    reason: typeof raw.reason === "string" ? raw.reason.trim().slice(0, 300) : "",
    ...(bottleneck ? { bottleneck } : {}),
  };
}

/** Stop the turn and climb: the agent asked to, or is less confident than its tier's threshold. */
export function shouldExit(p: Preamble, threshold: number): boolean {
  return p.escalate || p.confidence < threshold;
}
