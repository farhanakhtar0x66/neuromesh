A cheap worker sometimes hands back a feature built from stand-ins: functions whose body is `raise NotImplementedError`, `pass`, `...`, `unimplemented!()`, `todo!()`, a thrown "not implemented" error, or a `// TODO: implement ...` comment. The project's checks pass because nothing exercises them. Add a scanner that finds such stand-ins in a diff, so the engine can fail the checks.

New file src/checks/stubs.ts, exporting:

- `findStubs(diff: string): { file: string; line: number; text: string }[]` reads a git unified diff and looks only at ADDED lines (not context lines, not removed lines, not the "+++" header). `file` is the path from the "+++ b/<path>" header; `line` is the line's number in the new file (from the hunk header "@@ -a,b +c,d @@", counting added and context lines); `text` is the line, trimmed. Results are in diff order.
- `describeStubs(stubs): string` gives one line per stub, "<file>:<line>: <text>", for the failure message the developer is shown.

What counts as a stand-in (in added lines of source files):
- Python: `raise NotImplementedError`, or a line that is only `pass` or only `...` as the body of a def (also `async def`).
- Rust: `unimplemented!()` and `todo!()`.
- JavaScript and TypeScript: `throw new Error("Not implemented yet")` (any error message that says "not implemented", in any case), a comment `// TODO: implement ...`, and a placeholder comment like `/* implementation goes here */`.
- Go: `panic("todo")`.

What does not count:
- A plain TODO comment that is not about implementing ("TODO: tune timeout in prod"); names such as `mock_response`; empty callbacks and empty catch blocks (`() => {}`, `catch {}`); `pass` inside `while True:` or `for ...:` loops.
- Abstract methods: a def under `@abstractmethod` whose body is `raise NotImplementedError` or `pass`.
- Anything in test files (paths with a tests/ directory, `test_*.py`, `*.test.ts` and the like) and in documentation (`.md`).
- Lines that are context or removed lines, even if they look like stand-ins.

Tests are in test/stubs.test.ts.
