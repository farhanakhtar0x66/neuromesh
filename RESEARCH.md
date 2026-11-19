# Research: the tests for the paper

On `neuromesh-research` only. What to run, in what order, and how to record it, so the numbers can carry a paper.
How to write the paper itself: `RESEARCH-PAPER.md`. What exists and was measured so far: `HANDOFF.md`,
`evals/swe-live/RESULTS.md`, raw results in `evals/results/`.

## The paper's question

What can a frontier coding model safely hand to cheaper models, and what does that save on subscription plans?

The measurements so far (one run each) suggest the answer: **facts, not judgement**. Every judgement handoff lost
quality (a plan built by a cheap model, a cheap model's diagnosis, rules written for cheap workers); every facts-only
handoff kept it. The tests below turn those single runs into results with repeats and intervals.

## Research questions

| RQ | Question | Configurations | Evidence so far (one run) |
| --- | --- | --- | --- |
| RQ1 | Does a facts-only dossier from a cheap model keep the frontier model's resolution rate, and at what cost? | Opus alone; K6 (`dossier-claude`) | 7 of 19 each, $9.14 against $8.91 |
| RQ2 | How much quality does each kind of judgement handoff cost? | K6 with F132 off (worker rules), K6 with F131 off (diagnosis), lead v3 (plan), K1 (blind patch) | 5 of 20; openai-1633 lost; 7 of 20; 2 of 21 |
| RQ3 | Where does an agent's cost go, and what reduces it? | per-turn input split (F106), calls and tokens re-read, dossier on and off by repository size | black 1.51M re-read alone, 0.76M with the dossier |
| RQ4 | On building tasks, does routing by kind of work match the frontier model at a fraction of the plan? | cascade-claude; Opus alone; Haiku alone | routing bench 150 / 150 / 142 of 150; $0.84 / $3.32 / $0.21 |
| RQ5 | Can a free model on another provider gather facts safely when every fact is checked mechanically? | K6 with a Flash scout and quote/command checks (PLAN.md S3), against a Haiku scout | not measured |

## Rules for every run (write them in the paper's method section)

1. **Dev set and test set.** The 21 SWE-bench-Live issues used so far are the **dev set**: F130 to F132 were changed
   after looking at them, so final claims cannot rest on them. Final claims use a **test set** imported fresh and run
   only with the configurations frozen below.
2. **Freeze before running.** Record the commit hash and the preset files of every configuration in
   `evals/paper/PROTOCOL.md` before the first test-set run. No engine or preset change during the test-set runs; a
   fix found then goes into a later version, and the runs are redone.
3. **Repeats.** Three runs of every configuration on the test set (a model's output varies from run to run). Report
   the mean and a 90% interval with the paired bootstrap: `node evals/bench.ts --compare a1,a2,a3 b1,b2,b3 --margin 10`.
4. **Same conditions.** Configurations compared with each other run in the same window of days, from the same
   machine, at most two evals at a time (five in parallel broke the grader). A run paused on quota or sign-in is
   resumed under the same name; the pause is recorded.
5. **Record unknowns as unknown.** A cost the tool did not report is unknown, never 0. All dollar figures are
   API-equivalent estimates; say so in every table.
6. **Re-grade errors alone.** A hidden verdict of `error` (grader timeout or empty output) is re-graded alone with
   `bash -c '~/.neuromesh/swe-live/why.sh <run> <id>'` and the re-grade is recorded beside the original.
7. **Engine failures apart from task failures.** A crash, hang or lost run is an engine failure; report its count per
   configuration and leave those issues out of that run's rate, saying so.

## The test set

- **Size:** about 60 issues (enough that a difference of 5 to 6 issues means something; 21 cannot tell 1 or 2).
- **Contamination:** SWE-bench-Live adds new issues every month. Take issues **created after the newest model's
  training cut-off** where possible; record each issue's creation date, and report results separately for issues
  before and after the cut-off if both are used.
- **Import:** add the instance ids to `evals/swe-live/instances.json` (or a new `instances-test.json`), then
  `node evals/swe-live/import.ts --ids <ids>`. Each issue is validated (the seed fails, the gold patch passes twice);
  rejected ones go to `tasks-rejected/`. Images are about 1.5 to 2 GB each: 60 issues need about 120 GB of disk.
- **Interface notes:** apply the same rule as for the dev set (`interfaces.json`): a note only where the hidden tests
  call a name the issue never states, found by the same script, decided before any run.
- Make a subset folder of symlinks, as for the dev set: `~/.neuromesh/swe-live/subsets/test60/`.

## The runs, in order

Each line is three runs (suffix `-1`, `-2`, `-3`). Commands from the repository root; `S=~/.neuromesh/swe-live/subsets`.

| # | Configuration | Command (run 1) | Answers |
| --- | --- | --- | --- |
| 1 | Opus alone | `node src/cli/main.ts eval --suite $S/test60 --preset solo-opus --name pt-opus-1 --quota` | baseline |
| 2 | K6 with Opus (F129 to F132) | `... --preset dossier-claude --name pt-k6-1` | RQ1, RQ3 |
| 3 | Haiku alone | `... --preset solo-haiku --name pt-haiku-1` | floor |
| 4 | K6 with F132 off | `... --preset dossier-claude --name pt-k6-rules-1 --disable solver-own-judgement` | RQ2 |
| 5 | K6 with Sonnet | `... --preset dossier-sonnet --name pt-k6-sonnet-1` | Sonnet's place |
| 6 | K6 with F131 off (dossier with diagnosis) | `... --preset dossier-claude --name pt-k6-diag-1 --disable advisory-repro` | RQ2 |
| 7 | Cascade | `... --preset cascade-claude --name pt-cascade-1` | the cascade on hard work |
| 8 | K6 with a Flash scout | after PLAN.md S3 is built and frozen | RQ5 |

Runs 1 to 3 are the core; 4 to 8 are ablations and can use one run each on the test set if quota is short, said so in
the paper. Check that each `--disable` key exists before running (`node src/cli/main.ts features`).

RQ4 (building tasks) uses the routing bench, which already has a held-out set:

```bash
node evals/routing-bench/run.ts --config cascade  --set all --name pr-cascade-1 --wait-reset
node evals/routing-bench/run.ts --config frontier --set all --name pr-frontier-1 --wait-reset
node evals/routing-bench/run.ts --config haiku    --set all --name pr-haiku-1 --wait-reset
```

Three runs each; score with `node evals/routing-bench/score.ts`, compare with `node evals/bench.ts --compare`.
The held-out 15 have never been used to tune the router; keep it so.

## Budget

Opus alone cost about $0.47 per issue (estimate) on the dev set; K6 about the same. Three runs of runs 1 and 2 on 60
issues is about 360 Opus-sized issue runs, roughly $170 API-equivalent, on the subscription's windows. Before
scheduling, run 10 issues of run 1 once and record the five-hour and weekly points they use
(`~/.neuromesh/quota.json`, the eval's `quota.before/after` per task); plan the rest across weekly windows from that.
`--quota` pauses a run at the window limit, and rerunning the same name continues where it stopped.

## What to record per run

Already in `results.json`: hidden verdict and score, per-model tokens, `costUsdEquivalent`, cache reads, calls
(`usage.split.calls`), quota before and after, wall time, turns, engine failures. Add by hand in
`evals/paper/RUNS.md`: the date, the commit, pauses and why, re-grades.

After each run, copy its `results.json` and `.out` into `evals/results/` (as done for the runs so far) and add a row to
`evals/results/README.md`.

## Analysis

- **Resolution:** per configuration, mean over the three runs, 90% interval; paired against Opus alone per issue.
- **Cost:** estimated dollars by model; Claude window points; Opus's calls and tokens re-read per issue (RQ3).
- **Per-issue table:** which configuration resolved which issue; issues none resolve (often missing information).
- **Where each configuration loses:** read the lost issues' hidden-test logs (`why.sh`) and classify the cause
  (implied case not handled, wrong place, environment). Classify before looking at which configuration lost them.

## Threats to validity (to state in the paper)

- One subscription, one machine, one month; model versions can change silently. Record the CLI versions
  (`claude --version`, `agy --version`).
- The agent runs on the host with a runner into the container, not the leaderboard protocol; results compare
  configurations, they are not leaderboard numbers.
- Costs are estimates from token counts at list prices; the subscription's quota is not proportional to them (Haiku
  is about 1/6 of Opus on the plan's window, 1/40 at list prices).
- The dev set shaped F130 to F132; only the test set supports claims.
- Issue contamination (above).
