# The path to the goal (a plan; nothing here is built)

Written 2026-11-14, after the phase-2 review (`docs/21-phase-2-review.md`).
The owner asked for the full list of what could make Neuromesh the best
model-agnostic multi-agent engineering system, and then for how to approach
each phase, as a plan only. Items have plan ids (M1, O3, ...), not feature
ids: an item gets an F number when it is built.

How to read it: the goal; what the end looks like; the one idea; the items by
track (what could be built); then the nine phases in order, each with its
question, its approach, the decisions to make first, its budget of live
calls, its gate, and what to do if the gate is missed; then what would make
it a breakthrough, and what would make the plan wrong.

## The goal, stated so it can be checked

    minimise   E[C(run)]
    subject to E[R(Neuromesh)] >= E[R(one frontier model)]

Two things in that sentence are not yet defined well enough to optimise.

**R.** Today R is "hidden checks pass" on 8 to 25 tasks, one run each, and
the cheap worker passes all 25 alone. A constraint cannot be checked on a
suite every configuration passes. "Matching" needs a number: Neuromesh is not
worse than the frontier model by more than a margin d (say 3 points), shown by
a confidence interval on paired tasks, not by one run.

**C.** There are two costs and they disagree. Dollars at API list prices say
the cascade costs a quarter of Opus; the Claude five-hour window says three
quarters (routing benchmark, first run). The owner pays in subscription
windows. So C is a weighted sum the owner sets:

    C = sum over plans p of  price_p * (window points spent on p)  +  dollars paid per token

with `price_p` the worth of one point of that plan's window right now (high
when the window is nearly full, zero for a plan that would otherwise expire
unused). F104 is the first, crude version of that price.

Everything below is ordered by one rule: **an item is worth building only if
it moves C or R by more than the benchmark's noise**, so the benchmark comes
first.

## What the end looks like

A person types a request in any repository, with whatever tools and plans
they have. The engine already knows that repository (how to build and test
it, its definitions, its earlier decisions) and every model it can reach
(what each passes, what each costs right now on each plan). It makes the
request checkable before anything is built: a failing test for a bug, pinned
behaviour for a refactor, tests from the spec for something new. The
cheapest model likely to pass builds it; where the record says one try is a
coin toss, two different models try and the tests choose. Nothing is paid
for that could not change the outcome. What the request leaves open comes
back as a question, not a guess. The result arrives with its evidence and
its cost, and the run's record makes the next one cheaper. On a suite where
the cheap model alone fails a third of the tasks, the whole system resolves
more than the frontier model alone, for less, and can show both with
intervals.

Each sentence there is a track below.

## The one idea that ties the rest together

Every optional thing the engine does is an action with a cost and an expected
gain in R: a review, a blind test, a race, an advice turn, a preamble, a
second plan. Today each has its own hand-set threshold (0.55, 0.80, 800
words, 5 tries, 70%). The principled form of the friend's "Lagrangian":

    take action a  iff  P(a changes the outcome) * (value of a resolved task)  >  lambda * cost(a)

One number, lambda, is the price of cost in units of resolution. Raise it and
the engine gets cheaper and less thorough; lower it and the reverse. It is
tuned on the benchmark to the smallest value at which the R constraint still
holds. The probabilities come from the engine's own record (how often did a
review find a blocker on this kind of work, on this tier?). This is item D1,
and most other items either feed it a probability or give it a new action to
price.

## Track M: measure (blocks everything else)

| Id | What | Why it comes first | Done when |
| --- | --- | --- | --- |
| M1 | A suite the cheap worker fails alone: 40+ tasks in real, medium-sized repositories (a bug with a failing hidden test, a feature across 3+ files, a refactor that must keep behaviour), from the owner's projects and open-source history. | Luna passes all 25 current tasks alone, so escalation, review, races and blind tests can never show a gain. | Luna alone scores 40 to 70%; a frontier model alone 80%+. |
| M2 | Every configuration run 3 times; results as a rate with an interval; comparisons paired by task. | Every number so far is one run. The cascade's 149/150 against 150/150 cannot be told from chance. | The report prints "not worse than Opus by more than d: shown / not shown". |
| M3 | A clean frontier baseline: Opus alone on M1, on a Claude plan nothing else is using. | The current baseline's quota readings include the working session. | Baseline R, dollars and window points, three runs. |
| M4 | Cost in both currencies per turn, and the fitted worth of a window point per model (`bench --fit`, extended to every plan). | C cannot be minimised while its two measures disagree and only one is recorded reliably. | Every run reports dollars and points; the fit is stable across two days. |
| M5 | Where the tokens go, per turn: the tool's own start-up (system prompt, tool definitions), Neuromesh's prompt, files read, command output, the model's own earlier turns. Read from the tools' logs. | "Reading, tools 92%" mixes five things with different remedies. Start-up is fixed per session; reads are per task. | The TUI meter and the bench table show the five parts. |
| M6 | Replay: record every turn's request and answer; re-run the engine against the recording with a changed policy, no model calls. | A routing or threshold change can then be tested on 200 past runs in a minute, for nothing. Where a change sends a task down a path with no recording, replay says "unknown", never guesses. | A threshold change is evaluated offline and agrees with a live re-run on the tasks where both exist. |
| M7 | Ablation as a command: `eval --ablate F101,F102,...` runs the suite with each feature off and prints its effect on R and C with intervals. | 104 features, almost none with a measured effect. Features that show none are removed. | A table with one row per feature; a rule for removal. |
| M8 | Check strength: mutate the code a run produced (flip a comparison, drop a line) and count how many mutants the project's checks catch. | The checks are the gate for every cheap tier. A weak gate makes every "pass" worth little, and nobody has measured it. | A mutation score per task on the benchmark. |
| M9 | Every hidden check validated against two independent reference solutions before it counts. | Hidden checks were wrong three times (findings 4, 6, 13). | No task enters M1 without it. |

## Track O: oracles (the strongest lever on R)

With a test that can be run, a cheap model plus retries can beat a strong
model's single attempt. Without one, nothing downstream is trustworthy. So
the first lever on R is making more of the task executable.

