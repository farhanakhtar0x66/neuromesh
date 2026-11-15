// [F106 input-split] Where a turn's input tokens went, in five parts, worked out
// from the tool's own stream (the same lines the turn log keeps). Plan item M5.
//
// Every model call of a turn re-reads the whole conversation so far, so the
// input of a turn is the sum, over its calls, of each call's prompt size
// (fresh + cache read + cache written; the tool reports it per call). Each
// call's prompt is shared out between:
//
//   startup    the tool's own system prompt and tool definitions
//   prompt     Neuromesh's prompt for the turn
//   files      what Read, Grep and Glob returned earlier in the turn
//   commands   what Bash (and any other tool) returned earlier in the turn
//   earlier    the model's own earlier output in the turn (text, tool calls,
//              and whatever else the call grew by that is not a tool result)
//
// The call's total is exact; the shares are estimates (about 4 characters a
// token), so the split says `estimated`. startup is what is left of the first
// call after Neuromesh's prompt, so it is known only for a fresh session whose
// prompt size is known; otherwise it is left out, never made up as 0.

export interface InputSplit {
  /** The tool's system prompt and tool definitions. Unknown (absent) for a resumed session. */
  startup?: number;
  /** Neuromesh's prompt. Absent when its size was not recorded (old logs). */
  prompt?: number;
  /** startup + prompt, when the two cannot be told apart (old logs). */
  startupAndPrompt?: number;
  files: number;
  commands: number;
  earlier: number;
  /** How many model calls the turn made: each re-read the whole prompt. */
  calls: number;
  /** A resumed session's first call, beyond Neuromesh's prompt: its start-up and the earlier turns, not told apart. */
  resumed?: number;
  /** Always true: the shares are estimates from character counts. */
  estimated: true;
}

const FILE_TOOLS = new Set(["Read", "Grep", "Glob", "NotebookRead", "LS"]);
const tokens = (chars: number): number => chars / 4;

function contentChars(content: unknown): number {
  if (typeof content === "string") return content.length;
  if (Array.isArray(content)) return content.reduce((n: number, c) => n + contentChars((c as { text?: unknown })?.text ?? (typeof c === "string" ? c : "")), 0);
  return 0;
}

export class SplitTracker {
  private order: string[] = [];
  private prompts = new Map<string, number>();
  /** Per call: what was added to the conversation since the call before it. */
  private added = new Map<string, { files: number; commands: number; own: number }>();
  private pending = { files: 0, commands: 0, own: 0 };
  private toolNames = new Map<string, string>();
  private lastCall: string | undefined;

  private readonly options: { promptChars?: number; resumed?: boolean; startupHint?: number };

  constructor(options: { promptChars?: number; resumed?: boolean; startupHint?: number } = {}) {
    this.options = options;
  }

  onEvent(event: Record<string, unknown>): void {
    const type = event.type;
    const message = event.message as { id?: unknown; usage?: Record<string, unknown>; content?: unknown } | undefined;
    if (type === "assistant" && message) {
      const id = typeof message.id === "string" ? message.id : undefined;
      const u = message.usage;
      if (id && u) {
        const size = (Number(u.input_tokens) || 0) + (Number(u.cache_read_input_tokens) || 0) + (Number(u.cache_creation_input_tokens) || 0);
        if (!this.prompts.has(id)) {
          this.order.push(id);
          // What came in since the last call is charged to this call's prompt.
          this.added.set(id, this.pending);
          this.pending = { files: 0, commands: 0, own: 0 };
        }
        this.prompts.set(id, Math.max(this.prompts.get(id) ?? 0, size));
        this.lastCall = id;
      }
      if (Array.isArray(message.content)) {
        for (const block of message.content as Record<string, unknown>[]) {
          if (block.type === "text" && typeof block.text === "string") this.pending.own += tokens(block.text.length);
          else if (block.type === "tool_use") {
            this.pending.own += tokens(JSON.stringify(block.input ?? "").length);
            if (typeof block.id === "string" && typeof block.name === "string") this.toolNames.set(block.id, block.name);
          }
        }
      }
      return;
    }
    if (type === "user" && message && Array.isArray(message.content)) {
      for (const block of message.content as Record<string, unknown>[]) {
        if (block.type !== "tool_result") continue;
        const name = this.toolNames.get(String(block.tool_use_id));
        const t = tokens(contentChars(block.content));
        if (name && FILE_TOOLS.has(name)) this.pending.files += t;
        else this.pending.commands += t;
      }
    }
  }

