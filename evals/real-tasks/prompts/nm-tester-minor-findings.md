On the first typing-app build the tester found a new small problem every round, and each one cost another round and finally the expert. Small problems should not decide that.

Let the tester mark each finding with a severity, "blocker" or "minor" (a field `severity` on every finding, in the tester's output format and in the stored verdict). Only blockers cost another round or the expert. When a review fails but every finding is minor, the task merges as it is, with no further round, and the engine emits a `note` event whose message says the review had only minor findings.

In the engine's test the tester returns a failing verdict with one minor finding (a typo in the help text): the task's attempts are then exactly the build and the test, the stored verdict keeps the finding with its severity "minor", and the note is present.

Tests are in test/engine.test.ts; the engine is in src/engine/run.ts and the tester's prompt and schema in src/engine/prompts.ts.
