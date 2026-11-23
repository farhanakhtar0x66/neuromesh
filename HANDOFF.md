# Handoff: Neuromesh, as of 2026-11-19

One file for whoever works on Neuromesh next. It states facts (what exists, what was measured, what is known not to
work, what is open), not orders. It consolidates the four handoffs written on 2026-11-19 (this file's earlier version,
the Fable session of 11-12 to 13, the 11-14 session, the Sonnet session of 11-15 to 16); those files were removed and
are in git history (`git show 0f1f276:HANDOFF-2026-11-13.md`, `.../docs/handoff-2026-11-14-session.md`,
`.../docs/handoff-sonnet-session-2026-11-15.md`).

Read next: `CLAUDE.md` (the working rules), then `docs/STATUS.md` (one numbered entry per event, 1 to 71; the full
log). Where an older document and this file disagree, the later work is current.

## The goal

The owner pays for a $20 Claude plan. The stated goal (`docs/22-path-to-the-goal.md`):

> minimise the total cost of a run, subject to resolving at least as often as one frontier model working alone.

"Cost" is first the plan's five-hour and weekly windows, second dollars at API list prices. Dollar figures here are
API-equivalent estimates (nothing is paid per token). Unless said otherwise every number is from one run.

## Where things are

| Branch | What it holds |
| --- | --- |
| `main` | the 0.3.0 beta (2026-11-16, `42f672b`), then (2026-11-19) fast-forwarded to `neuromesh-research`: everything below, defaults unchanged (`cascade-claude`). |
| `neuromesh-testing` | `aa0a409` (2026-11-14), behind `main`; testers install it. Not moved. |
| `neuromesh-research` | everything since: F111 to F132, SWE-bench-Live, the lead and K1/K5/K6 presets, docs 23 to 26. Not merged to testing. |
| `code/*` | worktrees of Sonnet build sessions (`.claude/worktrees/`). |

- `neuromesh-routing` (where the cascade was built) was merged into all three branches and deleted on 2026-11-14.
- The `neuromesh` command on the owner's Mac runs `~/.neuromesh/app`, a checkout of `neuromesh-research` (switched from
  `neuromesh-testing` on 2026-11-14). After a push: `git -C ~/.neuromesh/app pull --ff-only`. `install.sh` resets that
  copy to `neuromesh-testing`; it has not been run.
- Feature registry: `src/features.ts`; `docs/10-features.md` lists them. Next free id: **F134**.
- License: MIT since 2026-11-19 (was PolyForm Shield 1.0.0); the name and logo are not licensed (`NOTICE.md`).
- `PLAN.md`: the plan for starting projects on Gemini Flash and continuing with Opus (not built).
- At `60f10bd`: `npm test` 373 of 373, `npx tsc --noEmit` clean, both fault-harness sweeps keep every rule.
- Telemetry (F52): endpoint live at https://neuromesh-telemetry.farhanakhtar.workers.dev (Cloudflare Worker + D1,
  `telemetry-endpoint/`, `deploy.sh`); admin token in `~/.neuromesh/telemetry/admin-token` (not in git); tests never
  post to it (NODE_TEST_CONTEXT guard); `neuromesh telemetry pull` reads it.
