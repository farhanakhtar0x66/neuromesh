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
