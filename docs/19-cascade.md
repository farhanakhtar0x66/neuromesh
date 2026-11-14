# The routing cascade (2026-11-14)

On branch `neuromesh-routing`. The owner brought in a routing architecture: a
five-tier triage-and-cascade pipeline (a zero-token router, a nano "grunt", a
Haiku-class worker, a Sonnet-class senior, and a frontier expert), with gates
that catch a wrong route as it happens and an Architect-Worker sandwich for
hard tasks. This note maps it onto Neuromesh: what was already there, what was
added (F80 to F88), and what could not be done as written.

Nothing here has run on real subscriptions yet. It is tested on the fake
backend and the fault harness only, so by the project's rule it is not
finished.

## The tiers

| Tier | Architecture | Neuromesh (`presets/cascade.json`) |
| --- | --- | --- |
| 0 | Bouncer: regex, local embeddings, RouteLLM classifier | F80 rules and weighted cluster match; F81 calibrated table |
| 1 | Grunt (nano model) | `gruntLadder`: GPT-6 Luna low, through Codex (F82) |
| 2 | Haiku-class worker | `workerLadder`: Claude Haiku 5.5 medium, then high |
| 3 | Sonnet-class senior | `seniorLadder`: Claude Sonnet 5.5 medium, then high (F78) |
| 4 | Frontier expert | orchestrator, briefer and escalation: Claude Opus 5.5 medium |

All four sit on one ladder (grunt, worker, senior rungs), which only climbs.

## Piece by piece

| Architecture | Already in Neuromesh | Added |
| --- | --- | --- |
| 0A deterministic heuristics | The brief engine's kind, size and staffing (F01) | F80: a trivial change goes to the grunt; over 800 words or 12 named files, to the expert's plan |
| 0B embedding similarity | none | F80: weighted patterns for four clusters of work. Neuromesh has no runtime dependencies, so there is no embedding model. Confidence is the best cluster's share of the match, and below 65% it counts as ambiguous. |
| 0C RouteLLM classifier | none | F81: P(success \| tier, cluster) from a stated prior plus this machine's outcomes. Picks the cheapest tier with P >= alpha (0.8). |
| Router prompt injection | none | F80: sentences that ask for a model ("use Opus", "this is extremely hard") are removed before scoring |
| Gate 1: deterministic checks on the grunt | Project checks, acceptance runs (F58), tester | F82: a grunt is never repaired, never asked to judge itself, and never moved to another grunt rung. Its failure goes to the first worker rung with the errors. A grunt's work that no check verifies is always reviewed. |
| Gate 2: 25-token preamble, stream cut | none | F83: worker and senior turns start with a JSON preamble. The engine reads the first text message and stops the tool's process when the turn escalates or its confidence is below threshold (0.75 worker, 0.80 senior), and the task climbs a whole tier. |
| Gate 3: bottleneck diagnostic to the expert | Advice before takeover; F62 advice-cap compacts attempts | F84: the stuck developer writes a diagnostic of at most 150 words, in its own read-only session or in its preamble. The expert's advice prompt holds that in place of the attempt history. |
| Phase 1: grunt and Haiku compress context | F63 scout, F12 context packet | With a grunt rung, the scout runs on the grunt |
| Phase 2: expert writes only a DAG blueprint | F65 spec plan with owners, F78 tiers | F85: the expert builds nothing. Its plan puts the hardest part's decision, algorithm and invariants into that part's brief, and the part goes to the senior. F93: only for a request Tier 0 routes there by rule (large: F80; or a short build across 3+ subsystems with no code file named: F94); any other expert route starts on the senior, and the expert advises on escalation. F96: a developer that finds the request needs a design first says scope: true, and the expert divides it. F95: stand-ins for an implementation fail the checks. |
| Phases 3 and 4: Sonnet and Haiku implement | F78 owners, F79 findings to the owning rung | the "grunt" owner for mechanical parts |
| Cost model E = (1+eps) sum p_i C_i | Usage log, eval pricing (`src/usage/prices.ts`) | F87: `routing.summary` at the end of a run, measured. p_i, per-tier cost, eps (turns a task left, early exits), and the same tokens priced at the expert, all labelled as estimates. |
| Acyclic escalation, circuit breaker | The ladder only climbs; expert budget in tokens and dollars (F16, F60, F69) | F86: at most `maxEscalations` (2) tasks per run reach the expert |
| Prompt caching | The CLIs cache on their own | none |
| Offline shadow evaluation | none | F88: 1% of grunt and worker passes are kept locally. `neuromesh routing grade` has the senior grade them, and a rejected pass becomes a failure in F81's table. |

## What could not be done as written

- **No logprobs, no `max_tokens`, no SSE cut.** Neuromesh reaches models only
  through their CLIs. So the gate reads the first text message rather than 25
  tokens, and stops the process rather than closing a stream. The expert's
  blueprint is capped by prompt (F15 spec-cap) and by the dollar budget (F60),
  not by a token limit.
- **Self-reported confidence is not calibrated.** A model that never
  escalates is let through, and so is a turn that does not start with a
  preamble. Whether Haiku and Sonnet escalate honestly is the main thing a live
  run has to show.
- **No embeddings, no trained classifier.** 0B is lexical, and 0C learns
  only from this machine's runs and shadow grades. With no data it uses its
  prior, which `neuromesh routing` prints.
- **The architecture's numbers are not this project's.** Finding 23 measured
  Haiku at about 5 to 7 times cheaper than Opus on the Claude quota, not 60
  times. And the doc's "Sonnet resolves 80%" and "97% of frontier quality"
  have no source. F87 measures the real p_i and eps per run instead.
- **Haiku shares Opus's quota.** The worker and senior tiers in
  `presets/cascade.json` draw from the same Claude plan as the expert. The grunt
  (Luna) and the tester's fallback are the only parts on another plan.

## Commands

```bash
node src/cli/main.ts routing
```

```bash
node src/cli/main.ts routing route "fix the race in the job queue"
```

```bash
node src/cli/main.ts run --preset cascade "<request>"
```

```bash
node src/cli/main.ts routing grade --limit 5
```

The first two make no model calls. `routing grade` makes one live call per
item it grades.

## Next

1. One live run per tier on real subscriptions (a typo, a flag with tests, a
   refactor, `hard-py-minidb`), reading `route.tier`, `agent.preamble`,
   `task.early-exit` and `routing.summary` in the event log.
2. The same hard task against `factory-opus-sonnet-haiku`, to see whether the
   blueprint-only expert (F85) keeps Opus under its budget without losing the
   197/197.
3. Check that Haiku and Sonnet escalate when they should, and how much an
   early exit saves against the turn it stopped.
