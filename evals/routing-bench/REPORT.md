# Routing benchmark report: 5-tier cascade vs single Opus

**Date:** 2026-11-14 (runs 19:51 to 20:26 UTC, 2026-11-13)
**Branch:** `neuromesh-routing`
**Runs:** `rb-frontier-1` (single Opus), `rb-cascade-1` (the cascade)
**Raw records:** `results/<run>/<prompt>.json` and `results/<run>/LOG.md`, committed and pushed as each prompt finished
**Machine-generated table:** `results/rb-cascade-1/REPORT.md` (`score.ts`)

## Summary

- **Quality:** the same. The cascade scored 10/10 on 14 of 15 prompts and Opus on all 15. The quality gap is 0.8%, inside the suite's 3% target.
- **API cost:** the cascade cost 35% of single Opus: $1.16 against $3.32, estimated at API list prices. That is a 64.9% saving, just under the suite's 65% target, and 77.8% on the traffic-weighted mix (target 80%).
- **Subscription usage:** the cascade moved the Claude five-hour window 10 points against Opus's 13, a 23% saving. The dollar saving does not carry over to the subscription.
- **Contamination:** both quota figures include this working session, which was also Claude Opus 5.5 on the same subscription. The session did more work during the cascade run than during the Opus run (see "Measurement caveat" below), so the cascade's quota figure is inflated more than Opus's.
- **Traps:** two of three survived. 5.1 (regex bomb) passed, 5.3 (impossible sort) was caught by the early-exit gate, and 5.2 (jargon wall) failed: it was routed to Sonnet instead of the grunt.

## Setups

| | Single frontier (`solo-opus`) | Cascade (`cascade-claude`) |
| --- | --- | --- |
| Tier 0 router | none | Neuromesh rules, no model call (F80, F81) |
| Tier 1 grunt | | Claude Haiku 5.5, low effort |
| Tier 2 worker | | Claude Haiku 5.5, medium, then high |
| Tier 3 senior | | Claude Sonnet 5.5, medium, then high |
| Tier 4 expert | Claude Opus 5.5, medium, does everything | Claude Opus 5.5, medium: plans and advises, builds nothing |
| Gates | the same visible format check | the same check, the early-exit gate (thresholds 0.75 / 0.80), at most 2 expert escalations |

Both used Claude models only. Each prompt started with no context: its own Neuromesh home, a fresh repository, and Claude sessions that load none of the owner's settings or memory. The two runs ran one after the other on the same subscription.

## The suite's four metrics

| Metric | Result | Target | Verdict |
| --- | --- | --- | --- |
| CostSave, unweighted | 64.9% | >= 65% | missed by 0.1 points |
| CostSave, weighted 50/30/16/4 | 77.8% | >= 80% | missed |
| Gap@Oracle (quality loss vs Opus) | 0.8% | <= 3.0% | met |
| WCTR (wasted cascade tokens) | 1.4% (22,130 of 1,561,327) | <= 8.0% | met |
| Trap 5.1, regex bomb | final regex 13/13 (Haiku solved it at once) | PCRE test passes | survived |
| Trap 5.2, jargon wall | routed to Sonnet, $0.058 spent on Tier 3 | Tier 1 only, $0 above it | **failed** |
| Trap 5.3, impossible sort | Haiku's turn stopped by the gate, Sonnet answered 5/5 | stopped at <= 30 tokens, bound named | routing survived; the stop came at about 840 tokens, not 30 |
| Tier 0 sent the prompt to the expected starting tier | 6 of 15 | | |

## API cost vs subscription usage

These are two different currencies, and the cascade does very differently in each.

### API cost (estimated at list prices, `src/usage/prices.ts`; no money was spent)

| | Single Opus | Cascade | Cascade / Opus |
| --- | --- | --- | --- |
| Total | $3.319 | $1.164 | 35% |
| Opus 5.5 | $3.319 | $0.308 | |
| Sonnet 5.5 | | $0.777 | |
| Haiku 5.5 | | $0.079 | |
| Tokens processed (input, cache and output) | 1,060,609 | 1,561,327 | 147% |
| Output tokens | 92,348 | 127,288 | 138% |
| Agent turns | 15 | 20 | |
| Wall time | 16.1 min | 13.5 min | 84% |

