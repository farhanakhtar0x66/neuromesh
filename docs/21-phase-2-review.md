# A friend's phase-2 review, checked against the code (2026-11-14)

A friend read the routing benchmark and the TUI and proposed four upgrades,
framed as: minimise the cost of the whole trajectory, subject to resolving at
least as often as a single frontier model. The note is in
`~/Projects/neuromesh-old-learn/nmr-phase-2.md`. This is what held up when it
was read against the engine, what was built from it (F100 to F104, on
`neuromesh-research`), and what was not.

Nothing here has been run on a live model. Every number the note gives for the
upgrades (40 to 60% fewer tokens, $0.005 per blind test, Pass@2 at 8% of Opus,
a 5 to 8 times longer window) is the note's estimate, not a measurement.

## What the note gets wrong about the engine as it is

| The note says | The code and the reports say |
| --- | --- |
| There is no host-side repository map; build one. | F12 `context-packet` has made one since 2026-11-11: file layout and the signatures most relevant to the request, no model call, in every first prompt. F13 `nm` gives agents `map`, `show` and `find`. What F12 lacks is narrower: it is built once per run from the request, not per task, and it gives line numbers but no ranges or bodies. |
| The cascade's 47% more tokens come from `read` and `grep` exploration. | In the routing benchmark every prompt starts in an empty folder (`docs/20-routing-benchmark.md`): there was nothing to explore. The report's own cause is that each Claude Code session loads its system prompt and tool definitions again. A repository map cannot reduce that. |
| "Reading, tools" at 92% of the context is exploration. | The TUI's meter is everything in the window that is not Neuromesh's prompt (`src/tui/view.ts`): tool definitions, the tool's system prompt, file reads, command output and the model's own earlier turns. It is an upper bound on exploration, not a measure of it. |
| One cascade run is bounded above by the frontier model's single-shot accuracy. | The cascade is not single-shot. Checks, a reviewer and repair rounds are in the loop, and on logstat it scored 27/27 against 26/27 for Opus alone (`docs/13-logstat-benchmark.md`). The two mechanisms proposed under this heading are still worth having; the premise is not why. |
| Thresholds are fixed heuristics; add a calibration loop. | F81 `route-calibration` is that loop: a stated prior per tier and cluster, moved by this machine's outcomes after every finished cascade run, with F88 shadow grades counted as failures. `neuromesh routing` prints it. What it lacked: it was consulted only when the lexical match was unsure, and nothing ever tried a cheaper tier than the match. |
| Use Haiku for workers while the Claude window is under 60%. | Finding 23: Haiku draws on the same Claude window as Opus and is about 5 to 7 times cheaper per token there, not 40. The clean cascade run did move the window less than Opus alone (3 points against 13, one run, contaminated baseline). So a threshold is reasonable; "Haiku is free below 60%" is not established. |
| Step 1: merge `neuromesh-testing` into `main` as v0.3.0. | Already merged (STATUS 36), deliberately not tagged: F93 to F99 have one live run between them. |
| The worker is "GPT-4 Luna". | GPT-6 Luna, through Codex. |

## What was built

Five features, all optional, each registered in `src/features.ts`, each
switched off with `--disable <key>`.

### F100 `start-here`: where one task begins (the note's part 1)

`startHere()` in `src/context/packet.ts`. Before a task's first turn, from the
task's own brief: the definitions whose names match its words, as
`file:start-end` ranges, and the body of the best match when it is 60 lines or
fewer. Files the last 15 commits touched break ties.

Two things differ from the note on purpose:

- The note's wording is "do not scan unrelated directories". The match is
  lexical, so it is sometimes wrong, and a boundary would turn a wrong guess
  into a failed task. The prompt says "where to look first, not a limit".
- It says nothing unless the lead is strong enough: a definition the task
  names outright, written as an identifier (`compactNotes`, `max_size`,
  `flush()`); a file whose own name is a word of the task; or several weaker
  matches in one file. Ordinary words name things by accident (tried on this
  repository, "add a changelog entry" pointed at an unrelated `Entry` type
  until they were weighted down), and no lead is cheaper than a wrong one.
- It is not the note's 30 ms. It reads every tracked file, about a quarter of
  a second on this repository (150 files). An index kept between runs would
  be faster; nothing needs that yet.

No import graph: nothing in the engine would use it yet.

### F101 `blind-tests`: tests written without seeing the code (2A)

