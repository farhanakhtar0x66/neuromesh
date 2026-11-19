# Handoff: for whoever works on Neuromesh next

Rewritten 2026-11-19 on `neuromesh-research` (last commit before this file: `60f10bd`). It states facts: what exists,
what was measured, what is known not to work, what is open. Read it, then `CLAUDE.md` (the working rules), then
`docs/STATUS.md` (one numbered entry per event; 63 to 71 cover the work summarised here).

## Latest facts (updated 2026-11-19)

- Branch `neuromesh-research` is at 60f10bd (STATUS 71). Next free feature id: F133.
- Lead/K-series experiments 2026-11-17 to 19 (`docs/24-lead.md`, `docs/25-cascade-research.md`,
  `docs/26-final-design.md`): F120 to F132. On SWE-bench-Live issues, Opus alone resolved 8.
  K1 (F127 patch-lead) resolved 2 of 21. K6 (F129 lead-dossier) with F132 (solver-own-judgement),
  trial A2: 7 of 19, at est. $8.91 against Opus alone's $9.14 (one run). That is about Opus
  quality for a small saving. The owner's next stated direction is routing each kind of work to
  its measured winner.
- Haiku shares Opus's quota on one Claude plan, so a cheaper worker saves window only on its own plan.
- Since 2026-11-16 the arrangement is: an advisor session decides, Sonnet 5.5 sessions build
  from its prompts, the owner runs live commands.
- Telemetry (F52): the endpoint is live at https://neuromesh-telemetry.farhanakhtar.workers.dev
  (Cloudflare Worker + D1, `telemetry-endpoint/`, `deploy.sh`). Its admin token is in
  `~/.neuromesh/telemetry/admin-token` (not in git). Tests never post to it (NODE_TEST_CONTEXT guard).
- Housekeeping done 2026-11-12: the old Rust binary (`neuromesh 0.0.1`) was removed from
  `~/.local/bin`, which now holds the installer's shell wrapper. The old run history
  (`~/.neuromesh/projects`, `history.json`) was moved to the Trash. `~/.neuromesh/evals` was kept.
  An empty stray `~/Projects/.git` was moved to the Trash. New project in the TUI now makes its
  own repository with a first commit (9dc0e63), even inside another repository and with no git
  identity set.
- `docs/STATUS.md` (entries up to 71) is the full log. The checklist below dates from 2026-11-14;
  some items in it predate the K-series.

## What this is for

The owner pays for a $20 Claude plan. The stated goal (docs/22):

> minimise the total cost of a run, subject to resolving at least as often as one frontier model working alone.

"Cost" is first the plan's five-hour and weekly windows, second dollars at API list prices. All dollar figures below
are API-equivalent estimates (nothing is paid per token), from one run each unless said otherwise.

## Where things are

| Branch | What it holds |
| --- | --- |
| `main`, `neuromesh-testing` | the 0.3.0 beta (2026-11-16): F01 to F110, `cascade-claude` the default. Testers install `neuromesh-testing`. |
| `neuromesh-research` | everything since: F111 to F132, the SWE-bench-Live suite, the lead and K1/K5/K6 presets, docs 23 to 26. Not merged to testing. |

- The `neuromesh` command on the owner's Mac runs `~/.neuromesh/app`, checked out on `neuromesh-research`. After a push:
  `git -C ~/.neuromesh/app pull --ff-only`. `install.sh` resets that copy to `neuromesh-testing`; it has not been run.
- Feature registry: `src/features.ts`. Next free id: **F133**.
- Tests: `npm test` 373 of 373, `npx tsc --noEmit` clean, at `60f10bd`. Fault harness (`node evals/chaos.ts --seeds 1000`,
  `--kill 1 --seeds 400`) keeps every rule at that commit.

## Results, by kind of work

| Kind of work | Suite | Measured | Source |
| --- | --- | --- | --- |
| Easy | real-tasks batch 1 (10), batch 2 (29), batch 3 (10), hard set (12) | Haiku 5.5 alone: 10/10, 28/29, 8/10, 9/12. The cascade on batch 3: 7/10 ($2.86, before F117/F118); on the hard set: 11/12 ($3.12) | STATUS 51, 61, 63, 64 |
| Medium: building from the owner's kind of prompt | routing bench, 15 prompts, checkers run the code | cascade 150/150 at $0.84, 3 five-hour points; Opus alone 150/150 at $3.32, 13 points. Held-out set of 15 exists (`evals/routing-bench/held-out/`) | `evals/routing-bench/REPORT.md`, docs/22 |
| Real use | owner's usage log, `~/.neuromesh/usage/USAGE.md` | cascade-claude: 4 runs, all finished with passing checks, $0.01 to $0.53, one rating (4 of 5) | usage log |
| Hard: real repository bug fixes | SWE-bench-Live, 21 issues (below) | Opus alone and K6 + F132 resolve the same 7 of 19 at $9.14 and $8.91 | `evals/swe-live/RESULTS.md` |

