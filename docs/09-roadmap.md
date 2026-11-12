# Roadmap after v0.1

Written 2026-11-11, after v0.1.0 (all exit criteria met with `factory-luna`)
and the first build test (`docs/08-build-test.md`).

The aim does not change: match or beat a single frontier agent's results at a
fraction of its cost. What changed is the picture of how. The cheap model is
good at following a plan and bad at deciding what to build; the strong model
is the reverse, and its planning is cheap compared with its typing. So the
factory is: **the expert decides, the workers build, the engine checks and
controls**, with every expert call justified by evidence the engine collected.

Branches: `main` holds what has been measured to work; `neuromesh-research`
holds experiments; `neuromesh-testing` records real use (`docs/07-usage-log.md`).
The owner's Mac runs `neuromesh-testing`, and the usage log from real work is
the main evidence from here on; no heavy synthetic tests unless asked.

## Status (2026-11-12)

v0.2.0 is released: the TUI (F19 to F31, then F32 to F49 for its own look,
projects, agent boxes, approvals, follow-ups and the final report), teams and
logins (F50, F51), testers' reports (F52) and the write sandbox (F53). The TUI
was built at the owner's request before the gate below was met; the gate's
comparison is still to be repeated (Next steps in `docs/STATUS.md`).

### Earlier (2026-11-11, evening)

Built on `neuromesh-research`, merged into `neuromesh-testing`, each with a
feature id (`docs/10-features.md`), unit-tested, not yet measured live:

| Item | Feature |
| --- | --- |
| Feature ids, kill switches and tagged errors for everything after v0.1 | `src/features.ts` |
| Context packet: repository map and relevant signatures in every prompt, no model call | F12 |
| Universal agent tool for any CLI: map, show, find, checks | F13 |
| Expert patch instead of rebuild when only review findings remain | F14 |
| Spec cap | F15 |
| Expert budget in estimated dollars; passing work is kept when it runs out | F16 |
| Live cost per turn and by role in the summary | F17 |
| Screen check waits out a countdown | F18 |
| Lean Claude sessions (measured: spec turn $0.50 → $0.24) | F08 |
| TUI, first phase: landing, live workspace, outcome card, diff, rating, demo preset (`docs/11-tui.md`) | F19 |

Default preset on the research and testing branches: `factory-opus-luna`
(Opus 5.5 as lead engineer, Luna workers and tester). `main` keeps
`factory-luna`. Still open from the list below: expert acceptance review,
evidence collectors for web and command-line programs, staffing chosen from
the usage log, harder benchmarks, local models, contract-first parallel work.

## 1. Cost: make every expert token count

| Item | Why | Measure |
| --- | --- | --- |
| Done: lean Claude sessions | Default setup was ~33k prompt tokens per session | Opus spec turn $0.50 → $0.24 |
| Cap the spec | Opus output (8k tokens, $0.17) is now most of the spec cost | Spec turn cost and build score with a length target and `effort: low` vs medium |
| Replace the takeover | Every expensive build was an expert rebuild ($0.54 to $2.34) | An "expert patch" turn instead: the expert fixes only the named problems, with a turn budget, in the worker's tree; or advice plus one more worker round |
| Lean advice | An Opus advice turn cost $0.75 with the old setup | Advice cost with the lean setup and a capped diff |
| Sol vs Opus as lead | Opus planned better; Sol costs less per token | Build test with both leads, every fix in place |

## 2. Quality: evidence over opinion

| Item | Why |
| --- | --- |
| Screen check, round 2 | It missed a timed test that only ended on the next key press. Add an idle wait after typing, and run any key the screen advertises. |
| Expert acceptance review | One cheap read-only Opus look at the final screens and diff for new programs, instead of a rebuild. Measure whether it catches what the Luna tester misses. |
| Other evidence collectors | The same idea for web pages (headless browser screenshots as text), command-line tools (run `--help`, bad input) and services (start, one request). |
| Spec as the contract | The tester judges against the spec and request only; the engine shows the spec to every reviewer. Partly done. |

## 3. Control: the engine decides, from data

The owner's point: the system has to steer both the workers and the expert,
so cost stays down and scores stay up. Decisions to make data-driven:

- **Staffing by kind of work.** The brief engine already classifies requests
  (bug, feature, refactor, new program; terminal, CLI, web, library). The usage
  log groups real runs the same way. Once there are enough runs, the default
  staffing for each kind comes from the log, not from hand-written rules.
- **When to call the expert, and how.** Today: stuck worker → advice → takeover.
  Next: an expected-value rule using the costs measured so far (advice is cheap,
  rebuilds are not), with a per-run expert budget in estimated dollars rather
  than tokens.
- **Live cost display.** Show estimated cost per turn and per role as the run
  goes, so the owner sees where money goes.

## 4. Benchmarks that can tell configurations apart

- Repeat every build-test configuration three times; report the spread.
- More builds of different shapes: a command-line tool, a small web app, a
  feature in an existing medium-sized repository, a refactor across many files.
- A harder task suite: tasks Luna fails alone, so escalation and the tester can
  show their value. The current 25 are all solved by Luna alone.

## 5. Reach

- Local models as workers (Ollama or similar through a CLI), for zero-cost
  repair rounds and reviews.
- The TUI: done in v0.2 (`docs/11-tui.md`).

## Gate for the TUI phase

Opus + Luna (or Sol + Luna), with every fix in place, over three repeats of the
three typing prompts:

- average rubric score at least Opus alone's on each prompt;
- average estimated cost at most half of Opus alone's on each prompt;
- expert tokens at most a third of Opus alone's.

Then merge the research engine to `main` and start the TUI.