| Id | What | Moves | Kill it if |
| --- | --- | --- | --- |
| O1 | **Reproduce first.** For a bug: before any fix, a cheap turn writes a test that fails on the current code for the reported reason. The engine checks it fails before the fix and passes after. | R on bug fixes; gives every later step an oracle. | The reproduction is wrong more often than it guides (measure on M1 bugs). |
| O2 | **Characterise first.** For a refactor: before any change, generate tests that pin current behaviour (inputs from existing tests and call sites; outputs recorded from the current code). They must pass before and after. | R on refactors, where "tests pass" today says little. | Recorded tests are flaky on more than a few percent of tasks. |
| O3 | Blind tests, next version. F101 now shows the tester earlier tests for calling conventions and lets it raise one open question (after the first live run, where signatures alone gave 15 wrong tests of 22). Next: written from the spec *before* the build when there is a spec, so the builder can run them; property frameworks (fast-check, hypothesis) where the project has one. | R on stateful and algorithmic work. | M7 shows no gain on M1. |
| O4 | Invariants as code: every "Invariant: ..." line in an expert blueprint (F85) becomes an assertion or a test, written by a cheap turn, checked by the engine. | Makes the expert's most valuable output enforceable instead of advisory. | Blueprints rarely state checkable invariants. |
| O5 | Changed-line coverage: the engine runs the checks with coverage and names changed lines no test reaches; one cheap turn adds tests for them. | Closes the gap where new code is simply not exercised. | Coverage tools are missing in most projects met. |
| O6 | Evidence collectors beyond the terminal: a headless browser for web pages (the page as text, console errors), `--help` and bad input for command-line tools, start-and-one-request for services. | R on work whose checks cannot see the result (the screen check, F04, for other surfaces). | - |
| O7 | Flaky-check detection: a failing check is run again; if it passes, it is marked flaky and neither repairs nor escalates. | C (no repair rounds or expert turns bought by noise) and R. | - |
| O8 | Static gates with no model call: type-check, lint, secret scan, dependency audit, where the project has the tool. | R at zero token cost. | - |
| O9 | Mutation feedback: mutants the suite misses (M8) are shown to a cheap turn, which writes the tests that kill them. | Raises the gate's strength itself. | Too slow on real suites; then sample. |

## Track S: search (only where an oracle exists)

| Id | What | Moves | Notes |
| --- | --- | --- | --- |
| S1 | Measure the repair race (F102) on M1, and its two hints against two identical ones. | C: does it replace escalations at all? | First live check. |
| S2 | Racers from different vendors (Luna and Haiku, not Luna twice). | Attempts by different model families fail differently; two tries of one model after it has failed twice mostly fail the same way. | Needs two cheap plans. |
| S3 | Best-of-2 at the first build, for tasks where the record says the tier passes 40 to 70% of the time. | Below 40% start higher; above 70% one try is enough. D1 decides. | - |
| S4 | A reviewer from a different vendor than the builder. | The reviewer's blind spots then differ from the builder's. | Free to try: a preset change. |
| S5 | Two cheap plans compared before the expert is asked: when they agree, use one; when they differ on structure, that is the signal a design is needed. | C: fewer expert plans. Replaces F94's keyword count with evidence. | - |
| S6 | Pick among passing candidates by more than size: fewest changed lines outside the task's files, then a cheap judge. | R when both pass but one is a hack. | - |

## Track R: routing

| Id | What | Moves | Needs |
| --- | --- | --- | --- |
| R1 | Route every planned task, not only an unplanned run's one task. | C: planned parts start on the right tier by the record, not only by the expert's label. | - |
| R2 | Choose the starting tier by least expected cost, not "cheapest with 80%": cost of starting on tier i = its price + P(fail) x cost of climbing from there. | C. A tier at 60% can still be the cheapest start when it costs a twentieth of the next. | M4 |
| R3 | A learned Tier 0: logistic regression on the run record (kind, size, cluster scores, language, repository size, files named, tests present). No dependency, a few hundred runs. | Replaces hand-set patterns where the record is rich; the patterns stay as the prior. | M1, M6 |
| R4 | Finer clusters only where the record supports them: split a cluster when it has 30+ runs and the split halves differ. | The friend's "rust + async", when and only when there is data for it. | - |
| R5 | Confidence that means something: track each model's stated preamble confidence against what happened, and set each model's threshold from that curve. | F83 and F91 today use one number for every model. | M6 |
| R6 | Skip the preamble where the record says the tier nearly always succeeds: the question itself costs tokens. | C. | D1 |
| R7 | Probing as a budget, not a share: spend at most x% of cost on tries whose outcome teaches the table something, where its uncertainty is largest. | Replaces F103's fixed share. | - |

## Track C: the cost of context