For a task about state, parsing, limits, concurrency or an algorithm that has
just passed the project's checks. A cheap developer (the first worker rung)
gets the task and the signatures of what was written. The signatures come
from the changed files with no model call, and the turn runs in an empty
folder outside the project, so there is no code for it to read. It answers
with one or two new test files; the engine runs the project's checks with
them on a copy of the work.

| Outcome | What happens | Extra turns |
| --- | --- | --- |
| All pass | Nothing changes. The tests are not kept. | 0 |
| The tests cannot load (a guessed module or name) | Dropped: the test was wrong about code it could not see. | 0 |
| Some fail | They go into the task's folder; the developer gets one turn to judge each against the task: fix the code, or correct or delete the test and say why. | 1 |
| Still failing after that turn | The engine takes the blind tests out, records them (`blind.dropped`), and the work that had passed goes on. | 0 |

The last row is the part the note leaves out. A blind test can be the thing
that is wrong: it may assert behaviour the task never states. This project's
own hidden checks did that twice (STATUS findings 6 and 13). If a failing
blind test gated the task like a project check, a wrong one would burn repair
rounds and then an expert turn, which is the cost the feature exists to avoid.
So a blind test costs one cheap turn at most and never escalates by itself.
The price of that bound: a right test the developer fails to satisfy in one
turn is dropped too, and only the event log says so.

Not for the expert's own work (the fix turn would be an expert turn) or the
grunt's.

Two things were added after the first live run (below):

- **How the code is called.** Signatures say what exists, not how it is
  used. The tester now also gets the start of the tests that were already
  there for the changed files, as they were before the work: calling
  conventions, with none of the new code and none of the builder's own tests.
