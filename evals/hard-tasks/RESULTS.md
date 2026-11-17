# Beta baselines on hard-tasks

Generated 2026-11-17 12:46 UTC by `node evals/baselines.ts` from the saved evals in `/Users/farhanakhtar/.neuromesh/evals`. 12 tasks. Every figure is from **one run** of its preset (the cascade has two) and is a hint, not a measurement. "unknown" means the number was not recorded or the run is not finished; it is never 0.

## Runs

| Run | Preset | Tasks final | Resolved | Engine failures | Est. cost (API list prices) | 5-hour window, points | Weekly window, points | Minutes of work |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| hd-haiku-1 | solo-haiku | 12 of 12 | 9 of 12 (75.0%), one run | 0 | $1.16 (estimate) | 4 | 0 | 50.0 |
| hd-cascade-1 | cascade-claude | 12 of 12 | 11 of 12 (91.7%), one run | 0 | $3.12 (estimate) | 17 | 2 | 49.5 |
| hd-cascade-2 | cascade-claude | not run | unknown | unknown | unknown | unknown | unknown | unknown |
| hd-opus-1 | solo-opus | not run | unknown | unknown | unknown | unknown | unknown | unknown |

Costs are **estimates** at API list prices (`src/usage/prices.ts`), not money spent: the runs draw on one Claude plan. Window points are whole points of the plan's windows read by a one-word call before and after each task; a window that reset in between, or a task with no reading, is counted as unknown, not 0. Minutes are the time the final attempt of each task took; waiting for a reset is not counted. A task that failed because the engine failed (crash, hang) is counted separately from one where the model wrote wrong code.

## Paired comparisons

| Comparison (A against B) | Resolved A / B | Difference A − B, 90% interval (points) | A not worse than B by more than 10 points |
| --- | --- | --- | --- |
| cascade-claude (hd-cascade-1) against Opus alone (hd-opus-1) | unknown | unknown | unknown (hd-opus-1 has not been run) |
| cascade-claude (hd-cascade-1) against Haiku alone (hd-haiku-1) | 91.7% / 75.0% | -8.3 to +41.7 | shown |
| Haiku alone (hd-haiku-1) against Opus alone (hd-opus-1) | unknown | unknown | unknown (hd-opus-1 has not been run) |
| cascade run 1 (hd-cascade-1) against cascade run 2 (hd-cascade-2) | unknown | unknown | unknown (hd-cascade-2 has not been run) |

Each comparison pairs the tasks both configurations ran and resamples them 10,000 times (`node evals/bench.ts --compare A B --margin 10`; src/eval/stats.ts). "Shown" means the lower end of the 90% interval is above −10 points. A comparison is made only when every run in it has a final result on every task.

<details><summary>cascade-claude (hd-cascade-1) against Opus alone (hd-opus-1)</summary>

Not made: hd-opus-1 has not been run.

</details>

<details><summary>cascade-claude (hd-cascade-1) against Haiku alone (hd-haiku-1)</summary>

```
hd-cascade-1 against hd-haiku-1, paired over 12 tasks (runs per task: 1 and 1)
  resolved: 91.7% and 75.0%; mean difference +16.7 points
  90% interval for the difference: -8.3 to +41.7 points (10,000 task resamples, seed 1)
  not worse than hd-haiku-1 by more than 10 points: shown
  the interval holds zero: the two cannot be told apart on these tasks.
  with these tasks the data can show a margin of about 8.3 points, no tighter.
```

</details>

<details><summary>Haiku alone (hd-haiku-1) against Opus alone (hd-opus-1)</summary>

Not made: hd-opus-1 has not been run.

</details>

<details><summary>cascade run 1 (hd-cascade-1) against cascade run 2 (hd-cascade-2)</summary>

Not made: hd-cascade-2 has not been run.

</details>

## Phase 1 gate (docs/22-path-to-the-goal.md)

| Check | Result | Number |
| --- | --- | --- |
| (a) Haiku alone resolves 40 to 70% | not met | 75.0%, one run |
| (a) Opus alone resolves 80% or more | unknown | unknown: hd-opus-1 is not complete (Opus runs only with --allow-opus) |
| (b) Haiku alone and Opus alone are separated (the 90% interval of the difference excludes zero) | unknown | unknown: hd-opus-1 has not been run |
| (c) cascade run 1 and cascade run 2 are not separated (the interval holds zero) | unknown | unknown: hd-cascade-2 has not been run |

The gate is **missed** on at least one line. Doc 22 says what each miss means (a Haiku rate above 70% or an Opus rate below 80% changes the plan; a cascade run that separates from itself means flaky checks or too few runs).

## Per task

| Task | Kind | hd-haiku-1 | hd-cascade-1 | hd-cascade-2 | hd-opus-1 |
| --- | --- | --- | --- | --- | --- |
| hd-js-cache-stampede | bug | pass | pass | - | - |
| hd-js-sheet-engine | program | pass | pass | - | - |
| hd-py-ledger-cents | bug | pass | fail | - | - |
| hd-py-migration-graph | feature | pass | pass | - | - |
| hd-py-streaming-stats | refactor | fail | pass | - | - |
| hd-rust-free-slots | bug | pass | pass | - | - |
| hd-rust-merge3 | feature | pass | pass | - | - |
| hd-rust-regex-linear | program | fail | pass | - | - |
| hd-ts-chunked-csv | bug | fail | pass | - | - |
| hd-ts-event-store | refactor | pass | pass | - | - |
| hd-ts-query-language | feature | pass | pass | - | - |
| hd-ts-recurrence-dst | bug | pass | pass | - | - |