| Id | What | Moves | Measured by |
| --- | --- | --- | --- |
| C1 | Start-up per session, per tool: measure it (M5), then trim it. Fewer tool definitions for roles that need few; no-tools mode wherever a turn needs none. | The cascade's 47% more tokens came from here, not from exploration. | Tokens before the first tool call. |
| C2 | Prompts ordered for the cache: what never changes first (rules, format), then what changes per run (repository map), then per task, then per turn. Parallel workers share the first two. | Cache reads cost a tenth of fresh input on Claude. | Cache-read share per turn. |
| C3 | A repository index kept between runs, updated from git: definitions, who imports whom, which tests exercise which files. | F12 and F100 in milliseconds; makes C4 and C5 possible. | Time; lead accuracy on M1. |
| C4 | Slices that follow the code: the definition, its callers and what it calls, to a budget. Only for leads the record shows are usually right. | Fewer reads. | M7 on F100 first: if a lead does not cut reads, a bigger lead will not. |
| C5 | Run the affected tests first (from C3), the whole suite once at the end. | Wall time and the tokens of test output in a session. | - |
| C6 | Edits as patches, not whole files, in one-answer mode (F77): search-and-replace blocks the engine applies and verifies. | Output tokens cost about five times input. | Output tokens per changed line. |
| C7 | Command output cut to what matters before the model sees it: failures only, a long log's head and tail. | Tokens re-billed on every later turn of the session. | - |
| C8 | When to start a fresh session, from prices: a session is restarted when re-reading it costs more than re-briefing (F67's fixed 90K, computed per model). | C. | - |
| C9 | Free repairs first: before paying a model for a failed check, run the project's own fixers (`eslint --fix`, `ruff --fix`, `cargo fix`, the formatter) and re-check. | C: a class of repair rounds at no tokens. | Repair turns avoided. |
| C10 | A project profile, written once and verified by running it: how to install, build, test, run; conventions. Reused by every run in that repository. | Every session rediscovers this today. | First-turn tool calls. |

## Track A: any model, any plan

| Id | What | Why |
| --- | --- | --- |
| A1 | A probe suite: 20 short tasks with known answers across the tiers' kinds of work. `neuromesh probe <model>` runs it and records pass rate, cost, speed, how well its confidence matches its results. | A new model gets a measured place on the ladder in ten minutes instead of a hand-written preset and a guess. |
| A2 | Teams built from the probe: given the tools and plans installed, the engine proposes the ladder (cheapest model that clears each tier's bar) and the owner confirms. | "Model-agnostic" means no code or preset edit when a model appears or disappears. |
| A3 | Drift watch: the probe re-run weekly on a few tasks; when a model's rate moves, its cells in the table are aged out. | Hosted models change under the same name. |
| A4 | Capability flags per tool, checked by the conformance tests: no-tools mode, structured output, session resume, usage report, window report, sandbox. The engine degrades by flag, not by tool name. | New CLIs join by passing the conformance suite. |
| A5 | Local models as grunt and reviewer (through opencode or a CLI of their own). | A tier whose cost is electricity; unlimited tries where an oracle exists. |
| A6 | Many plans, one allocator: every plan's windows, reset times and current price (the C above); cheap turns go where a point is worth least; spending is paced so a window is not exhausted hours before it resets. | F104 generalised from one threshold to the owner's actual objective. |
| A7 | Answers that do not parse are repaired without a model call where possible (a trailing comma, a fenced block, a missing field with a default), and each tool's failure rate on structured answers is recorded. | Garbled answers cost a turn today. |
| A8 | Prompts tested per model: a small set of golden cases per role, run on each model in the probe, so a prompt change that helps one model and hurts another is seen. | Prompts are tuned on Claude and Luna only. |

## Track D: one controller

| Id | What | Why |
| --- | --- | --- |
| D1 | The value rule above: every optional action priced by lambda, with its probability from the record. Thresholds become outputs. | One dial instead of a dozen; the constraint in the goal becomes the thing being tuned. |
| D2 | A run budget in the owner's cost, allocated across tasks by how much each is at risk, not only an expert budget. | The engine can then promise "at most this much", and spend it where it matters. |
| D3 | Regret, after every run: the cheapest path that would have reached the same result, from the run's own record (an escalation that the next cheaper step would have avoided; a cheap try that was never going to pass). | Feeds D1's probabilities; shows the owner where cost went for nothing. |
| D4 | Stop early when more spending cannot change the outcome: checks pass, review found nothing of weight, record says further review finds blockers in under 2% of such tasks. | C. |
| D5 | Hand back instead of guessing: when a request is ambiguous in a way the record says usually ends in a low rating, ask one question first. F101's open questions are the first case of it, asked after the work; the next is asking before. | R, in the owner's sense (the rating), at the cost of one question. |
| D6 | Show what the developer says it chose. A worker's notes already name the decisions it made alone and what it left out ("no size cap; the request did not ask for one", first live run); the summary cuts them to 200 characters. Give "choices made" and "left open" their own fields in the report format, and show them in full. | R in the owner's sense, at no tokens. The cheapest item in this plan. |
| D7 | Open questions counted against what the owner does next: a question followed by a request that answers it was worth asking; one that is ignored five times is a kind to stop asking. | Keeps D5 and F101's questions from becoming noise. |

## Track P: planning and parallel work

| Id | What | Why |
| --- | --- | --- |
| P1 | Interfaces first: the plan's first task writes the shared types and signatures, and the tests against them, alone; the parts then build against fixed interfaces side by side. | Integration failures are where planned builds lose time (F75, F98). |
| P2 | Plan lint with no model: every task has a way to tell it is done; no two tasks own one file; the tasks' sizes fit the tier's measured limit. | Catches a bad plan before it is paid for. |
| P3 | The size a tier can hold, measured: the "300 lines per session" rule is a guess; the record has sessions' sizes and outcomes. | Tasks sized to the model that builds them. |
| P4 | The expert's decisions kept per repository: a short design notes file the engine maintains (decisions and their reasons), given to later runs. | The expert is not asked the same question in the next run. |
| P5 | Check results cached by the tree they ran on: an unchanged tree is not tested twice. | Wall time; fewer chances for a flaky failure. |

## Track L: learning from its own runs

| Id | What | Why |
| --- | --- | --- |
| L1 | One run record, queried: every turn, outcome, feature involved, cost, rating, in one store the engine and the owner can ask. | The data for R3, R5, D1, D3 already exists, scattered over run folders. |
| L2 | `neuromesh learn`: recompute the routing table, the confidence curves and D1's probabilities from the record; show what changed; the owner accepts. | Learning is a visible step, not silent drift. |
| L3 | Shadow grading widened (F88): a sample of passes on every tier graded later by a stronger model, cheaply, in bulk. | The only measure of R on real work, where there is no hidden check. |
| L4 | Priors from testers' reports (consented, no code): tier outcomes by kind of work, pooled. | A new install starts from many people's record instead of a stated prior. |
| L5 | Failures labelled by kind automatically: engine, environment, wrong code, ambiguous request, wrong check. | Each kind has a different remedy; today they are read by hand. |
| L6 | Prompt variants tried on replay (M6) and the benchmark, kept only on a measured gain. | Prompts are the largest untested surface. |

## Track E: the engine

| Id | What |
| --- | --- |
| E1 | The fault harness, extended to what it does not model: two runs on one repository, a disk that fills, follow-up runs, the questions asked of the person, and cost rules (no run exceeds its budget; no task takes more than its share). |
| E2 | A write sandbox on Linux (bubblewrap) for every tool. |
| E3 | Cleanup on entry, as a rule: every step that makes a copy removes a leftover one first (the lesson of the blind step, 2026-11-14), checked by the harness for every step. |
| E4 | Long work across days: a project's goals, decisions and open tasks kept between sessions, so a large build resumes from its plan, not from a re-reading of the code. |
| E5 | The result as a pull request with its evidence: what was tested and how, what the review said, what was dropped (blind tests, findings), cost. |

## The order, in short

| Phase | Items | Gate |
| --- | --- | --- |
| 1. A benchmark that can tell | M1, M2, M3, M9; then M4, M5 | Two configurations known to differ are told apart; the frontier baseline has an interval. |
| 2. Clear the backlog | M7 on F93 to F104; S1; the remaining live checks of doc 21; D6 | Every feature on trial is kept, changed or removed on a number. |
| 3. Oracles | O1, O2, O7, O8, then M8, O3, O5 | R on the suite's bugs and refactors rises at no more than 10% more cost. |
| 4. Replay and the record | L1, M6, D3 | A policy change is priced offline and agrees with a live re-run. |
| 5. The controller | R1, R2, R5, D1, D2 | Same R as phase 3 at measurably lower C, with the hand-set thresholds gone. |
| 6. Any model | A1, A2, A4, A5, A6 | A model never seen is placed by the probe and used in a run with no edit. |
| 7. Context | C1, C2, C9, C10, then C3, C5, C6 | Tokens per resolved task down by a third, R unchanged. |
| 8. Search | S4, S2, S3, S5 | R above the frontier baseline's interval, C still under it. This is the goal. |
| 9. Keep it true | L2, L3, A3, L6, E1 to E5 | The numbers hold a month later, on models that have changed. |

Why this order and not the note's: context work (phase 7) is where the note
starts, but its gain cannot be seen until phase 1 exists, and the largest
context cost found so far (session start-up) is not the one the note names.
Search (phase 8) is where R passes the frontier, and it is only worth its
cost on top of strong oracles (phase 3) and a controller that knows when to
use it (phase 5).

What can overlap: phase 2 needs only phase 1's suite. The run record (L1, in
phase 4) can start the day phase 1 does, because every benchmark run should
land in it. The probe (A1, phase 6) runs on the cheap plans and needs nothing
but the task format. Phases 5 and 8 cannot be moved earlier: each spends what
the phases before it measure.

    1 ──┬── 2 ── 3 ──┬── 5 ── 8 ── 9
        ├── 4 (record first, replay second) ──┘
        └── 6 (probe first) ── 7

## Rules for every phase

1. **One change at a time against a frozen baseline.** The frontier baseline
   is run once per model version and kept. It is the dearest thing in this
   plan and the easiest to spoil (a working session on the same plan spoils
   its quota readings).
2. **A week's live budget is set before the week.** The Claude weekly window
   is the binding limit (84% used on 2026-11-14). Each phase below states
   what it is expected to spend. A phase that would pass the budget waits for
   the next window; it does not borrow from the baseline's.
3. **Fake backend and fault harness before any live call.** As now.
4. **Every item becomes a feature id with a switch when it is built**, and
   its row in the ablation table (M7) decides whether it stays.
5. **A kill rule is written before the measurement**, not after: the number
   below which the item is removed. The tracks above have one per item.
6. **A result is one sentence with an interval**, or it is recorded as "one
   run" and treated as a hint.
7. **Nothing is tuned on the tasks it is judged on.** The suite is split once
   into a tuning half and a held-out half (phase 1); thresholds, prompts and
   lambda are tuned on the first and reported on the second.

---

## Phase 1: a benchmark that can tell

**The question.** Can two configurations that really differ be told apart,
and what exactly is the frontier model's resolution rate and cost?

**Where it starts.** 29 tasks in `evals/tasks` (a prompt, a seed repository,
a hidden check), `neuromesh eval` with `--quota` and `--spec-from`,
`evals/bench.ts` for the table and the quota fit. Luna passes the 25 ordinary
ones alone. One Opus baseline task finished cleanly before the window ran out
(`docs/17-benchmark.md`).

**How to approach it.**

1. *Write the task recipe before any task.* A task is a real change from a
   real repository:
   - the seed is the commit before the change;
   - the prompt is written from the issue or the commit message, with the
     solution left out;
   - the hidden check is the tests that came with the change, split into
     those that fail before and pass after ("fail to pass") and those that
     must keep passing ("pass to pass");
   - the reference solution is the real commit.
   This is the recipe public benchmarks use; it gives tasks nobody wrote to
   be solved.
2. *Choose where tasks come from.* Two sources, for two reasons:
   - the owner's own repositories: private, so no model has seen the answer,
     and they are the work this tool exists for;
   - open-source repositories under permissive licences, changes made after
     the models' training cut-offs. A famous repository's old bug fix may be
     remembered rather than solved; recent commits are the guard.
3. *Admit a task only when it is validated (M9).* On the seed the fail-to-pass
   tests fail; on the reference they pass; the check is run three times on
   the reference to show it is not flaky; and one independent solution (a
   frontier model's, read by a person) also passes, which catches a check
   that only the original author's solution satisfies. A script does the
   first three with no model call.
4. *Set the difficulty by measurement.* Run Luna alone once on every
   candidate. Keep a mix: about a third Luna passes, a third it fails, a
   third in between over three tries. Tasks the frontier model fails three
   times out of three are kept to at most a tenth of the suite (they show
   headroom, and they tell nothing apart).
5. *Balance the kinds*, because phases 3 and 8 are judged per kind: bug
   (40%), feature across several files (30%), refactor that must keep
   behaviour (15%), new program (15%). Languages: JavaScript or TypeScript,
   Python, Rust, as in the current suite.
6. *Split once* into a tuning half and a held-out half, by repository, so no
   repository is in both.
7. *Fix the statistics in code (M2).* Each task is run three times per
   configuration; a task's score is the share of its runs that pass; two
   configurations are compared by the mean of per-task differences, with an
   interval from resampling tasks 10,000 times. No dependency. "Not worse by
   more than d" is shown when the lower end of the 90% interval is above -d.
8. *Run the baselines (M3)*: Luna alone, Opus alone, and `factory-opus-luna`
   as it is today. The Opus runs go one task at a time through
   `evals/until-done.ts`, from a session that is otherwise idle, on days the
   window is not needed for anything else.
9. *Record both costs for every turn (M4) and where the tokens went (M5).*
   The split of a turn's input into start-up, prompt, reads, command output
   and earlier turns is read from the tools' own logs, which are already
   kept per turn.

**How many tasks.** What can be shown depends on how often the two systems
disagree on a task. If they disagree on about 15% of tasks:

| Tasks | Margin that can be shown |
| --- | --- |
| 40 | about 10 points |
| 120 | about 6 points |
| 400 | about 3 points |

So 40 tasks cannot support "matches the frontier within 3 points", and the
plan does not pretend otherwise. Stage it: 40 tasks first (enough to tell a
real difference of 10 points, and to rank features in phase 2); 120 by the
end of phase 3; a public benchmark of several hundred tasks for the 3-point
claim in phase 8.

**Decisions to make first.**

| Decision | Recommendation |
| --- | --- |
| Which frontier model is "the frontier" | Claude Opus 5.5 at medium effort through Claude Code, as in every comparison so far. Add GPT-6.1 Sol alone as a second baseline when the ChatGPT window allows; it is cheap to add and guards against a claim that holds against one vendor only. |
| The margin d | 10 points at 40 tasks, stated as such; 3 points is the phase 8 claim. |
| Whether rating counts in R | Not in the benchmark (no rater). The rating stays the measure on real use (L3). |
| One run or three | Three. One run cannot separate a feature from luck. |

**What gets built.** `evals/make-task.ts` (a commit into a task folder),
`evals/validate-task.ts` (M9, no model), the resampling interval and the
"shown / not shown" line in `evals/bench.ts`, the tuning and held-out lists,
the five-part token split in the turn record and the TUI meter.

**Live budget (estimates from the routing benchmark: Opus alone moved the
five-hour window about 0.9 points and the weekly about 0.13 per prompt; these
tasks are larger, so twice that).** Opus alone, 40 tasks three times: about
30 points of one weekly window, spread over several five-hour windows. Luna
alone and the validation solves: the ChatGPT plan, small. This is the dearest
step in the whole plan and it is done once.

**Gate.** (a) Luna alone 40 to 70%, Opus alone 80% or more, each with an
interval. (b) Two configurations known to differ (Luna alone against Opus
alone) are separated. (c) Two runs of the same configuration are *not*
separated. (c) is the one that shows the instrument is not inventing
differences.

**If the gate is missed.** If Luna passes 85% of real tasks from the owner's
repositories, the finding is that the cheap model alone is enough for this
work; the plan narrows to phases 6 and 7 (any model, cheaper context) and the
rest is dropped. If the same configuration separates from itself, there are
flaky checks or too few runs: fix the checks first (O7), then go to five
runs.

**Hands on.** The suite, the baseline, the interval, the cost in both
currencies, the token split.

---

## Phase 2: clear the backlog

**The question.** Which of the features nobody has measured are worth
keeping?

**Where it starts.** 104 features; most of F54 to F104 have at most one live
run. F100 and F101 have one each way; F102 to F104 none.

**How to approach it.**

1. *Do D6 first*: show a developer's "choices made" and "left open" in full.
   It costs no tokens and the first live run showed the information is
   already there.
2. *Measure bundles before features (M7).* 104 features times three runs
   times 40 tasks is not affordable. Group them by what they act on and
   leave one bundle out at a time:
   - routing (F80, F81, F89, F91, F93, F94, F99, F103);
   - gates and escalation (F82 to F86, F96, F102);
   - context (F12, F13, F100, F67);
   - review (the tester, F05 to F07, F59, F71, F98);
   - blind tests and stubs (F95, F101);
   - one-answer modes (F77, F90).
   Six configurations, the tuning half of the suite, two runs each. Most of
   these turns are on the worker's plan.
3. *Open only the bundles that matter.* Inside a bundle whose removal moved R
   or C beyond the interval, switch features off one at a time. A bundle
   whose removal moved nothing is examined for cost only: features in it that
   add turns or tokens go off by default.
4. *Three outcomes per feature, decided by the rule written beforehand:*
   kept (it moved R up or C down beyond the interval), off by default (no
   measurable effect; code stays one phase, then goes), changed (it helps one
   kind of task and hurts another: restrict it).
5. *The live checks left over from doc 21* happen inside this: F104 on a day
   the window is above 70%; F102 now has tasks Luna fails, so it triggers.
6. *Write the result into `src/features.ts`*: each feature's line says what
   was measured, on what, and when.

**Decisions to make first.** The removal rule. Recommendation: a feature
that adds any cost and shows no gain in R on two measurements is off by
default; its code is deleted when the next phase ends unless something
depends on it. Features that only make failures legible (the harness's
protective ones, event tags) are not in the contest.

**What gets built.** `neuromesh eval --ablate <bundle or ids>`, a bundles
file, the ablation table in `evals/bench.ts`.

**Live budget.** About 480 task-runs, nearly all on the worker's plan; the
expert only where a task escalates. A few weekly points of Claude.

**Gate.** Every feature from F54 on has a line saying kept, off or changed,
with the numbers.

**If the gate is missed.** If no bundle shows any effect, either the suite
still cannot tell (back to phase 1's gate (b) and (c)) or the engine's
extras really do nothing on this work; the second is a result, and the
default becomes the simplest configuration that matches.

**Hands on.** A smaller engine, and the first real probabilities for phase
5 (how often each action changed an outcome).

---

## Phase 3: oracles

**The question.** How much of a task can be made checkable before and while
it is built, and does that raise the resolution rate of cheap models?

**Where it starts.** The gate for every cheap tier is the project's own
checks plus F95 (stubs) and F101 (blind tests). On a bug, "the tests pass"
often means the bug was never exercised. On a refactor it means little.

**How to approach it.** In this order, because each is cheaper and surer
than the next:

1. *O7, flaky checks.* A failing check is run once more before anything
   reacts to it. Passing the second time marks it flaky for the run: it
   neither repairs nor escalates. No model call. Do this first because every
   later measurement is cleaner for it.
2. *O8, the project's own static gates*, where its tools are installed:
   type-check, lint, a secret scan on the diff. No model call.
3. *O1, reproduce first (bugs).* A new step before the developer's first
   turn, for requests the brief engine calls a bug:
   - a cheap turn writes one test that should fail for the reported reason;
   - the engine runs it on the untouched code. It must fail, and not because
     it cannot load (F101's rule for that already exists);
   - the developer then gets the task with "this test must pass, and you may
     not change it"; the engine checks the file is unchanged and now passes.
   If no failing test comes in one try, the task goes on as today. The step
   never blocks: a bug that cannot be reproduced cheaply is still fixed the
   old way.
4. *O2, characterise first (refactors).* A cheap turn writes tests that
   record what the code does now, using inputs from existing tests and call
   sites. The engine runs them three times on the untouched code (all three
   must pass, which filters the flaky ones), then requires them to pass
   after the change.
5. *M8, measure the gate.* Mutate the lines a run changed (a comparison
   flipped, a constant moved by one, a statement removed), at most 20
   mutants per task, and count how many the checks catch. No model call.
   This is the first number for "how good is the gate", and it is how O1,
   O2 and O3 are judged besides R.
6. *O5, changed lines no test reaches*, where the language has coverage
   built in (Node's test runner, coverage.py). One cheap turn writes tests
   for them.
7. *O3, blind tests from the spec*, before the build, when there is a spec.
8. *O9, O4, O6* only if M8 shows the gate is still weak after the above.

**Decisions to make first.**

| Decision | Recommendation |
| --- | --- |
| Who writes the reproduction | The first worker rung, a different model from the builder when the preset has two cheap ones (their mistakes differ). |
| May the developer change the reproduction | No. If it believes the test is wrong it says so and the engine falls back to today's path; one cheap turn lost at most, the same bound as F101. |
| Are generated tests kept in the result | Reproductions and characterisations, yes: they are the regression tests a reviewer would ask for. Blind tests only when they found something (as now). |

**What gets built.** Two new task steps (`reproduce`, `characterise`) with
their prompts and harness cases; a re-run in the checks step; a mutation
runner in `src/checks`; the task kinds in `evals/bench.ts` so R is reported
per kind.

**Live budget.** Each oracle is an ablation on the tasks of its kind (about
16 bugs and 6 refactors in a 40-task suite): too few. This is why the suite
grows to 120 during this phase, weighted to bugs and refactors. Worker plan
mostly.

**Gate.** On bugs and refactors, R up by more than the interval; cost per
task up by no more than 10%; mutation score up.

**If the gate is missed.** If cheap models cannot write a correct
reproduction most of the time, record the rate, keep O7 and O8 (they are
free), and move the reproduction to the senior tier for the cases where
Tier 0 already expects trouble. If that fails too, phase 8's search has less
to choose with and its expected gain is cut; say so then.

**Hands on.** Tasks with an executable definition of done, which is what
makes trying twice (phase 8) worth more than trying once.

---

## Phase 4: the record and replay

**The question.** Can a change of policy be judged on past runs, for
nothing?

**Where it starts.** Each run keeps `run.json`, `events.jsonl` and a log per
agent turn in its own folder; the usage log keeps one line per run; the
routing table keeps counts. The data exists in 50-odd project folders and no
single place.

**How to approach it.**

1. *L1 first, and early.* One append-only record, one line per turn and one
   per decision the engine made (started on tier X, asked for a review,
   skipped the preamble), each with what was known then and what happened
   after. Start it when phase 1 starts so every benchmark run is in it. A
   backfill script reads the existing run folders.
2. *Keep the engine's inputs to each decision*, not only its outcome. A
   decision can be replayed only if what it saw was recorded.
3. *M6, replay, in its honest form.* A recorded backend answers a turn when
   the model, the prompt and the state of the files match a recorded one.
   That covers "what if the engine had decided differently about something
   it already paid for": stopped earlier, skipped a review that found
   nothing, started on the tier the task ended on, not raced. It does not
   cover "what would another model have written"; there replay answers
   "unknown" and counts how often. The share of unknowns is reported with
   every replay result.
4. *D3, regret*, from the record alone: for each finished run, the cheapest
   recorded path to the same result.
5. *Check replay against reality once*: take one threshold change, replay
   it, then run it live on 20 tasks.

**Decisions to make first.** Where the record lives and its form.
Recommendation: JSON lines under `~/.neuromesh/record/`, no database (the
no-dependency rule holds; hundreds of thousands of lines are fast enough to
scan), with an index file rebuilt on demand. Testers' records stay on their
machines; only the consented counts travel (L4).

**What gets built.** `src/record/` (write, backfill, query), a `replay`
backend beside `fake`, `neuromesh replay --set <option=value>`,
`neuromesh regret [run]`.

**Live budget.** 20 task-runs for the one check. Everything else is free.

**Gate.** The replayed estimate of one policy change agrees with the live
re-run within the interval, on tasks where both exist, and the unknown share
is under a third.

**If the gate is missed.** If most counterfactuals are unknown, replay is
kept for the narrow class it covers (skip, stop, accept) and phase 5 tunes
lambda live on the tuning half instead, which costs more runs but still
works.

**Hands on.** Probabilities per action, kind and tier for the controller; a
way to test it without paying.

---

## Phase 5: the controller

**The question.** Can one price of cost replace the dozen thresholds, and
reach the same resolution rate for less?

**Where it starts.** Thresholds set by hand or from one benchmark run: 800
words and 12 files (plan), 0.55 (preamble), 0.80 (calibration bar), 3
subsystems (breadth), 5 tries (evidence), 70% (window), 2 repair rounds, 2
tasks to the expert, 1% shadow sample.

**How to approach it.**

1. *List every optional action with what it costs and what it can change.*

   | Action | It changes the outcome when |
   | --- | --- |
   | Preamble question | the developer would have failed and says so |
   | Review | it finds a blocker the checks missed |
   | Blind tests | a test fails for a real defect |
   | Reproduction, characterisation | the fix would have passed without fixing |
   | Race | a racer passes and the escalation is avoided |
   | Climb, advice, takeover | the next tier passes where this one did not |
   | Expert plan | the unplanned build would have failed or split late |
   | Second candidate at build (phase 8) | the first fails and the second passes |

2. *Estimate each "when" from the record*: counts per action, kind of work
   and tier, on top of a stated prior. The prior is today's behaviour, so
   with no data the controller acts exactly as the thresholds do. That is
   the safety of the whole phase: its worst case is the present.
3. *The rule*: act when P(changes the outcome) times the value of a resolved
   task is more than lambda times the action's cost. Cost is in the owner's
   C (phase 1), so a full Claude window makes Claude actions dearer without
   a separate rule; F104's threshold becomes a consequence.
4. *R2 with it*: the starting tier by least expected cost over the whole
   ladder, which is the same rule applied to "start here or one up".
5. *R5*: each model's stated confidence corrected by its own curve before
   it enters the rule.
6. *Tune lambda on replay, confirm live.* Sweep lambda over the record; pick
   the largest value at which R on the tuning half stays within the margin;
   confirm at that value and one on each side, live, on the held-out half.
7. *D2*: a run's budget in C, with each task's share set by its risk.
8. *Remove a hand threshold only when the controller has matched it* on the
   held-out half. Presets keep an override.

**Decisions to make first.**

| Decision | Recommendation |
| --- | --- |
| The value of a resolved task | Not a number of dollars to argue about: fix it at 1 and let lambda carry the trade. The owner sets lambda per preset or per run ("thorough", "normal", "cheap"), and the benchmark says what each one buys. |
| How much data before a count overrules the prior | The same rule as F103: a handful is not a rate. Start at 5 and tune on replay. |

**What gets built.** `src/control/` (the rule, the estimates, the budget),
each feature's gate rewritten as "ask the controller", the three named
settings, a line per decision in the record saying what the controller
expected.

**Live budget.** Three configurations on the held-out half, three runs
each, mostly worker turns.

**Gate.** At the chosen lambda: R not worse than phase 3's by more than the
margin, C lower beyond the interval, and no hand-set threshold left in the
default path.

**If the gate is missed.** The thresholds stay, with values re-tuned on the
tuning half by the same sweep. The record and the estimates are still worth
having: they are what D3 and L2 report to the owner.

**Hands on.** A single dial; a controller that can price a new action,
which is what phase 8 adds.

---

## Phase 6: any model

**The question.** Can a model nobody has configured be measured, placed and
used with no edit to code or presets?

**Where it starts.** 26 hand-written presets. Four tools behind adapters
with a conformance check (M0). Prices in `src/usage/prices.ts`. A local
Gemma model is already on the owner's Mac.

**How to approach it.**

1. *A1, the probe.* Twenty tasks, five for each tier's kind of work
   (mechanical, routine, judgement, hard), each under two minutes, each with
   a check a script can run. Besides pass or fail the probe records cost in
   both currencies, speed, whether structured answers parse, whether tools
   are used correctly, and how stated confidence compares with results.
   Output: one profile file per model and version.
2. *Keep the probe apart from the benchmark.* The probe places models; the
   benchmark judges the system. A model is never placed by the tasks the
   system is then scored on.
3. *A4, capability flags from the conformance check*, so the engine asks
   "can this tool answer without tools, resume a session, report its
   window?" and never "is this Claude?".
4. *A2, the team from the profiles*: for each tier, the cheapest model whose
   profile clears that tier's bar, with a second choice from another plan
   where there is one. The engine proposes; the owner confirms; the result
   is a preset file like any other, so it can still be read and edited.
5. *A5, the local model*, first as grunt only (its gate is the checks, so a
   weak model costs retries and no wrong results), then as reviewer if its
   profile allows.
6. *A6, the allocator*: one table of every plan's windows, reset times and
   current price; the controller's cost reads from it. Pacing: a window is
   not allowed past the share of it that has elapsed plus a reserve, unless
   the owner says the run matters more.
7. *A3, drift*: five probe tasks per model each week; a move beyond the
   probe's own noise ages that model's counts in the record.

**Decisions to make first.** The bars per tier. Recommendation: take them
from the profiles of the models that hold each tier today, so the first
proposed team is the current one, and anything new is measured against
models whose behaviour in the system is already known.

**What gets built.** `evals/probe/` and `neuromesh probe <model>`, profile
files, `neuromesh team propose`, the plans table, the capability flags in
`src/backends/types.ts`.

**Live budget.** A probe is 20 short tasks per model: small on any plan, and
run on the model's own plan.

**Gate.** (a) A model that was in no preset is probed, placed and used in a
benchmark run with no file edited by hand. (b) The proposed team does not
score worse than the hand-written preset. (c) With the local model as grunt,
cost falls and R does not.

**If the gate is missed.** If the probe's ranking does not predict how
models do inside the system, the probe tasks are wrong, not the idea:
replace them with the tasks from the record where tiers differed most.

**Hands on.** The claim "model-agnostic" as something anyone can test with a
model released that week.

---

## Phase 7: the cost of context

**The question.** Where do the tokens go, and which of those can be removed
without touching R?

**Where it starts.** Phase 1's token split (M5). Known already: each session
reloads the tool's system prompt and tool definitions (17k to 33k tokens
with tools, about 3k without), and that, not exploration, made the cascade
process 47% more tokens than Opus alone.

**How to approach it.** Attack the parts in the order of their measured
share, and stop when the next part is under 5% of tokens:

1. *C1, start-up*, per tool and per role: the smallest tool set each role
   needs; no-tools mode wherever a turn reads nothing (F77 and F90 exist for
   Claude; A4 says which other tools can).
2. *C2, cache order.* Rules and format first, then what changes per run,
   then per task, then per turn. Workers of one run share the first two
   parts word for word, so the second worker reads them from the cache.
3. *C9, the project's own fixers* before a model is paid to repair a failed
   check: the formatter, `--fix` modes, then the check again.
4. *C10, the project profile*: how to install, build, test and run, written
   once by a cheap turn, verified by the engine running each command, kept
   with the repository's record and refreshed when a command stops working.
5. *C7 and C8*: command output cut before the model sees it; a session
   restarted when re-reading costs more than re-briefing at that model's
   prices.
6. *C3, the index*, only now: definitions, imports, and which tests reach
   which files, kept between runs and updated from git. Then *C5* (affected
   tests first) and, if F100 survived phase 2, *C4* (slices that follow the
   code).
7. *C6, edits as patches* in one-answer mode.

**Decisions to make first.** Whether to take a parser as a dependency for
C3. Recommendation: no, until the regular-expression map is shown to be the
limit; the rule is "no runtime dependency unless a milestone needs one", and
phase 2 will say whether leads matter enough to deserve better ones.

**What gets built.** Per-role tool sets in the adapters, a prompt builder
that keeps the stable part first, `src/checks/fixers.ts`, the project
profile, `src/context/index.ts`.

**Live budget.** Each step is an ablation on the tuning half; worker plan.

**Gate.** Tokens per resolved task down by a third against phase 5, cost in
C down beyond the interval, R unchanged.

**If the gate is missed.** If start-up cannot be trimmed because the tools
do not allow it, that is the argument for A5 (a local model has no fixed
start-up) and for longer-lived sessions shared across a run's tasks; try
those before giving up the third.

**Hands on.** A lower cost per attempt, which is what makes the extra
attempts of phase 8 affordable.

---

## Phase 8: search, and the claim

**The question.** With strong oracles, a controller and cheap attempts, does
the system resolve more than the frontier model alone, for less?

**Where it starts.** F102 (two repairs by the same model). Phase 3's
executable definitions of done. Phase 5's controller, which can price an
extra attempt. Phase 6's second cheap plan.

**How to approach it.**

1. *S4 first: the reviewer from another vendor than the builder.* A preset
   change. It tests the idea under all of this phase (different models fail
   differently) at no engineering cost.
2. *S2: racers from two vendors.* The measurement that matters: of the tasks
   one model fails, how many does the other pass? If the answer is "few",
   the models share their failures and the rest of this phase is worth
   less; find that out here.
3. *S3: two candidates at the first build*, only where the record says the
   tier passes between 40 and 70% of such tasks, and only where phase 3 gave
   the task an executable check. The controller decides per task.
4. *S6: choosing among candidates that pass*: fewest changes outside the
   task's files, then mutation score (M8) of each candidate's own tests,
   then a cheap judge.
5. *S5: two cheap plans before an expert plan.*
6. *The claim, on the held-out half*: three runs, the interval, both costs.
7. *Then the same on a public benchmark of several hundred tasks*, chosen
   when this phase starts (the public ones change; pick the one that is
   current, maintained, and has tasks newer than the models). This is the
   only way to the 3-point margin and the only result other people can
   compare with their own.

**Decisions to make first.**

| Decision | Recommendation |
| --- | --- |
| How many candidates | Two. The gain from a third is smaller than from the second and the cost is the same. Let the controller ask for a third only where the record supports it. |
| What is published | Cost per resolved task and resolution rate, each with its interval, for the frontier model alone, the cheap model alone and the system; the task list; the commands to repeat it. A claim nobody can repeat is not one. |

**What gets built.** Candidates as a generalisation of F102's lanes (the
copies, the checks and the choice are already there), cross-vendor presets,
the selection rule, a public-benchmark adapter that turns its tasks into
`evals/tasks` folders.

**Live budget.** The largest after phase 1: the system on the held-out half
three times, then the public benchmark once for the system. The frontier
baseline on the public benchmark is taken from its published results where
they exist for the same model, and run only on a sample to confirm.

**Gate.** On the held-out half, the system's resolution rate is above the
frontier baseline's interval and its cost in C is below the baseline's.
Then, on the public benchmark, not worse by more than 3 points at less than
half the cost.

**If the gate is missed.** Report what was reached: "matches within d at a
fraction of the cost" is the result the engine has pointed at since v0.1 and
is worth shipping by itself. Then read the regret report (D3) for where the
remaining failures are; if they are tasks no cheap model gets near, the
remedy is a stronger senior tier, not more attempts.

**Hands on.** The number this project exists for.

---

## Phase 9: keep it true

**The question.** Do the numbers hold next month, on other people's
machines, with models that have changed?

**How to approach it.**

1. *A3 and L2 as habits*: the weekly five-task probe; `neuromesh learn`
   showing what the record would change and asking before it does.
2. *L3*: a sample of passes on real work graded in bulk by a stronger model
   when a window would otherwise go unused. It is the only measure of R
   where there is no hidden check.
3. *The benchmark re-run on a schedule*: the tuning half monthly on the
   worker plans; the frontier baseline only when the frontier model
   changes.
4. *L4*: testers' pooled counts as the prior a new install starts from.
5. *E1 to E3*: the harness extended to what it does not model, the Linux
   sandbox, cleanup on entry as a harness rule for every step.
6. *E4 and E5*: work across days from a kept plan; the result as a pull
   request with its evidence.
7. *L6*: prompt variants tried on replay, kept on a measured gain.
8. *A release is a set of numbers*: each one states the suite version, the
   models and their versions, and the three rates and costs.

**Gate.** A month after phase 8, with at least one model changed, the
held-out result is inside its earlier interval, or the drift watch flagged
the change before the benchmark did.

---

## What would make it a breakthrough, and what would not

A longer feature list would not. Every agent tool has one. What does not
exist yet, as far as this project's record shows, is a system that can make
all of these statements at once and let anyone repeat them:

1. **A resolution rate above a frontier model's, at under half its cost,
   with intervals, on tasks the cheap model alone fails a third of.**
   (Phases 1, 3, 5, 8.)
2. **No model named in the code.** A model released this week is probed,
   placed and used the same day. (Phase 6.)
3. **Every action it takes is priced and explained.** "The review was
   skipped because on this kind of work it has found a blocker twice in 140
   runs." (Phases 4, 5.)
4. **It asks instead of guessing** where the request leaves something open,
   and it learns which questions were worth asking. (D5 to D7.)
5. **It runs on what the person already pays for**: subscriptions, with the
   plans' windows as the cost being minimised. (A6.)
6. **Its own claims have kill rules.** Features that do not measure up are
   removed, and the table of what was removed is published with the result.
   (Phase 2.)

The first is the claim; the other five are why it would be believed and
used. None is certain. The gates are placed so that the two findings that
would end the plan early (the cheap model is already enough; cheap models
share their failures) arrive in phases 1 and 8's first steps, before most of
the work is spent.

## What would make this plan wrong

- **The cheap worker keeps passing everything.** If M1 cannot be built so
  that Luna fails 30%+, then on the owner's real work the answer is "Luna
  alone", and most of this plan is unnecessary. That would be a good result.
- **Window points cannot be priced.** If the fit in M4 is unstable (the
  vendor changes how models weigh on the window), C is not well defined and
  the controller optimises a moving target. Then optimise dollars and treat
  windows as hard limits only.
- **The record is too small.** R3, R5 and D1 need hundreds of runs with
  outcomes. One person's use gives tens per week. Testers' pooled priors (L4)
  and replay (M6) are the remedy; if neither arrives, the hand-set thresholds
  stay and only their values are tuned on the benchmark.
- **Oracles do not generalise.** O1 and O2 assume a cheap model can write a
  correct reproduction or characterisation most of the time. If it cannot,
  search has nothing to select with, and the cascade stays bounded by its
  reviewer.