- **Open questions.** The tester may add one separate probe for something the
  request leaves open, above all something that grows without limit, checked
  by comparing sizes (after 4,000 operations less than twice the size after
  1,000) so that no limit has to be invented. The engine runs it by itself.
  If it fails, the person gets the tester's one-sentence question with the
  result (`blind.open`, and "open question:" in the run's summary). No
  developer sees it, no turn is spent, nothing is kept, and it never gates.

### F102 `repair-race`: two fresh repairs side by side (2B)

When a task's checks still fail after its repair rounds, and the next step is
a dearer tier or the expert: two fresh developers of the task's own tier get
the failing work, each in its own copy. One is told to patch in place; the
other is told not to patch and to rewrite the failing part from the
requirement, so the two do not fail the same way. The project's checks pick
the winner, the smaller change when both pass. Its commit becomes the task's,
and the task's own checks run again as for any change. With no winner, the
task goes on to where it was headed and the expert is told the race failed
too.

Limits, each for a reason:

- Only where the project has checks. Without an executable oracle, "passes"
  means nothing and the race would pick at random.
- Only in runs that have somewhere dearer to go. `solo-opus` must keep meaning
  "Opus alone", or every baseline shifts.
- Once per task, and never at a climb within a tier (Luna low to Luna high is
  already a fresh attempt).
- The note's "Pass@2 on a mid-tier model beats Pass@1 on a higher tier" is for
  independent attempts. These follow two or three failures by the same model
  on the same task, so the errors are correlated; fresh sessions and opposite
  instructions reduce that, and how much is what a live run has to show.

A stopped race (a limit, Ctrl-C, a kill) is run again from the start on
resume.

### F103 `evidence-override`: the record overrules a confident match (3)

`evidencePick()` in `src/routing/calibration.ts`. When Tier 0's lexical match
is confident, the table is now consulted as well: if the matched tier has at
least 5 tries on that kind of work and its estimate is under the quality bar,
the request starts on the cheapest tier above that clears it. A cheaper tier
with 5 tries that clears the bar is used instead of the match (never the grunt
for something to build). `neuromesh routing` lists the overrules in effect.

The note also asks to route 20% of confident senior requests down to the
worker. That is the only way the worker's rate on senior work is ever
learned, so it exists as `cascade.probe` (a share, default 0, chosen by a hash
of the request so a benchmark repeats). It is off unless a preset asks:
`cascade-hybrid` sets 0.2.

What was not built: clusters by language and domain ("rust + async"), and a
"Lagrangian controller". The table has 4 clusters by 4 tiers. Fifty runs
spread over 16 cells is about 3 per cell, which is why the rule needs 5 tries
before it acts; a finer table would never reach its own threshold on one
person's usage. A prior plus counts is the size of tool the data supports.

### F104 `quota-shift`: cheap turns leave a plan that is running low (4)

`src/engine/quota.ts`. A preset names the tool whose window is watched, a
threshold, and another plan's models:

```json
"quotaShift": { "backend": "claude", "window": "five_hour", "above": 0.7,
                "to": [{ "backend": "codex", "model": "gpt-6-luna", "effort": "medium" }] }
```

Every reading a tool reports is kept in `~/.neuromesh/quota.json`. At or past
the threshold, grunt, worker and reviewer turns on that tool go to the other
models first; senior and expert turns stay. A reading whose window has reset,
or older than five hours, is unknown, and an unknown moves nothing (so the
first Claude turn of a day is never moved). `presets/cascade-hybrid.json` is
`cascade-claude` with this.

The note's two thresholds (60% and 70%) are one here. A moved follow-up starts
a fresh session on the other model with the task and what failed, because a
session cannot move between models.

## The first live check (2026-11-14)

`scope-test-2` at the commit before the Notes change, the same request the
owner's run got ("fold the evicted facts into Notes instead of silently
dropping them"), `cascade-claude`, a Neuromesh home of its own. One run per
row, so each number is one observation.

| | Turns | Ordinary blind tests | Unbounded Notes | Estimated cost |
| --- | --- | --- | --- | --- |
| The owner's run, no blind tests | build | - | not noticed; fixed by a second request | $0.012 |
| Run 1: F101 as first built | build, blind, fix | 15 of 22 failed, every one the tester's mistake about how the code is called; the developer corrected them and changed no code | not caught: "stays bounded" was tested on the history window, not on Notes | $0.032 |
| Run 2: with usage and open questions | build, blind | all passed the first time | raised as a question: "Notes gain roughly one entry per evicted turn with no cap ... should Notes be capped or further summarized?" | $0.019 |

What it says:

- **The engine held.** Both runs finished with the checks passing and nothing
  left behind. F100 pointed at `src/context.js` both times (and at
  `bin/agent.js`, because the request says "agent.js" and two files have that
  name).
- **The note's claim, as stated, did not hold.** A test written without
  seeing the code did not catch the growth in run 1, and could not fairly
  have: the request does not say Notes are bounded, and "instead of dropping
  them" is satisfied by keeping everything. It is a gap in the request, not a
  defect in the code. What works is asking the person.
- **The builder already knew.** In run 2 Haiku's own notes say: "Notes have
  no size cap, so a long session grows the Notes section and the prompt
  without bound. I did not add a cap because the request did not ask for
  one." The run's summary cuts a developer's notes to 200 characters, so the
  owner never saw the like of it. Showing the choices a developer says it
  made may be worth as much as the blind probe, at no cost at all
  (`docs/22-path-to-the-goal.md`, D6).
- **Cost.** Run 2 is 1.6 times the run without blind tests, for one question
  worth asking. Whether that is a good trade on average is what the
  benchmark has to say; on this request it would have saved the second
  request.

## What only a live run can say

Apart from the one check above, none of these is measured. In order of what
each would cost:

1. **F100.** One planned build on a repository with 15+ files, with and
   without `--disable start-here`: the workers' first-turn tool calls and
   input tokens. The claim to test is "fewer exploratory turns", and the
   honest prior is a small effect on top of F12.
2. **F104.** `cascade-hybrid` once with the Claude window above 70%: do the
   moved turns pass on Luna, and does the window stop moving?
3. **F102.** Needs a task Luna fails alone, which the suite does not have
   (STATUS next step 4). Until then the race rarely triggers, which also
   means it rarely costs anything.
4. **F101.** Done once (above). Next: the same on a suite of tasks, to see
   how often the ordinary blind tests find a real defect, how often they are
   wrong, and how often an open question is one the owner wanted asked.

## Fault harness

`test/support/chaos.ts` now draws requests that get blind tests, a second
tool for moved turns, probes, and blind testers that pass, fail, answer
nonsense or aim at existing files. New rules: no race copy is left behind; a
task is raced to the end once, on its own tier, never on the expert; blind
tests are written once per task and never by the expert; blind tests that
passed are not in the result; only worker and reviewer turns move to the
other tool, never a senior's or the expert's. The sweep prints how many runs
took each path, so a clean sweep can be told from an idle one.

The first kill-and-resume sweep broke a rule on 5 of 400 seeds, all in the
blind step: an engine killed while running the tests on its copy paid for
them again on resume, and could leave the copy behind. Both are fixed
(`docs/16-fault-harness.md`). After that, 1,000 ordinary and 400
kill-and-resume seeds kept every rule, with 92 races, 151 blind-test runs
and 47 moved turns among the 1,000.
