# Offline phase 1: what was built, and what it showed (2026-11-15)

Everything in this report ran with no model calls and no change to the
router. The branch is `neuromesh-research`. A number from one run is a hint,
and each one below says where it came from.

## What was done

| Item | Commits | What it is |
| --- | --- | --- |
| M9 | `ed823e8`, `3cd1649`, `e544963` | Checkers that run the code for 2.1, 2.3, 3.1, 3.2; the saved answers rescored |
| Housekeeping | `9a19e03` | The 150 of 150 wording in the docs; more timeout room in two flaky tests |
| D6, F105 | `97302e2` | A developer's choices made and points left open, shown in full |
| M5, F106 | `2372018` | A Claude turn's input split into five parts |
| M2, F107 | `feeeec0` | `bench --compare`: a paired bootstrap and a "not worse than d" line |
| L1, F108 | `44438cb` | One append-only record of every turn and decision, with a backfill |
| Docs | `7baa8a8` | STATUS 43, HANDOFF and doc 22 brought up to date |
| Held-out 15 | the commit that adds this file | H1.1 to H5.3, their checkers and references, `routes.ts` with two tables |

`npm test`, `npx tsc --noEmit` and both fault-harness sweeps (1000 seeds, and
400 kill-and-resume seeds) passed on the engine changes.

## M9: the rescore

The four prompts whose answer is code now run it: 2.1 (a signed webhook
handler), 2.3 (the GST function, against twelve correct variants and eleven
broken ones), 3.1 (the abort hook) and 3.2 (the allocator). 3.3 stays on its
rubric until a Postgres is available to apply the migration to; the M9 box in
doc 22 says "four of five".

Rescored from the saved answers, with no new run, `rb-cascade-2` scores 150
of 150, where the old keyword rubric gave 148.8, and Opus alone scores 150.
Every executable-graded prompt passes in both runs. That is a ceiling: this
suite cannot tell the two apart, which is why the next suite has to be one the
cheap worker fails.

## F106: where the input tokens go

On the saved Opus+Haiku build evals, read from the turns' kept logs
(`bench --split`):

- Start-up plus Neuromesh's prompt is **57 to 74 percent** of a turn's input.
- Files the turn read are **under 1 percent**.

So the lever on input tokens is what is sent at the start of every turn, not
what the model reads. These shares are estimated from character counts, and
for runs made before the prompt's size was recorded, start-up and prompt are
one number. They have not been checked against a live Claude run yet; the next
real run is the first check.

## F107: the paired bootstrap

`bench --compare a1,a2,a3 b1,b2,b3 --margin d` resamples tasks 10,000 times
(seeded) and prints the 90 percent interval and "not worse than d: shown / not
shown". It was checked on synthetic data, including one pair known to differ
and one pair that should not separate. On the saved evals it returns a
zero-width interval, because every task passes in both configurations: it
reports the ceiling above, not a margin.

## F108: the record

The record is `~/.neuromesh/record/record.jsonl`. It holds no request text,
code or paths, and an unknown number is left out, never written as 0. Run on
the owner's saved runs, the backfill read **95 runs, 308 results and 6
ratings, and wrote 996 lines**; a second pass added nothing. It is written
live by every run from now on; run `node src/record/cli.ts backfill` after a
benchmark to pick up its result lines.

## The held-out 15

`evals/routing-bench/held-out/` has 15 prompts in the same five groups as the
original 15, and three new traps. Each has a checker that runs the answer and
a reference answer. `sh evals/routing-bench/validate.sh` passes all 30
references in full and fails all 30 empty folders, including `cargo test
--release` for H3.3 and H4.3. The H4.2 Raft checker was also run on two broken
simulators (no Figure 8 rule; no log up-to-date check) and fails both.

Tier 0, calibration priors only, with the router unchanged:

| Set | On an expected tier |
| --- | --- |
| Table A: the 15 tuned on | 11 of 15 |
| Table B: the held-out 15 | 8 of 15 |

```
  H1.1  grunt   rules       expected grunt
  H1.2  grunt   rules       expected grunt
  H1.3  worker  calibrated  expected grunt|worker
  H2.1  worker  calibrated  expected worker
≠ H2.2  senior  similarity  expected worker
  H2.3  worker  calibrated  expected worker|senior
≠ H3.1  worker  calibrated  expected senior
≠ H3.2  worker  calibrated  expected senior
≠ H3.3  expert  similarity  expected senior
≠ H4.1  worker  similarity  expected expert
≠ H4.2  expert  similarity  expected senior
  H4.3  expert  similarity  expected expert
  H5.1  worker  calibrated  expected worker|senior
≠ H5.2  senior  similarity  expected grunt|worker
  H5.3  worker  calibrated  expected cascade 2>3
```

The seven misses are honest baseline data: under-routed H3.1, H3.2, H4.1;
over-routed H2.2, H3.3, H4.2; and the decoy trap H5.2, a three-row table that
starts on the senior. The expected tiers were written before this was run, and
neither `router.ts` nor `brief.ts` was touched. The full table and notes are
in `evals/routing-bench/HELD_OUT_ROUTES.md`.

What this does not show: how any model does on these prompts. `run.ts` reads
only `tasks/`, so the held-out set has not been run live, and H5.2's rule (no
spend on senior or expert) is recorded in its `task.json` but not yet applied
by `score.ts`.

## Model calls

None. Every step used local files, the fake backend, the fault harness, the
checkers' own interpreters and `cargo`. No live model was called and none of
the owner's plan was spent.

## What is next

1. A second and third clean cascade run, and Haiku alone, when the owner says
   the plan can be spent (HANDOFF step 1).
2. Teach `run.ts` and `score.ts` the held-out set and H5.2's rule, so it can be
   run once, live, with the router held fixed.
3. 3.3's checker, when a Postgres is available.
4. Check F106's split and F108's live writes against the next real Claude run.
