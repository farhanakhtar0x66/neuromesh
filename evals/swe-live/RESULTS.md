# SWE-bench-Live results

27 real issues (SWE-bench-Live, July to September 2025, 25 repositories), graded by the official harness. One run each.
Costs are API-equivalent estimates, not money spent (all runs on subscriptions).

## Runs

| Run | Configuration | Issues | Resolved | Est. cost | Time |
| --- | --- | --- | --- | --- | --- |
| swl-haiku-1 | Haiku 5.5 high, alone | 27 | 8 | $1.61 | 1h 30m |
| swl-haiku-notes | the same, on the 5 issues given an interface note | 5 | 1 (electrum) | $0.21 | 14m |
| swl-cascade-notester | cascade-claude before F119 (stopped after 6) | 6 | 1 | unknown (partial) | — |
| swl-cascade-1 | cascade-claude with F119 | 21 (Haiku's 19 failures + 2 of its passes) | 5 | $5.13 | 1h 52m |
| swl-opus-1 | Opus 5.5 alone | 5 (cascade failures judged fixable) | 3 | $3.36 | 27m |
| swl-sonnet-1 | Sonnet 5.5 high alone | the same 5 | 1 (pint) | $1.10 | 9m |

Over all 27 (taking the notes into account): Haiku alone 9; the cascade 11 (Haiku's 9 kept, as far as checked on 2 of
them, plus PyPSA-1310 and openai-agents-1633).

## Per issue (cascade set)

| Issue | Haiku | Cascade | Opus | Sonnet | Why the cascade failed |
| --- | --- | --- | --- | --- | --- |
| django-dbbackup-601 | pass | pass | | | |
| a2a-python-443 | pass | pass | | | |
| spesmilo electrum-10172 | pass (with note) | pass | | | |
| PyPSA-1310 | 2/5 | **pass** | | | |
| openai-agents-1633 | 0/1 | **pass** | | | |
| a2a-python-414 | 0/2 | 0/2 | **pass** | 0/2 | wrong JSON-RPC codes for cases the issue implies |
| hgrecco pint-2194 | 1/2 | 1/2 | **pass** | **pass** | dB + dB addition (the issue shows dBm − dB) |
| psf black-4720 | 1/2 | 1/2 | **pass** | 1/2 | a longer `except A, B, C:` form does not parse |
| authlib-802 | 3/4 | 3/4 | 3/4 | 3/4 | implicit grant with `alg none` |
| simplejwt-928 | 2/6 | 2/6 | 2/6 | 2/6 | deleted users in the sliding refresh serializer |
| falcon-2459 | 4/5 | 4/5 | | | unstated: the test matches a deprecation message the issue never gives |
| QuantEcon-797 | 7/14 | 7/14 | | | unstated: `Timer(verbose=...)` |
| attrs-1457 | 5/14 | 5/14 | | | unstated: an internal function called with positional arguments |
| django-guardian-896 | 0/2 | 0/2 | | | unstated: the test patch's migration clashes with the agent's own |
| intelmq-2632, dag-factory-519, molecule-4534 | 0 | 0 | | | unclear (environment-looking errors) |
| dbbackup-604, Tuxemon-3068, mcp-1154, lastmile-367 | 0 or partial | same | | | wrong or incomplete fix |

## What it shows

- **Haiku stops at the first plausible fix.** Every one of its 27 attempts was a single turn; its checks (the repository's
  own tests, green before any change) passed every time.
- **Before F119 the cascade had no review at all on real repositories**: with `test: "no-checks"`, green-at-the-start checks
  counted as verification, so no tester ran (swl-cascade-notester). F119 fixed that.
- **With the review, the cascade rescued 2 issues**, and the tester caught real gaps elsewhere (pint's second example,
  a2a's boolean id), which the worker then fixed. The hidden tests failed on cases the issue only implies; the tester checks
  the request's own examples. Opus, given the same issue, covered the implied cases on 3 of 5; Sonnet alone on 1 of 5
  (pint). One run each on 5 issues: it suggests the gap is in reading what the issue implies, not in the builder's rung.
- 4 of the 16 cascade failures cannot be fixed from the issue text alone (an unstated message, argument or migration
  name). Absolute rates on this set are low for every configuration for that reason too.

## The lead (F120 to F126), 2026-11-18

One run each; costs are estimates; "error" grades (the grader broke under five parallel runs) were re-graded alone.

| Run | Version | Issues | Resolved | Est. cost |
| --- | --- | --- | --- | --- |
| swl-lead-2 | v2: plan with cases, Haiku probes, review on doubt | the 5 fixable misses | 2 | $2.72 |
| swl-lead-3, -3b, -3c | v3: plus the lead's test file as the oracle (F124) | 21 | 7 of the 20 Opus also finished (Opus alone 8, $9.40) | $15.22 on those 20 |
| swl-opus-2 | Opus alone | the other 16 | (with swl-opus-1) 8 of 20 | $9.40 |
| swl-lead-4pair | v4: no takeover (F125), report quotes code, prefer Haiku, one task | a2a-443, pint | 2 | $1.17 |
| swl-lead-5trio | v5: one-call plan and review (F126) | a2a-414, a2a-443, pint | 2 (a2a-414 failed: a rule let existing tests freeze the bug; fixed after) | $1.47 |

Lead v3 against Opus alone on the 20: it won dag-factory-519 (Opus failed), lost intelmq-2632 and pint-2194, and cost
more, mostly in recovery paths since removed: expert takeovers ($1.94 dbbackup-604, $2.12 authlib-802), a split of one
change (a2a-443), a 30-minute evidence turn (mcp-1154). On the issues both resolve, v4 and v5 cost 20 to 35 percent less
than Opus alone (a2a-443 $0.36 against $0.48; pint $0.66 and $0.83 against $1.08). The lead was tuned on the 5 fixable
misses; the next run measures the final version on all 20 unchanged.