### SWE-bench-Live, all configurations

27 valid issues imported; the comparison set is 21 (Haiku's 19 failures plus 2 of its passes). Opus alone did not finish
PyPSA-1310, so most comparisons are on 20; A2's electrum did not run (sign-in lost), so A2's is on 19.

| Configuration | Preset | Resolved | Est. cost |
| --- | --- | --- | --- |
| Haiku alone | solo-haiku | 8 of 27 (9 with interface notes); 3 of the 21 | $1.61 on 27 |
| Cascade with F119 | cascade-claude | 5 of 21 | $5.13 |
| Opus alone | solo-opus | 8 of 20 | $9.40 |
| Sonnet alone | solo-claude (Sonnet high) | 1 of 5 | $1.10 |
| Lead v3 (Opus plans, cheap models build, Opus reviews) | lead-claude | 7 of 20 | $15.22 |
| K1 (Haiku scouts, Opus writes one patch with no tools) | patch-claude | 2 of 21 | $5.74 |
| K6 with Opus, before F132 (trial A) | dossier-claude | 5 of 20 | $9.78 |
| K6 with Sonnet, before F132 (trial B) | dossier-sonnet | 5 of 20 (the same 5 as A) | $4.18 |
| K6 with Opus and F132 (trial A2) | dossier-claude | **7 of 19, the same 7 as Opus alone**, plus PyPSA | **$8.91** (Opus alone on those 19: $9.14) |
| F132 on the 3 issues A lost | dossier-claude / dossier-sonnet | Opus 3 of 3 ($2.29); Sonnet 0 of 3 ($1.03) | |

Per-issue tables, costs by model and Opus's re-read tokens: `evals/swe-live/RESULTS.md`.

## What the measurements established

1. **Judgement handed between models lost quality every time it was measured**: Opus's plan built by Haiku (lead v2
   to v5 lost implied cases); Haiku's diagnosis and mandatory reproduction given to Opus (openai-1633 under K6, F131);
   the brief's worker standards given to the solver (trials A and B, F132). Facts handed over (quoted code, test
   commands and their output) did not lose quality.
2. **Opus needs its own tool session on real repositories.** One blind patch (K1): 2 of 21; its own session with a
   dossier (K6): Opus's level.
3. **Opus's cost is the number of its calls**: each call re-reads the CLI's system prompt and the whole session. On
   black, alone: 36 calls, 1.51M tokens re-read; with the dossier: 22 calls, 756k. Its outputs were already short.
4. **A cheaper model's verdict is not a gate on hard fixes.** The cascade's tester approved fixes the hidden tests
   failed; K1 accepted patches that passed Haiku's reproduction; Sonnet's K6 patches passed every visible check.
5. **The dossier saves only where the search is big** (black, lastmile, mcp-1154, attrs). On small or well-named
   issues it adds a Haiku turn and saves nothing; the gate (F130) skips it there.
6. **Sonnet with the dossier** resolved 5 of Opus's 8 at 44% of K6-with-Opus's cost and none of the three issues that
   depend on cases the issue only implies.
7. About 4 of the 21 issues cannot be solved from the issue text (an unstated message, argument or migration name).

## What exists (built on `neuromesh-research`)

| Ids | What | Preset |
| --- | --- | --- |
| F111 to F118 | `neuromesh report`, `nm run` short output, reproduce-first (off), network pause, empty-done, keep-checks | |
| F119 | checks green at the start no longer stand in for the review | all |
| F120 to F126 | the lead: Opus plans with cases, triage (F121: trivial or small self-contained goes to Haiku alone), scout report on big repos, evidence probes, the lead's test file as oracle, no takeover, direct no-tool calls | lead-claude |
| F127 | K1 patch-lead: Haiku scouts in a disposable copy, Opus writes search/replace edits in up to 3 calls | patch-claude |
| F128 | K5 lead-auto: patch for repository changes, plan for big requests | auto-claude |
| F129 | K6 lead-dossier: Haiku's dossier, then the solver's own tool session | dossier-claude, dossier-sonnet |
| F130 | dossier gate, no model call: dossier only for a repo over 150 files whose request does not name code it defines | |
| F131 | dossier is facts only; the scout's reproduction is advice, not a check | |
| F132 | on K6 the solver gets the request without the brief's working standards | |

Design documents: `docs/24-lead.md` (the lead), `docs/25-cascade-research.md` (published work, K1 to K5, remedies for
v1 to v5), `docs/26-final-design.md` (the facts-only design and where Sonnet goes).

Already present before this work and relevant to what the owner described next: Tier 0 rule router (F80, F94,
`src/routing/router.ts`); this machine's pass record per tier, `~/.neuromesh/routing/calibration.json`, which can
overrule Tier 0 (F103); CONTEXT.md notes and compaction (F42); brief engine (F01, `src/intake/brief.ts`).

