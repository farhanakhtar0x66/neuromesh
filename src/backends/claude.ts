// Claude Code in print mode (`claude -p`).
//
// The prompt goes in on standard input. `--allowedTools` takes a list, and a
// prompt placed after it on the command line would be read as a tool name.

import type { AgentBackend, AgentRequest, AgentResult } from "./types.ts";
import { classifyFailure } from "./types.ts";
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

export function claudeArgs(request: AgentRequest): string[] {
  const args = ["-p", "--output-format", "stream-json", "--verbose"];
  if (request.model) args.push("--model", request.model);
  if (request.effort) args.push("--effort", request.effort);
  if (request.outputSchema) args.push("--json-schema", JSON.stringify(request.outputSchema));
  if (request.resumeSessionId) args.push("--resume", request.resumeSessionId);
  args.push(...LEAN);
  if (request.access === "write") {
    args.push("--tools", WRITE_TOOLS, "--permission-mode", "acceptEdits", "--allowedTools", "Bash", "Edit", "Write");
  } else {
    args.push("--tools", READ_TOOLS, "--system-prompt", READ_ONLY_SYSTEM_PROMPT, "--permission-mode", "plan");
  }
  return args;
}

export function claudeParser(request: Pick<AgentRequest, "onActivity">): StreamParser {
  const run: ParsedRun = { finalText: "", usage: {} };
  let quotaBlocked = false;

  return {
    onEvent(event) {
      const type = str(event.type);
      if (type === "system" && event.subtype === "init") {
        run.sessionId = str(event.session_id);
        run.model = str(event.model);
        return;
      }
      if (type === "assistant") {
        const content = obj(event.message)?.content;
        if (!Array.isArray(content)) return;
        for (const block of content) {
          const b = obj(block);
          if (b?.type === "text" && str(b.text)) {
            request.onActivity?.({ kind: "text", summary: short(b.text, 160) });
          } else if (b?.type === "tool_use") {
            request.onActivity?.({ kind: "tool", summary: `${str(b.name) ?? "tool"} ${short(b.input, 100)}` });
          }
        }
        return;
      }
      if (type === "rate_limit_event") {
        const info = obj(event.rate_limit_info);
        const status = str(info?.status);
        if (status && !status.startsWith("allowed")) quotaBlocked = true;
        const windows = obj(info?.unifiedWindows);
        if (windows) {
          const used: Record<string, number> = {};
          for (const [name, value] of Object.entries(windows)) {
            const utilization = num(obj(value)?.utilization);
            if (utilization !== undefined) used[name] = utilization;
          }
          run.quotaUsed = used;
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
