# Features since v0.1

Every capability added after v0.1.0 has an id. Its code is marked `[Fxx key]`, its events carry `feature: "Fxx"`, and its errors name it. When Neuromesh goes wrong, the run summary, the event log (`events.jsonl`) and the usage log (`~/.neuromesh/usage/USAGE.md`, "Features that failed") say which feature was involved.

- Switch features off: `--disable <id or key,...>` on any command, `NEUROMESH_DISABLE=...` in the environment, or `"disable": [...]` in a preset.
- Optional features that fail are switched off for the rest of the run and the run carries on; a core feature that fails ends the run with its id and a `--disable` hint.
- `NEUROMESH_FAULT=<key>` makes a feature fail on purpose, to check the handling.
- `neuromesh features` prints this list with what is on.

| Id | Key | Kind | What it does | Where |
| --- | --- | --- | --- | --- |
| F01 | `brief-engine` | optional | Cleans the request, attaches documents it names, adds working standards and decides the staffing, with no model call. | `src/intake/brief.ts`, `src/engine/run.ts (startRun)` |
| F02 | `spec-step` | optional | A spec writer turns a short request for something new into features, behaviour rules, scope and a design. | `src/engine/run.ts (specStep)`, `src/engine/prompts.ts (specPrompt)` |
| F03 | `expert-spec` | optional | With an expert spec writer, every new program gets a spec and design before the workers start. | `src/intake/brief.ts (staff)`, `presets/factory-opus-luna.json` |
| F04 | `screen-check` | optional | Runs a full-screen terminal program in tmux, plays generic user actions and gives the screens to the tester. | `src/checks/screen.ts`, `src/engine/run.ts (screensFor)` |
| F05 | `tester-severity` | optional | The tester marks findings blocker or minor; a review with only minor findings lets the task merge. | `src/engine/run.ts (test step)`, `src/engine/prompts.ts (VERDICT_SCHEMA)` |
| F06 | `review-memory` | optional | The tester sees its earlier findings and may not reverse them or fail a choice the spec leaves open. | `src/engine/prompts.ts (earlierReviews)` |
| F07 | `review-only-merge` | optional | Once the expert's advice was tried and the checks pass, remaining reviewer objections are recorded instead of sent to an expert rebuild. | `src/engine/run.ts (test step)` |
| F08 | `lean-claude` | optional | Claude Code gets only the tools a turn needs, a short system prompt for read-only turns, and nothing from the user's setup. | `src/backends/claude.ts (claudeArgs)` |
| F09 | `codex-session-totals` | core | Resumed Codex sessions report running totals; the engine records the change per turn. | `src/engine/run.ts (once, perTurnAttempts)`, `src/backends/codex.ts` |
| F10 | `work-created-checks` | optional | A project with no checks picks up the tests the work itself adds, and they gate the task. | `src/engine/run.ts (checks step)` |
| F11 | `usage-log` | optional | Records every real run and the owner's rating in ~/.neuromesh/usage/USAGE.md. | `src/usage/log.ts`, `src/cli/main.ts (finish, rate, usage)` |
| F12 | `context-packet` | optional | A repository map and the signatures most relevant to the request, built with no model call and put in the prompt, so agents explore less. | `src/context/packet.ts`, `src/engine/prompts.ts (taskPrompt, advisePrompt, escalationPrompt)` |
| F13 | `nm-tools` | optional | One shell tool any agent CLI can call: repository map, symbol bodies, ranked search, the project's checks in short form. | `src/tools/nm.ts`, `src/engine/prompts.ts (toolsNote)` |
| F14 | `expert-patch` | optional | When checks pass and only review findings remain, the expert fixes the named problems in the worker's tree instead of rebuilding from the start. | `src/engine/run.ts (escalate step)`, `src/engine/prompts.ts (patchPrompt)` |
| F15 | `spec-cap` | optional | Asks the spec writer for a compact spec, since its output is most of an expert spec turn's cost. | `src/engine/prompts.ts (specPrompt)` |
| F16 | `dollar-budget` | optional | Caps a run's expert spending by estimated API cost as well as by tokens. | `src/engine/run.ts (budgetLeft)`, `src/presets/presets.ts (expertBudgetUsd)` |
| F17 | `live-cost` | optional | Shows each turn's estimated cost as it finishes, and cost by role in the summary. | `src/engine/run.ts (once)`, `src/cli/format.ts` |
| F18 | `screen-check-2` | optional | Waits out a countdown the program shows, so a timed run that never ends by itself is caught. | `src/checks/screen.ts (countdown wait)` |
