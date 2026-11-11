// What each role is told. Kept short: every word here is paid for on every turn.
// The expert only ever sees briefs, diffs and exact failures, never a worker's chat.

import type { AgentResult } from "../backends/types.ts";
import { parseStructured } from "../backends/shared.ts";
import type { CheckResult, CheckSpec } from "../checks/checks.ts";
import type { Advice, Finding, Plan, PlannedTask, RunState, TaskState, Verdict, WorkerReport } from "./types.ts";

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

export const PLAN_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    tasks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          brief: { type: "string" },
          owned: { type: "array", items: { type: "string" } },
          depends_on: { type: "array", items: { type: "string" } },
          owner: { type: "string", enum: ["worker", "expert"] },
        },
        required: ["id", "title", "brief", "owned", "depends_on", "owner"],
        additionalProperties: false,
      },
    },
  },
  required: ["summary", "tasks"],
  additionalProperties: false,
};

export const VERDICT_SCHEMA = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["pass", "fail"] },
    summary: { type: "string" },
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          problem: { type: "string" },
          file: { type: "string" },
          reproduce: { type: "string" },
        },
        required: ["problem", "file", "reproduce"],
        additionalProperties: false,
      },
    },
  },
  required: ["verdict", "summary", "findings"],
  additionalProperties: false,
};

export const ADVICE_SCHEMA = {
  type: "object",
  properties: {
    diagnosis: { type: "string" },
    steps: { type: "array", items: { type: "string" } },
  },
  required: ["diagnosis", "steps"],
  additionalProperties: false,
};

function checkList(checks: CheckSpec[]): string {
  if (checks.length === 0) return "This project has no automatic checks. Test your change by hand where you can.";
  return `Neuromesh runs these checks after you finish. Run them yourself before you stop:\n${checks.map((c) => `- ${c.name}: \`${c.command}\``).join("\n")}`;
}

const WORKER_RULES = `Rules:
- Work only inside the current directory.
- Do not commit, push, switch branches or change git settings. Neuromesh collects your changes from the files.
- Keep the change focused on your task. Do not reformat or rewrite unrelated code.
- Nobody can answer questions during this task. Make reasonable choices and mention them in your notes.
- If something truly blocks you, stop and explain it.

When you finish, give your final answer in the required JSON format:
- status: "done", or "blocked" if you could not complete the task
- summary: one or two sentences on what you changed
- notes: anything the reviewer should know (assumptions, things left undone); empty if none`;

function isWholeRequest(state: RunState, task: TaskState): boolean {
  return state.tasks.length === 1 && task.brief === state.prompt;
}

/** The first turn of a task. */
export function taskPrompt(state: RunState, task: TaskState): string {
  if (isWholeRequest(state, task)) {
    return `You are working on a software project. Complete the request below by editing the files in the current directory.

Request:
${state.prompt}

${checkList(state.checks)}

${WORKER_RULES}`;
  }
  const owned = task.owned.length > 0 ? `\nFiles and folders you own for this task: ${task.owned.join(", ")}. Change other files only if the task cannot be done without it, and say so in your notes.` : "";
  return `You are one worker on a team building a change to this software project. Another part of the team planned the work; you do one task of it.

The overall request, for context only:
${state.prompt}

Your task: ${task.title}
${task.brief}${owned}

Other tasks of the plan are done by others. Do not do them, but do not break them either.

${checkList(state.checks)}

${WORKER_RULES}`;
}

function failureText(results: CheckResult[], baseline: CheckResult[] | undefined): string {
  return results
    .filter((r) => r.status === "failed" || r.status === "timeout")
    .map((r) => {
      const before = baseline?.find((b) => b.name === r.name);
      const history =
        before?.status === "failed"
          ? " It was already failing before the work started; if the request was meant to fix it, it is not fixed yet."
          : " It passed before the work started, so the change broke it.";
      const what = r.status === "timeout" ? "took too long and was stopped" : `failed (exit code ${r.exitCode})`;
      return `Check "${r.name}" (\`${r.command}\`) ${what}.${history}\nLast lines of its output:\n\`\`\`\n${r.tail.slice(-3_000)}\n\`\`\``;
    })
    .join("\n\n");
}