- Working arrangement since 2026-11-16: an advisor session decides, Sonnet 5.5 sessions build from its prompts, the
  owner runs live commands (in practice the advisor also ran live evals on 11-17 to 19 with the owner's OK).
- Housekeeping 2026-11-12: the old Rust binary (`neuromesh 0.0.1`) was removed from `~/.local/bin` (it now holds the
  installer's shell wrapper); old run history (`~/.neuromesh/projects`, `history.json`) moved to the Trash;
  `~/.neuromesh/evals` kept; a stray empty `~/Projects/.git` moved to the Trash. New project in the TUI makes its own
  repository with a first commit (`9dc0e63`).

## Timeline of the work

| Dates | Session | What | Record |
| --- | --- | --- | --- |
| to 11-12 | several | v0.1 engine, v0.2 TUI, factory presets (Opus or Sol lead, Luna/Haiku/Flash workers) | STATUS 1 to 22 |
| 11-12 to 13 | Fable 5.2 | fault harness, F69 to F79, eight-task benchmark, hard task `hard-py-minidb` | STATUS 23 to 26, docs 15 to 18 |
| 11-13 to 14 | | the routing cascade F80 to F99, `cascade-claude`, routing bench | docs/19, `evals/routing-bench/` |
| 11-14 | Opus | phase-2 review, F100 to F104, the plan (doc 22), default preset `cascade-claude` | docs 21, 22 |
| 11-15 to 16 | Sonnet 5.5 | checkers that run code (M9), F105 to F110, held-out set, real-task tooling, batch 1 | STATUS 42 to 54, doc 23 |
| 11-16 to 17 | advisor + Sonnet sessions | 0.3.0 beta, F111 to F118, batches 2 and 3, the hard set | STATUS 55 to 64 |
| 11-17 to 19 | Opus advisor | SWE-bench-Live, F119, the lead F120 to F126, K1/K5/K6 F127 to F132, final trials | STATUS 64 to 71, docs 24 to 26, `evals/swe-live/RESULTS.md` |

GPT-6 Luna is no longer used. Results measured on the factory presets (logstat, bookshelf, python-bot, "finding 23")
do not describe the cascade; an assistant on 2026-11-14 judged the project from them and wrote a plan around Luna.

## Results, by kind of work

| Kind of work | Suite | Measured | Source |
| --- | --- | --- | --- |
| Easy | real-tasks batch 1 (10), batch 2 (29), batch 3 (10), hard set (12) | Haiku 5.5 alone: 10/10, 28/29, 8/10, 9/12. The cascade on batch 3: 7/10 ($2.86, before F117/F118); on the hard set: 11/12 ($3.12) | STATUS 51, 61, 63, 64 |
| Medium: building from the owner's kind of prompt | routing bench, 15 prompts plus 15 held-out, checkers run the code | cascade 150/150 at $0.84, 3 five-hour points; Opus alone 150/150 at $3.32, 13 points (tables below) | `evals/routing-bench/REPORT.md` |
| Real use | owner's usage log, `~/.neuromesh/usage/USAGE.md` | cascade-claude: 4 runs, all finished with passing checks, $0.01 to $0.53, one rating (4 of 5) | usage log |
| Hard: real repository bug fixes | SWE-bench-Live, 21 issues | Opus alone and K6 + F132 resolve the same 7 of 19, $9.14 and $8.91 | `evals/swe-live/RESULTS.md` |

### Routing bench (quality out of 150, corrected checkers)

| Run | Config | Score | Est. cost | Five-hour / weekly |
| --- | --- | --- | --- | --- |
| rb-frontier-1 / -2 | Opus alone | 150.0 / 147.9 | $3.32 / $3.87 | 13% / 2%; 21% / 2% |
| rb-cascade-1 / -2 | cascade | 150.0 / 150.0 | $1.16 / $0.84 | 10% / 1%; 3% / 0% |
| rb-cascade-3 / -4 | cascade | 147.9 / 146.7 | $0.82 / $0.76 | 6% / 1%; 6% / 0% |
| rb-cascade-6 (F109 fired) | cascade | 147.8 | $0.69 | 6% / 0% |
| rb-haiku-1 | Haiku alone | 142.0 | $0.21 | 2% / 0% |

- Held-out 15: Opus alone 150.0 ($6.90, 38% / 3%), cascade 150.0 ($1.22, 9% / 1%), Haiku alone 140.0 ($0.76, one
  engine failure counted 0). The held-out comparison is at the ceiling (both pass everything).
- Paired comparison (F107): cascade 2/3/4 against Opus 1/2: −0.5 points, 90% interval −1.2 to +0.1.
- Tier 0 on its first route: 11 of 15 expected tiers on the tuned set, 8 of 15 on the held-out set
  (`evals/routing-bench/HELD_OUT_ROUTES.md`). The held-out set has never been used to change the router.
- Traps (regex bomb, jargon wall, impossible sort; held-out H5.1 to H5.3) all held except H5.2 once (a $0.03 senior
  turn), the miss Table B predicted.
- 4.3 alone was 65% of the suite's input after F109 (633k of 969k; 67% the model's own earlier turns).

### The hard task `hard-py-minidb` (11-13)

A pure-Python SQL engine checked against SQLite (197 hidden cases in 12 groups; `evals/tasks/hard-py-minidb/`).
`factory-opus-sonnet-haiku` (`hard-tiers-1`): **197/197**, 49 minutes, expert 1.72M and workers 15.50M tokens; Opus
built the executor itself, Sonnet four parts, Haiku one. `hard-opus-haiku-1` was stopped at 23 minutes (plan of 5 tasks
discarded against a limit of 4). Fable alone was cut at 16 minutes with no file written; the scheduled rerun was
cancelled, so **there is no single-model bar on this task**.

### Eight-task benchmark (11-13)

Opus alone 8/8 (28/28 on the whole suite by accident, about $4.59), Haiku alone 8/8, Opus+Haiku plan-first 8/8. These
tasks separate setups on cost only.

### SWE-bench-Live, all configurations

27 valid issues imported (4 of 31 rejected); the comparison set is 21 (Haiku's 19 failures plus 2 of its passes).
Opus alone did not finish PyPSA-1310, so most comparisons are on 20; A2's electrum did not run (sign-in lost), so
A2's is on 19.

| Configuration | Preset | Resolved | Est. cost |
| --- | --- | --- | --- |
| Haiku alone | solo-haiku | 8 of 27 (9 with interface notes); 3 of the 21 | $1.61 on 27 |
| Cascade with F119 | cascade-claude | 5 of 21 | $5.13 |
| Opus alone | solo-opus | 8 of 20 | $9.40 |
| Sonnet alone | Sonnet 5.5 high, alone | 1 of 5 | $1.10 |
| Lead v3 (Opus plans, cheap models build, Opus reviews) | lead-claude | 7 of 20 | $15.22 |
| K1 (Haiku scouts, Opus writes one patch with no tools) | patch-claude | 2 of 21 | $5.74 |
| K6 with Opus, before F132 (trial A) | dossier-claude | 5 of 20 | $9.78 |
| K6 with Sonnet, before F132 (trial B) | dossier-sonnet | 5 of 20 (the same 5 as A) | $4.18 |
| K6 with Opus and F132 (trial A2) | dossier-claude | **7 of 19, the same 7 as Opus alone**, plus PyPSA | **$8.91** (Opus alone on those 19: $9.14) |
| F132 on the 3 issues A lost | dossier-claude / dossier-sonnet | Opus 3 of 3 ($2.29); Sonnet 0 of 3 ($1.03) | |

Per-issue tables, costs by model and Opus's re-read tokens: `evals/swe-live/RESULTS.md`. About 4 of the 21 issues
cannot be solved from the issue text (an unstated message, argument or migration name).

## What the measurements established

1. **Judgement handed between models lost quality every time it was measured**: Opus's plan built by Haiku (lead v2
   to v5 lost implied cases); Haiku's diagnosis and mandatory reproduction given to Opus (openai-1633 under K6, F131);
   the brief's worker standards given to the solver (trials A and B, F132). Facts handed over (quoted code, test
   commands and their output) did not lose quality.
