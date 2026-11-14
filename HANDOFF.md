# Handoff: for whoever works on Neuromesh next

Written 2026-11-14 on `neuromesh-research`. Read this, then `CLAUDE.md` (the
working rules), then `docs/STATUS.md` (the log of what happened). Keep this
file current: when a step below is done, tick it and say where the result is.

## What this is for

The owner pays for a $20 Claude plan, not a $200 one. A frontier model used
for everything builds good software and runs out of plan quickly. Neuromesh
exists to get the same result for far less of the plan:

> minimise the total cost of a run, subject to resolving at least as often
> as one frontier model working alone.

"Cost" is first the plan's five-hour and weekly windows, and second dollars
at API list prices. They are different measures and both are recorded.

## What it is today

The **routing cascade**, preset `cascade-claude`, the default on this
branch. One Claude plan:

| Tier | Model | Job |
| --- | --- | --- |
| 0 | no model: Neuromesh's rules | choose the starting tier (`src/routing/router.ts`) |
| 1 grunt | Haiku 5.5 low | mechanical work; no tools for inline transforms |
| 2 worker | Haiku 5.5 medium, then high | routine building |
| 3 senior | Sonnet 5.5 | judgement; reviews |
| 4 expert | Opus 5.5 medium | plans and advises; builds nothing |

A stuck task climbs; the engine checks everything it can with the project's
own checks. `docs/19-cascade.md` explains it; `src/engine/run.ts` is it.

**The result so far** (`evals/routing-bench/REPORT.md`, run `rb-cascade-2`):
150 of 150 (after the M9 executable rescore; 148.8 under the old
keyword rubric) against Opus alone's 150, an estimated $0.84 against $3.32, 3
points of the five-hour window against 13 (of which 1 to 2 are the session
that ran it), all three traps survived, and faster. One run.

**Do not judge the project from older results.** The logstat, bookshelf and
python-bot runs and "finding 23" in `docs/STATUS.md` were measured on the
earlier factory presets. GPT-6 Luna is no longer used. Before you assess or
plan anything, read the last two days of `git log --all` and the owner's
usage log (`~/.neuromesh/usage/USAGE.md`) to see what is actually being run.
An assistant got this wrong on 2026-11-14 and wrote a plan around Luna.

## Where things are

| Branch | What it holds |
| --- | --- |
| `main`, `neuromesh-testing` | the cascade as merged on 2026-11-14 (F80 to F99); default preset still `factory-opus-luna` there |
| `neuromesh-research` | that, plus F100 to F104, the corrected plan, and `cascade-claude` as the default |

The `neuromesh` command on the owner's Mac runs `~/.neuromesh/app`, which is
checked out on **`neuromesh-research`** (since 2026-11-14, at the owner's
request, so real projects use the latest). After you push here, update it:

    git -C ~/.neuromesh/app pull --ff-only

Do not run `install.sh` on this Mac: it resets the copy to
`neuromesh-testing`. Testers still install `neuromesh-testing`; nothing
reaches them until the owner merges.

F100 to F104 (`docs/21-phase-2-review.md`) are on by default here and mostly
unmeasured: F100 and F101 have one live run each way, F102 to F104 none. If
one misbehaves in the owner's real work, `--disable <key>` switches it off;
fix it or turn it off by default, and say so in `docs/STATUS.md`.

## What to do, in order

The plan is `docs/22-path-to-the-goal.md`: the items by track, then nine
phases, each with its approach, its budget of live calls, its gate, and what
to do if the gate is missed. **Follow its order.** Do not start a later phase
because it is more interesting; each one spends what the one before it
measures. The next steps, concretely:

- [ ] **1. Finish the routing report's open items** (phase 1, step 0). A
  second and third clean cascade run (`node evals/routing-bench/run.ts
  --config cascade --name rb-cascade-3 --wait-reset`), and Haiku alone on the
  same 15 prompts (a `solo-haiku` configuration for the runner). This says
  how stable the result is and how much of it is the cascade rather than
  Haiku. Ask the owner before starting: it spends the plan.
- [ ] **2. Checkers that run the code** (the checklist at the top of doc
  22). No model calls; rescore the saved answers with `rescore.ts`.
- [ ] **3. A held-out set of 15 prompts** the router has never been tuned
  on. Record Tier 0's routes on them before changing anything.
- [ ] **4. Show the developer's "choices made" in full** (D6). No tokens.
- [ ] **5. Start-up tokens** (C1): extend the no-tools path from the grunt
  to worker turns that have a spec or a named file; measure tokens per
  prompt on the routing suite.
- [ ] **6. Read the owner's usage log weekly.** The owner is building real
  projects with the cascade; each run is rated there. A low rating or a
  failed feature is the next thing to fix, ahead of the plan.
- [ ] **7. Then phase 1 proper**: tasks from real commits (M1), three runs,
  intervals. Then the phases in order.

The beta release is track B in doc 22. Nothing on the beta's page may say
more than the checklist has ticked.

## How to work here

- The rules are in `CLAUDE.md`. The ones people break:
  - **Live calls spend the owner's plan.** Fake backend for engine tests.
    Say before anything that makes more than a few live calls, and run
    benchmarks from an idle session (`--wait-reset`).
  - **An engine change runs the fault harness**: `node evals/chaos.ts --seeds
    1000` and `node evals/chaos.ts --kill 1 --seeds 400`. The kill sweep
    finds what nothing else does. A step that makes a copy removes a
    leftover one on entry; cleanup on the way out does not survive a kill.
  - **Every new behaviour is a feature** in `src/features.ts` with an id, a
    switch, and its events tagged. Next free id: F105.
  - **A number from one run is a hint.** Write "one run" beside it.
  - **Never tune on what you judge by.** The 15 routing prompts are a
    regression set; the held-out set stays untouched.
  - `npm test` and `npx tsc --noEmit` before calling anything done; commit
    and push every change to this branch.
- Before building an idea, check it is not already there: `docs/10-features.md`
  lists 104 features. A review on 2026-11-14 proposed a repository map and a
  calibration loop that had existed for days (F12, F81).
- Write a kill rule before you measure: the number below which the thing
  you built is removed. Features that do not measure up go; that is the
  point of phase 2.
- Plain words in docs and code comments, as in the rest of the repository.
  No long worklogs; `docs/STATUS.md` gets one numbered entry per event.

## What "done" looks like

On tasks the cheapest tier alone fails a third of, in real repositories,
run three times: the cascade resolves at least as many as Opus alone, for
well under half the plan, shown with intervals, repeatable by anyone, and
with no model's name in the code. Phase 8 of doc 22 is where that is
claimed; everything before it is what makes the claim believable.
