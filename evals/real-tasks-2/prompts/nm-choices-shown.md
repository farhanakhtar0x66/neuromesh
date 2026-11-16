A worker makes decisions nobody could be asked about (a limit it set or did not set, a format it picked, a reading of an unclear request) and leaves things out; both end up in its `notes`, which the summary cuts to 200 characters. Give them their own report fields, kept whole and shown in full.

- `WorkerReport` (`src/engine/types.ts`) gets `choices?: string` (each decision the worker made alone, one line each) and `open?: string` (what it left out or could not settle, and the question a person should answer about it).
- In `src/engine/prompts.ts`, `REPORT_SCHEMA` and `DIRECT_SCHEMA` become functions `reportSchema()` and `directSchema()` (change their callers in `src/engine/run.ts`): with the feature on they also have string properties `choices` and `open`, both added to `required`; with it off they are as before. The worker rules (what a worker is told about its final JSON answer) and the one-answer prompts ask for both fields.
- `parseReport` and `parseDirect` keep them: trimmed, whole (no length cut), left out when empty or only whitespace; with the feature off they are ignored.
- The `task.report` event carries both fields. `formatSummary` (`src/cli/format.ts`) prints, under a task, a `choices made:` block and a `left open:` block with the text in full (each line indented under the label), while notes stay cut to 200 characters. The TUI's task report text and its detailed blocks show them under "Choices made:" and "Left open:".
- Register F105, key `choices-shown`, optional, marked `// [F105 choices-shown]`. With it off nothing new is asked, parsed or printed.

Graded by new tests in `test/choices.test.ts` (not in your copy of the repository).
