# Handoff: the 2026-11-14 session (phase-2 review, F100 to F104, the plan)

Facts about what one session did on `neuromesh-research`, for an agent
picking up from it. The live handoff is `HANDOFF.md`; this file does not
replace it. Later status (from 2026-11-15 on) is in `docs/STATUS.md`.

## Commits (all on `neuromesh-research`, pushed)

| Commit | What |
| --- | --- |
| `fbd5a93` | Friend's phase-2 review read against the code; F100 to F104 built |
| `0ad6c9f` | Two kill-and-resume defects in the blind step fixed |
| `62a3552` | F101 changed after its first live runs; `docs/22-path-to-the-goal.md` first written |
| `2e20999` | Doc 22: an approach for each of nine phases |
| `f6cd7ef` | Doc 22 corrected from Luna to the cascade |
| `3d28ff1` | Default preset `cascade-claude` (DEFAULT_PRESET, CLAUDE.md, README, TUI favourites) |
| `67c3fa0` | First `HANDOFF.md`; evidence checklist and beta track in doc 22 |

## The review (`docs/21-phase-2-review.md`)

The friend's note (`~/Projects/neuromesh-old-learn/nmr-phase-2.md`, read-only
archive) proposed four upgrades. Checked against the code:

- A host-side repository map already existed (F12, F13); per-task line ranges did not.
- The cascade's 47% extra tokens came from session start-up (system prompt and
  tool definitions), not exploration: the benchmark prompts start in empty folders.
- A calibration loop already existed (F81); it was consulted only when Tier 0 was unsure.
- The note assumed GPT-6 Luna as worker; the system had moved to the Claude-only cascade.

## Features built (registered in `src/features.ts`)

| Id | Key | Main code | State as of 2026-11-17 (STATUS 57) |
| --- | --- | --- | --- |
| F100 | `start-here` | `src/context/packet.ts` (`startHere`, `leadTerms`) | kept, on; 11 live firings, first read hit a listed file 7 of 10 |
| F101 | `blind-tests` | `src/checks/blind.ts`, `src/engine/run.ts` (`blindStep`) | **off by default** (`--enable blind-tests`); 83 live turns, caught no confirmed bug, cost ~7% of cascade runs |
| F102 | `repair-race` | `src/engine/run.ts` (`raceStep`, `raceApplies`) | on; never fired live |
| F103 | `evidence-override` | `src/routing/calibration.ts` (`evidencePick`) | on; never fired (needs 5 tries in one cell) |
| F104 | `quota-shift` | `src/engine/quota.ts`, preset `cascade-hybrid` | on; never fired; `cascade-hybrid` targets Luna and is stale |

Design facts worth knowing before changing them:

- F101 never gates on its own: a failing blind test gets the developer one
  turn, then is removed (`blind.dropped`). Its "open" probe (growth without a
  limit) is reported as a question (`blind.open`, `openQuestions` on the task)
  and costs no turn. The tester is shown pre-work tests of the changed files
  for calling conventions (`blindUsage`), never the new code.
- F101 saves the tester's answer (`task.blindAnswer`) so a resume after a kill
  does not pay twice, and removes a leftover `tasks/<id>/tester` copy on entry.
- F102 runs only with project checks, once per task, only when a dearer tier
  or the expert is next, never within a tier's climb. Lanes are
  `tasks/<id>/race-a|b`; smaller passing diff wins.
- F104 moves only worker and tester turns; an unknown or stale reading
  (window reset, older than 5 h) moves nothing. Readings: `~/.neuromesh/quota.json`.
- F103's probe (`cascade.probe`) is chosen by a hash of the request, so reruns repeat.

## Tests and harness

- `test/phase2.test.ts`: 25 tests on F100 to F104 (later edited by others).
- `test/engine.test.ts`: four escalation tests set `disable: ["repair-race"]`.
- `test/support/chaos.ts` and `evals/chaos.ts`: new draws (blind requests, a
  second backend `other`, probes, open probes), new rules (no race copy left,
  one race per task on its own tier, blind tests once per task and never by
  the expert, only worker/tester turns moved), and a per-path coverage line.
- First kill sweep: 5 of 400 seeds broke a rule, all in the blind step (paid
  twice after a kill; copy left behind). After fixes, 1,000 ordinary and 400
  kill seeds kept every rule (`docs/16-fault-harness.md`).

## Live runs this session (one each)

`scope-test-2` at `d7ac633`, the Notes request, `cascade-claude`, a scratch
Neuromesh home:

| Run | Result | Est. cost |
| --- | --- | --- |
| F101 as first built | 15 of 22 blind tests wrong (misread a pure API); unbounded Notes not caught | $0.032 |
| With usage and open probes | blind tests passed; asked whether Notes should be capped | $0.019 |

Haiku's own report in run 2 already said Notes had no cap; the run summary
truncated it. That led to plan item D6 (built later as F105).

## Documents

- `docs/21-phase-2-review.md`: the review, the five features, the live check.
- `docs/22-path-to-the-goal.md`: the plan (tracks M, O, S, R, C, A, D, P, L,
  E, B; nine phases with approach, budget, gate, fallback). Corrected to the
  cascade; later agents have ticked and edited it.
- `HANDOFF.md`: first version written here; since rewritten by later agents.

## Environment changes on the owner's Mac

- `~/.neuromesh/app` (what the `neuromesh` command runs) was switched from
  `neuromesh-testing` to `neuromesh-research`. `install.sh` would reset it.
- Memory note added: `cascade-is-current-architecture.md`.

## Mistakes made in this session

- Judged the project from pre-cascade runs and wrote the first plan around
  Luna; corrected after the owner pointed to the routing benchmark.
- Edited the wrong one of two near-identical tests once (fixed before commit).
