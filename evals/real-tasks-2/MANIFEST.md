# Batch 2 manifest (built 2026-11-16, offline; every number below is from the build, except the last column)

29 candidate tasks, all valid (fail on the seed, pass on the reference in 3 fresh runs, no test changes result between
runs). "Source files" and "Lines" count the reference change without the tests; "From" is the commit (or the ProofBench
fixture folder, or the base commit of a synthetic change). **The last column is my guess, not a measurement**: it is
set by size, how much of the prompt is a contract the tests check to the letter, and whether the seed names the bug.
Nothing here has run on a model. The first live run (`rt2-haiku-1`) replaces the guess.

| Task | Repository | Language | Kind | From | Source files | Lines + / - | fail-to-pass | pass-to-pass | Haiku difficulty (guess) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| nm-blind-resume | neuromesh | typescript | bug | 0ad6c9f | 6 | +81 / -10 | 1 | 0 | hard, about 15% |
| nm-cascade-one-review | neuromesh | typescript | feature | 2bde99e | 4 | +20 / -1 | 1 | 1 | medium, about 45% |
| nm-choices-shown | neuromesh | typescript | feature | 97302e2 | 8 | +67 / -22 | 3 | 0 | medium-hard, about 35% |
| nm-direct-request-wiring | neuromesh | typescript | bug | 712d8e9 | 17 | +190 / -20 | 1 | 0 | medium, about 40% |
| nm-dollar-budget | neuromesh | typescript | feature | 6eff1df | 7 | +109 / -16 | 1 | 0 | hard, about 30% |
| nm-expert-budget | neuromesh | typescript | feature | 33c5387 | 8 | +41 / -4 | 1 | 0 | medium, about 50% |
| nm-expert-patch | neuromesh | typescript | feature | 6bc11a1 | 3 | +30 / -3 | 1 | 0 | medium-hard, about 35% |
| nm-expert-spec-design | neuromesh | typescript | feature | 05d9de0 | 5 | +102 / -8 | 2 | 0 | medium, about 50% |
| nm-finding-owner | neuromesh | typescript | feature | cb7035c | 5 | +129 / -13 | 1 | 0 | hard, about 25% |
| nm-linger-plan-fail | neuromesh | typescript | bug | 507148f | 5 | +36 / -4 | 2 | 0 | hard, about 30% |
| nm-paired-bootstrap | neuromesh | typescript | feature | feeeec0 | 4 | +164 / -3 | 5 | 0 | medium, about 55% |
| nm-resume-usage-totals | neuromesh | typescript | bug | 7b0d040 | 6 | +99 / -5 | 1 | 0 | medium, about 50% |
| nm-review-no-reversal | neuromesh | typescript | bug | c101a81 | 2 | +26 / -1 | 1 | 0 | medium, about 50% |
| nm-senior-first-expert | neuromesh | typescript | feature | c1df44d | 6 | +28 / -2 | 1 | 2 | medium, about 45% |
| nm-split-payload | neuromesh | typescript | refactor (synthetic) | synthetic on 42f672b | 3 | +68 / -58 | 6 | 14 | easy-medium, about 70% |
| nm-two-step-escalation | neuromesh | typescript | feature | 95fc233 | 5 | +146 / -11 | 2 | 0 | hard, about 25% |
| nm-worker-first-routing | neuromesh | typescript | feature | 858779b | 4 | +74 / -2 | 1 | 0 | easy-medium, about 75% |
| nm-worker-ladder | neuromesh | typescript | feature | c6cd3f9 | 6 | +90 / -18 | 2 | 0 | hard, about 25% |
| pb-backoff | proofbench | rust | feature | ProofBench task-2-missing-feature | 1 | +12 / -3 | 4 | 1 | easy, about 95% |
| pb-checksum-lint | proofbench | rust | bug | ProofBench task-6-deterministic-fix | 1 | +0 / -2 | 1 | 0 | easy, about 95% |
| pb-event-pipeline | proofbench | rust | bug | ProofBench task-3-multi-file-regression | 2 | +2 / -4 | 3 | 2 | easy, about 90% |
| pb-event-service | proofbench | rust | bug | ProofBench task-9-bidirectional-event-service | 4 | +8 / -9 | 4 | 0 | easy-medium, about 80% |
| pb-normalizer-lint | proofbench | rust | bug | ProofBench task-8-deterministic-unused-var | 1 | +1 / -1 | 1 | 0 | easy, about 95% |
| pb-outlier-filter | proofbench | rust | feature | ProofBench task-5-context-filtering | 1 | +18 / -10 | 3 | 0 | easy, about 90% |
| pb-sensor-fusion | proofbench | rust | bug | ProofBench task-10-sensor-fusion-aggregator | 3 | +5 / -6 | 3 | 0 | easy-medium, about 80% |
| pb-sliding-window | proofbench | rust | bug | ProofBench task-1-fix-failing-func | 1 | +1 / -4 | 3 | 2 | easy, about 95% |
| pb-spin-wait | proofbench | rust | feature | ProofBench task-4-version-freshness | 1 | +4 / -2 | 2 | 1 | easy, about 85% |
| pb-stream-pipeline | proofbench | rust | bug | ProofBench task-7-adaptive-pipeline | 3 | +7 / -6 | 2 | 0 | easy-medium, about 75% |
| ss2-notes-module | scope-test-2 | javascript | refactor (synthetic) | synthetic on 42a7973 | 2 | +50 / -41 | 11 | 132 | easy-medium, about 75% |

## Mix

| By | Count |
| --- | --- |
| Source | 10 ProofBench (Rust), 17 neuromesh commits (TypeScript), 2 synthetic refactors (1 TypeScript, 1 JavaScript) |
| Kind | bug 12 (7 ProofBench, 5 neuromesh), feature 15 (3 ProofBench, 12 neuromesh), refactor 2 (synthetic), new program 0 |
| Guessed Haiku difficulty | easy 7, easy-medium 6, medium 8, medium-hard 2, hard 6 |
| Languages | TypeScript 18, Rust 10, JavaScript 1 |

The guessed mean pass share is about 59 percent, inside the 40 to 70 band, but it leans on the ten ProofBench tasks
(guessed 75 to 95 percent each, because their seeds name the bug): without them the guess is about 43 percent. If the
live run finds Haiku above 70 percent overall, the lever is more of the hard neuromesh-style tasks; below 40, drop
the two or three hardest (`nm-blind-resume`, `nm-finding-owner`, `nm-worker-ladder`).

## Short of the target

The task asked for about 45 candidates; this is 29. The count is bounded by the sources: ProofBench has exactly ten
fixtures, `scope-test-2` has no commit left that is not batch 1's or a 19-file initial build, and the neuromesh history
holds about 17 commits that are bug-sized or feature-sized with a test that fails before them (the rest are
all-at-once milestone commits of 1,000 to 6,000 lines or commits that change no test). The blocked repositories in
`evals/real-tasks/BATCH-2.md` (droidtui, anpasser, edgemed, JalNet) are the way to the other 15 to 20.
