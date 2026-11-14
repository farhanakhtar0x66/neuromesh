# Status and handoff

Kept current after every meaningful step so that work can resume in a new
session if usage runs out. Read this first, then `docs/02-v0.1-plan.md`.

## Standing instructions from the owner (2026-11-11)

- Work through M2 to M6 without asking for confirmation.
- Commit and push to `origin main` (private repo `farhanakhtar0x66/neuromesh`)
  often, including between milestones.
- Workers and testers: Gemini 3.8 Flash through Antigravity (`agy`). Gemini quota
  is plentiful; use it for all development runs.
- Expert (orchestrator, escalation) model, in this order (updated 2026-11-11):
  1. `gpt-6.1-sol` through Codex: medium effort to plan, high effort for escalations
  2. Claude Opus 5.5 at medium effort through Claude Code, only if Sol is exhausted
- Claude 4.6 through Antigravity is out: past a small free quota it needs paid
  "AI Credits". Its presets were removed.

## Where things stand

| Milestone | State |
| --- | --- |
| M0 backend conformance | Done. See `docs/03-m0-results.md`. |
| M1 single agent, prompt to applied diff | Done. 5/5 live tasks, both kill and Ctrl-C resume pass. See `docs/04-m1-results.md`. |
| M2 task suite and baselines | 20 tasks in `evals/tasks`, `neuromesh eval` done. `base-solo-flash` running. `base-solo-opus46` paused after 5/5 passes: Opus 4.6 on Antigravity hit its individual quota after ~600k tokens; rerun the same command to continue once it resets. |
| M3 orchestrator and workers | Done. Live: factory 4/4 on multi-part tasks. |
| M4 tester, repair, escalation | Done. Advice-then-takeover escalation, expert budget, tester policy. Live escalation check running (`esc-check-flash-low`). |
| M5 intake and parallel work | Done. Worker-first intake; live 4-task plan on the large shop ran two tasks in parallel (`large-factory-wf-split`). |
| M6 hardening and release | Done 2026-11-11: E1 to E5 hold (`docs/06-v0.1-results.md`), tagged `v0.1.0`. Work continues on `neuromesh-research` (experiments: brief engine, screen check, Opus as lead engineer) and `neuromesh-testing` (usage log of real runs). |

## How to resume

```bash
cd ~/Projects/neuromesh && git pull && npm install
```

```bash
npm test && npx tsc --noEmit
```

Live checks (spend Gemini quota only):

```bash
node src/cli/main.ts eval --preset solo-flash --tasks js-slugify-bug,rust-roman --name smoke
```

```bash
node evals/kill-resume.ts --signal SIGKILL
```

Run state lives in `~/.neuromesh/projects/<repo>-<id>/runs/`; eval output in
`~/.neuromesh/evals/`.

## Eval commands in use

```bash
node src/cli/main.ts eval --preset solo-flash --name base-solo-flash
```

```bash
node src/cli/main.ts eval --preset solo-opus46 --name base-solo-opus46
```

```bash
node src/cli/main.ts eval --preset factory --kinds multi --name try-factory-multi
```

```bash
node src/cli/main.ts eval compare base-solo-flash base-solo-opus46 try-factory-multi
```

Rerunning an eval command with the same `--name` continues it; tasks already
finished are skipped.

## Findings so far (2026-11-11)

1. **Claude 4.6 on Antigravity has a small quota.** Opus 4.6 stopped after 5
   tasks (about 600k tokens) with "Individual quota reached ... Resets in
   4h55m". Sonnet 4.6 shares the same pool. The expert really is the scarce
   resource, as the factory idea assumes.
2. **Gemini 3.8 Flash alone is strong on the standard tasks** (all passes so far
   apart from two Gemini 503 outages). The standard suite cannot show a team
   advantage, so four hard tasks were added (`hard-*`), each with a hidden check
   validated against a reference implementation.
3. **Planning costs nearly as much expert effort as doing small tasks.** On the
   four multi-part tasks the `factory` preset passed 4/4 with about 80k expert
   tokens per task (planning only), against about 120k for Opus doing the whole
   task alone. Every plan was a single task. The tester added about half the
   worker tokens and found nothing. Direction: worker first, with the expert
   only on escalation or genuinely large requests. To be confirmed on the hard
   tasks before changing the default.
4. **Python hidden checks were broken** (wrong import path) until commit
   `310fdc2`; evals run before that were re-scored with `neuromesh eval recheck`.
