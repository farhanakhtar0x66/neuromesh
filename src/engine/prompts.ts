// What each role is told. Kept short: every word here is paid for on every turn.
// The expert only ever sees briefs, diffs and exact failures, never a worker's chat.

import type { AgentResult } from "../backends/types.ts";
import { parseStructured } from "../backends/shared.ts";
import type { CheckResult, CheckSpec } from "../checks/checks.ts";
import { fileURLToPath } from "node:url";
import { isOn } from "../features.ts";
import type { Spec } from "../intake/brief.ts";
import type { Advice, Finding, Plan, PlannedTask, RunState, TaskState, Verdict, WorkerReport } from "./types.ts";

export const REPORT_SCHEMA = {
  type: "object",
  properties: {
    status: { type: "string", enum: ["done", "blocked", "split"] },
    summary: { type: "string" },
    notes: { type: "string" },
    run: { type: "string" },
  },
  required: ["status", "summary", "notes", "run"],
  additionalProperties: false,
};

export const SPEC_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    summary: { type: "string" },
    features: { type: "array", items: { type: "string" } },
    behaviour: { type: "array", items: { type: "string" } },
    out_of_scope: { type: "array", items: { type: "string" } },
    design: { type: "array", items: { type: "string" } },
    acceptance: {
      type: "array",
      items: {
        type: "object",
        properties: { command: { type: "string" }, expect: { type: "string" } },
        required: ["command", "expect"],
        additionalProperties: false,
      },
    },
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
  required: ["name", "summary", "features", "behaviour", "out_of_scope", "design", "acceptance", "tasks"],
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
          severity: { type: "string", enum: ["blocker", "minor"] },
          check: { type: "string" },
        },
        required: ["problem", "file", "reproduce", "severity", "check"],
        additionalProperties: false,
      },
    },
  },
  required: ["verdict", "summary", "findings"],
  additionalProperties: false,
};

/** [F63 scout-facts] What the scout found. */
export const FACTS_SCHEMA = {
  type: "object",
  properties: { facts: { type: "array", items: { type: "string" } } },
  required: ["facts"],
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
- notes: anything the reviewer should know (assumptions, things left undone); empty if none
- run: the shell command that starts the program from this directory, if it is a program a person runs; empty otherwise`;

/** Absolute path of the agents' tool, so any CLI can run it from any directory. */
export const NM_TOOL = fileURLToPath(new URL("../tools/nm.ts", import.meta.url));

/** [F12 context-packet] The repository map for a prompt, when there is one. */
function contextSection(state: RunState): string {
  if (!state.contextPacket || !isOn("context-packet")) return "";
  return `\n\nThe repository, mapped by Neuromesh before you started (no need to rediscover it; read only what you need):\n${state.contextPacket}`;
}

/** [F13 nm-tools] How to use the shared tool. */
function toolsNote(): string {
  if (!isOn("nm-tools")) return "";
  return `\n\nTo find your way cheaply, use this read-only tool from your shell instead of listing directories or reading whole files: \`node ${NM_TOOL} map [words]\` (repository map), \`node ${NM_TOOL} show <file> <function or class>\` (one definition with line numbers), \`node ${NM_TOOL} find <regex> [path]\` (matches grouped by file), \`node ${NM_TOOL} checks\` (the project's checks, failures only in full).`;
}

function isWholeRequest(state: RunState, task: TaskState): boolean {
  return state.tasks.length === 1 && task.brief === state.prompt;
}