## SWE-bench-Live setup (facts for running it)

- Suite: `evals/swe-live/tasks/<id>` (imported by `evals/swe-live/import.ts`; README there). Interface notes for 5
  issues: `interfaces.json`. Rejected: `tasks-rejected/`.
- Docker: colima profile `swe` (x86 via Rosetta), socket `~/.colima/swe/docker.sock`. If it is down: `colima start swe`,
  then `docker context use default`. The agent works on the host; a runner executes commands in the image.
- Hidden check: the official harness; verdicts pass, fail or **error** (timeout or empty output). Five evals in
  parallel on the 4-CPU VM produced empty grades; two in parallel did not.
- Re-grade one issue alone: `bash -c '~/.neuromesh/swe-live/why.sh <run> <id>'` (under bash; zsh does not split the
  arguments). Output in `~/.neuromesh/swe-live/why/<run>/<id>`.
- Subsets are folders of symlinks in `~/.neuromesh/swe-live/subsets/` (`all21`, `lost3`, `k6pair`, `opus`, ...).
- Run: `node src/cli/main.ts eval --suite <dir> --preset <p> --name <n> --quota`; results in
  `~/.neuromesh/evals/<n>/results.json` (keyed by task id; per-model `usage` with `costUsdEquivalent` and
  `usage.cacheRead`, `usage.split.calls`) and `<n>.out`. Run folders: `~/.neuromesh/projects/<task>-<hash>/runs/<run id>`.
- The prompt text the solver received is not stored in the run folder; `events.jsonl` has the brief's kind and the
  number of standards only.

## Known issues and loose ends

- The Claude CLI's sign-in was revoked mid-run twice (STATUS 64, trial A2). The engine pauses correctly; the owner
  has to sign in again (`claude` in a terminal). electrum-10172 in A2 is unrun.
- `ansible__molecule-4534`: F12 context-packet and F100 start-here fail with `EISDIR` (a directory read as a file);
  the run continues without them.
- With no dossier, Opus inside K6 made more calls than Opus alone on some issues (molecule 12 against 7, simplejwt 9
  against 5); the cause is not established (candidates: the 8k-character repository map, start-here hints).
- PyPSA-1310: Opus's cost there is unknown (no `costUsdEquivalent` recorded; 3.3M to 3.9M tokens re-read).
- The lastmile-367 brief is staffed with the old cascade wording ("the cheapest worker rung starts") in dossier runs:
  a label only.
- The beta sprint's 40-task claim (docs/22, track B) was not run: batches 1 to 3 and the hard set proved too easy for
  Haiku to separate presets; SWE-bench-Live replaced them as the hard measure.

## Open (not built, not measured)

- **The owner's stated direction (2026-11-19)**: route each kind of work to the configuration measured to win on it
  (easy to Haiku alone, building to the cascade, hard repository fixes to K6), choosing among the models the user is
  signed in to, using this machine's record and published results; when a task moves from Sonnet to Opus, hand over a
  facts-only compaction of the context (decisions removed). Facts relevant to it: no measured cheap-model signal says
  "this got hard" (finding 4); signals known before starting are the gate's (repo size, named code) and the brief's
  kind; failing checks after repairs are a signal only where real tests exist.
- A huge-repository test (Opus alone against K6 on a feature in a very large codebase), deferred by the owner. Chromium
  is about 100 GB with hours-long builds; a large repository that builds quickly would test the same effect.
- Cross-run repository facts (doc 25 C10, TokenEconomizer): keep the dossier's how-to-test and conventions per
  repository for the next run.
- Medium-tier evidence on real repositories: Sonnet with the dossier is measured only on the hard set above.

## How to work here

- `CLAUDE.md` holds the rules. The ones most often broken:
  - Live calls spend the owner's plan; the fake backend is for engine tests; say before more than a few live calls.
    The owner's instruction: wait for a reset only when the window is at 90% or more.
  - An engine change (`src/engine`, `src/workspace`, `src/backends`) runs the fault harness, both sweeps. A new
    failure seen in a real run goes into the harness first (`test/support/chaos.ts`, `docs/16-fault-harness.md`).
  - Every new behaviour is a feature with an id, a switch (`isOn`/`optional`), a `// [Fxx key]` mark and
    `feature: "Fxx"` on its events.
  - One run is a hint; on 20 issues a difference of one or two is noise.
  - An unknown number is recorded as unknown, never 0.
- Commit and push every change to `neuromesh-research`, then update `~/.neuromesh/app`.
- `neuromesh-old*` folders in `~/Projects` are a read-only archive.
- Plain words in docs and comments; `docs/STATUS.md` gets one numbered entry per event; no long worklogs.