5. **The CLIs sometimes hang after finishing.** Antigravity and Codex printed
   their final event and then did not exit, so turns ran into the 30-minute
   limit and were recorded as timeouts. Fixed in `507148f`: the engine stops a
   tool 10 seconds after its final event. Together with network drops to
   Google's API (now retried once), this caused every "failure" of the first
   `solo-flash` baseline that was not a broken hidden check. Those tasks are
   being rerun with `--rerun`.
6. **Two hidden checks of mine were wrong** (Python import path; an inventory
   query that matched). Both fixed and re-scored. Hard-task checks were each
   validated against a reference implementation for that reason.
7. **Quota, as seen by the owner on 2026-11-11.** After a day of evals, Gemini
   (Antigravity) showed 87% of its weekly limit left; ChatGPT Plus (GPT-6.1 Sol)
   showed 23% weekly left. Expert quota is the binding constraint, so the expert
   baseline stays small (`hard-solo-sol`, `large-solo-sol`) and Sol is otherwise
   spent only through the factory's advice and takeover.
8. **Final baselines (after removing infrastructure faults and test bugs).**
   Gemini 3.8 Flash alone: 20/20 standard, 4/4 hard, 1/1 large, about 8-12
   minutes and 0 expert tokens per hard task. GPT-6.1 Sol alone: 4/4 hard, 1/1
   large, 1-2 minutes and 22-42k fresh expert tokens per task. On this suite
   the cheap worker is as capable as the expert, so the factory's job is to
   keep the expert idle, which worker-first routing does. Escalation has not
   been needed live; `esc-check-flash-low` runs the hard tasks with a weaker
   worker (Flash low effort) to exercise advice and takeover for real.
9. **E1 in progress:** `e1-final-1..3`, three full-suite runs of the final
   `factory-wf` (ladder, tester on), started 2026-11-11 10:47 IST. The earlier
   `e1-factory-wf-1..3` runs were stopped at about 5/25 because they measured an
   older configuration; none of their tasks had failed. To continue E1 in a new
   session, rerun the same three commands: finished tasks are skipped.

Current engine choices for `factory-wf` (all measured above): worker-first
routing, plan only clearly large requests (and then split independent parts),
two-step escalation (advice, then takeover), expert budget 250k per run,
tester only when the project has no checks, and stall protection (10-minute
idle timeout, 10-second linger after a final event, one retry on network errors).
10. **Worker ladder (owner's request, from the research's tiered effort).**
    `factory-wf` now starts every task on Gemini Flash low and climbs to Flash
    high when stuck, before the expert is asked. Being measured as
    `ladder-hard` (hard and large tasks). The E1 runs started before the ladder
    and before the tester was turned back on; they measure reliability.
11. **The tester is back on.** A low-effort worker passed the visible checks
    with a wrong cache implementation (hidden tests failed) and nothing stopped
    it. The tester runs on Gemini, the cheap quota, so it stays on.
12. **Tester value, measured.** Hard tasks with a Flash-low worker: 3/4 without
    the tester (`esc-check-flash-low`), 4/4 with it
    (`esc-check-flash-low-tester`), both with zero expert tokens.
13. **Hidden-check ambiguity again.** `hard-js-cache` required a specific count
    for a call that joins a load in progress, which the prompt never states.
    The check now accepts hit, miss or neither (at most once); results
    re-scored. The engine survived the Claude Code session quitting: evals run
    detached and kept going.
14. **Gemini has limits too.** At 11:57 IST all three parallel E1 runs paused:
    Antigravity said "Your AI credits balance is too low to continue" for both
    Gemini rungs. The engine paused cleanly (zero engine failures, no lost
    work). E1 now runs one eval at a time through `evals/until-done.ts`, which
    waits out cooldowns between quota windows:

    ```bash
    node evals/until-done.ts --preset factory-wf e1-final-1 e1-final-2 e1-final-3
    ```

    It was started detached at 11:58 IST (log in the session scratchpad). If it
    is not running, start it again with the command above; finished tasks are
    skipped. After E1 finishes, re-score with
    `node src/cli/main.ts eval recheck e1-final-1 e1-final-2 e1-final-3`
    (a running eval overwrites re-scores made while it runs).
15. **Cost in one unit (2026-11-11, afternoon).** Evals are now priced at API list
    prices (`src/usage/prices.ts`). GPT-6.1 Sol alone costs about $0.10 per hard
    task; `factory-wf` costs $0.70 to $0.82. The factory wins only on subscription
    quota, not on API cost. See "Cost in one unit" in `docs/06-v0.1-results.md`.