  /** The split, or undefined when the stream had no per-call usage. */
  result(): InputSplit | undefined {
    if (this.order.length === 0) return undefined;
    const sum: InputSplit = { files: 0, commands: 0, earlier: 0, calls: this.order.length, estimated: true };
    const first = this.prompts.get(this.order[0]!) ?? 0;
    const promptTok = this.options.promptChars === undefined ? undefined : Math.min(first, tokens(this.options.promptChars));
    // The first call is the tool's start-up plus Neuromesh's prompt, in a fresh session.
    let startup: number | undefined;
    let carried = 0;
    if (!this.options.resumed && promptTok !== undefined) startup = Math.max(0, first - promptTok);
    else if (this.options.resumed && promptTok !== undefined) {
      const hint = this.options.startupHint;
      startup = hint === undefined ? undefined : Math.min(hint, Math.max(0, first - promptTok));
      carried = Math.max(0, first - promptTok - (startup ?? 0));
    }
    let files = 0, commands = 0, earlier = 0;
    let prev = first;
    for (const [i, id] of this.order.entries()) {
      const p = this.prompts.get(id)!;
      if (i > 0) {
        const grew = p - prev;
        const a = this.added.get(id)!;
        const known = a.files + a.commands + a.own;
        if (grew < 0) {
          // The tool shrank the conversation (compaction): scale what is carried down to fit.
          const keep = prev > 0 ? p / prev : 0;
          files *= keep; commands *= keep; earlier *= keep; carried *= keep;
        } else {
          const scale = known > grew && known > 0 ? grew / known : 1;
          files += a.files * scale;
          commands += a.commands * scale;
          earlier += a.own * scale + Math.max(0, grew - known * scale);
        }
      }
      // This call's prompt, shared out.
      const base = p - files - commands - earlier - carried;
      if (promptTok !== undefined) {
        const st = startup;
        if (st !== undefined) {
          sum.startup = (sum.startup ?? 0) + Math.min(st, Math.max(0, base - promptTok));
          sum.prompt = (sum.prompt ?? 0) + promptTok;
        } else {
          sum.prompt = (sum.prompt ?? 0) + promptTok;
        }
      } else {
        sum.startupAndPrompt = (sum.startupAndPrompt ?? 0) + Math.max(0, base);
      }
      sum.files += files;
      sum.commands += commands;
      sum.earlier += earlier;
      if (carried > 0) sum.resumed = (sum.resumed ?? 0) + carried;
      prev = p;
    }
    for (const k of ["startup", "prompt", "startupAndPrompt", "files", "commands", "earlier", "resumed"] as const) {
      if (sum[k] !== undefined) sum[k] = Math.round(sum[k]!);
    }
    return sum;
  }
}

/** The split of a kept turn log (JSON lines), or undefined when it has no per-call usage. */
export function splitFromLog(text: string, options: { promptChars?: number; resumed?: boolean; startupHint?: number } = {}): InputSplit | undefined {
  const tracker = new SplitTracker(options);
  for (const line of text.split("\n")) {
    if (!line.startsWith("{")) continue;
    try {
      tracker.onEvent(JSON.parse(line) as Record<string, unknown>);
    } catch {
      // a line that is not an event
    }
  }
  return tracker.result();
}

/** Add two splits. A part known in only one is kept as is; no part is made up. */
export function addSplit(a: InputSplit | undefined, b: InputSplit | undefined): InputSplit | undefined {
  if (!a) return b;
  if (!b) return a;
  const out: InputSplit = { files: a.files + b.files, commands: a.commands + b.commands, earlier: a.earlier + b.earlier, calls: a.calls + b.calls, estimated: true };
  for (const k of ["startup", "prompt", "startupAndPrompt", "resumed"] as const) {
    if (a[k] !== undefined || b[k] !== undefined) out[k] = (a[k] ?? 0) + (b[k] ?? 0);
  }
  return out;
}

/** The parts as [label, tokens] for a table or a meter, in the order of the plan; unknown parts are left out. */
export function splitParts(s: InputSplit): [string, number][] {
  const parts: [string, number | undefined][] = [
    ["start-up", s.startup],
    ["prompt", s.prompt],
    ["start-up + prompt", s.startupAndPrompt],
    ["files read", s.files],
    ["command output", s.commands],
    ["resumed session", s.resumed],
    ["earlier turns", s.earlier],
  ];
  return parts.filter((p): p is [string, number] => p[1] !== undefined);
}
