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

## K1, patch-lead (F127), 2026-11-19

`swl-k1-a` and `swl-k1-b`, preset `patch-claude`, on the 21 issues with Opus-alone results: **2 of 21** (dbbackup-601,
electrum-10172) at est. $5.74, against Opus alone 8 of 21 at $9.40 and Haiku alone 3. K1 lost six of Opus's wins
(a2a-414, a2a-443, intelmq, openai-1633, pint, black). On most issues Opus's first one-call patch passed every check
there was (the existing tests and the scout's reproduction, kept on 16 of 21) and was accepted after one call; the
hidden tests then failed. The scout's reproduction tests what Haiku understood of the issue, so it is a weak oracle;
an Opus call with no tools cannot run the tests or read further, where Opus alone does both (a2a-443: all 25 target
tests pass, other tests broken). The published hybrids this followed used a cheap fixer nearly as strong as the
frontier model (Scrouting) or many rollouts and a trained context extractor (AI21).

## The final trial: K6 with Opus (A) and with Sonnet (B), 2026-11-19

`swl-trialA` (`dossier-claude`, F121 to F131) and `swl-trialB` (`dossier-sonnet`, the same with Sonnet as the solver), on
the 21 issues, run side by side. No engine failures and no broken grades. Opus alone (`swl-opus-1`, `swl-opus-2`, with
intelmq and electrum re-graded) did not finish PyPSA-1310, so the comparison is on the other 20; PyPSA passed in both
trials (Sonnet $1.08; Opus's cost there is unknown, 3.9M tokens re-read in 63 calls).

| Issue | Opus alone | A: Opus + dossier | B: Sonnet + dossier | Dossier |
| --- | --- | --- | --- | --- |
| dbbackup-601 | pass $0.26 | pass $0.28 | pass $0.12 | skipped (small) |
| a2a-443 | pass $0.48 | pass $0.66 | pass $0.28 | yes |
| intelmq-2632 | pass $0.69 | pass $0.81 | pass $0.29 | skipped (named) |
| black-4720 | pass $1.21 | pass $0.90 | pass $0.41 | yes |
| electrum-10172 | pass $0.26 | pass $0.44 | pass $0.15 | yes |
| a2a-414 | pass $0.54 | fail $0.50 | fail $0.18 | yes |
| pint-2194 | pass $1.08 | fail $0.89 | fail $0.41 | yes |
| openai-1633 | pass $0.34 | fail $0.43 | fail $0.17 | yes |
| the other 12 | fail $4.54 | fail $4.87 | fail $2.17 | |
| **20 issues** | **8, $9.40** | **5, $9.78** | **5, $4.18** | |

- **A does not beat Opus alone**: three fewer issues at slightly more cost. The dossier still cut Opus's work where the
  search is big (black: 821k tokens re-read in 22 calls against 1.51M in 36; pint 679k against 1.11M), but on issues
  without a dossier Opus inside Neuromesh made more calls than alone (dbbackup-601 11 against 7, lastmile 21 against 16,
  electrum 10 against 7).
- **B resolved exactly what A resolved, at 43% of A's cost.** Inside this pipeline the solver's model made no difference
  on these 20; something both share held them back.
- **What both share and Opus alone did not have: the brief's working standards.** Opus alone ran with no brief; A and B
  received three bug standards, one of them "keep the change small; behaviour the request does not mention must stay as
  it is". The three issues lost (a2a-414, pint, openai-1633) are the ones whose hidden tests check cases the issue only
  implies (see the cascade section). F132 removes the standards from the solver's prompt on K6.

### F132 on the three issues lost (`swl-f132-lost3`, `swl-f132-opus-lost3`)

| Issue | Opus alone | A (with standards) | Sonnet + dossier, F132 | Opus + dossier, F132 |
| --- | --- | --- | --- | --- |
| a2a-414 | 2/2 $0.54 | 1/2 | 0/2 $0.17 | **2/2** $0.54 |
| pint-2194 | 2/2 $1.08 | 1/2 | 1/2 $0.57 | **2/2** $1.23 |
| openai-1633 | 1/1 $0.34 | 0/1 | 0/1 $0.30 | **1/1** $0.52 |

Without the standards Opus resolves all three, at about Opus alone's cost; Sonnet resolves none. So the standards cost
Opus the implied cases, and Sonnet's gap is its own. `swl-trialA2` reruns A with F132 on all 21.

### Trial A2: Opus + dossier + F132 on all 21 (`swl-trialA2`)

8 of 21 (PyPSA included). electrum-10172 did not run: the Claude CLI was signed out mid-run (the engine paused it,
as it should). On the 19 issues both Opus alone and A2 ran: **Opus alone 7, $9.14; A2 7, $8.91** (Haiku's dossiers
included). The same 7 resolved (dbbackup-601, a2a-414, a2a-443, intelmq, pint, openai-1633, black), plus PyPSA, which
Opus alone did not finish. Opus re-read less where the search is big (black 756k against 1.51M, lastmile 194k against
453k, mcp-1154 339k against 570k) and more on pint (1.40M against 1.11M) and molecule. Quality now matches Opus
alone; the saving is 2.5%, within the noise of one run.