/** A cheap model turns a request too short to build from into a product spec. */
export function specPrompt(request: string, brief?: string, facts?: string[]): string {
  // [F63 scout-facts] Checked on this machine before you write, so the spec does not guess.
  const checked = facts && facts.length > 0 ? `\nFacts checked on this machine and against the real data just now (trust these over memory; design for them):\n${facts.map((f) => `- ${f}`).join("\n")}\n` : "";
  // [F54 work-env]
  const env = isOn("work-env")
    ? "\nNeuromesh installs the packages a project declares (requirements.txt or pyproject.toml for Python, package.json for Node) into an environment it manages, and the developer, the checks and the acceptance runs all use it. A third-party package is fine where it is the usual choice; keep them few.\n"
    : "";
  return `You are the lead engineer. A less experienced developer is about to build the request below on their own, from what you write now; you will not see their work. Write the product spec and the design they need. Do not write code and do not create or edit files.

The request:
${request}
${brief && brief !== request ? `\nThe full brief they will get (the request plus standards they must meet):\n${brief}\n` : ""}${checked}${env}
If the request is already detailed, do not repeat it: cover only what it leaves open, and put most of your effort into the design.

Give your answer in the required JSON format:
- name: a short working name of your own for the product
- summary: two or three sentences on what it is and who uses it
- features: ${isOn("spec-cap") ? "6 to 10" : "8 to 14"} must-have features, most important first. Include what anyone asking for this would expect without saying it. One sentence each, concrete enough to check.
- behaviour: the exact rules that are easy to get wrong: how every number shown is calculated, what every key or command does, what happens at the edges (empty input, the end, a mistake, going back), and what each screen or output shows.
- out_of_scope: what not to build, so that it stays one sitting of work (accounts, network features, settings nobody asked for).
- design: ${isOn("spec-cap") ? "5 to 8" : "6 to 12"} points on how to build it: the files or modules and what each one does, the data model, how input flows to the screen or output, and the hard parts with exactly how to handle them (the mistakes a less experienced developer would make here).
- acceptance: ${isOn("acceptance-runs") ? "2 to 4 real uses of the finished program, each a shell command run from the project folder (relative paths only, no installs, under 2 minutes, no keyboard input) and what must be true of its result: its output, or the files it writes (name them). Use the real thing the program is for (a real website, a real file), not a test fixture: these catch what tests on made-up samples miss. A terminal program that needs a keyboard gets an empty list." : "an empty list."}
- tasks: ${isOn("spec-plan") ? `the build order. Cheap, fast developers build it, each in a fresh session that sees the spec, your task brief and the files so far; a session that has to hold more than about 300 lines of new code and its tests gets slow and expensive. So split the program into 2 to 5 tasks of that size, each owning its own files (its module and that module's tests; the README and the entry point in the last task), with depends_on for tasks that need another's code. Each brief names the exact functions, signatures and data shapes others rely on, and how to tell it is done. Mark a task "expert" only if it needs reasoning a cheap model would likely get wrong (a tricky algorithm, subtle concurrency); you will build that one yourself. A program under about 300 lines in all is one task.` : "an empty list."}

Rules:
- Do not contradict the request, and do not choose the programming language unless the request does.
- Where the request names an existing product as its model, describe the expected features in your own generic terms. Do not copy that product's name, texts, word lists or artwork.
- Prefer a small product that is complete and pleasant to use over a long list of half-features.${
    // [F15 spec-cap] The spec writer's output is most of an expert spec turn's cost.
    isOn("spec-cap") ? "\n- Be compact: one or two sentences per point, and about 900 words in all. Every word is read by the developer; say each thing once." : ""
  }`;
}

export function parseSpec(result: AgentResult): Spec | undefined {
  const raw = (result.structured ?? parseStructured(result.finalText)) as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== "object") return undefined;
  const list = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.trim().length > 0).map((v) => v.trim()) : []);
  const features = list(raw.features);
  if (features.length === 0) return undefined;
  const acceptance = Array.isArray(raw.acceptance)
    ? (raw.acceptance as unknown[])
        .map((a) => a as { command?: unknown; expect?: unknown })
        .filter((a) => typeof a?.command === "string" && a.command.trim() !== "")
        .map((a) => ({ command: (a.command as string).trim(), expect: typeof a.expect === "string" ? a.expect.trim() : "" }))
        .slice(0, 4)
    : [];
  const tasks = Array.isArray(raw.tasks) ? (raw.tasks as NonNullable<Spec["tasks"]>) : [];
  return {
    name: typeof raw.name === "string" ? raw.name.trim() : "",
    summary: typeof raw.summary === "string" ? raw.summary.trim() : "",
    features,
    behaviour: list(raw.behaviour),
    outOfScope: list(raw.out_of_scope),
    design: list(raw.design),
    ...(acceptance.length > 0 ? { acceptance } : {}),
    ...(tasks.length > 0 ? { tasks } : {}),
  };
}

/**
 * [F63 scout-facts] A cheap model checks the facts a spec depends on before the
 * expert writes it: what this machine has, and what the real data looks like.
 * The python-bot spec guessed Wikipedia's math markup and was wrong.
 */
export function scoutPrompt(request: string, machine: string[]): string {
  return `A program is about to be designed for the request below. Before the design is written, check the facts it depends on. Do not write the program.

The request:
${request}

Known about this machine already:
${machine.map((m) => `- ${m}`).join("\n")}

Check, briefly (a few commands; you may use the network and write scratch files in this folder):
1. If the program works with something outside itself (a website, an online service, a file format, a device), fetch or open one real example and note its exact shape: the parts the program must handle, and anything that differs from what most people would assume (markup that changed, fields that are missing, limits, required headers).
2. Anything about this machine that the design must respect (a package that will not install, a tool that is missing).

Give your answer in the required JSON format: facts, at most 10, each one concrete sentence a designer can act on. Leave out what any developer already knows.`;
}