16. **GPT-6 Luna is the cheap worker the prices predicted (2026-11-11, 13:30 to
    14:00 IST).** Luna alone (`solo-luna`, Codex, medium effort): 25/25 on the
    full suite, estimated $0.004 per task, 22 minutes for all 25. Hard tasks:
    4/4 twice at $0.004 against Sol alone at $0.102. `factory-luna` (Luna low,
    then high, Luna tester, Sol expert): hard 4/4 at $0.012 per task (12% of Sol
    alone), large 1/1 at $0.094 of which the Sol plan is $0.058. The Luna tester
    rejected two changes that passed the visible checks; both were fixed. So the
    cost goal is met on this suite, and the suite is too easy to tell models
    apart: a harder benchmark is the main missing piece. Evals:
    `hard-solo-luna`, `base-solo-luna`, `hl-factory-luna`.

17. **Default preset is now `factory-luna` (owner's decision, 2026-11-11 14:10
    IST).** The Gemini E1 (`e1-final-1..3`) was stopped unfinished: 10 tasks
    passed, 0 engine failures. E1 now runs on the Luna team as `e1-luna-1..3`.
    Experiments with models and efforts go on the `neuromesh-research` branch.
    Before any TUI work the owner wants one more test: build a typing-speed
    test for the terminal with three prompt styles (one line, detailed, a .md of
    steps) and beat a single Claude Opus 5.5 medium agent on cost and quality.
    A deterministic brief engine that improves the prompt and picks the
    staffing comes first.

18. **The TUI, redesigned to the owner's sketch (2026-11-12).** Layered panes in
    the terminal's own colours (or transparent), projects and recents on the
    left, one box per agent in the middle with verbosity none/medium/full, the
    agent graph, context and changes on the right, mouse everywhere, and the
    final report rendered as markdown. Normal mode asks before the plan and the
    expert (F39); Turbo goes ahead. Features F32 to F47; `docs/11-tui.md`.
    Checked with the demo preset only; no live run through the TUI yet.
    Then its own look (the neuromesh-dark theme, titled frames instead of
    opencode-like shaded panels) and follow-ups that continue a session from
    the earlier run's result (F48, F49).

19. **v0.2.0 released and the repository public (2026-11-12).** Testers install
    the `neuromesh-testing` build (`install.sh`). Since then:
    - on macOS, Claude Code, Antigravity and opencode run under a write
      sandbox (F53), checked live on all three;
    - opencode now runs with `--standalone`, because its background service
      had been working in the wrong folder;
    - CI runs the type-check and the tests on Linux and macOS;
    - `main` and `neuromesh-testing` are protected from force-pushes and
      deletion.

20. **First real TUI run cost three times Opus alone (2026-11-12).** The
    python-bot build: 83% of the Opus cost was one takeover that rebuilt from
    an empty folder, set off by a package the worker's sandbox could not
    install. Causes, replays and the six changes: `docs/12-python-bot-run.md`.

21. **logstat, Neuromesh against Opus alone (2026-11-12).** First live run with
    F54 to F63, on `factory-opus-haiku`: 27/27 on a hidden battery against
    26/27 (25/27 on Python 3.9) for Opus alone, at about half the estimated
    cost ($0.23 against $0.43; Opus share 40%) and five times the time. Both
    moved the 5-hour quota by 1%. Bytecode in the diff, found there, is fixed.
    `docs/13-logstat-benchmark.md`.

22. **SiteWatch against GPT-6 Astra; plan-first building (2026-11-12).** Both
    13/13 on end-to-end scenarios at about the same cost ($0.80 against $0.73);
    Neuromesh's cost was one long Haiku session past Haiku's 100K price tier.
    Now Opus's spec turn plans small tasks (F65), workers can ask for a split
    (F68), sessions past 90K start fresh (F67), long calls are priced right
    (F66), and a revoked login pauses (F64). `docs/14-sitewatch-and-plan-first.md`.

23. **Bookshelf TUI: Neuromesh used 9 points of the 5-hour quota, Opus alone 5
    (2026-11-12).** Opus's app was also better: closest match and duplicates.
    Measured across runs, Haiku is only about 5 to 7 times cheaper than Opus per
    token on the Claude quota, not 40 times, and it wrote 220k tokens. So Opus
    and Haiku on one Claude plan cannot beat Opus alone; the worker needs its
    own plan (Luna). Engine fixes: expert parts go to a worker when the budget
    cannot pay (F69); a stopped turn keeps its usage (F70); a planned build is
    reviewed once, as a whole (F71); the usage log records quota (F72).
    `docs/15-bookshelf-run.md`.

