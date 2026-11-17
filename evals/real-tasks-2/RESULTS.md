# Beta baselines on real-tasks-2

Generated 2026-11-17 04:54 UTC by `node evals/baselines.ts` from the saved evals in `/Users/farhanakhtar/.neuromesh/evals`. 29 tasks. Every figure is from **one run** of its preset (the cascade has two) and is a hint, not a measurement. "unknown" means the number was not recorded or the run is not finished; it is never 0.

## Runs

| Run | Preset | Tasks final | Resolved | Engine failures | Est. cost (API list prices) | 5-hour window, points | Weekly window, points | Minutes of work |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| rt2-haiku-1 | solo-haiku | 29 of 29 | 28 of 29 (96.6%), one run | 0 | $1.12 (estimate) | 6 | 2 | 86.4 |
| rt2-cascade-1 | cascade-claude | not run | unknown | unknown | unknown | unknown | unknown | unknown |
| rt2-cascade-2 | cascade-claude | not run | unknown | unknown | unknown | unknown | unknown | unknown |
| rt2-opus-1 | solo-opus | not run | unknown | unknown | unknown | unknown | unknown | unknown |

Costs are **estimates** at API list prices (`src/usage/prices.ts`), not money spent: the runs draw on one Claude plan. Window points are whole points of the plan's windows read by a one-word call before and after each task; a window that reset in between, or a task with no reading, is counted as unknown, not 0. Minutes are the time the final attempt of each task took; waiting for a reset is not counted. A task that failed because the engine failed (crash, hang) is counted separately from one where the model wrote wrong code.

## Paired comparisons

| Comparison (A against B) | Resolved A / B | Difference A − B, 90% interval (points) | A not worse than B by more than 10 points |
| --- | --- | --- | --- |
| cascade-claude (rt2-cascade-1 + rt2-cascade-2) against Opus alone (rt2-opus-1) | unknown | unknown | unknown (rt2-cascade-1 has not been run; rt2-cascade-2 has not been run; rt2-opus-1 has not been run) |
| cascade-claude (rt2-cascade-1 + rt2-cascade-2) against Haiku alone (rt2-haiku-1) | unknown | unknown | unknown (rt2-cascade-1 has not been run; rt2-cascade-2 has not been run) |
| Haiku alone (rt2-haiku-1) against Opus alone (rt2-opus-1) | unknown | unknown | unknown (rt2-opus-1 has not been run) |
| cascade run 1 (rt2-cascade-1) against cascade run 2 (rt2-cascade-2) | unknown | unknown | unknown (rt2-cascade-1 has not been run; rt2-cascade-2 has not been run) |

Each comparison pairs the tasks both configurations ran and resamples them 10,000 times (`node evals/bench.ts --compare A B --margin 10`; src/eval/stats.ts). "Shown" means the lower end of the 90% interval is above −10 points. A comparison is made only when every run in it has a final result on every task.

<details><summary>cascade-claude (rt2-cascade-1 + rt2-cascade-2) against Opus alone (rt2-opus-1)</summary>

Not made: rt2-cascade-1 has not been run; rt2-cascade-2 has not been run; rt2-opus-1 has not been run.

</details>

<details><summary>cascade-claude (rt2-cascade-1 + rt2-cascade-2) against Haiku alone (rt2-haiku-1)</summary>

Not made: rt2-cascade-1 has not been run; rt2-cascade-2 has not been run.

</details>

<details><summary>Haiku alone (rt2-haiku-1) against Opus alone (rt2-opus-1)</summary>

Not made: rt2-opus-1 has not been run.

</details>

<details><summary>cascade run 1 (rt2-cascade-1) against cascade run 2 (rt2-cascade-2)</summary>

Not made: rt2-cascade-1 has not been run; rt2-cascade-2 has not been run.

</details>

## Phase 1 gate (docs/22-path-to-the-goal.md)

| Check | Result | Number |
| --- | --- | --- |
| (a) Haiku alone resolves 40 to 70% | not met | 96.6%, one run |
| (a) Opus alone resolves 80% or more | unknown | unknown: rt2-opus-1 is not complete (Opus runs only with --allow-opus) |
| (b) Haiku alone and Opus alone are separated (the 90% interval of the difference excludes zero) | unknown | unknown: rt2-opus-1 has not been run |
| (c) cascade run 1 and cascade run 2 are not separated (the interval holds zero) | unknown | unknown: rt2-cascade-1 has not been run; rt2-cascade-2 has not been run |

The gate is **missed** on at least one line. Doc 22 says what each miss means (a Haiku rate above 70% or an Opus rate below 80% changes the plan; a cascade run that separates from itself means flaky checks or too few runs).

## Per task

| Task | Kind | rt2-haiku-1 | rt2-cascade-1 | rt2-cascade-2 | rt2-opus-1 |
| --- | --- | --- | --- | --- | --- |
| nm-blind-resume | bug | pass | - | - | - |
| nm-cascade-one-review | feature | pass | - | - | - |
| nm-choices-shown | feature | pass | - | - | - |
| nm-direct-request-wiring | bug | pass | - | - | - |
| nm-dollar-budget | feature | pass | - | - | - |
| nm-expert-budget | feature | pass | - | - | - |
| nm-expert-patch | feature | pass | - | - | - |
| nm-expert-spec-design | feature | pass | - | - | - |
| nm-finding-owner | feature | pass | - | - | - |
| nm-linger-plan-fail | bug | pass | - | - | - |
| nm-paired-bootstrap | feature | pass | - | - | - |
| nm-resume-usage-totals | bug | pass | - | - | - |
| nm-review-no-reversal | bug | pass | - | - | - |
| nm-senior-first-expert | feature | pass | - | - | - |
| nm-split-payload | refactor | fail | - | - | - |
| nm-two-step-escalation | feature | pass | - | - | - |
| nm-worker-first-routing | feature | pass | - | - | - |
| nm-worker-ladder | feature | pass | - | - | - |
| pb-backoff | feature | pass | - | - | - |
| pb-checksum-lint | bug | pass | - | - | - |
| pb-event-pipeline | bug | pass | - | - | - |
| pb-event-service | bug | pass | - | - | - |
| pb-normalizer-lint | bug | pass | - | - | - |
| pb-outlier-filter | feature | pass | - | - | - |
| pb-sensor-fusion | bug | pass | - | - | - |
| pb-sliding-window | bug | pass | - | - | - |
| pb-spin-wait | feature | pass | - | - | - |
| pb-stream-pipeline | bug | pass | - | - | - |
| ss2-notes-module | refactor | pass | - | - | - |