export function failureSummary(results: CheckResult[] | undefined, baseline: CheckResult[] | undefined): string {
  return failureText(results ?? [], baseline);
}

/** Sent to the same session, so it can be short. */
export function repairPrompt(state: RunState, task: TaskState): string {
  return `Neuromesh ran the project's checks on your change and some failed.

${failureText(task.latest ?? [], state.baseline)}

Fix the problem, run the checks again, then give your final answer in the same JSON format as before.`;
}

function findingText(findings: Finding[]): string {
  return findings
    .map((f, i) => `${i + 1}. ${f.problem}${f.file ? `\n   File: ${f.file}` : ""}${f.reproduce ? `\n   To reproduce: ${f.reproduce}` : ""}`)
    .join("\n");
}

export function reviewFixPrompt(task: TaskState): string {
  return `A reviewer checked your change against the task and found problems:

${findingText(task.verdict?.findings ?? [])}

Fix them, run the checks again, then give your final answer in the same JSON format as before.`;
}

/** When the session cannot be continued (a different model, or resuming failed). */
export function freshFollowUpPrompt(state: RunState, task: TaskState): string {
  const why =
    task.next === "review-fix"
      ? `A reviewer found problems with it:\n\n${findingText(task.verdict?.findings ?? [])}`
      : `The project's checks failed afterwards:\n\n${failureText(task.latest ?? [], state.baseline)}`;
  return `${taskPrompt(state, task)}

An earlier attempt at this task already changed some files in this directory (\`git diff\` shows them). ${why}

Fix the problem.`;
}

export function continuePrompt(state: RunState, task: TaskState): string {
  return `${taskPrompt(state, task)}

Note: an earlier attempt at this task was interrupted part way. Some files may already be changed. Run \`git status\` and \`git diff\` first to see what was done, then finish the task.`;
}

export function redoPrompt(state: RunState, task: TaskState): string {
  return `${taskPrompt(state, task)}

Note: you did this task before, but other tasks finished in the meantime and changed the same files, so your change no longer applies. The current files include their work. Make your change again on top of it. For reference, this was your earlier change:

\`\`\`diff
${(task.previousDiff ?? "").slice(0, 12_000)}
\`\`\``;
}

export function plannerPrompt(state: RunState, files: string[]): string {
  const listing = files.length > 300 ? [...files.slice(0, 300), `… and ${files.length - 300} more files`] : files;
  return `You are the lead engineer of a small team. Your job right now is to plan, not to code. Read the project as much as you need (you cannot change files), then split the request below into tasks for the team.

Request:
${state.prompt}

Project files:
${listing.join("\n")}

${state.checks.length > 0 ? `The project's checks: ${state.checks.map((c) => `\`${c.command}\``).join(", ")}` : "The project has no automatic checks."}

How the team works:
- Workers are fast, cheap models. Each gets only your brief for its task, in a fresh copy of the project with every earlier task's work already merged in. They write the code and its tests, and run the checks.
- Independent tasks are built at the same time by different workers, so splitting saves time; every task also costs a fixed overhead for starting a worker. Give parts that live in separate files and do not need each other's code their own tasks. Keep a part together when splitting it would make workers edit the same files. If the request is really one change to one place, plan exactly one task. Never plan more than ${state.maxTasks}.
- Give each task the files or folders it owns; tasks that can run side by side must not own the same files. A task that only needs another task's interface still depends on it, unless your brief spells that interface out exactly (names, signatures, return values), in which case both can start at once.
- A task that needs another task's result lists it in depends_on.
- Mark a task "expert" only if it needs deep reasoning a cheap model would likely get wrong (subtle concurrency, tricky algorithms, delicate design). You will do those yourself. Everything else is "worker".
- Each brief must stand on its own: what to build, exact names and behaviour (function signatures, formats, error cases) that other tasks rely on, which tests to add, and how to tell it is done. Copy the exact requirements from the request; do not summarise them away.

Give your answer in the required JSON format: summary (one sentence) and tasks (id, title, brief, owned, depends_on, owner). Use short ids like "t1".`;
}

export function testerPrompt(state: RunState, task: TaskState, diff: string): string {
  const what = isWholeRequest(state, task) ? `The request:\n${state.prompt}` : `The overall request:\n${state.prompt}\n\nThe task under review: ${task.title}\n${task.brief}`;
  return `You are reviewing a change made by another engineer. Decide whether it does what was asked, correctly.

${what}

The change:
\`\`\`diff
${diff.slice(0, 24_000)}
\`\`\`

The project's own checks already pass. Look for what they miss: requirements not met, wrong behaviour in edge cases the request mentions, broken existing behaviour. You may read files and run commands, and you may write small scripts or tests to try the change. Your edits here are thrown away afterwards.

Be strict about the request and lenient about style. Do not fail the change for things the request did not ask for.

Give your answer in the required JSON format:
- verdict: "pass" or "fail"
- summary: one sentence
- findings: for a fail, each concrete problem with the file and a command or input that shows it; empty for a pass`;
}