export function parseFacts(result: AgentResult): string[] {
  const raw = (result.structured ?? parseStructured(result.finalText)) as { facts?: unknown } | undefined;
  return Array.isArray(raw?.facts) ? raw.facts.filter((f): f is string => typeof f === "string" && f.trim() !== "").map((f) => f.trim().slice(0, 400)).slice(0, 10) : [];
}

/** [F68 split-ask] A worker may hand a task that is too big or too hard back to the lead engineer, once. */
function splitNote(task: TaskState): string {
  if (!isOn("split-ask") || task.owner !== "worker" || task.fromSplit || task.splitAsked || task.escalated) return "";
  return `\n\nIf this task turns out much bigger than one short sitting (well over about 300 lines of new code and its tests), or needs reasoning you are not confident you can get right (a tricky algorithm, subtle concurrency), do not push on: stop early and answer with status "split", saying in notes what makes it big or hard. The lead engineer then divides it, or builds the hard part, and hands the rest back. Keep what you wrote; it is kept.`;
}

/** The first turn of a task. */
export function taskPrompt(state: RunState, task: TaskState): string {
  if (isWholeRequest(state, task)) {
    return `You are working on a software project. Complete the request below by editing the files in the current directory.

Request:
${state.prompt}${contextSection(state)}${toolsNote()}

${checkList(state.checks)}

${WORKER_RULES}${splitNote(task)}`;
  }
  const owned = task.owned.length > 0 ? `\nFiles and folders you own for this task: ${task.owned.join(", ")}. Change other files only if the task cannot be done without it, and say so in your notes.` : "";
  return `You are one worker on a team building a change to this software project. Another part of the team planned the work; you do one task of it.

The overall request, for context only:
${state.prompt}

Your task: ${task.title}
${task.brief}${owned}

Other tasks of the plan are done by others. Do not do them, but do not break them either.${contextSection(state)}${toolsNote()}

${checkList(state.checks)}

${WORKER_RULES}${splitNote(task)}`;
}

/**
 * [F68 split-ask] The worker said its task is too big or too hard. The expert
 * divides it into worker-sized parts, keeping for itself only what needs deep
 * reasoning; that part is built first and the rest is handed out.
 */