2. **Opus needs its own tool session on real repositories.** One blind patch (K1): 2 of 21; its own session with a
   dossier (K6): Opus's level.
3. **Opus's cost is the number of its calls**: each call re-reads the CLI's system prompt and the whole session. On
   black, alone: 36 calls, 1.51M tokens re-read; with the dossier: 22 calls, 756k. Its outputs were already short.
   Across Haiku's ten batch-1 turns (F106): start-up 23% of input, prompt 6%, files 11%, commands 11%, earlier turns 49%.
4. **A cheaper model's verdict is not a gate on hard fixes.** The cascade's tester approved fixes the hidden tests
   failed; K1 accepted patches that passed Haiku's reproduction; Sonnet's K6 patches passed every visible check.
5. **The dossier saves only where the search is big** (black, lastmile, mcp-1154, attrs). On small or well-named
   issues it adds a Haiku turn and saves nothing; the gate (F130) skips it there.
6. **Sonnet with the dossier** resolved 5 of Opus's 8 at 44% of K6-with-Opus's cost and none of the three issues that
   depend on cases the issue only implies.
7. **Quota:** Haiku 5.5 is about 5 to 7 times cheaper than Opus 5.5 per unit of the Claude plan's window, not about 40
   times as at list prices, and shares Opus's window; an Opus+Haiku team on one plan saves window only by using fewer
   tokens.