24. **Fault harness (2026-11-12).** `evals/chaos.ts` runs seeded random runs
    against agents that misbehave, with the engine process killed and resumed
    as one of the faults, and checks rules every run must keep. The first 320
    seeds broke a rule 39 times. Fixed: an endless checks loop after a failed
    expert fix; a task built beside another being tested without the other's
    work and sent to the expert (F75); a crashing adapter (F74); damaged work
    folders (F73); a turn hung by a program the tool left running (F76); and
    more. Since then 1,620 ordinary and 400 kill-and-resume seeds kept every
    rule. `docs/16-fault-harness.md`.

25. **Benchmark against single Opus (2026-11-13, started).** Eight tasks with
    hidden checks, three of them the owner's own build prompts with scored
    batteries; the eval reads quota around each task and can build from a
    frozen spec to test one role at a time. First number: single Opus built
    the expense tracker to 33/33 in 1.7 minutes for about $0.44. The run then
    hit the 5-hour limit, used up mostly by the working session itself. F77
    direct-build (one-answer workers, no tools) is built and not yet tried
    live. `docs/17-benchmark.md`.
26. **The hard task (2026-11-13).** `hard-py-minidb`: a pure-Python SQL engine
    checked on 197 cases against the real SQLite. Three tiers by difficulty
    (F78: Opus plans and builds the hardest part, Sonnet the moderate parts,
    Haiku the routine ones) passed it 197/197 in 49 minutes on the first full
    run. Engine faults it exposed and that are fixed: a spec plan over the task
    limit was thrown away, thinking was not counted until the next message, and
    review findings went to the cheapest worker whatever file they were in
    (F79). Fable alone has not finished a run yet. See `docs/18-hard-task.md`.
27. **The routing cascade (2026-11-14, branch `neuromesh-routing`).** The
    owner's five-tier routing architecture, mapped onto the engine: Tier 0
    picks the starting tier with no model call (F80, F81); a grunt tier gated
    only by checks (F82); worker and senior turns that judge the task first and
    are stopped at once when it is beyond them (F83); the expert advises from
    the stuck developer's own diagnosis (F84), writes the blueprint and builds
    nothing (F85), and sees at most two tasks per run (F86); the run's measured
    tier mix and overhead (F87); and a shadow sample graded on request (F88).
    Preset `cascade`. See `docs/19-cascade.md`.
28. **Routing benchmark, first live run (2026-11-14).** The owner's 15-prompt
    suite, Claude only: `cascade-claude` against Opus alone. Quality matched
    (Gap@Oracle 0.8%, waste 1.4%), but CostSave was 64.9% (target 65%), 77.8%
    weighted (target 80%), and the five-hour window moved 10 points against
    13. The expert's 6.5K-token plan on 4.1, a gate false alarm on 4.2, and a
    Tier 0 that never picks the grunt (trap 5.2 failed) are the gaps. See
    `docs/20-routing-benchmark.md`.
29. **Fixes from the benchmark (2026-11-14), not yet re-run.** Tier 0 scores
    the instruction, not pasted material, and sends inline transforms to the
    grunt (F89; starting tier right on 11 of 15, was 6), which answers them with
    no tools (F90). The gate trusts `escalate: false` above 0.55 (F91), and the
    expert's blueprint is capped by its brief (F92).
30. **Routing benchmark, clean cascade re-run (2026-11-14, `rb-cascade-2`).**
    Every target met against the first Opus baseline: CostSave 74.7% (84.9%
    weighted), Gap@Oracle 0.8%, WCTR 0.7%, all three traps survived, 3 points
    of a clean five-hour window against Opus's 13 (contaminated). Open: the
    sandwich still costs as much as Opus on 4.1 (Opus wrote 836 words against
    a 400-word brief). See `evals/routing-bench/REPORT.md`.
31. **Senior first for a small expert request (F93, 2026-11-14).** The sandwich
    only runs for a large, many-part request; anything else Tier 0 sends to the
    expert (4.1) starts on Sonnet, and Opus advises on escalation. Not re-run
    live. The cascade is merged into `neuromesh-testing` (preset
    `cascade-claude`) to be judged on real use.
