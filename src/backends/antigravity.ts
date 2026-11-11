// Antigravity (`agy`): the only working route to Gemini models on an individual
// Google subscription. Gemini CLI itself now refuses individual accounts.
//
// Headless facts found in M0 (agy 1.5.5):
// - `--mode accept-edits` lets it write files but auto-denies every shell
//   command, because headless mode cannot ask.
// - `--sandbox` does not help: sandboxed commands cannot write inside the
//   working folder at all (EPERM), yet they can write in the home folder.
// - What works is a session-only allow rule passed with `--settings`. It is
//   never saved to the user's settings. Commands then run unsandboxed, so this
//   mode does not confine the agent to its folder.
// - A denied action still ends with status SUCCESS and an empty response, so
//   `denied_actions` has to be checked.
// - `--mode plan` writes a plan file into its own data folder first, which
//   costs an extra model turn.

import type { AgentBackend, AgentRequest, AgentResult } from "./types.ts";
import { classifyFailure } from "./types.ts";
import { capture } from "./proc.ts";
import { num, obj, runCli, short, str } from "./shared.ts";
import type { ParsedRun, StreamParser } from "./shared.ts";

export function antigravityArgs(request: AgentRequest): string[] {
  const args = ["-p", request.prompt, "--output-format", "stream-json"];
  if (request.model) args.push("--model", request.model);
  if (request.effort) args.push("--effort", request.effort);
  if (request.access === "write") {
    const allow = (request.allowCommands ?? ["*"]).map((command) => `command(${command})`);
    args.push("--mode", "accept-edits", "--settings", JSON.stringify({ permissions: { allow } }));
  } else {
    args.push("--mode", "plan");
  }
  if (request.outputSchema) args.push("--json-schema", JSON.stringify(request.outputSchema));
  if (request.resumeSessionId) args.push("--conversation", request.resumeSessionId);
  return args;
}

export function antigravityParser(request: Pick<AgentRequest, "onActivity">): StreamParser {
  const run: ParsedRun = { finalText: "", usage: {} };
  const toolErrors: string[] = [];

  return {
    onEvent(event) {
      const kind = str(event.event);
      if (kind === "init") {
        run.sessionId = str(event.conversation_id);
        run.model = str(obj(event.init)?.model);
        return;
      }
      if (kind === "step_update") {
        const step = obj(event.step_update);
        if (!step || step.step_type !== "tool") return;
        const info = obj(step.tool_info);
        if (step.state === "ACTIVE") {
          request.onActivity?.({
            kind: "tool",
            summary: `${str(step.tool_name) ?? "tool"} ${short(info?.parameters, 100)}`,
          });
        } else if (step.state === "ERROR") {
          const message = str(obj(info?.error)?.message);
          if (message) toolErrors.push(short(message, 300));
        }
        return;
      }
      if (kind === "result") {
        const result = obj(event.result);
        if (!result) return;
        run.sessionId = str(result.conversation_id) ?? run.sessionId;
        run.finalText = str(result.response) ?? "";
        run.structured = result.structured_output;
        const usage = obj(result.usage);
        run.usage = {
          input: num(usage?.input_tokens),
          output: num(usage?.output_tokens),
          reasoning: num(usage?.thinking_tokens),
          cacheRead: num(usage?.cache_read_tokens),
        };
        const denied = Array.isArray(result.denied_actions) ? result.denied_actions : [];
        if (denied.length > 0) {
          run.stop = "permission";
          run.detail = toolErrors[0] ?? `denied: ${short(denied, 200)}`;
        } else if (result.status === "SUCCESS") {
          run.stop = "done";
        } else {
          run.detail = short(result.error ?? result.response ?? result.status, 600);
          run.stop = classifyFailure(`${String(result.status)} ${run.detail}`);
        }
      }
    },
    result: () => run,
    finished: () => run.stop !== undefined,
  };
}

export const antigravity: AgentBackend = {
  id: "agy",
  displayName: "Antigravity",
  version: () => capture("agy", ["--version"]),
  run(request: AgentRequest): Promise<AgentResult> {
    return runCli({
      command: "agy",
      args: antigravityArgs(request),
      request,
      parser: antigravityParser(request),
    });
  },
};
