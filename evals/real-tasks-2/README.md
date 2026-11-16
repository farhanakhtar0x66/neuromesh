# Real-repository tasks, batch 2 (beta week 1)

Candidate tasks for the beta claim (`HANDOFF.md` item 6f, `docs/22-path-to-the-goal.md` phase 1): about 40 real tasks on
which Haiku alone passes 40 to 70 percent. Batch 1 (`evals/real-tasks/`) was too easy: Haiku alone passed 10 of 10
(`rt-haiku-1`). Built offline on 2026-11-16, no model call. **Nothing here has been run on a model yet**: the
difficulty column of `MANIFEST.md` is a guess, and the Haiku-alone run (below) is what sets the real mix.

The task folders (seed, hidden tests, reference) are made from the recipe and are not committed (`.gitignore`); what is
committed is the recipe: the manifests, the prompts, the hand-written references and the synthetic patches.

## Three sources, two builders

| Source | Recipe | Builder |
| --- | --- | --- |
| 10 ProofBench fixtures (Rust) | `proofbench.json`, `prompts/pb-*.md`, `references/<name>/` | `node evals/import-fixture.ts evals/real-tasks-2/proofbench.json` |
| 17 neuromesh commits (TypeScript) | `batch-2.json`, `prompts/nm-*.md` | `node evals/make-batch.ts evals/real-tasks-2/batch-2.json` |
| 2 synthetic refactors | `batch-2.json` entries with `synthetic`, `synthetic/*.patch` | the same `make-batch.ts` |

Both builders make the same folder layout as batch 1 and validate every task with `evals/validate-task.ts` (fails on the
seed, passes on the reference in each of 3 runs in fresh copies, no test changes between runs).

    node evals/import-fixture.ts evals/real-tasks-2/proofbench.json      # makes and validates the 10 Rust tasks
    node evals/make-batch.ts evals/real-tasks-2/batch-2.json             # makes and validates the other 19

`import-fixture.ts` reads `~/Projects/Global AI Hack/proofbench/fixtures/coding-tasks/<n>/` (`--fixtures` to change it):
seed = `workspace/` without `tests/` and `target/`; hidden tests = its `tests/` (kept as `hidden/tests/tests/*.rs`);
reference = `solution/` where the fixture has one (tasks 1, 2, 3, 5) and otherwise `references/<name>/files/`, written
for this batch (tasks 4, 6, 7, 8, 9, 10: the fixture ships only a workspace). The two lists come from `cargo test
--offline --no-fail-fast` on the seed and on the reference, as `make-task.ts` does.

A **synthetic** task is a change nobody committed: the real repositories hold no behaviour-keeping refactor commit with
a test that fails before it. `synthetic/<name>.patch` (a git diff, new test file included) is applied on the entry's
`base` commit in a temporary clone and committed there, then `make-task.ts` runs on that commit. The task's `task.json`
says `"synthetic": true`. Keep these two apart from the real commits in any count.

## Running them

    neuromesh eval --suite evals/real-tasks-2 --fake                                           # no model calls: every task must pass
    neuromesh eval --suite evals/real-tasks-2 --preset solo-haiku --name rt2-haiku-1 --quota   # LIVE: spends quota, run from an idle session

## What was audited, and what to know before trusting a number

- **Prompt leak audit.** ProofBench's prompts were written for a benchmark that shows the tests to the agent. Each was
  rewritten: every "ensure `cargo test` passes", "all unit tests in `tests/...` pass" and test count was removed, the
  examples were changed so they are not the tests' own values, and where the original prompt did not state a behaviour
  the hidden tests assert (tasks 9 and 10, parts of 7), the behaviour was added. The mined prompts end with "Graded by
  new tests in X (not in your copy of the repository)" instead of "Tests are in X".
- **Prompts name what the tests need, nothing about how.** Batch 1's convention, kept: every name, field, event and text
  the hidden tests rely on is in the prompt. For the long engine tasks this makes prompts of 250 to 500 words; they are
  not terse on purpose (difficulty must come from the work, not from hiding the contract).
- **Seeds of the ProofBench tasks carry comments that name the bug** (`// BUG: ...`, `// REGRESSION BUG: reads parts[1]
  instead of parts[2]`, `// TODO: implement ...`). They are kept as the fixtures have them, so those ten tasks are the
  floor of the mix, not a test of finding bugs. Stripping them would make four of them harder; it was not done because
  the task says the seed is the workspace as it is.
- **The neuromesh tasks are one repository**, and Claude models wrote much of it. A held-out half split by repository
  has only the ProofBench and scope-test-2 tasks in it.
- **Hand-written references** (six ProofBench tasks, two synthetic ones) are mine, not the original authors': they pass
  the hidden tests, nothing more.
- **Hidden checks can be slow on a failing attempt.** The engine tests of `nm-two-step-escalation` and `nm-worker-ladder` loop on the seed until the grader's 10-minute limit (they fail, but slowly), and the first-run validation of those two takes about 25 minutes. Plan the live run's wall time for it.
- **Tests run by name pattern** for the engine tasks (the rest of `engine.test.ts` takes about 2.5 minutes), as in batch 1.