export function splitPrompt(state: RunState, task: TaskState, files: string[]): string {
  return `You are the lead engineer. A worker on your team started the task below and stopped: it judged the task too big or too hard for one short session. Its work so far stays in the project.

The overall request (with its spec):
${state.prompt}

The task: ${task.title}
${task.brief}

What the worker said: ${(task.report?.notes || task.report?.summary || "(nothing)").slice(0, 1_500)}
Files it has written so far: ${files.join(", ") || "(none)"}

Split the rest of this task into 2 to 4 parts, each one short worker session (about 300 lines of new code and its tests), each owning its own files, in build order (depends_on). Each brief names the exact functions, signatures and data shapes the others rely on, says what of the worker's code to keep, and how to tell it is done. Mark a part "expert" only if it needs reasoning a cheap model would likely get wrong; you will build that part yourself before the parts that depend on it. Use short ids like "a", "b". Do not change files now.

Give your answer in the required JSON format: summary (one sentence) and tasks (id, title, brief, owned, depends_on, owner).`;
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

/** A stronger worker picks up where a quicker one got stuck, keeping its work. */
export function climbPrompt(state: RunState, task: TaskState): string {
  const last = task.history[task.history.length - 1];
  const what = !last
    ? "It stopped without finishing."
    : last.findings && last.findings.length > 0
      ? `A reviewer found these problems with it:\n\n${findingText(last.findings)}`
      : `What went wrong:\n${last.failures.slice(0, 6_000)}`;
  return `${taskPrompt(state, task)}

A quicker colleague attempted this task first and got stuck. Its changes are still in the files (\`git diff\` shows them). ${what}

Finish the task correctly: keep what is right in those changes and fix or replace the rest.`;
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

${state.contextPacket && isOn("context-packet") ? `The project, mapped by Neuromesh:\n${state.contextPacket}` : `Project files:\n${listing.join("\n")}`}

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

/** What earlier reviews of this task asked for, so a reviewer does not reverse itself. */
function earlierReviews(task: TaskState): string {
  // [F06 review-memory]
  if (!isOn("review-memory")) return "";
  const earlier = task.history.flatMap((h) => h.findings ?? []).filter((f) => f.severity !== "minor");
  if (earlier.length === 0) return "";
  return `

Earlier reviews of this task asked for these, and the developer has worked on them since:
${findingText(earlier.slice(-8))}

Check whether they are fixed. Do not ask for the opposite of an earlier finding, and do not fail the change over a choice the request (and its spec, if any) leaves open: there, the developer's choice stands.`;
}

export function testerPrompt(state: RunState, task: TaskState, diff: string, screens?: string, acceptance?: string): string {
  const what = isWholeRequest(state, task) ? `The request:\n${state.prompt}` : `The overall request:\n${state.prompt}\n\nThe task under review: ${task.title}\n${task.brief}`;
  return `You are reviewing a change made by another engineer. Decide whether it does what was asked, correctly.

${what}

The change:
\`\`\`diff
${diff.slice(0, 24_000)}
\`\`\`

The project's own checks already pass. Look for what they miss: requirements not met, wrong behaviour in edge cases the request mentions, broken existing behaviour. You may read files and run commands, and you may write small scripts to try the change. Your edits here are thrown away afterwards.${toolsNote()}${earlierReviews(task)}

Keep the review focused and quick: go through the requirements the request states, try each with a short probe, and stop. Do not build a large test suite or hunt for cases the request does not mention. A few minutes is enough.${
    screens
      ? `\n\nThis is a full-screen terminal program, so reading the code is not enough. ${screens}\n\nCompare these screens with the request. A garbled, cut-off or overflowing screen, a crash or stack trace, typed text that does not appear or is not marked, a key that does the wrong thing, or a program that does not quit is a blocker. Point to the screen that shows it.`
      : ""
  }${
    // [F58 acceptance-runs]
    acceptance
      ? `\n\nNeuromesh ran the program for real, as the spec's acceptance runs say, before you started. Judge these results first: each one either meets what it expects or it does not. A result that falls short is a blocker even when every test passes.\n\n${acceptance}`
      : ""
  }

Be strict about the request and lenient about style. Do not fail the change for things the request did not ask for.

Give your answer in the required JSON format:
- verdict: "pass" or "fail"
- summary: one sentence
- findings: for a fail, each concrete problem with the file and a command or input that shows it; empty for a pass
- severity of each finding: "blocker" when something the request states is missing or wrong, or the program crashes, hangs or loses data; "minor" for everything else (polish, wording, layout details, cases the request does not mention). Fail the change only if there is at least one blocker; list minor findings with a pass.
- check: ${isOn("reproduced-findings") ? "a shell command, run from the project folder, that exits non-zero while the problem is there and 0 once it is fixed. It must stand on its own (for example `python3 -c ...` or `node -e ...` with the probe inline, or a grep of a file an acceptance run wrote); your edits to the project's files are undone before it runs. Neuromesh runs it, and a blocker whose check exits 0 is dropped as not shown. Write a check for every blocker you can; leave it empty only where no command can show the problem (layout, wording)." : "an empty string."}`;
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

/**
 * [F62 advice-cap] The stuck state in a few thousand characters: the latest
 * change (cut short; the expert can read the files), what failed, and the
 * reviewer's open findings. The earlier attempt shows only which files it touched.
 */
export function compactAttempts(task: TaskState): string {
  const last = task.history.at(-1);
  if (!last) return "";
  const earlier = task.history.at(-2);
  const files = (diff: string): string[] => [...diff.matchAll(/^diff --git a\/(\S+)/gm)].map((m) => m[1]!).slice(0, 30);
  const findings = (last.findings ?? []).filter((f) => f.severity !== "minor");
  const parts = [
    `The latest change touches: ${files(last.diff).join(", ") || "(nothing)"}. Read the files for the detail; the start of the diff:\n\`\`\`diff\n${last.diff.slice(0, 2_500)}\n\`\`\``,
    `What went wrong:\n${last.failures.slice(-1_800) || "(the checks passed)"}`,
  ];
  if (findings.length > 0) parts.push(`The reviewer's open findings:\n${findingText(findings.slice(0, 5))}`);
  if (earlier) parts.push(`The attempt before touched: ${files(earlier.diff).join(", ") || "(nothing)"}; it failed with:\n${(earlier.failures || "(checks passed; reviewer findings)").slice(-600)}`);
  return parts.join("\n\n");
}

