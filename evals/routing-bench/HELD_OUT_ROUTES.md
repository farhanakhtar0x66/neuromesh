# Where Tier 0 sends the held-out 15 (recorded 2026-11-15, untuned)

The held-out set is `held-out/tasks/` (H1.1 to H5.3): 15 prompts written outside
this repository, in the same five groups as the original 15 and with three
new traps. The router was not changed after they were added, and it must not
be changed to fit them: a router change is judged on this table, never made
from it (phase 1, rule 7). `src/routing/router.ts` and `src/intake/brief.ts`
are exactly as they were on the commit before this one.

The expected tiers in each `task.json` were written before `routes.ts` was run
on these prompts. Where the pack named two acceptable tiers they are written
`grunt|worker` and either counts.

No model was called. Command, calibration priors only (an empty table, so the
result does not depend on this machine's past runs):

```
node evals/routing-bench/routes.ts
```

## Table A: regression set (tuned on)

```
  1.1   t11-pdf-table-json     grunt   rules       expected grunt
  1.2   t12-tone-rewrite       grunt   rules       expected grunt
  1.3   t13-env-example        grunt   rules       expected grunt
  2.1   t21-hmac-webhook       worker  similarity  expected worker
  2.2   t22-standup-table      worker  calibrated  expected worker
  2.3   t23-gst-tests          worker  similarity  expected worker
≠ 3.1   t31-abort-hook         worker  similarity  expected senior
  3.2   t32-heap-refactor      senior  similarity  expected senior
  3.3   t33-pg-migration       senior  similarity  expected senior
  4.1   t41-arm64-ringbuf      expert  calibrated  expected expert
≠ 4.2   t42-edge-dag           senior  calibrated  expected expert
≠ 4.3   t43-spot-checkpoint    worker  calibrated  expected expert
≠ 5.1   t51-regex-bomb         worker  calibrated  expected cascade 1>2>3
  5.2   t52-jargon-log-csv     grunt   rules       expected grunt
  5.3   t53-impossible-sort    worker  calibrated  expected cascade 2>3
11/15 start on an expected tier (calibration priors only).
```

Unchanged from before the held-out set was added.

## Table B: held-out set (never tuned on)

```
  H1.1  h11-conflict-json      grunt   rules       expected grunt
  H1.2  h12-syslog-tsv         grunt   rules       expected grunt
  H1.3  h13-ddl-typeguard      worker  calibrated  expected grunt|worker
  H2.1  h21-sliding-limiter    worker  calibrated  expected worker
≠ H2.2  h22-csv-stream         senior  similarity  expected worker
  H2.3  h23-semver-resolver    worker  calibrated  expected worker|senior
≠ H3.1  h31-wal                worker  calibrated  expected senior
≠ H3.2  h32-build-dag          worker  calibrated  expected senior
≠ H3.3  h33-chase-lev          expert  similarity  expected senior
≠ H4.1  h41-cas-backup         worker  similarity  expected expert
≠ H4.2  h42-raft               expert  similarity  expected senior
  H4.3  h43-rust-vm            expert  similarity  expected expert
  H5.1  h51-fec-decoder        worker  calibrated  expected worker|senior
≠ H5.2  h52-decoy-table        senior  similarity  expected grunt|worker
  H5.3  h53-rwlock             worker  calibrated  expected cascade 2>3
8/15 start on an expected tier (calibration priors only).
```

## What it says (one measurement of the router, not of any model)

- **11/15 on the tuned set, 8/15 on the held-out set.** The gap is the
  point of having a held-out set: the first number was reached by adjusting
  the router to those prompts.
- **Misses by direction.** Under-routed (started lower than expected): H3.1
  WAL and H3.2 build graph start on the worker, H4.1 backup engine starts on
  the worker. Over-routed (started higher): H2.2 CSV parser on the senior,
  H3.3 Chase-Lev deque and H4.2 Raft on the expert, and the H5.2 trap below.
  Seven misses in all.
- **Trap H5.2 (the multi-buzzword decoy) is missed.** It starts on the senior
  for a three-row table, the over-routing the trap was written to find. Its pass
  rule, no spend on senior or expert, is recorded in its `task.json`; the live
  runner and `score.ts` do not apply it yet.
- **H5.1 and H5.3 pass.** The prose-wrapped numeric spec stays off the
  inline-transform path, and the impossible-lock request starts on the worker,
  like 5.3.
- **Where the wrong calls come from.** All seven misses are decided by
  `similarity` or `calibrated`, not by the rules stage; the two prompts the
  rules stage decided (H1.1, H1.2) are right. Not a diagnosis: with one
  prompt per cell it only says where to look first.
- None of this is a reason to edit the router today. If a later change moves
  these numbers, it moves them as evidence about that change, and the set is
  then no longer held out for it.

## Validity of the checkers

`sh evals/routing-bench/validate.sh` covers both sets: all 30 references pass
in full and all 30 empty workspaces fail. `H3.3` and `H4.3` run
`cargo test --release --offline` against the reference crate; the H4.2 checker
was also run on two broken Raft variants (no Figure 8 rule, no log
up-to-date check) and fails both.
