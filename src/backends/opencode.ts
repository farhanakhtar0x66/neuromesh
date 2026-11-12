// [F50 opencode] opencode in its headless mode (`opencode run --format json`):
// the route to every model opencode knows, including API-key models the owner
// adds with `opencode auth login` (the key stays with opencode; Neuromesh never
// sees it). Models are written provider/model, e.g. opencode/big-pickle.
//
// Headless facts (opencode 2.2.5):
// - Events, one JSON object a line: step_start, tool_use (part.tool,
//   part.state), text (part.text), step_finish (part.tokens, part.cost), and
//   error. Every event carries the sessionID, which `--session` continues.
// - step_finish tokens are per step: input (fresh), output, reasoning and
//   cache.read / cache.write. part.cost is what the provider charges; on a
//   free or subscription model it is 0, on an API-key model real money.
// - `--auto` approves what is not explicitly denied (writes, commands);
//   `--agent plan` is opencode's read-only agent.
// - There is no output-schema flag: the schema goes in the prompt, and the
//   answer is read from the last text.

import type { AgentBackend, AgentRequest, AgentResult } from "./types.ts";
import { addUsage, classifyFailure } from "./types.ts";
import { capture } from "./proc.ts";
import { num, obj, parseStructured, runCli, short, str } from "./shared.ts";
import type { ParsedRun, StreamParser } from "./shared.ts";

export function opencodeArgs(request: AgentRequest): string[] {
  const args = ["run", "--format", "json"];
  if (request.model) args.push("--model", request.effort ? `${request.model}#${request.effort}` : request.model);
  if (request.access === "write") args.push("--auto");
  else args.push("--agent", "plan");
  if (request.resumeSessionId) args.push("--session", request.resumeSessionId);
  return args;
}

/** The prompt, with the answer's format spelled out when one is asked for. */
export function opencodePrompt(request: AgentRequest): string {
  if (!request.outputSchema) return request.prompt;
  return `${request.prompt}\n\nEnd your turn with only a JSON object (no other text, no code fence) matching this JSON Schema:\n${JSON.stringify(request.outputSchema)}`;
}

export function opencodeParser(request: Pick<AgentRequest, "onActivity" | "outputSchema">): StreamParser {
  const run: ParsedRun = { finalText: "", usage: {} };
  let lastText = "";
  let finished = false;
  let failed: string | undefined;
  let cost = 0;
  let priced = false;

  return {
    onEvent(event) {
      const type = str(event.type);
      run.sessionId = str(event.sessionID) ?? run.sessionId;
      const part = obj(event.part);
      if (type === "tool_use" && part) {
        const state = obj(part.state);
        request.onActivity?.({ kind: "tool", summary: `${str(part.tool) ?? "tool"} ${short(state?.input, 100)}` });
        return;
      }
      if (type === "text" && part) {
        const text = str(part.text) ?? "";
        if (text.trim()) {
          lastText = text;
          request.onActivity?.({ kind: "text", summary: short(text, 160) });
        }
        return;
      }
      if (type === "step_finish" && part) {
        const tokens = obj(part.tokens);
        const cache = obj(tokens?.cache);
        run.usage = addUsage(run.usage, {
          input: num(tokens?.input),
          output: num(tokens?.output),
          reasoning: num(tokens?.reasoning),
          cacheRead: num(cache?.read),
          cacheWrite: num(cache?.write),
        });
        const c = num(part.cost);
        if (c !== undefined) {
          cost += c;
          priced = true;
        }
        if (str(part.reason) === "stop") finished = true;
        return;
      }
      if (type === "error") {
        failed = str(obj(event.error)?.message) ?? str(event.message) ?? short(event, 200);
      }
    },
    finished: () => finished || failed !== undefined,
    result() {
      run.finalText = lastText;
      if (priced) run.costUsdEquivalent = cost;
      if (failed) {
        run.detail = failed;
        run.stop = classifyFailure(failed);
      } else if (finished || lastText) {
        run.stop = "done";
        if (request.outputSchema) run.structured = parseStructured(lastText);
      }
      return run;
    },
  };
}

export const opencode: AgentBackend = {
  id: "opencode",
  displayName: "opencode",
  version: () => capture("opencode", ["--version"]),
  run(request: AgentRequest): Promise<AgentResult> {
    return runCli({ command: "opencode", args: opencodeArgs(request), stdin: opencodePrompt(request), request, parser: opencodeParser(request) });
  },
};