function attemptsText(task: TaskState): string {
  return task.history
    .slice(-2)
    .map((h, i) => {
      const reviewer = h.findings && h.findings.length > 0 ? `\nReviewer findings:\n${findingText(h.findings)}` : "";
      return `Attempt ${i + 1}, its change:\n\`\`\`diff\n${h.diff.slice(0, 8_000)}\n\`\`\`\nWhat went wrong:\n${h.failures.slice(0, 4_000) || "(checks passed)"}${reviewer}`;
    })
    .join("\n\n");
}

/** The cheap first step of escalation: the expert looks, explains, and the worker fixes. */
export function advisePrompt(state: RunState, task: TaskState): string {
  return `You are the lead engineer. A worker on your team is stuck on the task below, and you are asked for advice, not to do the work. Do not change any files. The current directory holds the worker's latest attempt.

${isWholeRequest(state, task) ? `The request:\n${state.prompt}` : `The overall request:\n${state.prompt}\n\nThe task: ${task.title}\n${task.brief}`}

The worker's last attempts and how they failed (its reasoning is left out; do not assume its approach was right):

${attemptsText(task) || "(no attempt was recorded)"}

Read what you need, find the real cause, and tell the worker how to fix it. The worker is capable but missed something; give it the key insight and concrete steps (which file, which function, what to change), not a full implementation. Keep it short.

Give your answer in the required JSON format:
- diagnosis: what is actually wrong, in a few sentences
- steps: the changes to make, in order`;
}

function adviceText(advice: Advice | undefined): string {
  if (!advice) return "";
  return `Diagnosis: ${advice.diagnosis}\n\nWhat to do:\n${advice.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}`;
}

export function advisedFixPrompt(task: TaskState): string {
  return `The lead engineer looked at your work and the failures.

${adviceText(task.advice)}

Follow this advice, run the checks again, then give your final answer in the same JSON format as before.`;
}

export function freshAdvisedFixPrompt(state: RunState, task: TaskState): string {
  return `${taskPrompt(state, task)}

An earlier attempt at this task already changed some files in this directory (\`git diff\` shows them), but it did not work. The lead engineer looked at it:

${adviceText(task.advice)}

Follow this advice.`;
}

export function parseAdvice(result: AgentResult): Advice | undefined {
  const a = (result.structured ?? parseStructured(result.finalText)) as Partial<Advice> | undefined;
  if (!a || typeof a.diagnosis !== "string" || a.diagnosis.trim() === "") return undefined;
  const steps = Array.isArray(a.steps) ? a.steps.filter((s): s is string => typeof s === "string" && s.trim() !== "") : [];
  return { diagnosis: a.diagnosis.trim(), steps };
}

export function escalationPrompt(state: RunState, task: TaskState): string {
  const attempts = task.history
    .slice(-2)
    .map((h, i) => {
      const reviewer = h.findings && h.findings.length > 0 ? `\nReviewer findings:\n${findingText(h.findings)}` : "";
      return `Attempt ${i + 1}, its change:\n\`\`\`diff\n${h.diff.slice(0, 8_000)}\n\`\`\`\nWhat went wrong:\n${h.failures.slice(0, 4_000) || "(checks passed)"}${reviewer}`;
    })
    .join("\n\n");
  return `You are the lead engineer. A worker could not finish the task below, and it has come to you. The files are back as they were before the worker started.

${isWholeRequest(state, task) ? `The request:\n${state.prompt}` : `The overall request:\n${state.prompt}\n\nThe task: ${task.title}\n${task.brief}`}

The worker's attempts and how they failed (its reasoning is left out on purpose; do not assume its approach was right):

${attempts || "(no attempt was recorded)"}

${checkList(state.checks)}

Do the task yourself. ${WORKER_RULES}`;
}