32. **Breadth, scope and stubs (F94 to F96, 2026-11-14), from a friend's
    review.** A short new build spanning 3+ subsystems with no code file named
    goes to the expert's plan (F94); the unplanned developer can say "needs a
    design first" and the expert divides the task (F96); stand-ins such as
    `unimplemented!()` fail the checks (F95). Checked offline on 4 broad prompts
    and 3 decoys written outside the project; the 15 benchmark prompts route as
    before. Not run live (owner's choice). The one live question is whether
    Sonnet uses `scope: true`; one run of the agent prompt with
    `--disable subsystem-breadth` would show it.
33. **A resumed first turn keeps its preamble (F97, 2026-11-14).** The first
    live F96 check was paused by a revoked Claude login; on resume Sonnet's turn
    became a "continue" turn with no preamble, so it built the 5-module agent
    alone ($0.14, tests passed, rated 4) without being asked about scope. Added
    to the fault harness (4 of 300 seeds broke it), then fixed.
34. **First live F96 run, and one review per split build (F98, 2026-11-14).**
    With F94 off, Sonnet answered `scope: true` (329 output tokens), Opus split
    the agent request into 4 parts, Haiku built them: 19 files, 117 tests
    passing, ≈$0.53 against $0.14 for Sonnet alone without the question.
    Per-part Sonnet reviews were $0.22 of it and found no blocker; F98 reviews
    a planned or split cascade build once, at the end. Not re-run live.
35. **Incremental edits on the F96 build, and F99 (2026-11-14).** Two Haiku
    turns on `~/Projects/scope-test-2` ($0.012, $0.032) folded evicted turns
    into Notes and then bounded them (20 entries, 2,000 characters; held under
    a 500-turn stress check). Tier 0 sent both to the worker with no expert. The
    second request exposed an F89 false positive: a sentence after "In
    <file>:" with numbers was taken as data. F99 fixes it; the friend's ringbuf
    example now routes to the expert again, benchmark routes unchanged.
36. **`main` brought up to `neuromesh-testing` (2026-11-14).** A fast-forward
    of 80 commits: F54 to F99, the fault harness, the logstat and routing
    benchmarks. `neuromesh-research` had nothing of its own. Defaults are
    unchanged (`factory-opus-luna`); the cascade is the opt-in preset
    `cascade-claude`, still experimental. Not yet measured on real use, and
    so still on trial although in `main`: F93 to F99 (only F96 has one live
    run), and F95 and F97, which apply to every preset. The cascade numbers are
    one run per configuration against a contaminated Opus baseline. Not
    tagged as a release.

37. **A friend's phase-2 review, and F100 to F104 (2026-11-14, on
    `neuromesh-research`).** Read against the code, two of its four upgrades
    were partly there already (F12 is the repository map, F81 the calibration
    loop), and its token argument does not fit the benchmark (the prompts
    start in empty folders). Built from what held up: per-task line ranges
    (F100), tests written without seeing the code, bounded to one cheap turn
    when the test itself is wrong (F101), two side-by-side repairs before a
    dearer tier (F102), the calibration table overruling a confident match
    (F103), and cheap turns moving to another plan when the Claude window is
    low (F104, preset `cascade-hybrid`). All checked on the fake backend and
    the fault harness only; none run live. See `docs/21-phase-2-review.md`.

## Next steps

0a. F100 to F104 are on `neuromesh-research` and unmeasured. The four live
   checks, cheapest first, are at the end of `docs/21-phase-2-review.md`; the
   one that answers the review's main claim is `scope-test-2` with blind
   tests on. They stay off `neuromesh-testing` until at least that one is run.
0. Next: the order of work in `docs/17-benchmark.md` (finish the single-Opus
   baseline, Haiku alone, plan-first, then one-answer workers on the same
   specs). Run it from a short session on Opus 5.5, idle while an eval runs.
   Before changing the engine, run `node evals/chaos.ts --seeds 1000` and
   `--kill 1 --seeds 400`.
1. Done 2026-11-12: the telemetry endpoint is live at
   `https://neuromesh-telemetry.farhanakhtar.workers.dev` (checked end to end;
   requests without keys are refused). `neuromesh telemetry pull` reads it.
2. Live runs through the TUI on real work (the owner's usage log), then
   testers' reports: read them together (`neuromesh telemetry pull`) and pick
   the defaults from the data.
3. Repeat the typing-app build test three times per configuration, including
   the step-list prompt since the review fixes.
4. A harder benchmark: tasks Luna fails alone, so that escalation and the
   tester can be shown to earn their cost.
5. A write sandbox on Linux (bubblewrap), where only Codex is confined today.