8. **Synthetic and small real tasks no longer separate Haiku 5.5 high from the frontier** (batches 1 to 3, the hard
   set, the eight-task benchmark); SWE-bench-Live does.
9. A long assistant session (hundreds of thousands of tokens) re-reads its context every turn and shares the window
   with runs made meanwhile; it polluted quota readings on 11-13 and 11-17.

## What exists, by feature range

| Ids | What |
| --- | --- |
| F01 to F68 | engine, TUI, brief engine (F01, `src/intake/brief.ts`), context packet (F12, F13), compaction (F42), sign-in pause (F64), telemetry (F52), split (F68): see `docs/10-features.md` |
| F69 to F72 | budget handoff, cut turns keep usage, one review of a spec-planned build, quota log |
| F73 to F76 | from the fault harness: heal worktree, adapter guard, sync before checks, leftover-process stop |
| F77 to F79 | one-answer workers with no tools (direct-build), three tiers (worker, senior, expert), a finding fixed on the rung that built the file |
| F80 to F99 | the routing cascade (below) |
| F100 to F104 | start-here line ranges (kept, on), blind tests (**off by default**), repair race, evidence override, quota shift (on, never fired live) |
| F105 to F110 | choices shown in full, five-part input split, paired bootstrap (`bench --compare`), run record, direct worker (kept), structured-output rescue |
| F111 to F118 | telemetry summary, tool preflight, bad-run report (`neuromesh report`), short output, reproduce-first (off), network pause, empty-done, keep-checks |
| F119 | checks green at the start no longer stand in for the review |
| F120 to F126 | the lead: Opus plans with cases, triage (F121: trivial or small self-contained goes to Haiku alone), scout report on big repos, evidence probes, the lead's test file as oracle, no takeover, direct no-tool calls (preset `lead-claude`) |
| F127 | K1 patch-lead: Haiku scouts in a disposable copy, Opus writes search/replace edits in up to 3 calls (`patch-claude`) |
| F128 | K5 lead-auto: patch for repository changes, plan for big requests (`auto-claude`) |
| F129 | K6 lead-dossier: Haiku's dossier, then the solver's own tool session (`dossier-claude`, `dossier-sonnet`) |
| F130 | dossier gate, no model call: dossier only for a repo over 150 files whose request does not name code it defines |
| F131 | dossier is facts only; the scout's reproduction is advice, not a check |
| F132 | on K6 the solver gets the request without the brief's working standards |

### The routing cascade (F80 to F99; `docs/19-cascade.md`)

| Tier | Model | Job |
| --- | --- | --- |
| 0 | no model: rules, then cluster similarity, then this machine's calibration table | the starting tier (`src/routing/router.ts`; record in `~/.neuromesh/routing/calibration.json`) |
| 1 grunt | Haiku 5.5 | mechanical work, checked only by the project's checks; an inline transform is one no-tools call |
| 2 worker | Haiku 5.5 high (since STATUS 63) | routine building; writes a confidence preamble and stops under 0.4 |
| 3 senior | Sonnet 5.5 high | judgement; reviews (tester) |
| 4 expert | Opus 5.5 medium | plans and writes the hardest part's blueprint; builds nothing |

Details: at most 2 tasks per run reach the expert (F86); an expert route gets plan-then-build only by the size rule or
F94 (a short new build naming 3 or more technical domains), otherwise it starts on Sonnet (F93); stand-ins such as
`unimplemented!()` fail the checks (F95); `scope: true` in the preamble has the expert split the task (F96); a build the
expert planned is reviewed once as a whole (F98); Tier 0 scores the instruction, not pasted material (F89, F99).
F103 lets this machine's record overrule a confident Tier 0 match after 5 tries in a cell; it has not fired.

Live checks of the cascade on the owner's "local AI agent" prompt: Sonnet answered `scope: true`, Opus split it into 4
parts, Haiku built them: 19 files, 117 tests passing, $0.53 (`~/Projects/scope-test-2`, not in this repository).
Follow-up edits there went to Haiku alone at $0.012 and $0.032; the first passed with unbounded Notes, which nothing
caught under `no-checks`.