export function integrationPrompt(state: RunState, failing: CheckResult[]): string {
  const done = state.tasks.map((t) => `- ${t.title}: ${t.report?.summary ?? "done"}`).join("\n");
  return `You are the lead engineer. Your team finished every task of the plan below and the work is merged, but the project's checks now fail.

The request:
${state.prompt}

What the team did:
${done}

${failureText(failing, state.baseline)}

Find the problem and fix it with the smallest change that makes the request work.

${checkList(state.checks)}

${WORKER_RULES}`;
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

export function parseVerdict(result: AgentResult): Verdict | undefined {
  const v = (result.structured ?? parseStructured(result.finalText)) as Partial<Verdict> | undefined;
  if (!v || (v.verdict !== "pass" && v.verdict !== "fail")) return undefined;
  const findings = Array.isArray(v.findings)
    ? v.findings
        .filter((f): f is Finding => typeof f?.problem === "string" && f.problem.trim() !== "")
        .map((f) => ({ problem: f.problem, file: f.file || undefined, reproduce: f.reproduce || undefined }))
    : [];
  // A fail without anything concrete to fix is not actionable.
  if (v.verdict === "fail" && findings.length === 0) return { verdict: "pass", summary: `${v.summary ?? ""} (no concrete findings)`, findings };
  return { verdict: v.verdict, summary: typeof v.summary === "string" ? v.summary : "", findings };
}

/** Check a plan from the orchestrator and turn it into tasks. Throws with a reason the planner can act on. */
export function parsePlan(result: AgentResult, maxTasks: number): Plan {
  const raw = (result.structured ?? parseStructured(result.finalText)) as
    | { summary?: unknown; tasks?: { id?: unknown; title?: unknown; brief?: unknown; owned?: unknown; depends_on?: unknown; owner?: unknown }[] }
    | undefined;
  if (!raw || !Array.isArray(raw.tasks) || raw.tasks.length === 0) throw new Error("the plan has no tasks");
  if (raw.tasks.length > maxTasks) throw new Error(`the plan has ${raw.tasks.length} tasks; the limit is ${maxTasks}`);
  const tasks: PlannedTask[] = raw.tasks.map((t, i) => {
    const id = typeof t.id === "string" && /^[A-Za-z0-9_-]{1,32}$/.test(t.id) ? t.id : `t${i + 1}`;
    if (typeof t.brief !== "string" || t.brief.trim() === "") throw new Error(`task ${id} has no brief`);
    return {
      id,
      title: typeof t.title === "string" && t.title.trim() !== "" ? t.title.trim() : id,
      brief: t.brief.trim(),
      owned: Array.isArray(t.owned) ? t.owned.filter((p): p is string => typeof p === "string" && p.trim() !== "").map((p) => p.trim()) : [],
      dependsOn: Array.isArray(t.depends_on) ? t.depends_on.filter((d): d is string => typeof d === "string") : [],
      owner: t.owner === "expert" ? "expert" : "worker",
    };
  });
  const ids = new Set(tasks.map((t) => t.id));
  if (ids.size !== tasks.length) throw new Error("two tasks share an id");
  for (const t of tasks) {
    const unknown = t.dependsOn.filter((d) => !ids.has(d));
    if (unknown.length > 0) throw new Error(`task ${t.id} depends on unknown task(s) ${unknown.join(", ")}`);
    if (t.dependsOn.includes(t.id)) throw new Error(`task ${t.id} depends on itself`);
  }
  // Reject cycles: repeatedly remove tasks whose dependencies are all removed.
  const remaining = new Map(tasks.map((t) => [t.id, new Set(t.dependsOn)]));
  while (remaining.size > 0) {
    const ready = [...remaining].filter(([, deps]) => [...deps].every((d) => !remaining.has(d))).map(([id]) => id);
    if (ready.length === 0) throw new Error(`the dependencies form a cycle among ${[...remaining.keys()].join(", ")}`);
    for (const id of ready) remaining.delete(id);
  }
  return { summary: typeof raw.summary === "string" ? raw.summary : "", tasks };
}
