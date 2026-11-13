// Codex in non-interactive mode (`codex exec --json`).
//
// Codex reports cached input as part of input_tokens, so fresh input is the
// difference. It does not report which model answered.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentBackend, AgentRequest, AgentResult } from "./types.ts";
import { addUsage, classifyFailure } from "./types.ts";
import { capture } from "./proc.ts";
import { num, obj, parseStructured, runCli, short, str } from "./shared.ts";
import type { ParsedRun, StreamParser } from "./shared.ts";

export function codexArgs(request: AgentRequest, schemaPath?: string): string[] {
  const sandbox = request.access === "write" ? "workspace-write" : "read-only";
  const args = request.resumeSessionId
    ? ["exec", "resume", request.resumeSessionId, "--json", "-c", `sandbox_mode="${sandbox}"`]
    : ["exec", "--json", "-C", request.cwd, "-s", sandbox];
  // [F55 worker-network] Codex's workspace-write sandbox has no network unless asked.
  if (request.network && request.access === "write") args.push("-c", "sandbox_workspace_write.network_access=true");
  if (request.model) args.push("-m", request.model);
  if (request.effort) args.push("-c", `model_reasoning_effort="${request.effort}"`);
  if (schemaPath) args.push("--output-schema", schemaPath);
  args.push("-"); // read the prompt from standard input
  return args;
}

export function codexParser(request: Pick<AgentRequest, "onActivity" | "outputSchema" | "onText">): StreamParser {
  const run: ParsedRun = { finalText: "", usage: {} };
  let lastError: string | undefined;
  let completed = false;
  let failed = false;

  return {
    onEvent(event) {
      const type = str(event.type);
      if (type === "thread.started") {
        run.sessionId = str(event.thread_id);
        return;
      }
      if (type === "item.started" || type === "item.completed") {
        const item = obj(event.item);
        if (!item) return;
        if (item.type === "agent_message" && type === "item.completed") {
          run.finalText = str(item.text) ?? run.finalText;
          request.onActivity?.({ kind: "text", summary: short(item.text, 160) });
          // [F83 early-exit]
          if (str(item.text)) request.onText?.(str(item.text)!);
        } else if (item.type === "command_execution" && type === "item.started") {
          request.onActivity?.({ kind: "tool", summary: `$ ${short(item.command, 110)}` });
        } else if (item.type === "file_change" && type === "item.completed") {
          // The files it changed, by name: the change list itself is long JSON.
          const changes = Array.isArray(item.changes) ? item.changes.map((c) => str(obj(c)?.path)).filter(Boolean) : [];
          request.onActivity?.({ kind: "tool", summary: changes.length ? `edit ${changes.join(", ")}` : `edit ${short(item.changes, 110)}` });
        } else if (item.type === "error") {
          lastError = str(item.message) ?? lastError;
        }
        return;
      }
      if (type === "turn.completed") {
        completed = true;
        const usage = obj(event.usage);
        const total = num(usage?.input_tokens);
        const cached = num(usage?.cached_input_tokens);
        run.usage = addUsage(run.usage, {
          input: total === undefined ? undefined : total - (cached ?? 0),
          output: num(usage?.output_tokens),
          reasoning: num(usage?.reasoning_output_tokens),
          cacheRead: cached,
          cacheWrite: num(usage?.cache_write_input_tokens),
        });
        return;
      }
      if (type === "turn.failed") {
        failed = true;
        lastError = str(obj(event.error)?.message) ?? lastError;
        return;
      }
      if (type === "error") {
        lastError = str(event.message) ?? lastError;
      }
    },
    finished: () => completed || failed,
    result() {
      if (failed) {
        run.detail = lastError ?? "turn failed";
        run.stop = classifyFailure(run.detail);
      } else if (completed) {
        run.stop = "done";
        if (request.outputSchema) run.structured = parseStructured(run.finalText);
      } else if (lastError) {
        run.detail = lastError;
      }
      return run;
    },
  };
}

export const codex: AgentBackend = {
  id: "codex",
  displayName: "Codex",
  // `codex exec resume` reports the thread's running totals (seen in its own session files).
  sessionTotals: true,
  version: () => capture("codex", ["--version"]),
  async run(request: AgentRequest): Promise<AgentResult> {
    let schemaDir: string | undefined;
    let schemaPath: string | undefined;
    if (request.outputSchema) {
      schemaDir = mkdtempSync(join(tmpdir(), "neuromesh-schema-"));
      schemaPath = join(schemaDir, "schema.json");
      writeFileSync(schemaPath, JSON.stringify(request.outputSchema));
    }
    try {
      return await runCli({
        command: "codex",
        args: codexArgs(request, schemaPath),
        stdin: request.prompt,
        request,
        parser: codexParser(request),
        ownSandbox: true,
      });
    } finally {
      if (schemaDir) rmSync(schemaDir, { recursive: true, force: true });
    }
  },
};