### Design facts worth knowing before changing these features

- F101 (off) never gates on its own: a failing blind test gets the developer one turn, then is dropped; its "open"
  probe is reported as a question at no turn's cost.
- F102 runs only with project checks, once per task, when a dearer tier is next; lanes `tasks/<id>/race-a|b`; the
  smaller passing diff wins. F104 moves only worker and tester turns and nothing on a stale quota reading.
- F109 fires on a request judged small and self-contained by `src/routing/selfcontained.ts` (at most 100 words and 2
  named files) or a planned part with a spec. It must read `state.request` (the user's text), not `state.prompt` (which
  includes the brief's standards); that wiring bug once kept it from firing.
- F110: Claude Code's StructuredOutput tool rejects payloads that leave out string fields the model thinks are empty;
  the engine takes the last structured input when the parser would accept it (`structured.rescued` events).
- F132: the brief's bug standards include "behaviour the request does not mention must stay as it is"; that sentence
  is why trials A and B lost the implied-case issues.

## Tools and how to run them

- **Fault harness:** `node evals/chaos.ts --seeds 1000` and `node evals/chaos.ts --kill 1 --seeds 400` (seeded fake
  agents that crash, hang, damage the worktree, leave processes; rules checked after each run; `--kill` kills the
  engine at a turn and resumes). Rules and dice: `test/support/chaos.ts`; `docs/16-fault-harness.md`. No model calls.
- **Routing bench:** `node evals/routing-bench/run.ts --config cascade|frontier|haiku --set original|held-out|all
  --name <n> [--wait-reset]`; score with `score.ts`; `rescore.ts` reruns a saved workspace through the current checker;
  `sh evals/routing-bench/validate.sh` checks every reference passes and every empty folder fails; `routes.ts` prints
  Tier 0's route with no model call. 3.3's checker needs a Postgres (none here).
- **Comparisons and records:** `node evals/bench.ts --compare a1,a2 b1,b2 --margin 10` (paired bootstrap);
  `node evals/bench.ts --split <name>` (input by part); `node src/record/cli.ts backfill|summary|runs|results` (the
  append-only record `~/.neuromesh/record/record.jsonl`, no request text or code).
- **Real tasks from commits:** `evals/make-task.ts --repo --commit --name --runner --test-cmd`, `evals/validate-task.ts`,
  `evals/real-task/grade.ts`, `evals/make-batch.ts <batch.json> [--prompts terse]`. Batches: `evals/real-tasks/`,
  `evals/real-tasks-2/`, `evals/real-tasks-3/`; the hard set `evals/hard-tasks/`.
- **Evals:** `node src/cli/main.ts eval --suite <dir> --preset <p> --name <n> --quota [--fake]`; results in
  `~/.neuromesh/evals/<n>/results.json` (keyed by task id; per-model `usage` with `costUsdEquivalent`,
  `usage.cacheRead`, `usage.split.calls`) and `<n>.out`; run folders `~/.neuromesh/projects/<task>-<hash>/runs/<id>`.
  `node evals/baselines.ts --suite <dir> --only haiku|cascade1|opus --name <n>` runs baselines. The solver's prompt
  text is not stored in the run folder.
- **SWE-bench-Live:** suite `evals/swe-live/tasks/<id>` (importer `import.ts`, README there; interface notes for 5
  issues in `interfaces.json`; rejected in `tasks-rejected/`). Docker: colima profile `swe` (x86 via Rosetta), socket
  `~/.colima/swe/docker.sock`; if down, `colima start swe` then `docker context use default`. The agent works on the
  host; a runner executes commands in the image. The hidden check is the official harness; verdicts pass, fail or
  error (timeout or empty output). Five evals in parallel on the 4-CPU VM gave empty grades; two did not. Re-grade one
  issue alone: `bash -c '~/.neuromesh/swe-live/why.sh <run> <id>'` (bash, not zsh). Subsets are symlink folders in
  `~/.neuromesh/swe-live/subsets/` (`all21`, `lost3`, `k6pair`, `opus`, ...).

## Known issues and loose ends

- The Claude CLI's sign-in was revoked mid-run three times (rt-haiku-1, hd-cascade-1, trial A2). The engine pauses
  correctly; the owner signs in again with `claude` in a terminal. electrum-10172 in A2 is unrun.
- `ansible__molecule-4534`: F12 context-packet and F100 start-here fail with `EISDIR` (a directory read as a file);
  the run continues without them.
- With no dossier, Opus inside K6 made more calls than Opus alone on some issues (molecule 12 against 7, simplejwt 9
  against 5); the cause is not established (candidates: the 8k-character repository map, start-here hints).
- PyPSA-1310: Opus's cost there is unknown (no `costUsdEquivalent` recorded; 3.3M to 3.9M tokens re-read).
- Dossier runs show the old cascade staffing wording on some requests (lastmile-367): a label only.
- F102 to F104 have never fired live; `cascade-hybrid` (F104's preset) targets Luna and is stale.
- F109 has not run on the held-out set; its repair path is unexercised. F110 is unmeasured live.
- The beta sprint's 40-task claim (doc 22, track B) was not run: batches 1 to 3 and the hard set were too easy for
  Haiku to separate presets; SWE-bench-Live replaced them as the hard measure.
- `hard-tiers-1`'s per-model dollars do not add up to its $6.02 summary (a turn cut at the budget has unknown cost;
  resumed sessions report cumulative cost). Tokens and times are right.
- An AQI run (`~/Projects/bench-aqi`) produced a spec whose target was computed from its own inputs; not fixed.
- The terse real-task prompts exist (`prompts-terse/`) but the run was dropped: 7 of 10 hinge on a format the short
  prompt leaves out.

## Open (not built, not measured)

- **The owner's stated direction (2026-11-19):** route each kind of work to the configuration measured to win on it
  (easy to Haiku alone, building to the cascade, hard repository fixes to K6), choosing among the models the user is
  signed in to, using this machine's record and published results; when a task moves from Sonnet to Opus, hand over a
  facts-only compaction of the context (decisions removed). Relevant facts: no measured cheap-model signal says "this
  got hard" (finding 4); signals known before starting are the gate's (repository size, named code) and the brief's
  kind; failing checks after repairs are a signal only where real tests exist. Parts that already exist: Tier 0,
  the calibration record and F103, CONTEXT.md notes and compaction (F42), the brief's kinds, F121 triage, F130 gate.
- A huge-repository test (Opus alone against K6 on a feature in a very large codebase), deferred by the owner.
  Chromium is about 100 GB with hours-long builds; a large repository that builds quickly would test the same effect.
- Cross-run repository facts (doc 25 C10, TokenEconomizer): keep the dossier's how-to-test and conventions per
  repository for the next run.
- Medium-tier evidence on real repositories: Sonnet with the dossier is measured only on the hard SWE set.
- A single-model bar on `hard-py-minidb` does not exist.
- A write sandbox on Linux (bubblewrap); only Codex is confined today.

## How to work here

- `CLAUDE.md` holds the rules. The ones most often broken:
  - Live calls spend the owner's plan; the fake backend is for engine tests; say before more than a few live calls.
    The owner's instruction: wait for a reset only when the window is at 90% or more.
  - An engine change (`src/engine`, `src/workspace`, `src/backends`) runs both fault-harness sweeps. A new failure seen
    in a real run goes into the harness first.
  - Every new behaviour is a feature with an id, a switch (`isOn`/`optional`), a `// [Fxx key]` mark and
    `feature: "Fxx"` on its events; `--disable <key>` and `NEUROMESH_FAULT=<key>` work on it.
  - One run is a hint; on 20 issues a difference of one or two is noise.
  - An unknown number is recorded as unknown, never 0.
  - The held-out routing prompts are never used to tune the router.
- Before building an idea, check `docs/10-features.md`: on 2026-11-14 a review proposed a repository map and a
  calibration loop that had existed for days (F12, F81).
- Commit and push every change to `neuromesh-research`, then update `~/.neuromesh/app`.
- `neuromesh-old*` folders in `~/Projects` are a read-only archive.
- Plain words in docs and comments; `docs/STATUS.md` gets one numbered entry per event; no long worklogs.
