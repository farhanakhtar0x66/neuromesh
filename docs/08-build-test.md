# Build test: a typing-speed test for the terminal

The owner's gate before any TUI work: Neuromesh builds a whole program from
three kinds of prompt and must beat one frontier agent (Claude Opus 5.5 at
medium effort) on cost, usage and the quality of the result.

Prompts, rubric and probe: `evals/builds/`. The rubric (27 points: starts and
stops, typing, depth, robustness, engineering) was written before any app was
built. Every app was driven by `evals/builds/probe.ts` in a real 80x24 tmux
terminal with the same keystrokes, and scored from the recorded screens, its
own tests and its source. Costs are estimates at API list prices
(`src/usage/prices.ts`); nothing was paid per token. Measured 2026-11-11.

## Results

Score out of 27 · estimated API cost · wall-clock minutes.

| Configuration | One line | Detailed | Steps (`PLAN.md`) |
| --- | --- | --- | --- |
| Opus 5.5 medium alone (`solo-opus`) | 22 · $0.76 · 4 | 26.5 · $1.91 · 8 | 27 · $1.44 · 5 |
| Luna alone (`solo-luna`) | 22 · $0.01 · 3 | 6 · $0.01 · 4 (quits at once) | about 15 · $0.01 · 3 |
| Luna team, first engine (`build-factory-luna`) | stopped | 26.5 · $0.67 · 27 (Sol rebuilt it: $0.54) | not run |
| Luna team, lenient tester (`build-factory-luna-2`) | about 12 · $0.02 · 5 | about 19 · $0.01 · 4 | about 17 · $0.02 · 5 |
| **Opus lead + Luna workers (`build-opus-luna`)** | **24 · $0.58 · 16** | **27 · $0.56 · 14** | **27 · $3.49 · 26** |

"About" marks scores where a broken screen made several rubric lines hard to
judge; those apps were clearly far below the others either way.

The Opus + Luna steps build cost more than Opus alone because the Luna tester
reversed itself (show the expected letter in red, then the typed letter) and
the engine sent the task to an Opus rebuild ($2.34) although the app's own 84
tests passed. Both causes are fixed (see below); the steps build has not been
rerun since.

## What each run taught

1. **A cheap model alone does not know what to build.** Luna follows a detailed
   brief well but, from one line or even a detailed prompt, it shipped a letter
   key that switched modes mid-typing, passages wider than the screen, and an
   app that quit at once. Opus decides all of that correctly by itself.
2. **The lead engineer's plan is the cheap part of its value.** With Opus
   writing only the spec and design (one read-only turn) and Luna building,
   two of three apps matched or beat Opus alone at 30% of its cost, without
   Opus touching code.
3. **A tester that only reads code passes broken programs.** Luna's tester,
   reviewing code and unit tests, passed apps with garbled screens. Agents in
   Codex's sandbox cannot run tmux (sockets are blocked), so the engine now runs
   the program itself and hands the screens to the tester. With that, the
   tester found real problems (text cut off, Esc not quitting, typed letters in
   the wrong place) and the workers fixed them.
4. **A strict tester loops; a lenient one ships bugs.** Every review found
   something new, which ran tasks into expert rebuilds costing $0.54 to $2.34.
   Marking findings as blocker or minor alone made the tester too lenient. What
   holds: the screens as evidence, earlier findings shown to the tester (no
   reversals, open choices belong to the developer), and no expert rebuild
   when only the reviewer objects after the expert's advice was tried.
5. **Expert rebuilds are the cost cliff.** Every expensive build was a takeover
   (Sol $0.54 to $0.61, Opus $2.34). Advice turns cost $0.07 to $0.11 on Sol.
6. **Claude Code's own setup was half the price of an Opus turn.** A default
   session carries about 33k prompt tokens (tool list, MCP servers, skills)
   before the task. Neuromesh now sends only the tools a turn needs; the same
   Opus spec turn went from $0.50 to $0.24.

## Engine changes made during the test

- Brief engine (`src/intake/brief.ts`): cleans the request, attaches
  documents it names, adds working standards for the kind of work, and decides
  the staffing (plan or not, starting rung, tester, spec) with no model call.
- Spec step: for a new program, the spec writer (Opus in `factory-opus-luna`,
  Luna otherwise) writes features, exact behaviour, scope and a design.
- Screen check (`src/checks/screen.ts`): the engine runs a terminal program in
  tmux, plays generic user actions, and gives the screens to the tester.
- Checks the work creates (a new program's own tests) now gate it.
- Tester: blocker or minor findings, earlier findings shown, no reversals.
- No expert rebuild over review-only objections once advice was tried.
- Claude adapter: only the tools a turn needs; nothing from the user's setup.
- Codex usage counted per turn (resumed sessions report running totals).

## Not settled yet

- One run per configuration. Repeat runs are needed before calling a winner.
- The steps build on Opus + Luna after the fixes.
- The Luna team with Sol as lead and every fix in place (`build-factory-luna-3`
  ran with the screen check but before the review fixes; two of three apps
  again needed a Sol rebuild).
