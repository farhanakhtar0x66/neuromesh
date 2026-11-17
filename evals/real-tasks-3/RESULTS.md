# Beta baselines on real-tasks-3

Generated 2026-11-17 07:58 UTC by `node evals/baselines.ts` from the saved evals in `/Users/farhanakhtar/.neuromesh/evals`. 10 tasks. Every figure is from **one run** of its preset (the cascade has two) and is a hint, not a measurement. "unknown" means the number was not recorded or the run is not finished; it is never 0.

## Runs

| Run | Preset | Tasks final | Resolved | Engine failures | Est. cost (API list prices) | 5-hour window, points | Weekly window, points | Minutes of work |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| rt3-haiku-1 | solo-haiku | 10 of 10 | 8 of 10 (80.0%), one run | 0 | $1.40 (estimate) | 4 | 0 | 63.6 |
| rt3-cascade-1 | cascade-claude | 10 of 10 | 7 of 10 (70.0%), one run | 0 | $2.86 (estimate) | 37 | 5 | 38.7 |
| rt3-cascade-2 | cascade-claude | not run | unknown | unknown | unknown | unknown | unknown | unknown |
| rt3-opus-1 | solo-opus | not run | unknown | unknown | unknown | unknown | unknown | unknown |

Costs are **estimates** at API list prices (`src/usage/prices.ts`), not money spent: the runs draw on one Claude plan. Window points are whole points of the plan's windows read by a one-word call before and after each task; a window that reset in between, or a task with no reading, is counted as unknown, not 0. Minutes are the time the final attempt of each task took; waiting for a reset is not counted. A task that failed because the engine failed (crash, hang) is counted separately from one where the model wrote wrong code.

## Paired comparisons

| Comparison (A against B) | Resolved A / B | Difference A − B, 90% interval (points) | A not worse than B by more than 10 points |
| --- | --- | --- | --- |
| cascade-claude (rt3-cascade-1) against Opus alone (rt3-opus-1) | unknown | unknown | unknown (rt3-opus-1 has not been run) |
| cascade-claude (rt3-cascade-1) against Haiku alone (rt3-haiku-1) | 70.0% / 80.0% | -40.0 to +20.0 | not shown |
| Haiku alone (rt3-haiku-1) against Opus alone (rt3-opus-1) | unknown | unknown | unknown (rt3-opus-1 has not been run) |
| cascade run 1 (rt3-cascade-1) against cascade run 2 (rt3-cascade-2) | unknown | unknown | unknown (rt3-cascade-2 has not been run) |

Each comparison pairs the tasks both configurations ran and resamples them 10,000 times (`node evals/bench.ts --compare A B --margin 10`; src/eval/stats.ts). "Shown" means the lower end of the 90% interval is above −10 points. A comparison is made only when every run in it has a final result on every task.

<details><summary>cascade-claude (rt3-cascade-1) against Opus alone (rt3-opus-1)</summary>

Not made: rt3-opus-1 has not been run.

</details>

<details><summary>cascade-claude (rt3-cascade-1) against Haiku alone (rt3-haiku-1)</summary>

```
rt3-cascade-1 against rt3-haiku-1, paired over 10 tasks (runs per task: 1 and 1)
  resolved: 70.0% and 80.0%; mean difference -10.0 points
  90% interval for the difference: -40.0 to +20.0 points (10,000 task resamples, seed 1)
  not worse than rt3-haiku-1 by more than 10 points: not shown
  the interval holds zero: the two cannot be told apart on these tasks.
  with these tasks the data can show a margin of about 40.0 points, no tighter.
```

</details>

<details><summary>Haiku alone (rt3-haiku-1) against Opus alone (rt3-opus-1)</summary>

Not made: rt3-opus-1 has not been run.

</details>

<details><summary>cascade run 1 (rt3-cascade-1) against cascade run 2 (rt3-cascade-2)</summary>

Not made: rt3-cascade-2 has not been run.

</details>

## Phase 1 gate (docs/22-path-to-the-goal.md)

| Check | Result | Number |
| --- | --- | --- |
| (a) Haiku alone resolves 40 to 70% | not met | 80.0%, one run |
| (a) Opus alone resolves 80% or more | unknown | unknown: rt3-opus-1 is not complete (Opus runs only with --allow-opus) |
| (b) Haiku alone and Opus alone are separated (the 90% interval of the difference excludes zero) | unknown | unknown: rt3-opus-1 has not been run |
| (c) cascade run 1 and cascade run 2 are not separated (the interval holds zero) | unknown | unknown: rt3-cascade-2 has not been run |

The gate is **missed** on at least one line. Doc 22 says what each miss means (a Haiku rate above 70% or an Opus rate below 80% changes the plan; a cascade run that separates from itself means flaky checks or too few runs).

## Per task

| Task | Kind | rt3-haiku-1 | rt3-cascade-1 | rt3-cascade-2 | rt3-opus-1 |
| --- | --- | --- | --- | --- | --- |
| an-com-demand | refactor | pass | fail | - | - |
| an-leaf-effects | feature | pass | fail | - | - |
| an-process-init-gate | bug | pass | pass | - | - |
| an-return-contract | feature | pass | pass | - | - |
| dt-typed-adb | refactor | pass | pass | - | - |
| em-egress-cancel | bug | pass | pass | - | - |
| em-hospital-lan | feature | fail | fail | - | - |
| em-inverted-index | refactor | pass | pass | - | - |
| em-model-provisioning | feature | pass | pass | - | - |
| em-unix-targets | feature | fail | pass | - | - |
