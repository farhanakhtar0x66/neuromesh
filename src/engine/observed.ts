// [F61 advice-facts] What a worker saw happen, for the expert.
//
// The handoff to the expert leaves the worker's reasoning out on purpose (a
// stuck worker's theories mislead). In the python-bot run that also left out
// a fact: the worker had tried to install a package three ways and been
// refused each time. The expert, not knowing, advised `pip install`. Commands
// that failed and the worker's own "blocked" report are evidence about the
// environment, so they go to the expert, short and labelled as such.

import { readFileSync } from "node:fs";

export interface FailedCommand {
  command: string;
  exitCode?: number;
  output: string;
}

function lines(path: string): Record<string, unknown>[] {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const out: Record<string, unknown>[] = [];
  for (const line of text.split("\n")) {
    if (!line.startsWith("{")) continue;
    try {
      out.push(JSON.parse(line) as Record<string, unknown>);
    } catch {
      // Not an event.
    }
  }
  return out;
}

const tidy = (s: string, n: number): string => {
  const one = s.replace(/\s+\n/g, "\n").trim();
  return one.length > n ? `…${one.slice(-n)}` : one;
};

/** Commands that failed in one agent log (Codex or Claude Code); empty for other tools. */
export function failedCommands(logPath: string): FailedCommand[] {
  const found: FailedCommand[] = [];
  const claudeCalls = new Map<string, string>();
  for (const e of lines(logPath)) {
    // Codex: item.completed with a command_execution item.
    const item = e.item as Record<string, unknown> | undefined;
    if (e.type === "item.completed" && item?.type === "command_execution") {
      const code = typeof item.exit_code === "number" ? item.exit_code : undefined;
      if (code !== undefined && code !== 0) {
        found.push({ command: String(item.command ?? ""), exitCode: code, output: String(item.aggregated_output ?? "") });
      }
      continue;
    }
    // Claude Code: a Bash tool_use, then a tool_result marked as an error.
    const message = e.message as { content?: unknown } | undefined;
    const content = Array.isArray(message?.content) ? (message.content as Record<string, unknown>[]) : [];
    for (const block of content) {
      if (e.type === "assistant" && block.type === "tool_use" && block.name === "Bash") {
        const input = block.input as { command?: unknown } | undefined;
        if (typeof block.id === "string" && typeof input?.command === "string") claudeCalls.set(block.id, input.command);
      }
      if (e.type === "user" && block.type === "tool_result" && block.is_error === true && typeof block.tool_use_id === "string") {
        const command = claudeCalls.get(block.tool_use_id);
        if (command === undefined) continue;
        const output = typeof block.content === "string" ? block.content : JSON.stringify(block.content ?? "");
        found.push({ command, output });
      }
    }
  }
  return found;
}

/**
 * The observed facts for a task: the last failed commands across the given
 * logs, and the worker's latest report when it said it was blocked or left
 * notes. At most about 2,500 characters.
 */
export function observedText(logPaths: string[], report?: { status: string; notes?: string; summary?: string }): string {
  const commands = logPaths.flatMap((p) => failedCommands(p));
  // The same command failing again adds nothing.
  const seen = new Set<string>();
  const unique = commands.reverse().filter((c) => {
    const key = c.command.replace(/\s+/g, " ").trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 5).reverse();
  const parts = unique.map((c) => `$ ${tidy(c.command.replace(/^\/bin\/(?:z|ba)?sh -lc /, ""), 200)}\n  -> ${c.exitCode !== undefined ? `exit ${c.exitCode}: ` : "error: "}${tidy(c.output, 280)}`);
  if (report && (report.status === "blocked" || report.notes)) {
    parts.push(`The worker's report (${report.status}): ${tidy(`${report.status === "blocked" ? `${report.summary ?? ""} ` : ""}${report.notes ?? ""}`, 700)}`);
  }
  return parts.join("\n").slice(0, 2_600);
}
