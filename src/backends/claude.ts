// Claude Code in print mode (`claude -p`).
//
// The prompt goes in on standard input. `--allowedTools` takes a list, and a
// prompt placed after it on the command line would be read as a tool name.

import type { AgentBackend, AgentRequest, AgentResult } from "./types.ts";
import { isOn } from "../features.ts";
import { LONG_PROMPT, classifyFailure } from "./types.ts";
import { capture } from "./proc.ts";
import { num, obj, runCli, short, str } from "./shared.ts";
import type { ParsedRun, StreamParser } from "./shared.ts";

/**
 * Claude Code sends its whole tool list, MCP servers, skills and settings with
 * every new session: about 33k prompt tokens before the task (measured
 * 2026-11-11, Claude Code 2.1.319). Neuromesh turns need few tools, so each
 * session gets only those, and nothing from the user's own setup.
 */
const LEAN = ["--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}', "--disable-slash-commands", "--setting-sources", ""];
const READ_TOOLS = "Read,Grep,Glob";
const WRITE_TOOLS = "Bash,Edit,Write,Read,Grep,Glob";
/** Replaces Claude Code's long default system prompt for turns that only read. */
export const READ_ONLY_SYSTEM_PROMPT =
  "You are a senior software engineer. You are working in the repository in the current directory, which you can read with the Read, Grep and Glob tools but not change. Read what you need, think carefully, and answer precisely and concisely. When a JSON format is required, give your final answer in exactly that format.";

/** [F77 direct-build] */
export const DIRECT_SYSTEM_PROMPT =
  "You are a careful senior software developer. You have no tools: you cannot read files or run anything. Everything you need is in the message. Think it through, then answer once, in exactly the required JSON format.";

export function claudeArgs(request: AgentRequest): string[] {
  const args = ["-p", "--output-format", "stream-json", "--verbose"];
  if (request.model) args.push("--model", request.model);
  if (request.effort) args.push("--effort", request.effort);
  if (request.outputSchema) args.push("--json-schema", JSON.stringify(request.outputSchema));
  if (request.resumeSessionId) args.push("--resume", request.resumeSessionId);
  // [F08 lean-claude]
  const lean = isOn("lean-claude");
  if (lean) args.push(...LEAN);
  // [F77 direct-build] No tools and a one-line system prompt: one model call, a prompt of a few thousand tokens.
  if (request.direct) {
    args.push("--tools", "", "--system-prompt", DIRECT_SYSTEM_PROMPT, "--permission-mode", "plan");
    return args;
  }
  if (request.access === "write") {
    if (lean) args.push("--tools", WRITE_TOOLS);
    args.push("--permission-mode", "acceptEdits", "--allowedTools", "Bash", "Edit", "Write");
  } else {
    if (lean) args.push("--tools", READ_TOOLS, "--system-prompt", READ_ONLY_SYSTEM_PROMPT);
    args.push("--permission-mode", "plan");
  }
  return args;
}

export function claudeParser(request: Pick<AgentRequest, "onActivity" | "onUsage">): StreamParser {
  const run: ParsedRun = { finalText: "", usage: {} };
  let quotaBlocked = false;
  // [F60 no-rebuild] Usage so far in the turn. Input and cache counts come per
  // model call; output in the stream is only a placeholder, so it is estimated
  // from what was written (about 4 characters a token) and the thinking counts.
  const calls = new Map<string, { input: number; cacheRead: number; cacheWrite: number }>();
  let writtenChars = 0;
  let thinking = 0;
  const reportUsage = (): void => {
    if (!request.onUsage) return;
    let input = 0;
    let cacheRead = 0;
    let cacheWrite = 0;
    for (const c of calls.values()) {
      input += c.input;
      cacheRead += c.cacheRead;
      cacheWrite += c.cacheWrite;
    }
    request.onUsage({ input, cacheRead, cacheWrite, output: Math.round(writtenChars / 4) + thinking });
  };

  return {
    onEvent(event) {
      const type = str(event.type);
      if (type === "system" && event.subtype === "thinking_tokens") {
        thinking += num(event.estimated_tokens_delta) ?? 0;
        // A model can think for many minutes before its first message; the
        // engine's budget and a cut turn's kept usage must see that as it happens.
        reportUsage();
        return;
      }
      if (type === "system" && event.subtype === "init") {
        run.sessionId = str(event.session_id);
        run.model = str(event.model);
        return;
      }
      if (type === "assistant") {
        const message = obj(event.message);
        const content = message?.content;
        const id = str(message?.id);
        const u = obj(message?.usage);
        if (id && u) {
          const prev = calls.get(id);
          const call = {
            input: Math.max(prev?.input ?? 0, num(u.input_tokens) ?? 0),
            cacheRead: Math.max(prev?.cacheRead ?? 0, num(u.cache_read_input_tokens) ?? 0),
            cacheWrite: Math.max(prev?.cacheWrite ?? 0, num(u.cache_creation_input_tokens) ?? 0),
          };
          calls.set(id, call);
          // [F67 session-cap]
          run.peakPrompt = Math.max(run.peakPrompt ?? 0, call.input + call.cacheRead + call.cacheWrite);
        }
        if (!Array.isArray(content)) return;
        for (const block of content) {
          const b = obj(block);
          if (b?.type === "text" && str(b.text)) {
            writtenChars += str(b.text)!.length;
            request.onActivity?.({ kind: "text", summary: short(b.text, 160) });
          } else if (b?.type === "tool_use") {
            writtenChars += JSON.stringify(b.input ?? "").length;
            request.onActivity?.({ kind: "tool", summary: `${str(b.name) ?? "tool"} ${short(b.input, 100)}` });
          }
        }
        reportUsage();
        return;
      }
      if (type === "rate_limit_event") {
        const info = obj(event.rate_limit_info);
        const status = str(info?.status);
        if (status && !status.startsWith("allowed")) quotaBlocked = true;
        const windows = obj(info?.unifiedWindows);
        if (windows) {
          const used: Record<string, number> = {};
          const resets: Record<string, number> = {};
          for (const [name, value] of Object.entries(windows)) {
            const utilization = num(obj(value)?.utilization);
            if (utilization !== undefined) used[name] = utilization;
            // [F43 quota-windows]
            const at = num(obj(value)?.resetsAt);
            if (at !== undefined) resets[name] = at;
          }
          run.quotaUsed = used;
          if (Object.keys(resets).length > 0) run.quotaResets = resets;
        }
        return;
      }
      if (type === "result") {
        run.sessionId = str(event.session_id) ?? run.sessionId;
        run.finalText = str(event.result) ?? "";
        run.structured = event.structured_output ?? undefined;
        run.costUsdEquivalent = num(event.total_cost_usd);
        const usage = obj(event.usage);
        run.usage = {
          input: num(usage?.input_tokens),
          output: num(usage?.output_tokens),
          reasoning: num(obj(usage?.output_tokens_details)?.thinking_tokens),
          cacheRead: num(usage?.cache_read_input_tokens),
          cacheWrite: num(usage?.cache_creation_input_tokens),
        };
        // [F66 tier-pricing] Calls over the long-context size, priced apart.
        if (isOn("tier-pricing") && calls.size > 0) {
          const long = [...calls.values()].filter((c) => c.input + c.cacheRead + c.cacheWrite > LONG_PROMPT);
          if (long.length > 0) {
            run.usage.long = {
              input: long.reduce((n, c) => n + c.input, 0),
              cacheRead: long.reduce((n, c) => n + c.cacheRead, 0),
              cacheWrite: long.reduce((n, c) => n + c.cacheWrite, 0),
              output: Math.round(((run.usage.output ?? 0) * long.length) / calls.size),
            };
          }
        }
        // The model that did the most output is the one that answered.
        const models = obj(event.modelUsage);
        if (models) {
          let best: string | undefined;
          let bestOut = -1;
          for (const [name, value] of Object.entries(models)) {
            const out = num(obj(value)?.outputTokens) ?? 0;
            if (out > bestOut) {
              best = name;
              bestOut = out;
            }
          }
          run.model = best ?? run.model;
        }
        const denials = Array.isArray(event.permission_denials) ? event.permission_denials : [];
        if (event.is_error === true || event.subtype !== "success") {
          run.detail = short(`${String(event.subtype)} ${run.finalText} ${String(event.api_error_status ?? "")}`, 600);
          run.stop = quotaBlocked ? "quota" : classifyFailure(run.detail);
        } else {
          run.stop = "done";
          // Claude can be refused a tool and still finish; keep a note of it.
          if (denials.length > 0) run.detail = `denied: ${short(denials, 300)}`;
        }
      }
    },
    result: () => run,
    finished: () => run.stop !== undefined,
  };
}

export const claude: AgentBackend = {
  id: "claude",
  displayName: "Claude Code",
  direct: true,
  version: () => capture("claude", ["--version"]),
  run(request: AgentRequest): Promise<AgentResult> {
    return runCli({
      command: "claude",
      args: claudeArgs(request),
      stdin: request.prompt,
      request,
      parser: claudeParser(request),
    });
  },
};