The cascade processed half again as many tokens and still cost a third as much. Most of its tokens went to Haiku, which costs a fortieth of Opus per token, and the rest mostly to Sonnet, which costs half. Each Claude Code session starts by loading its own system prompt and tools, so even a short task in a cheap model's session processes tens of thousands of tokens. On 1.1 to 1.3, Haiku processed 1.2 to 2.9 times as many tokens as Opus did for the same answer.

### Subscription usage (the Claude windows, read before and after every prompt)

| Window | Single Opus | Cascade | Cascade / Opus |
| --- | --- | --- | --- |
| Five-hour, summed per prompt | 13 points (53% to 66%) | 10 points (67% to 77%) | 77% |
| Weekly, summed per prompt | 2 points (57% to 59%) | 1 point (59% to 61%, 2 at the run's edges) | |
| Between the runs | the window moved 66% to 67% with no benchmark prompt running | | |

The subscription saving is about 23%, not 65%. There are four reasons, in order of how sure I am of them:

1. **Haiku and Sonnet use the same Claude quota as Opus**, and that quota is not priced like the API. This project measured the same thing before (`docs/STATUS.md` finding 23): Haiku is about 5 to 7 times cheaper than Opus on the quota, not the 40 times its API price suggests.
2. **The cascade processed 47% more tokens.** Quota appears to follow tokens more closely than dollars do.
3. **This working session ran on the same quota, and worked more during the cascade run.** See the next section.
4. **The readings are whole percentages,** and 60 one-word Haiku calls read them. On a run of 10 to 13 points, plus or minus one or two points is noise.

## Measurement caveat: this session used the same five-hour window

I, the assistant running and watching the benchmark, am Claude Opus 5.5 in Claude Code on the same Claude subscription. Every message I sent during the runs drew on the same five-hour window that the benchmark's before-and-after readings measure. My session carries a long context, so each of my turns costs more than a short benchmark turn. I did not pause during the runs, and **I did more during the cascade run than during the Opus run:**

| | During the Opus run (19:51 to 20:10) | During the cascade run (20:10 to 20:26) |
| --- | --- | --- |
| Progress notes (one short turn each) | 15 | 15 |
| Failures looked into, with tool calls | 2 (prompts 2.1, 3.3) | 4 (prompts 2.3, 3.1, 4.2, 4.3) |
| Checkers fixed and revalidated | 2 | 3 |
| Other | | rerunning the cascade's 4.3 simulator by hand, searching the engine's environment code, restarting the progress monitor |
| My turns, roughly | about 20 | about 28 |

So part of the cascade's 10 points is my own work, and a larger part than in Opus's 13. My work also appears where it overlapped a prompt's readings: the cascade's 4.2 moved the window 3 points while I was looking into its early exit. It also appears between prompts, which no prompt's reading includes (66% to 67% between the runs). I cannot separate my share from the benchmark's: the windows report one number for the whole account.

**What this means:** the cascade's true subscription saving is probably a little better than 23%, but not near 65%. A clean measurement needs this session idle (or ended) during the runs, and the two runs in separate five-hour windows, or each run twice in alternating order.

## Per prompt

Q = hidden checker score out of 10. Cost is estimated at API list prices. "5h" is the five-hour window before and after the prompt.

| ID | Prompt | Expected | Cascade path | Q cascade | Q Opus | Cost cascade | Cost Opus | 5h cascade | 5h Opus |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1.1 | PDF table to JSON | grunt | worker | 10.0 | 10.0 | $0.0071 | $0.0980 | 67→67 | 53→53 |
| 1.2 | Tone rewrite | grunt | worker | 10.0 | 10.0 | $0.0073 | $0.0603 | 67→67 | 53→54 |
| 1.3 | .env.example | grunt | worker | 10.0 | 10.0 | $0.0025 | $0.0638 | 67→67 | 54→54 |
| 2.1 | HMAC webhook | worker | worker | 10.0 | 10.0 | $0.0085 | $0.1141 | 67→68 | 54→55 |
| 2.2 | Standup table | worker | senior | 10.0 | 10.0 | $0.0911 | $0.0672 | 68→68 | 55→55 |
| 2.3 | GST pytest suite | worker | worker | 8.8 | 10.0 | $0.0084 | $0.2426 | 68→69 | 55→56 |
| 3.1 | AbortController hook | senior | worker | 10.0 | 10.0 | $0.0150 | $0.1136 | 69→69 | 56→57 |
| 3.2 | Heap refactor | senior | senior | 10.0 | 10.0 | $0.0660 | $0.2013 | 69→70 | 57→58 |
| 3.3 | 80M-row migration | senior | senior | 10.0 | 10.0 | $0.0890 | $0.5965 | 70→71 | 58→60 |
| 4.1 | ARM64 ring buffer | expert sandwich | Opus plan → Sonnet → Haiku | 10.0 | 10.0 | $0.3304 | $0.3378 | 71→72 | 60→61 |
| 4.2 | Edge DAG orchestrator | expert sandwich | Sonnet (gate) → Opus advice → Sonnet | 10.0 | 10.0 | $0.4017 | $0.6344 | 72→75 | 61→63 |
| 4.3 | Spot GPU checkpointing | expert sandwich | worker | 10.0 | 10.0 | $0.0174 | $0.4641 | 75→75 | 63→65 |
| 5.1 | Regex bomb (trap) | cascade 1→2→3 | worker | 10.0 | 10.0 | $0.0037 | $0.0967 | 75→76 | 65→65 |
| 5.2 | Jargon wall (trap) | grunt | senior | 10.0 | 10.0 | $0.0581 | $0.0644 | 76→77 | 65→66 |
| 5.3 | Impossible sort (trap) | cascade 2→3 | worker (gate) → senior | 10.0 | 10.0 | $0.0580 | $0.1639 | 77→77 | 66→66 |
| | **Total** | | | **149 / 150** | **150 / 150** | **$1.164** | **$3.319** | **10 pts** | **13 pts** |

## Where the cascade lost money

1. **4.1, the sandwich cost as much as Opus alone** ($0.330 against $0.338). Opus's planning turn wrote 6,543 output tokens ($0.197). The suite expects a blueprint of at most 500 output tokens. The plan prompt asks for brevity, but the CLI has no output cap to enforce it.
2. **4.2, a false alarm from the gate.** Sonnet's preamble said confidence 0.70, `escalate: false`, and "feasible in one sitting". The senior threshold is 0.80, so the task went to Opus for advice ($0.110), and then Sonnet built it anyway ($0.269). The threshold made that escalation, not the model.
3. **2.2 and 5.2 went to Sonnet** instead of the worker and the grunt. On these short prompts Sonnet cost about what Opus did.
4. **Tier 0 never picked the grunt.** Every prompt arrives in an empty workspace, so the brief engine calls it new work, and the router never leaves new work with the grunt. The grunt-tier prompts went to Haiku medium instead. That cost little here, because Haiku medium is cheap, but it is why trap 5.2 failed.

Together, 4.1 and 4.2 are 63% of the cascade's cost. A blueprint near the suite's size would on its own have pushed CostSave past 65%.

## Where it worked

- **Tiers 2 and 3** matched Opus at 4% to 33% of its cost: 2.1, 3.2 and 3.3, and 3.1 and 4.3, which went to Haiku below their expected tier.
- **The early-exit gate on 5.3:** Haiku reported 0.30 confidence, and the engine stopped its turn after about 7 seconds and $0.0016. Sonnet then answered correctly. The stop came after about 840 output tokens (estimated), not 30. Haiku thinks before it writes its one-line preamble, and the CLI streams no partial text, so the 25-token cut the suite describes is not reachable through it. On this prompt, Haiku's own reason already named the lower bound.
- **Waste was low:** 1.4% of tokens went to stopped turns or turns a task later moved away from.
- **Wall time:** the cascade took 13.5 minutes against Opus's 16.1.

## Checker corrections

Five hidden checkers were too narrow, and the runs exposed them. Each fix still gives the reference answer full marks and an empty workspace low marks. Each was rerun on both setups' saved answers with `rescore.ts`, which makes no model calls. Every record keeps its run-time score as `scoreAtRun`.

| Prompt | The problem | Effect |
| --- | --- | --- |
| 2.1 | missed FastAPI's `x_signature: Header()` way of reading `X-Signature` | Opus 9/10 → 10/10 |
| 3.3 | compared DROP and ADD positions across two files joined together, and missed a read switch given as a table | Opus 7/9 → 9/9 |
| 3.1 | read only `useSearch.js`; Haiku put the abort logic in a helper module | cascade 2/7 → 7/7 |
| 4.2 | did not accept "No coordinator" for "no central coordinator" | cascade 8/9 → 9/9 |
| 4.3 | ran `sim.py` on the system's Python 3.9, not the newer Python the engine built and checked the work with | cascade 7/9 → 9/9 |

Before the corrections, Gap@Oracle read about 7% in Opus's favour. After them it is 0.8%.

## Limits of this run

- **One run per setup.** These numbers do not show variance.
- **Rubrics, not a judge.** Categories 3 and 4 and the trap rubrics are keyword and structure checks. They do not run the code, except `cargo build` (4.1), `sim.py` (4.3) and the regex (5.1). There was no blind human or model judge.
- **Dollar figures are estimates** at API list prices for usage reported by the CLI. A turn the gate stopped has its output estimated from what it streamed.
- **The suite's 25-token stream cut and 500-token expert cap** cannot be enforced through the CLIs. The tables show the actual sizes instead.
- **Contamination, again.** The quota figures include this session's own Opus usage, more of it during the cascade run (see above).

## Next (not started)

1. **Tier 0:** route requests that transform text they contain (1.x, 5.2) to the grunt even in an empty workspace, and weigh the closing instruction over jargon in pasted material. Validate this on prompts other than these 15.
2. **Expert blueprint:** cap its size by prompt, and measure it against the suite's 500-token target.
3. **Early-exit gate:** act on `escalate: true` only, or lower the senior threshold. Measure whether false alarms like 4.2 disappear while catches like 5.3 remain.
4. **Re-run both setups** at least twice, with this session idle and the runs in separate five-hour windows, before trusting the subscription numbers.

## After this report: what was changed (F89 to F92, not yet re-run)

The owner's own list and a friend's four suggestions were checked against this run's records. These were taken:

| Change | Feature | Prompted by | Expected effect (to be measured) |
| --- | --- | --- | --- |
| Tier 0 scores the instruction, not the pasted material. An instruction that only changes the form of the pasted text (turn into, rewrite, extract, list...) and asks for no judgement (flag, summarise, debug, fix, make it thread-safe...) goes to the grunt, empty workspace or not. | F89 `instruction-scoring` | 5.2 failed; 2.2 went to Sonnet because the quoted notes mention a "migration"; Tier 0 never picked the grunt | Starting tier right on 11 of 15 prompts (was 6): 1.1, 1.2, 1.3 and 5.2 to the grunt, 2.2 to the worker. 10 of 10 on prompts written outside the suite. Two of those first missed and the rule was changed for them, so they are a regression set now, not a held-out one. |
| Those grunt transforms are answered in one call with no tools: no Claude Code tool definitions, the files returned as JSON. An unusable answer gives the grunt its tools; failing checks send the task to the worker. | F90 `direct-grunt` | Haiku processed 30K to 86K tokens per formatting prompt, most of it Claude Code's own session prompt | Fewer tokens, and so less quota, on 1.x and 5.2 |
| The early-exit gate stops a turn on `escalate: true`, or on confidence below 0.55, not below 0.75/0.80 | F91 `gate-floor` | 4.2: Sonnet said 0.70 and `escalate: false`, was sent to Opus anyway, then built it | About $0.11 and one Opus turn saved on 4.2; 5.3 (0.30) is still caught |
| The expert's blueprint is asked to stay under about 400 words: bullet points, invariants and signatures, no function bodies | F92 `blueprint-cap` | 4.1: Opus's plan was 6,543 output tokens ($0.197) | Most of that $0.197 saved, if Opus follows the brief (the CLI cannot enforce a limit) |

Not taken:

- **Dropping the third hop of the sandwich** (Opus → Sonnet only). On 4.1, the Haiku part cost $0.0079. The same tokens at Sonnet's prices would cost about $0.15, so the third session saved money here rather than costing it.
- **Adding "standup", "meeting notes", "action items" to the worker's keywords.** That would fit the router to this suite's prompts. Scoring the instruction rather than the quoted notes routes 2.2 to the worker without it.

A bug was also found and fixed while doing this. Removing a sentence that asks for a model (the router's prompt-injection guard) used to flatten the request onto one line. That hid the line structure of pasted logs, so trap 5.2 would have scored its jargon even with F89.

A suggestion that these changes bring the batch to about $0.68 (79.5% CostSave) is a projection. Only a re-run will show the real figures, with this session idle and the two runs in separate five-hour windows (see "Measurement caveat").
