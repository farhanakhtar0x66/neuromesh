// What the worker is told. Kept short: every word here is paid for on every turn.

import type { AgentResult } from "../backends/types.ts";
import type { CheckResult } from "../checks/checks.ts";
import { parseStructured } from "../backends/shared.ts";
import type { RunState, WorkerReport } from "./types.ts";

export const REPORT_SCHEMA = {
  type: "object",
  properties: {
    status: { type: "string", enum: ["done", "blocked"] },
    summary: { type: "string" },
    notes: { type: "string" },
  },
  required: ["status", "summary", "notes"],
  additionalProperties: false,
};

function checkList(state: RunState): string {
  if (state.checks.length === 0) return "This project has no automatic checks. Test your change by hand where you can.";
  const lines = state.checks.map((c) => `- ${c.name}: \`${c.command}\``);
  return `Neuromesh runs these checks after you finish. Run them yourself before you stop:\n${lines.join("\n")}`;
}

const RULES = `Rules:
- Work only inside the current directory.
- Do not commit, push, switch branches or change git settings. Neuromesh collects your changes from the files.
- Keep the change focused on the request. Do not reformat or rewrite unrelated code.
- Nobody can answer questions during this task. Make reasonable choices and mention them in your notes.
- If something truly blocks you, stop and explain it.

When you finish, give your final answer in the required JSON format:
- status: "done", or "blocked" if you could not complete the request
- summary: one or two sentences on what you changed
- notes: anything the reviewer should know (assumptions, things left undone); empty if none`;

export function initialPrompt(state: RunState): string {
  return `You are working on a software project. Complete the request below by editing the files in the current directory.

Request:
${state.prompt}

${checkList(state)}

${RULES}`;
}

function failureText(results: CheckResult[], baseline: CheckResult[] | undefined): string {
  return results
    .filter((r) => r.status === "failed" || r.status === "timeout")
    .map((r) => {
      const before = baseline?.find((b) => b.name === r.name);
      const history =
        before?.status === "failed"
          ? " It was already failing before you started; if your request was meant to fix it, it is not fixed yet."
          : " It passed before you started, so your change broke it.";
      const what = r.status === "timeout" ? "took too long and was stopped" : `failed (exit code ${r.exitCode})`;
      return `Check "${r.name}" (\`${r.command}\`) ${what}.${history}\nLast lines of its output:\n\`\`\`\n${r.tail.slice(-3_000)}\n\`\`\``;
    })
    .join("\n\n");
}

/** Sent to the same session, so it can be short. */
export function repairPrompt(state: RunState): string {
  return `Neuromesh ran the project's checks on your change and some failed.

${failureText(state.latest ?? [], state.baseline)}

Fix the problem, run the checks again, then give your final answer in the same JSON format as before.`;
}

/** For a repair that has to start a fresh session, because resuming failed. */
export function standaloneRepairPrompt(state: RunState): string {
  return `${initialPrompt(state)}

An earlier attempt already changed some files in this directory, but the project's checks failed afterwards. Look at the current state of the files (git diff shows the changes so far) and fix the problem.

${failureText(state.latest ?? [], state.baseline)}`;
}

/** After an interruption the old session is not trusted; a fresh one checks the files. */
export function continuePrompt(state: RunState): string {
  return `${initialPrompt(state)}

Note: an earlier attempt at this request was interrupted part way. Some files may already be changed. Run \`git status\` and \`git diff\` first to see what was done, then finish the request.`;
}

export function parseReport(result: AgentResult): WorkerReport {
  const structured = (result.structured ?? parseStructured(result.finalText)) as Partial<WorkerReport> | undefined;
  if (structured && typeof structured.summary === "string") {
    return {
      status: structured.status === "done" || structured.status === "blocked" ? structured.status : "unknown",
      summary: structured.summary,
      notes: typeof structured.notes === "string" && structured.notes.trim() !== "" ? structured.notes : undefined,
    };
  }
  const text = result.finalText.trim();
  return { status: "unknown", summary: text === "" ? "(the agent gave no final answer)" : text.slice(0, 600) };
}
