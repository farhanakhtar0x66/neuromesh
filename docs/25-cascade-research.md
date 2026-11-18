# Towards a cascade that spends less than Opus at Opus's quality (research, 2026-11-18)

The owner's request: several cascade configurations, solutions for every failure and cost spike seen in the lead's
v1 to v5 runs, grounded in this project's own record since its first commit, the old research (neuromesh-old,
nmr-handoff, nmr-phase-2, the architecture landscape) and current published work. Nothing here is built; it is the
plan the next build follows. Numbers are estimates at API list prices, one run each, unless said otherwise.

## 1. What the record says

| Finding | Where |
| --- | --- |
| On well-specified tasks with failing checks the cascade matched Opus at a quarter of the cost (150 of 150, 3 window points against 13) | routing bench, STATUS 30, 46, 52 |
| Every delegation has a fixed start-up cost (17.5k tokens per CLI turn in the old research); delegating small things loses | doc 00, nmr-handoff v6 |
| Planning a small task costs the expert nearly as much as doing it | STATUS 3 |
| On one Claude plan Haiku is only 5 to 7 times cheaper than Opus per token, and writes far more | STATUS 23, doc 15 |
| A no-tools call costs about 94 percent less than a tool session for the same small job | F109, STATUS 52 |
| Half of every session's input is its own earlier turns re-read; command output a third of the rest | F106, STATUS 53 |
| On real repositories the checks are green before the change, so nothing climbs and reviewers approve wrong fixes | F119, STATUS 65 |
| Haiku fixes the examples an issue gives and misses the cases it implies; Opus alone covers them more often | STATUS 65, 67 |
| Recovery paths are where the money goes: takeovers $0.67 to $1.36, a split $1.03, a 30-minute probe turn | STATUS 67 |

SWE-bench-Live, 20 issues (re-graded where the grader broke):

| | Resolved | Est. cost | Per issue |
| --- | --- | --- | --- |
| Haiku alone | 3 | ~$0.6 | $0.03 |
| Opus alone | 8 | $9.40 | $0.47 |
| Cascade with F119 (21 issues, Haiku's failures) | 5 of 21 | $5.13 | $0.24, of which the Sonnet tester $0.16 |
| Lead v3 | 7 | $15.22 | $0.76 |
| Lead v4 / v5 (tuned, 3 issues) | 2 of 2 / 2 of 3 | $1.17 / $1.46 | $0.49 |

Where the lead's money went, all runs: Opus planning $0.22 to $0.79 an issue (about what Opus alone spends on the
whole issue), Opus takeovers $0.67 to $1.36, Sonnet building in big repositories $0.12 to $1.71, Haiku $0.01 to $0.22.

**The structural fact.** On these issues Opus alone already works in one efficient session (median about $0.35). A
design that pays Opus to read and plan every issue spends that much before anyone builds: it can match Opus on quality
but not undercut it. Savings come only from issues Opus never reads in a tool session at all.

## 2. What published work says

