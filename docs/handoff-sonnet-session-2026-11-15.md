# Handoff: what the Sonnet 5.5 session did, 2026-11-15 to 2026-11-16

Written 2026-11-19 from the session's own record. It describes this session only. The session ended at commit
`05f5732` on `neuromesh-research`; at the time of writing the branch is 78 commits further on (HEAD `60f10bd`: the lead
presets F120 to F126, K1/K5/K6 and F127 to F132, SWE-bench-Live, trial A2), none of which this file covers. Three
files this session wrote were changed afterwards by others (`evals/make-task.ts`, `evals/validate-task.ts`,
`evals/real-task/grade.ts`: a process-group time limit for graders, per-task time limits for batch 2), so read them,
not this file, for how they work now. The project's own `HANDOFF.md` and `docs/STATUS.md` (entries 42 to 54 are this
session's) are the running record; this is a single-session summary with the numbers.

## How the session worked

- **No live model call was made by the session.** Every live run (benchmarks, the real-task eval) was run by the owner
  in their own terminal; the session read the saved results afterwards. Engine tests used the fake backend.
- **Branch:** `neuromesh-research`. Every item was committed and pushed, and `~/.neuromesh/app` was pulled to the new
  HEAD each time (CLAUDE.md and the HANDOFF note say not to run `install.sh` on the owner's Mac).
- **Rules from CLAUDE.md that applied:** `npm test` and `npx tsc --noEmit` before calling anything done; an engine
  change also runs `node evals/chaos.ts --seeds 1000` and `node evals/chaos.ts --kill 1 --seeds 400`, with a new kind of
  failure added to the harness before the fix; every behaviour change is a feature in `src/features.ts` with an id,
  an `isOn` gate, `// [Fxx key]` comments, events tagged `feature: "Fxx"`, and a `--disable <key>` switch; unknown
  numbers are never written as 0; API-equivalent cost is labelled an estimate.
- **Rule 7 (held-out set):** `src/routing/router.ts` and `src/intake/brief.ts` were not edited at any point in the
  session. The held-out prompts were never used to change the router.
- Test count over the session: 254, then 271, 273, 292, 294, 306 (the last at `05f5732`).

## Commits (18, oldest first)

| Commit | What |
| --- | --- |
| `ed823e8`, `3cd1649`, `e544963` | M9: checkers that run the answer for routing-bench 2.1, 2.3, 3.1, 3.2; `.pyc` ignore |
| `9a19e03` | `rb-cascade-2` stated as 150 of 150 after the rescore (148.8 under the old rubric); more timeout headroom in two flaky tests |
| `97302e2` | D6 / F105 `choices-shown` |
| `2372018` | M5 / F106 `input-split` |
| `feeeec0` | M2 / F107 `paired-bootstrap` (`bench --compare`) |
| `44438cb` | L1 / F108 `run-record` (the append-only record and its CLI) |
| `7baa8a8` | STATUS 43, HANDOFF, doc 22 for the four above |
| `ae1fdd6` | The held-out 15 (H1.1 to H5.3), two-table `routes.ts`, `validate.sh` for both sets, doc 23 |
| `23d7ca0` | `run.ts --set original|held-out|all`, `--config haiku`, H5.x trap rules, record `set` tag |
| `f88eed5` | Audit of the first live runs: eight checker defects fixed, all runs rescored; `bench --compare` counts a failed task as 0.0; `bench --split` reads routing-bench runs; the record keeps rescored results |
| `4728a13` | F109 `direct-worker` |
| `e4bf9a9` | M1 harnesses: `evals/make-task.ts`, `evals/validate-task.ts`, `evals/real-task/grade.ts` |
| `712d8e9` | F109's wiring bug fixed; the 3.1 checker's stable fetcher; `rb-cascade-5` / `ho-cascade-2` reports |
| `9d178ed` | `evals/make-batch.ts` and the first ten real tasks |
| `8cc132e` | F109 marked kept (`rb-cascade-6`); real tasks through the eval runner (`--fake`, per-task `checks`); prompt audit; batch-2 survey |
| `72c74ff` | `make-batch --prompts terse`; STATUS 53 |
| `05f5732` | F110 `structured-rescue`; STATUS 53 corrected |

## What was built

### Checkers that run the code (M9)
- `evals/routing-bench/tasks/t21|t23|t31|t32/hidden/`: 2.1 (a FastAPI webhook, with `fastapi_shim.py`), 2.3 (pytest-style
  tests graded against correct implementations and mutants, with `shim/pytest.py`), 3.1 (the React hook, with
  `react-shim.js`, a fake clock and a scripted API, `run_hook.mjs`), 3.2 (the allocator, `run_alloc.py`).
  3.3 stays on its rubric: it needs a Postgres, which this machine does not have.
- Each checker passes its reference and fails an empty folder (`sh evals/routing-bench/validate.sh`); `rescore.ts`
  reruns a saved run's workspace through the current checker and keeps the run-time score as `scoreAtRun`.

### D6, M5, M2, L1 (F105 to F108)
- **F105 `choices-shown`:** worker reports carry `choices` and `open`, kept whole and shown in full
  (`src/engine/prompts.ts`, `src/cli/format.ts`, `src/tui/blocks.ts`).
- **F106 `input-split`:** a Claude turn's input in five parts (start-up, prompt, files, commands, earlier turns),
  estimated from character counts in the kept log (`src/usage/split.ts`); shown by `node evals/bench.ts --split <name>`
  (works on eval runs and, since `f88eed5`, on routing-bench runs) and in the TUI meter.
- **F107 `paired-bootstrap`:** `node evals/bench.ts --compare a1,a2 b1,b2 --margin 10`; paired tasks, 10,000 seeded
  resamples, 90% interval, "not worse than d: shown / not shown" (`src/eval/stats.ts`). Names may be evals or routing-bench
  runs; a task that failed counts as 0.0, a paused one is left out.
- **F108 `run-record`:** one append-only `~/.neuromesh/record/record.jsonl` of turns, decisions, runs, tasks, results,
  ratings (`src/record/`); `node src/record/cli.ts backfill|summary|turns|decisions|runs|results|index`. No request text,
  code or paths. A live eval appends each result as it finishes with the same line the backfill would make (no
  duplicates); a rescored result is a new line and the old one stays (`results` shows the newest, `--all` the history).

### The held-out 15 and the runner
- `evals/routing-bench/held-out/{tasks,reference}/`: H1.1 to H5.3, written outside this repository (an external pack),
  with three new traps (H5.1 prose-wrapped numeric spec, H5.2 multi-buzzword decoy, H5.3 impossible lock upgrade). Every
  checker runs the code (Python, Node, `cargo test --release`). All 30 references (15 original + 15 held-out) pass and all
  30 empty folders fail under `validate.sh`. The Raft checker was run on two broken simulators (no Figure 8 rule, no
  log up-to-date check) and fails both.
- `routes.ts` prints Table A (the 15 tuned on) and Table B (held-out). Expected tiers in each `task.json` were written
  before the first run. Tier 0, priors only: Table A 11/15, Table B 8/15, recorded untouched in
  `evals/routing-bench/HELD_OUT_ROUTES.md` (seven misses: H3.1, H3.2, H4.1 under-routed; H2.2, H3.3, H4.2 over-routed;
  H5.2, the decoy, starts on the senior).
- `run.ts --set original|held-out|all` (default `original`), `--config cascade|frontier|haiku` (`haiku` = preset
  `solo-haiku`); `score.ts` scores the traps of whichever set is present (5.1/5.2/5.3 and H5.1/H5.2/H5.3: H5.2 passes with
  no senior/expert turn or spend and at least 6 of 7 hidden items; H5.3 passes if the gate stopped Tier 2 and the check
  scored at least 3, or Tier 2 scored full marks).

### F109 `direct-worker`
- Extends the no-tools one-answer path (F77 for planned parts, F90 for the grunt) to cascade worker turns: (1) the whole
  request when `src/routing/selfcontained.ts` judges it small and self-contained (at most 100 words and 2 named files,
  a small project, nothing to run/install/look at, no explanation, derivation or complexity bound), one no-tools call,
  failing checks then go to a worker with tools; (2) a part the expert planned that has a spec (F77's build and one
  repair). `router.ts` and `brief.ts` untouched. `--disable direct-worker`.
- First live run (`rb-cascade-5`, `ho-cascade-2`): it never fired. Cause: `directWorker` passed `state.prompt` (the request
  plus the brief's "Working standards" block, 182 words for a 44-word request, containing "install") to the check;
  `state.request` is the user's own text. Fixed in `712d8e9` with a regression test that fails on the old line.
- `rb-cascade-6` (one run): it fired on 2.1, 2.2, 2.3, 3.1, 5.1 (one `task.direct` event each, no preamble). Those five
  went from 43 calls / 794.7k input tokens to 8 calls / 46.3k (−94.2%), all five 10.0. Suite: 84 to 54 calls, input
  1,370k to 969k, 147.8/150 (Opus alone 147.9), Gap@Oracle 0.1%, WCTR 1.0%, CostSave 82.3% unweighted / 87.1% weighted
  ($0.6866 against $3.8746), five-hour window 6% (Opus alone 21%), all three traps held. 4.3 and 5.3 stayed on tools
  and the 5.3 gate still stopped the worker. Marked kept.

### Real-repository tasks (M1)
- `evals/make-task.ts --repo <path|url> --commit <hash> --name <n> --runner node|pytest|cargo --test-cmd "<cmd>"`
  makes `seed/` (the parent commit), `prompt.md`, `hidden/` (the tests the change came with, `spec.json` with
  fail-to-pass and pass-to-pass lists found by running the tests on seed and reference, a copy of `grade.ts`),
  `reference/` (the change's other files, `deleted.txt`, `change.patch`), `task.json` (including optional `checks`).
- `evals/validate-task.ts <dir>`: every fail-to-pass fails on the seed, pass-to-pass passes; on the reference all pass in
  each of 3 fresh runs and no test flips; the task's own `checks` pass on the seed.
- `evals/real-task/grade.ts`: lays the hidden tests over a workspace and reads node `--test` (TAP), pytest, cargo test
  output; run as `node hidden/grade.ts` it prints `SCORE passed/total` and exits 0 only if every named test passes.
- `evals/make-batch.ts evals/real-tasks/batch-1.json [--prompts terse]` rebuilds and validates a batch from the committed
  recipe (`batch-1.json`, `prompts/`, `prompts-terse/`); the task folders are generated and gitignored.
- **Batch 1:** ten tasks, all valid: neuromesh `caec42b` (prose-guard), `7727c8e` (first-turn retry), `eff0b85` (dropped
  connection), `8dadadc` (no bytecode in diff), `e3b2394` (screen countdown), `83942dd` (quota cooldown), `ca2c0af`
  (tester minor findings), `3d7b17d` (stub scanner, its tests only); scope-test-2 `42a7973` (notes bound), `ee334f1`
  (notes fold). Five bugs, five features, TypeScript 8 / JavaScript 2. Each neuromesh task carries `checks` (the quick
  test file that exists on the seed) because a seed has no `node_modules`.
- `neuromesh eval --suite evals/real-tasks --preset <preset> --name <n> [--quota] [--fake]`: runs the tasks and grades them
  by each task's hidden grader. `--fake` (`src/eval/reference.ts`) makes every build turn write the task's reference:
  checked on solo-haiku, cascade-claude and solo-opus, all ten pass.
- **Terse variant:** ten 28 to 42 word prompts (`prompts-terse/`), same seed/hidden/reference; all ten validate. In five
  tasks the tests assert a format or message the terse prompt does not state (tester-minor-findings, stub-scanner,
  quota-cooldown, ss2-notes-fold, ss2-notes-bound).
- **Batch-2 survey** (`evals/real-tasks/BATCH-2.md`): of the repositories under the home folder only neuromesh and
  scope-test-2 have tests that run offline here; ProofBench's ten Rust fixtures run offline (`cargo test --offline` ran);
  anpasser, droidtui, edgemed, JalNet need a network once (`anstyle-wincon`, `gpui`, `qdrant-edge-py` not cached); the real
  refactor commits are in the blocked repositories.

### F110 `structured-rescue`
- Cause (from 411 kept logs): the model calls Claude Code's StructuredOutput tool with the core fields and leaves out string
  fields it thinks are empty; the tool rejects ("must have required property 'notes'" etc.) and ends the turn with
  `error_max_structured_output_retries` after the fifth rejection, work already done. Before F110 that climbed a cascade
  task a rung, or failed a solo task (`failure: "agent"`, `failTask` commits the work as "neuromesh (failed)" and merges
  it to the run's folder; the benchmark runner applies work only for finished runs, so it was graded 0).
- Built: the report schema requires `status`, `summary`; the one-answer schema `files`, `summary`; a blind test `path`,
  `content` (the verdict and every other schema unchanged; the fields stay in the schemas and the prompt wording);
  `claude.ts` keeps the last StructuredOutput input in `AgentResult.lastStructured`; `once()` in `run.ts` takes it as the
  answer when `rescueStructured` (`prompts.ts`) says the parser would accept it (non-blank summary / one usable file), keeping
  only schema keys, and emits `structured.rescued` (feature F110) with the fields left out. The rescue is in the engine,
  not the adapter, because the parsers and the event log are the engine's and the fake backend must take the same path.
  `--disable structured-rescue` restores the old schemas and the old failure; `NEUROMESH_FAULT=structured-rescue` fails the
  rescue (the feature switches itself off).
- Harness: a per-turn fault in `test/support/chaos.ts` plus a rule (with F110 on, no attempt may end in that error).
  Before F110: 61 of 1000 seeds took the fault, 20 failed runs of 1000 and 12 of 400. After: 986 finished / 14 failed
  (1000), 356 finished / 8 failed (400), 59 and 16 seeds rescued, both sweeps clean.

## Measured results

Original 15, quality out of 150 after the corrected checkers (one run each):

| Run | Config | Score | Est. cost | Five-hour / weekly window |
| --- | --- | --- | --- | --- |
| rb-frontier-1 | Opus alone | 150.0 | $3.32 | 13% / 2% |
| rb-cascade-1 / -2 | cascade | 150.0 / 150.0 | $1.16 / $0.84 | 10% / 1% ; 3% / 0% |
| rb-frontier-2 | Opus alone | 147.9 | $3.87 | 21% / 2% |
| rb-cascade-3 / -4 | cascade | 147.9 / 146.7 | $0.82 / $0.76 | 6% / 1% ; 6% / 0% |
| rb-haiku-1 | Haiku alone | 142.0 | $0.21 | 2% / 0% |
| rb-cascade-5 (F109 never fired) | cascade | 146.8 | | |
| rb-cascade-6 (F109 fired) | cascade | 147.8 | $0.6866 | 6% / 0% |

Held-out 15: ho-frontier-1 150.0 ($6.90, 38% / 3%), ho-cascade-1 150.0 ($1.22, 9% / 1%), ho-haiku-1 140.0 ($0.76, one
engine failure on H2.3, counted 0.0), ho-cascade-2 150.0. Paired comparisons: cascade-2/3/4 vs frontier-1/2 −0.5 points,
interval −1.2 to +0.1; cascade-3/4 vs haiku-1 +3.5, −1.4 to +11.3 (neither tells the systems apart); the held-out
cascade-vs-Opus comparison is a ceiling (both pass everything). ho-cascade-1 fails trap H5.2 (one senior turn, $0.0325): the
router miss Table B predicted.

Real tasks, Haiku alone (`rt-haiku-1`, one run): 10 of 10 pass, about $0.46 estimated, 10.07M tokens, 55 min. The run paused
once on a revoked sign-in (the summary labels every pause "quota"). `nm-stub-scanner` needed one repair (the F95 stub gate
found 4 stand-ins); `ss2-notes-bound` one review-fix. By F106 across the ten: 217 calls, 9.75M input: start-up 23%, prompt
6%, files 11%, commands 11%, earlier turns 49%. `nm-first-turn-retry`: one turn, 33 model calls, context 14k to 95k,
2.05M tokens = calls times context; no command repeated in any turn; 10 Edit uses in 3 parallel batches (one single-line);
four runs of the two slow test files, one full `npm test`, two `tsc` attempts.

Structured output (kept logs): 394 turns used the tool, 79 (20%) had a rejection, 74 recovered (55 after one, 8 after two,
6 after three, 5 after four), 5 failed after the fifth. 221 missing-property mentions: 172 top-level report fields (notes 70,
choices 49, open 37, run 16), 46 blind-test items (open 23, question 23), 3 other (status 1, findings 2); two more
rejections were an invented extra property. 134 rejected calls carried 4.39M of 56.1M tokens (7.8%); the 5 failed turns 1.53M
tokens and 276 s. 3 of the 5 were first turns (not `--resume`); one kept failed workspace (`ho-haiku-1` H2.3) scores 6/6.
With the fields required, Haiku filled `choices` 101/101 and `open` 95/101 of accepted report and one-answer payloads,
Sonnet 30/30 and 16/30, Opus 30/30 and 24/30. The audit script was a scratchpad file (`so_audit_all.py`); it is not in the repo.

## Defects found in the session's own checkers (all fixed, all runs rescored)

Found by reading saved answers that scored low: H3.1 called a private attribute of the reference class (`_f`); 2.3 lacked the
"round the tax to paise, then halve" variant and treated TypeError/ValueError as different; 3.1 did not accept the fetcher as a
positional argument and then passed a new function on every render; 3.2 passed batches only as a flat list; H1.3 required an
empty `tx_id` to be rejected; H4.1 required `uniqueChunks` 0 on a repeat backup; H4.3 required `10 / 4` to be 2.5, `i32::MAX + 1`
to promote, and a 4096-byte heap (now: the heap must not grow with garbage); H4.2 read `leader()` too early and proposed before
cutting a node off. Also: the F109 wiring bug above; the H5.2 trap rule first required `status === "finished"` (records say
`"applied"`) so it could never pass; the prompt audit removed "joined with '; '" from `ss2-notes-bound`, which
`context.test.js:288` asserts (restored in `05f5732`). Harness rule "a task's tier only goes up" was widened twice (chain
fallbacks that stopped on quota, a revoked login, or an unavailable model did no work).

## Corrections the session made to its own statements
- STATUS 53 first said 192 missing-field mentions and "105 of them choices/open": corrected to 221, 172/46/3.
- It first said "ten single-line Edit calls, three test runs": corrected to batched edits and four runs.
- An early fill-rate table counted blind-test payloads as reports; replaced.

## Where things are
`docs/STATUS.md` entries 42 to 54; `docs/22-path-to-the-goal.md` (items ticked: held-out set, more than one run; M9 4 of 5);
`docs/23-offline-phase1-report.md`; `evals/routing-bench/{README,REPORT,HELD_OUT_ROUTES}.md` (REPORT's last sections hold the
live tables and the audit); `evals/real-tasks/{README,BATCH-2}.md`; `docs/10-features.md` (F105 to F110). Saved runs:
`evals/routing-bench/results/<name>/`, benchmark workspaces `~/.neuromesh-bench/<name>/<slug>/`, eval runs `~/.neuromesh/evals/`
and `~/.neuromesh/projects/`.

## Open at the end of the session
- F110 had not been measured live (kept-log numbers only); what to look at: `structured.rescued` events, no more
  `error_max_structured_output_retries`, whether `choices` and `open` are still filled.
- F109 had not been run on the held-out set (`ho-cascade-3` did not exist); H1.3 and H5.1 are its targets, H5.2 its trap.
  Its repair path (checks failing after the one-answer turn) was not exercised by `rb-cascade-6`.
- The terse real-task run had not been made (command in `HANDOFF.md`); the ten prompts had been read by the author and one
  second pass, both models.
- 4.3 alone was 65% of the suite's input after F109 (633k of 969k, 18 calls, 67% the model's own earlier turns).
- Batch 2: nothing built; ProofBench's Rust fixtures need an importer; no real refactor task existed.
- 3.3's checker waits for a Postgres; M9's box in doc 22 reads "4 of 5".
- The eval summary's "paused (quota)" label covers sign-in pauses too (noted, not changed).