/** The cheap first step of escalation: the expert looks, explains, and the worker fixes. */
export function advisePrompt(state: RunState, task: TaskState, observed?: string): string {
  const attempts = isOn("advice-cap") ? compactAttempts(task) : attemptsText(task);
  return `You are the lead engineer. A worker on your team is stuck on the task below, and you are asked for advice, not to do the work. Do not change any files. The current directory holds the worker's latest attempt.

${isWholeRequest(state, task) ? `The request:\n${state.prompt}` : `The overall request:\n${state.prompt}\n\nThe task: ${task.title}\n${task.brief}`}

The worker's last attempts and how they failed (its reasoning is left out; do not assume its approach was right):

${attempts || "(no attempt was recorded)"}${
    // [F61 advice-facts] What the worker saw happen, which is evidence, unlike its theories.
    observed ? `\n\nWhat the worker observed (commands that failed in its environment, and what it reported; facts about the environment, not about the cause):\n${observed}` : ""
  }${contextSection(state)}${toolsNote()}

Read only what you need, find the real cause, and tell the worker how to fix it. The worker is capable but missed something; give it the key insight and concrete steps (which file, which function, what to change), not a full implementation. Every step must be something the worker can do where it works: it cannot change the machine, and Neuromesh installs declared packages itself. If a step needs the environment changed (a package that will not install, no network), say so in the diagnosis instead. Keep it short.

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

/** [F14 expert-patch] The expert fixes the reviewer's findings in the worker's code. */
export function patchPrompt(state: RunState, task: TaskState): string {
  const findings = task.history.flatMap((h) => h.findings ?? []).filter((f) => f.severity !== "minor");
  const latest = task.history.at(-1)?.findings ?? [];
  return `You are the lead engineer. A worker built the task below and the project's checks pass, but a reviewer found problems the worker could not fix. The current directory holds the worker's code.

${isWholeRequest(state, task) ? `The request:\n${state.prompt}` : `The overall request:\n${state.prompt}\n\nThe task: ${task.title}\n${task.brief}`}

The reviewer's latest findings:
${findingText(latest)}
${findings.length > latest.length ? `\nEarlier findings, for context (some may be fixed already):\n${findingText(findings.slice(0, -latest.length).slice(-6))}\n` : ""}${contextSection(state)}${toolsNote()}

Fix these problems with the smallest changes that do it. Keep the worker's structure and everything that already works; do not rewrite or restyle working code. If a finding is wrong, leave the code as it is and say why in your notes.

${checkList(state.checks)}

${WORKER_RULES}`;
}

/**
 * [F60 no-rebuild] The expert fixes the worker's code in place: never a rebuild.
 * Every expensive build so far was a rebuild from an empty folder.
 */
export function fixInPlacePrompt(state: RunState, task: TaskState, observed?: string): string {
  return `You are the lead engineer. A worker built the task below but could not finish it, even with your advice. The current directory holds its work.

${isWholeRequest(state, task) ? `The request:\n${state.prompt}` : `The overall request:\n${state.prompt}\n\nThe task: ${task.title}\n${task.brief}`}

Where it stands (the worker's reasoning is left out on purpose):

${compactAttempts(task) || "(no attempt was recorded)"}${observed ? `\n\nWhat the worker observed:\n${observed}` : ""}${task.advice ? `\n\nYour earlier advice, which the worker followed:\n${adviceText(task.advice)}` : ""}${contextSection(state)}${toolsNote()}

Fix what is wrong in the worker's code with the smallest changes that do it. Keep its structure and everything that works; do not rewrite, restyle or start over. Your time on this is limited and the turn is stopped when it runs out, so fix the most important problem first.

${checkList(state.checks)}

${WORKER_RULES}`;
}

/** [F56 env-blocked] The environment, not the code, was at fault; this does not count as a repair round. */
export function envRepairPrompt(task: TaskState): string {
  return `Neuromesh ran the project's checks on your change, and they failed because of the environment, not your logic:

${task.envProblem ?? "(no detail)"}

Neuromesh installs exactly what requirements.txt (or pyproject.toml) and package.json declare, before every check. Declare what is missing there, under its installable package name; do not skip or remove tests because a package is missing. Then run the checks again and give your final answer in the same JSON format as before.`;
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

${attempts || "(no attempt was recorded)"}${contextSection(state)}${toolsNote()}

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
      status: structured.status === "done" || structured.status === "blocked" || structured.status === "split" ? structured.status : "unknown",
      summary: structured.summary,
      notes: typeof structured.notes === "string" && structured.notes.trim() !== "" ? structured.notes : undefined,
      run: typeof structured.run === "string" && structured.run.trim() !== "" ? structured.run.trim() : undefined,
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
        .map((f) => ({ problem: f.problem, file: f.file || undefined, reproduce: f.reproduce || undefined, severity: f.severity === "minor" ? ("minor" as const) : ("blocker" as const), check: typeof f.check === "string" && f.check.trim() !== "" ? f.check.trim() : undefined }))
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