| Source | Finding | What it means here |
| --- | --- | --- |
| [Scrouting](https://arxiv.org/html/2608.04804) (SuperAGI, 2026) | A 7B scout explores the repository and writes a handoff (implicated files and lines, a reproduction replayed in a sandbox and stripped if it does not hold, dead ends). The cheapest fixer with the handoff matched Opus 4.6 alone, 159 of 266 against 158 on SWE-bench Pro Python, at $0.230 against $1.274 per solve. The no-router ablation tied the router; no learned router beat always-strongest. | The handoff, not the routing, carries the result. Reproductions are verified before they are trusted. |
| [AI21](https://www.ai21.com/blog/better-and-cheaper-together-open-models-explore-frontier-models-patch/) (2026) | Open models explore in parallel rollouts; a mid model extracts the context (functions, callers, covering tests); the frontier model writes the patch once from that brief, in one call. 80.8% on SWE-bench Pro at $5.99 a task against $18.28 for a solo Opus agent; the frontier models take 25% of the budget. Irrelevant context can steer the frontier model wrong. | The frontier model's tokens go to reasoning about the fix, not to exploring. The inverse of our lead, which spent Opus on reading and Haiku on the fix. |
| [Unified routing and cascading](https://arxiv.org/abs/2410.10347) (ICML 2025) | Cascades need a good post-hoc quality estimate; routing needs a good ex-ante one. With them, cascade routing gains up to 14% on SWE-bench. | Our cascade had no post-hoc estimate on real repositories (green checks, a reviewer that approved wrong fixes). Any design must supply one. |
| [JevCoder](https://arxiv.org/html/2610.19596) (2026) | A cheap judge detects a passing check almost perfectly (AUROC 0.990) but predicts whether a patch is right poorly (0.595). Cheap judgments of when to stop saved 21 to 51% of tokens. | Cheap models can run and read checks; they cannot be the judge of correctness. Executable oracles from a strong model are the judge. |
| [SWE-Verifier](https://arxiv.org/html/2610.30284) (2026) | A small verifier on fewer than 4% of steps raised resolution 1.7 to 1.9 points at 1.09 to 1.13 times the cost; verifying every step cost 2 to 4 times for less. | Verification pays only when it is selective. |
| [CodeRescue](https://arxiv.org/pdf/2607.19338) (2026) | After a cheap failure, a router chooses between more cheap compute and escalation from execution feedback; a calibrated point beat always-escalate at about 35% of its recovery cost (contest-style tasks). | Escalation should be a priced decision on evidence, not a reflex. |
| [Agentless](https://arxiv.org/html/2407.01489v2), [Otter](https://arxiv.org/pdf/2502.05368), [TestPrune](https://arxiv.org/pdf/2510.18270) | Reproduction tests plus regression tests select among candidate patches; reusing the issue's regression tests adds 9 to 13% relative resolution. | A verified reproduction and the existing tests near the change are the cheapest oracles. |
| [aider architect/editor](https://aider.chat/2024/09/26/architect.html) | A strong architect with a cheap editor reached top scores; some pairings did no better than the strong model alone. | Splitting reasoning from typing works when the editor only types. |

## 3. Every failure and cost spike of v1 to v5, and its remedy

| What happened | Cost | Remedy (status) |
| --- | --- | --- |
| Cascade: no tester on any real issue (green checks) | quality | F119 (built) |
| Plan froze the bug as a case (a2a -32600), twice | quality | Case rule (built); in K1 below Opus writes the fix itself, so its reading of the standard is applied directly |
| Plan missed an implied case (pint dB + dB, 2 of 4 runs) | quality | K1: Opus reasons about the fix, not about a list for someone else |
| Opus takeover after Sonnet failed | $0.67 to $1.36 | F125 (built); K1 has no takeover because Opus is the patcher |
| One change split into two tasks, Sonnet timeout, Opus advice | $1.03 | One-task rule (built); K1 has one patch |
| Opus plan reading the repository with tools | $0.35 to $0.79 | F122 + F126 (built): $0.23 to $0.33; K1 removes the plan |
| Sonnet building in big repositories | $0.12 to $1.71 | K1 has no Sonnet build; Sonnet only where K5 routes to it |
| Haiku probe turn ran 30 minutes | $0.03 + time | 8-minute cap (built) |
| Grader broke under five parallel runs | wrong scores | "error" verdict (built); at most 2 parallel runs on the 4-CPU VM |
| Lead's test file rejected: wrong Python in the image | lost oracle | K1: the scout finds and verifies how the tests run before anyone relies on it |

## 4. The candidate configurations

Expected cost per issue uses the measured prices: Haiku tool turn $0.02 to $0.10, Opus one call $0.10 to $0.33, Opus
tool session $0.18 to $1.21 (median $0.35), Sonnet build $0.12 to $1.71.

**K1. Scout explores, Opus patches in one call (the AI21 / Scrouting pattern).**
1. Haiku scout (tools, capped at 8 minutes): localises the change (files, functions, lines, quoted code), finds how
   the tests run in this environment, writes a reproduction test. Neuromesh runs the reproduction on the seed and keeps
   it only if it fails for the reported reason (F115's rule); otherwise it is dropped, not trusted.
2. Opus, one no-tools call, from the issue, the scout's dossier and the kept reproduction: the patch as search-and-replace
   edits, plus a short test file for the implied cases. It may answer "need: read X" once instead, and the scout fetches X.
3. Neuromesh applies the edits and runs the reproduction, Opus's tests and the existing tests near the change.
4. A failure goes back to Opus as one more call with the failing output (at most two); a mechanical failure
   (syntax, a missed import, formatting) goes to Haiku first.
Expected: $0.03 to $0.10 + $0.15 to $0.35 (+ $0.10 on a repair) = about $0.20 to $0.50, against Opus alone $0.35 median.
Fixes: implied cases (Opus reasons about the fix itself), frozen bugs, takeovers, splits, Sonnet costs.
Risk: a thin dossier makes Opus guess (AI21: irrelevant context misleads too). Kill rule: below Opus's resolution on
the 20 by more than 1 issue, or not at least 25% cheaper.

**K2. Lead v5 (built): Opus plans with a test file, Haiku builds against it, the cascade climbs on the test.**
Expected $0.30 to $0.85; quality near Opus on the 3 tuned issues. Best where the build is large (many files, a new
program) and Opus alone would spend $1 or more: Opus writes 1 to 2k tokens of plan and tests, Haiku writes 20k of code.
Kill rule: on large builds, not cheaper than Opus alone.

**K3. Haiku first, Opus judges, Opus-alone on rejection (a classic cascade with a frontier post-hoc estimator).**
Haiku builds with tools; Opus in one no-tools call reads the issue and the diff and says accept or reject; rejected,
Opus alone solves it (or K1). Cost = $0.05 + $0.10 + P(reject) x $0.35. It saves money only when Haiku is right on more
than about 40% of issues: true on the owner's own work (Haiku alone 28 of 29 on batch 2), false on SWE-bench-Live
(about 30%). JevCoder: judging a patch is the hard part; a frontier judge is better than a cheap one, but its
precision is unmeasured here. Kill rule: accepted patches failing hidden tests above 15%.

**K4. Best of three cheap attempts against a strong oracle (search, phase 8 of doc 22).**
Three Haiku attempts in parallel against the kept reproduction plus Opus's tests (K1 step 2 without the patch); the
first that passes wins; none passes, K1 step 2 patches. $0.10 to $0.30 + Opus tests $0.10. Only worth it where Haiku's
pass rate is 30 to 70% and the oracle is strong (Agentless, CodeMonkeys select this way). Kill rule: below K1's
resolution at no saving.

**K5. One controller choosing among them per request (the recommended system).**

| Request (decided by rules, the brief and the scout's dossier) | Path |
| --- | --- |
| Trivial or small self-contained (F121) | Haiku alone |
| A bug or change in an existing repository | K1 |
| A new program or a change across many files | K2 |
| Haiku's past record on this repository and kind of work is above about 70% (L1 record) | K3 |
| Anything that fails its path twice | Opus alone, once, with the dossier |

Scrouting's lesson applies: the routing should be simple rules plus the dossier; learned routers did not beat
always-strongest. What makes K5 work is that every path ends in an executable oracle written or verified by the
strong model, and that Opus's tokens go to the fix or the tests, never to exploring.

## 5. What "works in any situation" can honestly mean

- **Easy, well-specified work** (the owner's daily use, the routing bench): Haiku-first paths save 75 to 95%, measured.
- **Real issues in big repositories** (SWE-bench-Live): Opus alone is already about $0.35 an issue in one session. The
  best published hybrids save 65 to 80% with stronger cheap models than Haiku (Kimi K2.5 at 56% alone against Opus 4.6
  at 59%); Haiku alone is at 15% of these issues against Opus's 40%. A realistic target here is Opus's resolution at
  50 to 70% of its cost, through K1.
- **Issues every model fails** (4 of the 20 need details the issue never states): no configuration can fix them; they
  are excluded from claims and reported apart.
- The result is one run per configuration on 20 issues: a difference of one or two issues is noise (doc 22, M2).

## 6. Test plan (needs the owner's go)

1. Build K1 offline as F127 (scout dossier with a verified reproduction, Opus one-call patch with search-and-replace
   edits, apply and check, at most two repair calls), harness first, then K5's rules (F128).
2. Probe K1 on two issues (one Opus alone passed, one it failed).
3. K5 on the 20 issues, two runs in parallel at most; compare with Opus alone (8 of 20, $9.40) and lead v3.
4. If K5 is within one issue of Opus and at least 25% cheaper, run Opus alone and K5 a second time on the 20 for the
   interval; then the owner's own repositories (the usage log) for the easy-work side.
