# The path to the goal (a plan; nothing here is built)

Written 2026-11-14, after the phase-2 review (`docs/21-phase-2-review.md`).
The owner asked for the full list of what could make Neuromesh the best
model-agnostic multi-agent engineering system, as a plan only. Items have
plan ids (M1, O3, ...), not feature ids: an item gets an F number when it is
built.

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

## The order

Each phase has a gate. A phase that misses its gate is where the work stops
and the plan is reread.

| Phase | Items | Gate |
| --- | --- | --- |
| 1. A benchmark that can tell | M1, M2, M3, M9; then M4, M5 | Two configurations known to differ are told apart; the frontier baseline has an interval. |
| 2. Clear the backlog | M7 on F93 to F104; S1; the remaining live checks of doc 21; D6 (it costs nothing) | Every feature on trial is kept, changed or removed on a number. |
| 3. Oracles | O1, O2, O7, O8, then M8, O3, O5 | R on M1's bugs and refactors rises at no more than 10% more cost. |
| 4. Replay and the record | M6, L1, D3 | A policy change is priced offline. |
| 5. The controller | R1, R2, R5, D1, D2 | Same R as phase 3 at measurably lower C, with the hand-set thresholds gone. |
| 6. Any model | A1, A2, A4, A5, A6 | A model never seen is placed by the probe and used in a run with no edit. |
| 7. Context | C1, C2, C9, C10, then C3, C5, C6 | Tokens per resolved task down, R unchanged. |
| 8. Search | S2, S3, S4, S5 | R above the frontier baseline's interval on M1, C still under it. This is the goal. |
| 9. Keep it true | L2, L3, A3, L6, E1 to E5 | The numbers hold a month later, on models that have changed. |

Why this order and not the note's: context work (phase 7) is where the note
starts, but its gain cannot be seen until phase 1 exists, and the largest
context cost found so far (session start-up) is not the one the note names.
Search (phase 8) is where R passes the frontier, and it is only worth its
cost on top of strong oracles (phase 3) and a controller that knows when to
use it (phase 5).

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
