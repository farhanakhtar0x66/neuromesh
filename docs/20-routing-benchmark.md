# Routing benchmark, first run (2026-11-14)

The owner's 15-prompt routing suite (`evals/routing-bench`). The cascade
(`cascade-claude`) runs against a single Opus 5.5 agent (`solo-opus`), Claude
models only. Each prompt starts with no context: a fresh Neuromesh home, a fresh
repository, and lean Claude sessions. Runs `rb-frontier-1` and `rb-cascade-1`,
19:51 to 20:26 UTC. Every record is in
`evals/routing-bench/results/<run>/`, and the scored table is in
`results/rb-cascade-1/REPORT.md`.

## Result

| Metric | Cascade | Target | |
| --- | --- | --- | --- |
| CostSave, unweighted | 64.9% ($1.16 against $3.32, estimated at list prices) | >= 65% | just missed |
| CostSave, weighted 50/30/16/4 | 77.8% | >= 80% | missed |
| Gap@Oracle | 0.8% | <= 3% | met |
| WCTR (wasted cascade tokens) | 1.4% | <= 8% | met |
| Trap 5.1 regex bomb | 13/13, Haiku solved it directly | survive | survived |
| Trap 5.2 jargon wall | routed to Sonnet, $0.058 on Tier 3 | Tier 1, $0 above it | failed |
| Trap 5.3 impossible sort | Haiku's preamble stopped its turn, Sonnet answered 5/5 | stop at <= 30 tokens | survived the routing, not the token bound |
| Tier 0 starting tier as expected | 6/15 | | |
| Claude five-hour window | 10 points (Opus alone: 13) | | |
| Claude weekly window | 1 point (Opus alone: 2) | | |
| Tokens, all kinds | 1.56M (Opus alone: 1.06M) | | |
| Wall time | 13.5 min (Opus alone: 16.1) | | |

Opus alone scored 10/10 on all 15 prompts. The cascade scored 10/10 on 14.
On 2.3, Haiku tested rounding with exact two-decimal equality rather than the
`pytest.approx` or `Decimal` the suite asks for.

## What it showed

1. **Dollars and quota are not the same saving.** The cascade cost about a
   third of Opus at API list prices, but moved the five-hour window 10 points
   against 13. That is a quarter less quota, not two thirds less. Haiku and
   Sonnet share Opus's Claude quota, and the quota is not priced like the API
   (finding 23 again). The cascade also processed half again as many tokens,
   because each Claude Code session starts with its own system prompt and
   tools. The readings are whole percentages and include the 60 one-word
   readings themselves, so a point or two either way is noise.
2. **Two prompts are 63% of the cascade's cost, and the expert is why.**
   - 4.1 (the sandwich): Opus's plan turn wrote 6.5K output tokens ($0.20),
     where the suite expects a blueprint of at most 500. The prompt asks for
     brevity, and the CLI has no output cap to enforce it. With Sonnet's and
     Haiku's builds on top, the sandwich cost the same as Opus doing it alone
     ($0.33 against $0.34).
   - 4.2: Sonnet's preamble said 0.70 confidence, `escalate: false`, and
     "feasible in one sitting". The senior threshold is 0.80, so the gate sent
     it to Opus for advice ($0.11) and Sonnet then built it ($0.27). The
     result was no better than Opus's. The threshold, not the model, made that
     escalation.
3. **Tier 0 is the weak part, as measured before the run.** It never picked
   the grunt. Every prompt arrives in an empty workspace, so the brief engine
   calls each one new work, and the router never leaves new work with the
   grunt. It also sent 2.2 and 5.2 (the jargon trap) to Sonnet and 3.1 to
   Haiku, and sent 4.2 and 4.3 below the expert. Haiku and Sonnet still did
   those well, so the misroutes cost money, not quality. Moving 1.x and 5.2
   from Haiku-medium/Sonnet to the grunt would mostly fix trap 5.2. A cheaper
   4.1 plan would have added the few points that 65% and 80% were short.
4. **The early-exit gate did what it is for on 5.3, at a different size.**
   Haiku reported 0.30 confidence, its turn was stopped, and Sonnet answered
   correctly. The stopped turn is estimated at 840 output tokens, not <= 30,
   because Haiku thought before writing its one-line preamble and the CLI
   streams no partial text. It cost $0.0016. Haiku's own reason already named
   the lower bound, so on this prompt Haiku alone would have done as well.
5. **Waste was low.** 22K of 1.56M tokens (1.4%) went to turns that were
   stopped or left behind.

## Checker corrections made during the run

Five hidden checkers were wrong in ways the runs exposed. Each was fixed, still
gives the reference answer full marks and an empty workspace low marks, and was
rerun on both setups' kept workspaces (`rescore.ts`; each record keeps its
`scoreAtRun`):

| Prompt | What was wrong | Score at run, then rescored |
| --- | --- | --- |
| 2.1 | Missed FastAPI's `x_signature: Header()` way of reading `X-Signature` | Opus 9/10 to 10/10 |
| 3.3 | Compared DROP and ADD positions across two files joined together; missed a read switch given as a table | Opus 7/9 to 9/9 |
| 3.1 | Read only `useSearch.js`; Haiku put the abort logic in a helper module | cascade 2/7 to 7/7 |
| 4.2 | "No coordinator" was not accepted as "no central coordinator" | cascade 8/9 to 9/9 |
| 4.3 | Ran `sim.py` on the system's Python 3.9 rather than the newer Python the engine built and checked the work with | cascade 7/9 to 9/9 |

The rubrics for categories 3 and 4 check for the right constructs and
statements. They are not a blind judge and do not run the code, except
`cargo build` (4.1), `sim.py` (4.3) and the regex (5.1). Before the
corrections the metrics were Gap@Oracle about 7% in Opus's favour; after them,
0.8%.

## Next

1. Tier 0: stop treating a request in an empty workspace as new code when it
   asks for a transformation of text it contains (1.x, 5.2). Weigh the
   instruction at the end over jargon in the pasted material. Check this on
   prompts other than these 15, so the router is not tuned to its own test.
2. Cap the expert's blueprint by prompt and by measurement. 6.5K output
   tokens is the one thing that made the sandwich cost as much as Opus.
3. Gate only on `escalate: true`, or lower the senior threshold, and measure
   whether 4.2-like false alarms go away without losing 5.3-like catches.
4. Run each configuration two more times before trusting any of these
   numbers: one run per prompt is not a measurement of variance.
