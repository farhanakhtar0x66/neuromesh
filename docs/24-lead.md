# The lead: Opus decides, cheap models do the work and gather the evidence

The owner's idea (2026-11-18), and the factory picture the project started from (2026-11-10): an expert who directs
the workers, fixes problems when there are any, and otherwise conserves his energy. On SWE-bench-Live the cascade lost
because a cheap model decided first: Haiku fixed the examples an issue gave and missed the cases it implied, the tester
checked the same examples, and nothing climbed (STATUS 65). Opus alone covered the implied cases on 3 of 5.

## What was learnt before, and where it applies here

| Lesson (where) | What the lead does with it |
| --- | --- |
| Planning a small task costs Opus nearly as much as doing it (STATUS 3); every delegation has a fixed start-up cost (doc 00) | Small requests never reach Opus: the brief's "trivial" kind and F109's self-contained test send them to Haiku, with no model call to decide (F121) |
| On one Claude plan Haiku is only 5 to 7 times cheaper than Opus per token, and writes far more (STATUS 23, doc 15) | Measure quota points, not only estimated dollars; keep Haiku's turns few and short (F114 short output, F67 fresh sessions stay on) |
| A fresh Opus prompt costs about $0.15 in cache writes alone; Opus reading a big repository is its dearest part (doc 15) | On a big repository a Haiku turn reads it first and writes a report for the request; Opus plans from the report and opens files only to confirm a detail (F122) |
| Opus's plan was 6.5k output tokens before the cap (F92) | The plan is capped: about 700 words, briefs included |
| Opus waiting must cost nothing; earlier turns re-read are half of every session's input (F106) | No Opus session is kept open or resumed. The review, when there is one, is a fresh read-only turn with a compact packet |
| Opus reviews only add value when something is wrong (the factory picture); a reviewer that runs commands is a long, dear session | Haiku turns each acceptance case into a probe and runs it; the engine re-runs every probe itself, so its result does not rest on Haiku's word. All cases hold and the checks pass: accepted with no Opus turn. Otherwise Opus reviews, read-only, from the evidence (F123) |
| Green-at-start checks verify nothing for a fix (F119); medium effort lost to high (STATUS 63) | The acceptance cases are the verification; workers run at high effort |
| A takeover that rebuilt from an empty folder was 83% of a run's cost (STATUS 20); an expert part the budget cannot pay goes to a worker (F69) | Follow-ups continue from the merged work; Opus builds only what it chooses, inside the expert budget |
| A worker that finds its task too big says so (F68) | Kept: Haiku on a small request can still hand it up |

## The flow

1. **Triage, no model call (F121).** Trivial or self-contained small: Haiku alone, as `solo-haiku` would. Anything
   else: the lead.
2. **Report (F122).** A repository of more than 150 files: one Haiku turn, read-only, writes a report of at most about
   800 words for this request: where the code is (files, functions, lines), how it works now, the conventions nearby,
   which tests cover it and how they run, and what the request implies.
3. **Plan (F120).** Opus, read-only, from the request, the report and the repository map: the acceptance cases
   (concrete inputs and results, implied ones included) and the tasks, each with its builder: grunt (Haiku low),
   worker (Haiku high), senior (Sonnet high) or itself. Under about 700 words.
4. **Build.** The scheduler, as for any team run. No separate tester.
5. **Evidence (F123).** One Haiku turn in a disposable copy writes a probe per case (a command that exits 0 when the
   case holds) and runs it. The engine runs every probe again in its sandbox; its exit status is the result.
6. **Decision.** Every case holds and the checks pass: accepted, no Opus turn. Otherwise Opus, read-only, sees the
   cases, the probes and their output, and the diff, and accepts or adds follow-up tasks for the builder it chooses.
   Then evidence again. At most two rounds.

## How it is tested (after the owner says so)

Baselines exist, one run each, on SWE-bench-Live (`evals/swe-live/RESULTS.md`):

| Set | Haiku | Cascade | Sonnet | Opus |
| --- | --- | --- | --- | --- |
| 5 fixable cascade misses (a2a-414, authlib-802, pint-2194, simplejwt-928, black-4720) | 0 | 0 | 1 | 3 ($3.36) |
| 11 other cascade failures | 0 | 0 | not run | not run |
| 5 cascade passes (dbbackup-601, a2a-443, electrum-10172, PyPSA-1310, openai-1633) | 3 | 5 | not run | not run |

1. Offline first: the fault harness and the tests, with the lead in a quarter of the scenarios.
2. One small probe run (2 or 3 live calls): one SWE-bench-Live issue, to see the report, plan, evidence and decision
   work end to end before spending more.
3. `swl-lead-2` on the 5 fixable misses: the bar is Opus's 3 of 5 at under $3.36 and fewer quota points.
4. If it holds: the 5 cascade passes (does the lead lose what cheaper setups solve?) and the 11 others.
5. A few small requests (routing-bench prompts) to check the triage sends them to Haiku with no Opus turn.

Recorded for every run: resolved, estimated cost by model, five-hour and weekly quota before and after, Opus turns
and their tokens, wall time.
