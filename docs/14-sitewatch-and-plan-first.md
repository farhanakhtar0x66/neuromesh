# SiteWatch against GPT-6 Astra, and plan-first building

## The comparison (2026-11-12)

Prompt (the owner's): a Python bot that checks websites every few minutes,
reports price and text changes, keeps old and new versions, and survives sites
being down or the internet dropping.

| | Neuromesh (`factory-opus-haiku`) | GPT-6 Astra medium alone (Codex) |
| --- | --- | --- |
| Quota | Claude Pro: 6% of 5 hours, 1% of the week | ChatGPT: 7% of 5 hours, 2% of the week |
| Estimated API cost | about $0.80 (the run showed $0.36; see below) | about $0.73 (7k output, 218k cached input) |
| Time | 16 minutes | 3.5 minutes |
| 13 end-to-end scenarios | 13/13 | 13/13 |
| Real sites (books.toscrape.com, python.org) | correct, no false change | correct, no false change |
| Size | about 1,150 lines, 100 tests, README | 271 lines, 18 tests, README |
| Dependencies | requests, beautifulsoup4 | standard library only |
| Notable | parsed price changes with the difference and percent; any CSS selector; says "offline" | sites checked at the same time; raw pages kept and exportable; only simple selectors |

The scenarios (scratchpad `sw_e2e2.py`, `ww_e2e.py`) ran local sites that
change price and text, refuse connections, return 500 and hang, then cut the
internet through a dead proxy, then ran each tool continuously for 99 seconds.

A tie on cost and on what was asked; Neuromesh's tool was more thorough, Astra
was five times faster.

## Where Neuromesh's usage went

Per-turn quota readings: the Opus spec moved the 5-hour window by about 1
point; the Haiku build by about 5. The build was one Haiku session at high
effort: 48 model calls, about 81k thinking tokens, and a prompt that passed
100K tokens on 30 calls. The repair and the review fix resumed that session
at 150K to 165K. Haiku 5.5 charges five times as much for a call over 100K
prompt tokens, which the cost table did not know: the build showed $0.14 and
cost about $0.49.

The expert was not the cost. Handing the whole program to one cheap session was.

## What changed (F64 to F68)

- **F65 spec-plan.** For a new program, Opus's spec turn also splits the build
  into 2 to 5 tasks of about 300 lines each, with owned files and build order,
  and marks any part it should build itself. No extra planning turn. Small tasks
  start on the first worker rung (Haiku medium, not high). Acceptance runs move
  to the last task, when the program is whole.
- **F68 split-ask.** A worker that finds its task too big for one session, or
  too hard to get right, answers "split". Opus divides it, building any part
  that needs deep reasoning itself before the parts that depend on it; the
  worker's code so far is kept. Once per task.
- **F67 session-cap.** A session whose prompt passed 90K tokens is not resumed;
  the next turn starts fresh from the brief and what went wrong.
- **F66 tier-pricing.** Claude Code calls over 100K prompt tokens are priced at
  the model's long-context rate.
- **F64 auth-pause.** A revoked or expired login pauses the run with a sign-in
  hint (it used to skip the spec, call the expert on the same dead login, and fail).

The deterministic brief engine still decides staffing first: small changes,
fixes and refactors never reach Opus.

Checked with the fake backend only (162 tests). Next: the same SiteWatch prompt
again, in a fresh folder, against these numbers.
