# The final design: one strong model, fed facts by cheap ones (2026-11-19)

The owner's goal for the last honest try: one big model gets the work done, cheaper models do what suits them, so a
big repository or project costs less than the big model alone at about its quality. This design follows from every
measurement since the first commit (docs 00, 15, 22, 24, 25; STATUS 3 to 69) and the research in doc 25 and below.

## What the measurements settled

1. **Judgement must stay with the model doing the work.** Each time it crossed between models, quality fell: Opus's
   plan handed to Haiku lost the implied cases (lead v2 to v5); Haiku's diagnosis and mandatory test handed to Opus
   steered it wrong (openai-1633 under K6). Cheap models hand over facts, never conclusions.
2. **The strong model needs its tools on real repositories.** Opus writing one blind patch (K1): 2 of 21 against
   Opus alone's 8. Opus in its own session with a dossier (K6): 5 of 6 on issues Opus alone passed.
3. **What Opus pays for is the number of its calls.** Every call re-reads the tool's system prompt and the whole
   session: on black, 24 calls made 792k tokens of re-reading for 14k of output. Its outputs were already short
   (it reads with line ranges). So helpers must remove calls, not shorten outputs.
4. **A cheap model's verdict on a patch is not a gate.** The cascade's tester approved wrong fixes; K1 accepted
   patches that passed a cheap reproduction; published judges are "insufficient as a standalone correctness check"
   (ESEM 2026). Only executable checks gate.
5. **Savings concentrate where the search is big.** black: 1.51M → 0.79M tokens re-read (−48%) with the dossier;
   small or well-named issues gained nothing from it, so the gate (F130) skips it there.
6. **Easy work is the cheap model's.** Haiku alone 28 of 29 on batch 2, 150 of 150 on the routing bench at a quarter
   of Opus's cost. The strong model should not touch it (F121).

Published support: tool output is about 84% of an agent's context and masking it halves cost at equal solve rate
([JetBrains, NeurIPS 2025](https://arxiv.org/pdf/2508.21433)); compact search and 100-line views beat verbose tools
([SWE-agent](https://arxiv.org/pdf/2405.15793.pdf)); facts about a repository kept between sessions cut Claude Code with
Opus by 18 to 31% at nearly the same pass rate ([TokenEconomizer](https://www.marktechpost.com/2026/10/30/microsoft-tokeneconomizer-coding-agent-cost-control/));
a verified handoff lets a cheaper fixer match a frontier one when the fixer is strong enough
([Scrouting](https://arxiv.org/html/2608.04804)).

## The system

| Step | Who | What, facts only | Built |
| --- | --- | --- | --- |
| 0. Triage | rules, no model | trivial or small self-contained → Haiku alone, done | F121 |
| 1. Gate | rules, no model | dossier only for a big repository whose request does not name code it defines | F130 |
| 2. Dossier | Haiku, tools, disposable copy | the code the change touches, quoted with lines; xfail/skip tests and TODOs nearby; how one test file runs, with the command and its output; a reproduction as advice; no diagnosis | F127 scout, F131 |
| 3. Solve | the solver's own session with tools | starts from the dossier, checks only what it changed | F129, H3 |
| 4. Check | Neuromesh | the project's checks after the turn; failures go back to the same solver | engine |
| 5. Record | Neuromesh | the dossier's how-to-test and conventions kept per repository for the next run | to build (C10, TokenEconomizer) |

## Where Sonnet goes

Not as a reviewer (finding 4), not as a builder of Opus's plan (finding 1), and not as Haiku's replacement for the
dossier (facts are mechanical; Haiku does them for $0.02 to $0.05). Its one plausible place is **the solver for work
that does not need Opus**, the owner's "medium" tier: Sonnet in its own session, fed the same dossier. Sonnet alone
solved 1 of 5 hard issues; with a dossier it is unmeasured, and Scrouting's result says a strong-enough fixer with a
good handoff can match the frontier. So it is measured before it is routed to:

- **Trial A:** K6 with Opus (`dossier-claude`) on the 21 issues: does it hold Opus's 8 at less than $9.40?
- **Trial B:** K6 with Sonnet as the solver (`dossier-sonnet`) on the same 21: which of Opus's wins does it keep, at
  what cost?

Routing rule, decided from A and B before any further run: if Sonnet with the dossier keeps most of Opus's wins at a
fraction of the cost, Sonnet becomes the default solver and Opus is used where the dossier's facts mark the change as
broad (many files implicated, a standard or protocol to conform to, a change across modules). If Sonnet with the
dossier stays far below Opus, Sonnet's place is the everyday medium tier (routing bench work), and real-repository
issues go to Opus with the dossier. Either way the rule uses only facts available before the solver starts (the gate's
and the dossier's), since no judge after the fact can be trusted (finding 4).

## How it is judged

One run per configuration on 21 issues; differences of one or two issues are noise. Recorded per issue: resolved,
estimated cost by model, Opus's re-read tokens and calls. The claim the trial can support: "at Opus's quality within
one or two issues, at X% of its cost", or that it does not.
