# Real-repository tasks (plan item M1)

Tasks made from real commits, with no model call: the seed is the commit's parent, the prompt is an issue
written from the change, the hidden check is the tests that came with it (fail-to-pass and pass-to-pass), and
the reference is the real change. Made by `evals/make-task.ts`, checked by `evals/validate-task.ts`; this
batch is rebuilt from its recipe with

    node evals/make-batch.ts evals/real-tasks/batch-1.json

The task folders themselves (seed, reference, hidden tests) are made from the recipe and are not committed:
`batch-1.json` names each repository and commit, `prompts/<name>.md` is each prompt.

## Batch 1 (2026-11-16): 10 tasks, all valid

On the seed every fail-to-pass test fails and every pass-to-pass test passes; on the reference all of them
pass in each of 3 runs, in fresh copies, and no test changes its result between runs.

| Task | Kind | Language | From | fail-to-pass | pass-to-pass |
| --- | --- | --- | --- | --- | --- |
| nm-prose-guard | bug | TypeScript | neuromesh `caec42b` (F99) | 1 | 13 |
| nm-first-turn-retry | bug | TypeScript | neuromesh `7727c8e` (F97) | 3 | 1 |
| nm-dropped-connection | bug | TypeScript | neuromesh `eff0b85` | 1 | 0 |
| nm-no-bytecode-in-diff | bug | TypeScript | neuromesh `8dadadc` | 2 | 0 |
| ss2-notes-bound | bug | JavaScript | scope-test-2 `42a7973` | 7 | 125 |
| nm-screen-countdown | feature | TypeScript | neuromesh `e3b2394` (F18) | 1 | 3 |
| nm-quota-cooldown | feature | TypeScript | neuromesh `83942dd` | 2 | 0 |
| nm-tester-minor-findings | feature | TypeScript | neuromesh `ca2c0af` | 1 | 0 |
| nm-stub-scanner | feature | TypeScript | neuromesh `3d7b17d` (F95, tests of `stubs.ts` only) | 3 | 0 |
| ss2-notes-fold | feature | JavaScript | scope-test-2 `ee334f1` | 28 | 96 |

## What this batch is not

- **Not yet a benchmark.** Nothing here says how hard a task is: Haiku alone has not been run on any of them
  (phase 1, step 4 of `docs/22-path-to-the-goal.md`), so there is no mix of easy and hard yet.
- **No refactor, no Python, no Rust.** The two repositories' history holds no commit that is a behaviour-keeping
  refactor with a test that fails before it, and the tasks are TypeScript (8) and JavaScript (2).
- **Two repositories, not independent ones.** Eight tasks are from neuromesh itself, so they cannot be split
  into tuning and held-out halves by repository, and a model working on Neuromesh's own code knows its style.
  Both repositories are private, so no model has seen these changes, but Claude models wrote much of them.
- **Prompts are checked by one reader.** Each prompt names the files, functions, fields and formats its tests
  rely on (a solution cannot be right without them) and says nothing about how to implement them. A person
  other than the author should read each one for leaks before it counts.
- **A test that cannot load counts as failing.** In the scope-test-2 tasks the test files import a function
  that does not exist on the seed, so all their tests fail there; that is why `ss2-notes-fold` has 28
  fail-to-pass tests, most of them older tests that only needed the file to load.
- The tests of five neuromesh tasks run only the new or changed tests of an engine test file
  (`--test-name-pattern`); the rest of that file is slow and is not part of the grade.
