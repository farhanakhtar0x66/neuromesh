# Routing benchmark

The owner's 15-prompt suite (2026-11-14): the routing cascade (preset
`cascade-claude`, F80 to F88) against a single frontier agent (preset
`solo-opus`). It covers messy routine work, standard coding, multi-part logic,
deep architecture, and three "Trojan horse" traps. Claude models only.

| Tier | Model (`presets/cascade-claude.json`) |
| --- | --- |
| 0 | Neuromesh's rules, no model (F80, F81) |
| 1 grunt | Claude Haiku 5.5, low effort |
| 2 worker | Claude Haiku 5.5, medium then high |
| 3 senior | Claude Sonnet 5.5, medium then high |
| 4 expert | Claude Opus 5.5, medium: plans and blueprints, builds nothing |
| baseline | Claude Opus 5.5, medium, alone (`solo-opus`) |

## Layout

- `tasks/<slug>/prompt.md` holds the suite's prompt verbatim, plus one line naming the
  file to write the answer to (the same line for both setups).
- `tasks/<slug>/seed/` is the starting workspace. Its `neuromesh.json` check
  (`.bench/format-check`) is the suite's deterministic gate: the answer's
  format, not its correctness. Both setups get it.
- `tasks/<slug>/hidden/check.py` grades the answer after the run and prints
  `SCORE passed/total`. Quality Q = 10 x passed/total. It uses only the
  Python standard library, plus perl (for the PCRE test in 5.1) and cargo (4.1).
- `reference/<slug>/` holds a correct answer. `./validate.sh` checks that every
  hidden checker gives it full marks and gives an empty workspace low marks.

## Running

```bash
evals/routing-bench/validate.sh
```

```bash
node evals/routing-bench/run.ts --config cascade --name rb-cascade-1 --fake
```

```bash
node evals/routing-bench/run.ts --config frontier --name rb-frontier-1
```

```bash
node evals/routing-bench/run.ts --config cascade --name rb-cascade-1
```

```bash
node evals/routing-bench/score.ts rb-cascade-1 rb-frontier-1
```

`--fake` makes no model calls: every turn writes the reference answer. The live
runs spend the Claude subscription. Each prompt also costs two one-word Haiku
calls, which read the quota before and after it.

Every prompt starts with no context from an earlier one: its own Neuromesh
home in `~/.neuromesh-bench/<name>/<slug>` (so the router's calibration starts
from its prior), a fresh repository, and Claude sessions that load none of the
owner's settings. Each prompt's record (`results/<name>/<slug>.json`) and the
running log (`results/<name>/LOG.md`) are committed and pushed as soon as the
prompt finishes. Rerunning a name continues where it stopped.

## What the records hold, and what they cannot

- Per turn: model, tier, tokens, cost estimated at API list prices, the Claude
  quota windows the turn reported, and whether the turn was discarded (a tier
  the task later left, or an early exit).
- Claude quota: the five-hour and weekly windows, read before and after each
  prompt. Claude has no daily window. The reading is a whole percentage, so a
  small prompt can show 0.
- Category 4 and the rubric parts of Categories 3 and 5 are scored by keyword
  rubrics, not by a blind human or model judge.
- The suite's "25-token stream abort" and "<= 500 expert output tokens" cannot
  be enforced through the CLIs. The records show the early exit's estimated
  output tokens and the expert's actual output tokens instead.
- Tier 0 was not tuned to these prompts before the first run. Run against them
  with no calibration data, it picks the suite's starting tier for 6 of 15:
  every prompt arrives in an empty workspace, so the brief engine calls it new
  work, and Tier 0 never leaves new work with the grunt.
