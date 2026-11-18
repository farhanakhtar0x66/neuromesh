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
    the fault harness only; none run live. The harness's kill sweep found two
    defects in the blind step (paid twice after a kill; a copy left behind),
    fixed; then 1,000 ordinary and 400 kill seeds kept every rule. See
    `docs/21-phase-2-review.md`.

38. **First live check of F100 and F101 (2026-11-14).** `scope-test-2`,
    the Notes request, twice. As first built, the blind tester misread how
    the code is called (15 of its 22 tests wrong, one developer turn spent
    correcting them) and did not catch the unbounded Notes, which the request
    leaves open. Now it is shown the tests that were there before the work,
    and may raise one open question that never gates: in the second run its
    ordinary tests passed at once and it asked whether Notes should be
    capped. One run each. The builder's own notes had said the same; the
    summary cuts them short. See `docs/21-phase-2-review.md`.
39. **The path to the goal (2026-11-14).** A plan, nothing built: nine
    tracks, about seventy items, and nine phases, each with its question, its
    approach step by step, the decisions to make first, its budget of live
    calls, its gate and what to do if the gate is missed; then what would
    make it a breakthrough and what would make the plan wrong. It starts with
    a benchmark that can tell configurations apart (40 tasks from real
    commits, three runs each, a frozen Opus baseline).
    `docs/22-path-to-the-goal.md`.

40. **The plan corrected to the cascade (2026-11-14, evening).** Doc 22 was
    first written around the factory presets and Luna. The owner's work
    since 2026-11-13 is all on `cascade-claude`, and its clean benchmark run
    is the strongest result so far. The plan now takes the cascade as the
    system, Haiku alone as the cheap baseline, and starts by finishing what
    the routing report left open (a clean Opus baseline, two more cascade
    runs, Haiku alone); cutting start-up tokens is brought forward. The
    owner then made `cascade-claude` the default preset on this branch
    (`DEFAULT_PRESET`, `CLAUDE.md`, the README, the TUI's favourites);
    `main` and `neuromesh-testing` still default to `factory-opus-luna`
    until this branch is merged.

41. **Handoff and checklist (2026-11-14).** `HANDOFF.md` at the root is
    where a new agent starts: what the project is for, the cascade, what not
    to judge it by, and the next steps in order. Doc 22 has a checklist of
    what the evidence lacks (checkers that run code, a held-out prompt set,
    repeat runs, real repositories) and a beta-release track. The owner's
    installed `neuromesh` now runs `neuromesh-research`.

42. **Checkers that run the code, four of five (2026-11-15, plan item M9).**
    The hidden checkers for 2.1, 2.3, 3.1 and 3.2 now run the answer instead
    of matching keywords (no model calls). 2.1 sends the endpoint signed,
    unsigned, foreign-signed and tampered webhooks (FastAPI is not installed
    here, so `hidden/fastapi_shim.py` stands in). 2.3 runs the test file
    against twelve correct implementations (the prompt leaves open what a
    negative does, what "total" means and how odd paise are rounded) and
    needs it to fail on eleven broken ones; `hidden/shim/pytest.py` stands in
    for pytest. 3.1 runs the hook under a stand-in for React's hooks, a fake
    clock and a slow/fast API, and replays the bug in the prompt. 3.2 calls
    `allocate` on generated orders and batches and compares with plain FIFO,
    then times 30,000 against 30,000. The prompt for 3.2 gives no code and no
    data format, so that checker is tolerant about both; it grades the
    allocation, not the structure of the returned dict. Every reference still
    scores full marks and an empty folder fails (`validate.sh`). Rescoring
    the saved `rb-frontier-1` and `rb-cascade-2` answers: every answer to
    these four prompts passes in full, in both runs, so the cascade's 148.8
    of 150 becomes 150 of 150 (the 8.8 on 2.3 was the old rubric). Read it as
    a ceiling: on these prompts the benchmark cannot tell the two apart.
    **3.3 is not done**: the migration needs a real Postgres (the answers use
    plpgsql triggers, `SKIP LOCKED`, `CONCURRENTLY`), and none is installed
    here; it stays on its rubric until one is.

43. **D6, M5, M2 and L1 built (2026-11-15; F105 to F108).** No model calls.
    F105 `choices-shown` (D6): a developer's report has `choices` and `open`
    fields, kept whole and shown in full in the CLI summary and the TUI.
    F106 `input-split` (M5): a Claude turn's input in five parts (start-up,
    Neuromesh's prompt, files read, command output, the model's earlier
    output), estimated from the kept log; in the turn's usage, the TUI meter
    and `bench --split`, which also reads older runs' logs. On the saved
    Opus+Haiku build evals, start-up plus prompt is 57 to 74 percent of the
    input; files read are under 1 percent. F107 `paired-bootstrap` (M2):
    `bench --compare a1,a2,a3 b1,b2,b3 --margin d`. The saved evals all pass
    every task, so it reports a ceiling, not a margin: the old suite cannot
    tell the configurations apart. F108 `run-record` (L1): one append-only
    record at `~/.neuromesh/record/record.jsonl`, written live and backfilled
    (95 runs, 308 results, 6 ratings from the saved runs), asked with
    `node src/record/cli.ts`. Each is one commit; the engine changes passed
    `npm test`, chaos 1000 seeds and kill 400 seeds. None is measured on a
    live run yet: F106's split in particular is worth checking on the next
    real Claude run, against `--split` on its log.

44. **The held-out 15 (2026-11-15; plan item 3).** No model calls, no
    router change. `evals/routing-bench/held-out/` holds H1.1 to H5.3, written
    outside this repository in the same five groups as the original 15 plus
    three new traps (a prose-wrapped numeric spec, a multi-buzzword decoy, an
    impossible lock upgrade). Each has a checker that runs the code (Python,
    Node, `cargo test --release`) and a reference answer; `validate.sh` now
    covers both sets: all 30 references pass in full and all 30 empty folders
    fail. The Raft checker was also run on two broken simulators and fails
    both. `routes.ts` prints Table A (tuned on) and Table B (held-out), each
    with its own count. Tier 0 starts 11 of 15 on an expected tier on A and 8
    of 15 on B, recorded untouched in `evals/routing-bench/HELD_OUT_ROUTES.md`;
    the trap H5.2 is missed (a three-row table starts on the senior). One
    measurement of the router, with expected tiers written before it ran.
    `run.ts` and `score.ts` do not run the held-out set yet (H5.2's rule, no
    spend on senior or expert, is only in its `task.json`). Summary:
    `docs/23-offline-phase1-report.md`.

45. **The runner and scorer know the held-out set (2026-11-15).** No model
    calls, no router change. `run.ts --set original|held-out|all` (default
    `original`, so existing commands are unchanged) and `--config haiku` (the
    `solo-haiku` preset, Haiku alone); each record says which set it is from.
    `score.ts` sorts and weights both sets' ids and scores the trap rules of
    whichever set is present: 5.1, 5.2, 5.3 and H5.1, H5.2, H5.3, where H5.2
    passes only with every turn on the grunt or worker and no turn or dollar
    on the senior or expert. `rescore.ts` finds held-out checkers. `bench
    --compare` takes routing-bench run names as well as eval names (score =
    share of hidden items passed, keyed by prompt id). The record backfill tags
    each result `original` or `held-out`. Checked end to end on the fake
    backend: both sets and Haiku-alone ran, scored, compared and backfilled;
    the fake runs were then deleted. Live commands: HANDOFF step 1.

46. **Phase 1 step 0 and the held-out baseline, live; then an audit
    (2026-11-15).** The owner ran `rb-frontier-2`, `rb-cascade-3`,
    `rb-cascade-4`, `rb-haiku-1`, `ho-frontier-1`, `ho-cascade-1` and
    `ho-haiku-1`. The first scores had answers that looked right failing; each
    was traced to the saved answer, with no model calls, and every time the
    checker had assumed something the prompt does not say (a private attribute
    of my reference, a rounding variant, a positional fetcher, the shape of a
    list, an empty string, what a count means, a heap size, a division, two
    timing assumptions in the Raft test). Eight defects, listed in the report,
    all fixed by widening what counts as correct; all runs rescored. Also:
    `bench --compare` counts a failed task as 0.0 instead of dropping it and
    takes routing-bench run names; `bench --split` reads routing-bench runs;
    H5.2 passes with no senior or expert turn or spend and the table right
    (6 of 7 or more), whatever the path is called; H5.3 passes if the gate
    stops Tier 2 or Tier 2 scores full marks; the record backfill adds a
    rescored result as a new line (the old one stays) and `results` shows the
    newest. Result: cascade 150.0, 147.9, 146.7 against Opus 150.0, 147.9;
    Haiku alone 142.0; held-out 150.0, 150.0, 140.0. The suite does not separate
    the cascade from Haiku alone, and the cascade fails the H5.2 trap, as Tier
    0's route predicted. Table and detail: `evals/routing-bench/REPORT.md`.
    The lesson: a checker validated only against its own reference is not
    validated; the live answers found what `validate.sh` could not.

47. **F109 `direct-worker` (plan item C1, 2026-11-15).** No model calls.
    F106 showed what a tool turn costs on the live cascade runs: start-up
    plus prompt 42 to 50 percent of the input and the model's own earlier
    turns 47 to 55 percent, 95 to 1,033 thousand tokens a worker turn, against
    about 4 thousand for one no-tools call (the grunt on formatting prompts).
    F90 gave the grunt that path; F77 gave it to planned parts only in presets
    that set `direct`. Now, in the cascade, a task on a worker rung that has
    not been escalated or advised is answered in one no-tools call when (1) it
    is the whole request and `src/routing/selfcontained.ts` says it is small
    and self-contained (at most 100 words and 2 named files, a small project,
    nothing to run, install or look at, no explanation, derivation or
    complexity bound asked for): the build only, and failing checks go to a
    worker with tools; or (2) it is a part the expert planned and it has a
    spec: F77's build and one repair. An unusable answer gives the worker its
    tools. `router.ts` and `brief.ts` are untouched (Rule 7): this decides how
    a turn already on a worker rung is run, not where it starts. Offline, on
    the 30 routing prompts, the worker-tier ones it takes are 2.1, 2.2, 2.3, 3.1
    and 5.1, and H1.3 and H5.1; 4.3 and 5.3 stay on tools (a derivation, a
    complexity bound), and so do the held-out prompts of 100 words or more. Known trade: a no-tools turn has no
    preamble, so the early-exit gate does not see it; the judgement and
    complexity-bound cues keep a request that may be impossible on tools.
    `--disable direct-worker` as before. Fault harness: seed 38 broke "a task's
    tier only goes up" through a chain fallback that stopped on quota (a
    senior model tried, no work done, then a race at the worker tier after
    the resume); that rule now ignores quota-stopped attempts. Kill rule, to
    check on the next live run (`bench --split` for tokens, the traps for the
    gate): if resolution on the routing prompts falls by more than the
    interval, or tokens per prompt do not fall, it goes off by default. The
    held-out set is not tuned on: it measures this.

48. **M1 task harnesses (2026-11-15, plan items M1 and M9 for real tasks).**
    No model calls. `node evals/make-task.ts --repo <path or url> --commit
    <hash> --name <name> --runner node|pytest|cargo --test-cmd "<cmd>"`
    turns a real change into a task folder: `seed/` (the parent commit),
    `prompt.md` (the commit message, or `--prompt`; read it for leaks),
    `hidden/` (the tests the change came with, a grader and `spec.json` with
    the fail-to-pass and pass-to-pass lists), `reference/` (the change's other
    files and deletions, and a patch). The lists come from running the
    project's tests on the seed and on the reference. `node
    evals/validate-task.ts <dir>` checks, with no model: every fail-to-pass
    test fails on the seed, every pass-to-pass passes; on the reference all
    pass, in each of 3 runs in fresh copies, and no test changes its result
    between runs. The grader (`evals/real-task/grade.ts`, copied into each
    task as `hidden/grade.ts`) reads node --test (TAP), pytest and cargo test.
    Tested end to end on a small synthetic git repository, including a
    reference that does not fix it, a seed that already passes, and a flaky
    test. Not yet run on a real repository; the task folders are in the
    shape `evals/tasks` already uses, so `neuromesh eval` can read them.

49. **F109 on its first live run: it never fired, a wiring bug (2026-11-16).**
    No model calls. The owner ran `rb-cascade-5` and `ho-cascade-2` with F109
    on. On the seven prompts it was meant to take (2.1, 2.2, 2.3, 3.1, 5.1,
    H1.3, H5.1) there is no `task.direct` event in any run's log and every
    task ran as before: a tool session, a confidence preamble, 4 to 14 calls.
    Cause: `directWorker` handed `selfContained()` the engine's `state.prompt`,
    which is the request with the brief's "Working standards" block appended
    (a near-empty workspace counts as greenfield). That text is 182 words for
    2.1's 44-word request and contains "install", so the check refused it on
    length and on the observation cue. The user's own words are in
    `state.request`; the check now reads those. The unit tests missed it
    because their projects were not empty, so the brief added no standards;
    a new test uses a near-empty project and fails on the old line. The tokens
    in the two runs say nothing about F109's merit: the same prompts, a
    tool session both times. On the five original prompts the input was 795k
    (rb-cascade-5) against 1,018k (rb-cascade-3); on H1.3 and H5.1 it was 315k
    (ho-cascade-2) against 222k (ho-cascade-1); the 7 prompts together 1,110k
    against 1,241k, which is run-to-run spread (each task moved by 20 to 80
    percent either way). The run totals, 1,370k and 2,953k, are the whole
    suite, F109 or not. H1.3's rise (136k to 242k) is a Claude Code failure
    on a tool turn, `error_max_structured_output_retries`, after which the
    climb ran the same Haiku again (the same error as ho-haiku-1's H2.3),
    not a no-tools turn. So the kill rule is not yet applicable: it needs a run
    in which F109 fires, and the default stays on, as the exception in the
    owner's instruction allows (F109 was never invoked). Also found: the 3.1
    checker passed the positional fetcher as a new function on every render,
    which a hook that lists the fetcher among its effect's dependencies, as
    its own comment tells callers to avoid, re-runs on each render; one
    function now serves the whole run. rb-cascade-5's 3.1 was 9/14 and is 14/14;
    its other misses (4.1, 4.2, 4.3) are rubric items. ho-cascade-2 scores
    150.0 and rb-cascade-5 146.8, as the cascade runs before them.

50. **M1: the first batch of real tasks, and a batch builder (2026-11-16).** No
    model calls. `evals/make-batch.ts evals/real-tasks/batch-1.json` builds
    and validates ten tasks from commits in `~/Projects/neuromesh` (8) and
    `~/Projects/scope-test-2` (2): five bugs and five features, TypeScript
    and JavaScript. All ten are valid under `validate-task.ts`: the
    fail-to-pass tests fail on the seed, everything named passes on the
    reference in each of 3 fresh runs, no test flips. The recipe is
    committed (`batch-1.json`, `prompts/`); the folders are made from it and
    ignored. Not a benchmark yet: Haiku alone has not been run on them (no
    difficulty mix), there is no refactor, Python or Rust task, eight of the
    ten share one repository (no split by repository), and the prompts are
    unreviewed by a second reader. Details and the table:
    `evals/real-tasks/README.md`. `tsconfig.json` leaves generated task
    folders and the routing-bench task folders out of the type-check.

51. **Real tasks run through the eval runner; prompt audit; batch-2 survey (2026-11-16).**
    No model calls. (1) The ten prompts were re-read against each reference
    diff and test; five details the tests do not assert were cut (a 5-second
    floor and unit list, a 30-minute default, the "; " join, which other
    errors are retried, the check and acceptance runs' environment). (2) `neuromesh
    eval --suite evals/real-tasks --preset <preset> --name <n>` runs the real
    tasks on any preset and grades them with each task's hidden grader; it
    already took `--suite`, and now takes `--fake` (every build turn writes the
    task's reference, so the harness is tested end to end for free) and a task's
    `checks` (written to the seed's `neuromesh.json`: a seed has no `node_modules`,
    so detection would choose a type-check that cannot run and the whole slow
    suite). `validate-task.ts` now also requires that check to pass on the
    seed. Each eval result is appended to `record.jsonl` as it happens
    (F108; the backfill makes the same line, so nothing is recorded twice).
    Checked with `--fake` on solo-haiku, cascade-claude and solo-opus: every
    task passes its grader, 3 runs, the record has one line each. (3) Where
    batch 2 can come from: `evals/real-tasks/BATCH-2.md`. Of 30-odd local
    repositories only neuromesh and scope-test-2 have tests that run offline;
    ProofBench's ten Rust fixtures run offline and are the next source; the
    rest (anpasser, droidtui, edgemed, JalNet) need a network once and hold the
    real refactor commits; refactors can otherwise only be written, not mined.

52. **F109 `direct-worker` kept: rb-cascade-6 (2026-11-16).** No model calls
    in the audit. With the wiring fixed (STATUS 49), the owner ran the
    routing suite once (`rb-cascade-6`). F109 fired on the five prompts it
    should take, each with one `task.direct` event, no preamble and no tools:
    2.1, 2.2, 2.3, 3.1 and 5.1 went from 43 calls and 794.7k input tokens
    (`rb-cascade-5`) to 8 calls and 46.3k, minus 94.2 percent, every one
    10.0 of 10 (50 of 50). 4.3 and 5.3 stayed on tools with their preamble
    (a derivation, a complexity bound), and the 5.3 early-exit gate still
    stopped the worker. Whole suite: 84 to 54 calls, input 1,370k to 969k
    (the first run under a million), 147.8 of 150 against 147.9 (4.2, a
    rubric item, is 7.8; Gap@Oracle 0.1 percent), WCTR 1.0 percent, all three
    traps held, CostSave 82.3 percent ($0.6866 against $3.8746; 87.1
    weighted), five-hour window 6 percent against 21 for Opus alone. The kill
    rule (resolution down by more than the interval, or tokens not down) is
    not met: F109 stays on by default. One run, and what it has not shown:
    all five passed on the first no-tools turn, so the repair path (a failing
    check after the one-answer turn, then a worker with tools) was not
    exercised; the held-out set has not been re-run with F109 (H1.3 and H5.1
    are its targets, H5.2 its trap); the five prompts are small. Where the
    tokens are now: 4.3 alone is 633k of 969k, 65 percent of the suite, 18
    calls, 67 percent the model's own earlier turns: the next lever is a
    worker turn's history (C2 and C7), not start-up.

53. **Why Haiku's turns fail structured output, and where the 2M tokens go (2026-11-16).**
    No model calls; from the kept logs. (1) `error_max_structured_output_retries`:
    of 394 kept Claude turns that used the StructuredOutput tool, 79 (20 percent) had at
    least one rejection ("Output does not match required schema: root: must have
    required property 'notes' / 'run' / 'choices' / 'open'"); 74 recovered (55 after one
    rejection, 8 after two, 6 after three, 5 after four) and 5 failed after the fifth,
    which is Claude Code's cap. The model sends the core fields and leaves out the string
    fields it thinks are empty. Counted per mention there are 221 missing-property mentions
    (corrected on 2026-11-16; this entry first said 192): 172 at the top level of the report
    (notes 70, choices 49, open 37, run 16), 46 in blind-test items (open 23, question 23) and 3
    other (status 1, findings 2); two more rejections were an invented extra property.
    `choices` and `open` at the top level are 86 of the 221 (39 percent). The failures
    triggered climbs in ho-cascade-2 H1.3 and H3.2 (the task climbed to the same Haiku on a
    "worker error"), and ended ho-haiku-1 H2.3 and the two resumed repairs here. It is not tied to `--resume` (3 of the 5 were
    first turns) or to long turns (17 to 28 calls, like the others). In the failed turns
    the work and the report were done: the last attempted report had `status: done` and a
    summary. One log shows the model reading the error as "the empty run value breaks
    parsing" and deleting more fields. Cost: the 134 rejected calls carry 4.39M of 56.1M
    tokens (7.8 percent) in the 405 kept Claude attempts; the 5 failed turns 1.53M tokens
    and 276 s, and one of them (ho-haiku-1 H2.3, solo, no ladder) lost its task. Fix:
    F110 (STATUS 54): the schemas ask for less, and the last attempt is taken as the answer. (2) The 2.05M
    tokens of nm-first-turn-retry: one turn, 33 model calls, context growing from 14k to
    95k, so 2.0M is calls times context, not a loop: no command was repeated in any of the
    ten tasks' turns, test runs 1 to 7, never a failing one repeated. By F106 the 34 calls
    read start-up 18 percent, prompt 5, files 0, command output 29, earlier turns 48. A
    call ceiling would have cut working turns (the edits ran to call 34) and Haiku's 2.05M
    tokens cost about $0.056, so escalating to a dearer tier would cost more: no loop
    signature to trigger on. The levers are fewer calls (the ten Edit uses were already batched, in three
    parallel groups inside model calls 15, 20 and 26, and only one was a single line;
    the two slow test files were run four times, plus a full `npm test` and two `tsc`
    attempts: corrected 2026-11-16, this entry first said ten single-line Edit calls and three
    runs) and smaller results re-read on every call (107k characters of tool output in
    the turn, one of 12.9k). Across the ten tasks: 217 calls,
    9.75M input, 49 percent earlier turns. (3) `make-batch --prompts terse` builds the ten
    tasks with 28 to 42 word prompts (`evals/real-tasks/prompts-terse/`); all ten validate.

54. **F110 `structured-rescue` built (2026-11-16).** No model calls. From STATUS 53:
    the tool ends a turn with `error_max_structured_output_retries` when a model leaves
    out a string field it thinks is empty, after the work is done. Harness first: a new
    per-turn fault (a report or one-answer turn ends with that error and a last attempt
    with `status` and `summary` only), and two tests of what the code did before:
    a cascade climbed a rung for it, a solo task failed (`failure: agent`, "worker
    error: error_max_structured_output_retries") with its work merged into the run's
    folder. Before F110 both sweeps ran with the fault (61 of 1000 seeds took the
    failure; 20 failed runs of 1000, 12 of 400). Then: (1) the report schema requires
    `status` and `summary`, the one-answer schema `files` and `summary`, a blind test
    `path` and `content`; the other fields stay in the schemas and the prompts'
    wording, and the verdict's `findings` and every other schema are as before; (2)
    the Claude adapter keeps the input of the last StructuredOutput call
    (`AgentResult.lastStructured`), and `once()` takes it as the answer when the turn
    ended with that error and `rescueStructured` says the parser would accept it (a
    non-blank summary for a report; a usable file for a one-answer turn), keeping only the
    schema's keys, with a `structured.rescued` event tagged F110 that lists the fields
    left out; anything else ends as before. One place differs from the request: the
    adapter only stores the attempt, and the engine does the rescue, because the
    parsers and the event log are the engine's, a backend must not import them, and the
    fake backend the fault harness uses has to take the same path. `--disable
    structured-rescue` gives every old schema and the old failure; `NEUROMESH_FAULT=
    structured-rescue` fails the rescue, which switches the feature off and ends the turn
    as before. A new harness rule: with F110 on, no attempt may end in that error. After:
    `tsc` clean, 306 of 306 tests, chaos 1000 seeds clean (986 finished, 14 failed; 59 seeds
    rescued; the one seed that still ends a turn in the error is a scenario with F110 switched off, the only place the new rule allows it) and kill 400
    clean (16 rescued). Two harness rules were widened on the way: a chain fallback that
    stopped on a revoked login or an unavailable model did no work and is not the task
    going up a rung (seed 38, which the new fault's draws moved onto). Not measured live:
    the kept logs say 134 rejected calls carried 4.39M of 56.1M tokens and 5 turns were
    lost; check on the next live run with `node` over the kept logs (the script of STATUS
    53's reading) and the `structured.rescued` events. One thing to watch: whether the
    model still fills `choices` and `open` now that they are not required (Haiku filled
    `choices` 101 of 101 and `open` 95 of 101 while they were).

55. **Beta week 1, telemetry and first run (2026-11-16; offline, fake backend, no live calls).**
   The telemetry path works end to end against the live endpoint
   (`https://neuromesh-telemetry.farhanakhtar.workers.dev`): a fake-backend run, its
   rating and both reports went from a fresh `NEUROMESH_HOME` to the endpoint (201,
   outbox emptied) and `telemetry pull` returned them (22 reports then, 20 of them the
   owner's own 0.2.0 and 0.3.0 runs). Found and fixed (F111): one refused report blocked
   every later one for good; a waiting report never said why; `pull` stopped at 1,000;
   a wrong admin token printed "401" and nothing else. New: `neuromesh telemetry summary`
   reads the week (runs by preset, rating spread, bad runs by kind, failed features, five
   lowest-rated). First run (F112): with no Claude Code a run spent five retries and an
   escalation and ended in "execvp() of 'claude' failed" with `resume` offered; now it
   stops before starting and says where to get Claude Code. `doctor` says how to fix a
   missing tool and whether the default preset is ready; the TUI's "not a git
   repository" message no longer loses its instruction to the screen edge; the rating keys
   are in the composer hint. Not changed, and worth the owner's eye: on a 42-row terminal
   the Apply and rate row of a finished run is below the fold of a long final report.

56. **Batch 2 of real tasks: 29 candidates, built offline (2026-11-16).** No model calls. `evals/real-tasks-2/`
    (README, MANIFEST). Ten ProofBench Rust fixtures through the new `evals/import-fixture.ts` (seed = workspace
    without `tests/` and `target/`, plus a `.gitignore` for `target/`; six fixtures ship no `solution/`, so their
    references are hand-written in `references/`); 17 neuromesh commits (bugs and features, 2 to 17 source files,
    batch 1's commits skipped), prompts written from the commit with the solution left out; and two synthetic
    refactors (`nm-split-payload`, `ss2-notes-module`; `make-batch.ts` now builds an entry with `synthetic: {base,
    patch}` from a patch, and marks it so). All 29 validate (3 runs), and `neuromesh eval --suite evals/real-tasks-2
    --fake` passes 29/29; `npx tsc --noEmit` and `npm test` (306) are clean. Short of the 45 asked for: the sources
    are exhausted (scope-test-2 has no commit left, the neuromesh history has about 17 mid-size commits with a
    failing-before test, the rest are 1,000-line milestones; the blocked repositories are the way to the rest).
    Found on the way: (1) a Rust seed without `.gitignore` for `target/` makes every task conflict at merge (the
    engine's own checks leave an untracked `target/`); fixed in the importer. (2) The ProofBench seeds name the bug
    in comments, so they are the floor of the mix, not a test of finding bugs. (3) On the seed, the engine tests of `nm-expert-budget`, `nm-two-step-escalation` and `nm-worker-ladder` loop instead of failing (they ran to the 10-minute grader limit): their spec now has `timeoutSec: 60`, so a seed or a wrong answer fails in 60 seconds; every other seed fails in 35 seconds or less. (4) One project check was wrong
    after a correct solution (the old test's expectations change with the default of `advise`); that task checks
    `test/pieces.test.ts` instead. Haiku's difficulty is guessed (about 59 percent overall, about 43 without the
    ProofBench ten); the live run `rt2-haiku-1` is what sets it.

57. **F100 to F104 judged offline: F101 off by default (2026-11-17).** No model
    calls. Audit of 285 kept runs (195 bench, 90 owner; 29 fake-backend runs left out):

    | Feature | Fired | Cost (estimate) | Outcome | Decision |
    | --- | --- | --- | --- | --- |
    | F100 start-here | 11 live | under $0.001 | first read hit a listed file 7 of 10 | kept, on |
    | F101 blind-tests | 83 live turns | ~7% of cascade-claude cost, 27% on solo presets | caught no bug a later check confirmed; helped 1 arguably, hurt 3 (a wrong test in ss2-notes-bound; empty results in nm-stub-scanner and nm-first-turn-retry) | **off by default**, code kept |
    | F102 repair-race | 0 | 0 | never fired | kept, on, unmeasured |
    | F103 evidence-override | 0 | 0 | never fired (needs 5 tries in one cell) | kept, on, unmeasured |
    | F104 quota-shift | 0 | 0 | never fired; its one preset (`cascade-hybrid`) targets Luna | kept, on, unmeasured; preset marked stale |

    F101 is switched on with `--enable blind-tests`, `NEUROMESH_ENABLE=blind-tests` or
    `"enable": ["blind-tests"]` in a preset (new: `defaultOff` in `src/features.ts`); a
    disable wins, and a resumed run keeps what it started with. Re-measure it on
    `evals/real-tasks-2` with it on.

58. **F114 `short-output` built (2026-11-17; offline, fake backend, no live calls).**
    Plan item C7. Command output is re-read on every later model call of a turn: in the
    2.05M-token turn (`nm-first-turn-retry`) 29 percent of the input was command output
    (107k characters; one result 12.9k, test runs 5 to 13k each). Now `nm run -- <command...>`
    (the F13 tool) runs the command (`sh -c`, 5-minute limit), saves all of it to a log in the
    system temp folder (never in the repository) and shows `exit <code>`, the log path and,
    when over 2,000 characters, the failure lines (fail, error, panic, assert, expected,
    not ok, ✗, ×; one line of context each; at most 40), the first 15 and last 25 lines,
    about 3,000 characters, and how many lines were left out. `nm checks --only <file>`
    runs one test file through node --test (the package's own flags), `cargo test <name>`
    or pytest; elsewhere it says so and runs all. The `nm-tools` prompt gets two short lines
    (run long commands through these; one test file while iterating, the full checks once
    at the end; batch related edits). Both `nm checks` and `nm run` now put stderr and
    stdout in one stream for a whole compound command (`exec 2>&1`), not only its last part.
    **Not measured live.** Judge it on the next routing run by input tokens per prompt:
    4.3 is the target (633k of 969k input). Off with `--disable short-output`: the tool
    still works, no prompt mentions it.

59. **F115 `reproduce-first` built, off by default (2026-11-17).** Plan item O1 (docs/22, Track O). Offline: no model
    calls. For a request the brief calls a bug fix, before the first build turn, one cheap turn (the preset's cheapest
    worker model, low effort, with tools) writes ONE new test file that reproduces the reported bug. The engine runs
    only that file and keeps it only if it FAILS on the current code and not with a syntax, name or import error; it
    then stays in the work, its command joins the task's checks, the build prompt gets "A test reproducing the bug is
    at <path>; make it pass without weakening it.", and a build that edits it has it put back (`reproduce.restored`).
    A test that passes on the seed, cannot load, came with a changed source file, has no runner, or an unusable answer
    is discarded (`reproduce.tests` event, outcome says which) and the task goes on as if the feature were off. At most
    one turn per task, attempt kind `reproduce`; not for grunt-tier tasks or no-tools direct answers. The code is in
    `src/engine/reproduce.ts` and `reproduceStep`/`reproduceGuard` in `src/engine/run.ts`; tests in
    `test/reproduce.test.ts`; the fault harness draws a bug request in a fifth of its seeds and makes the reproduce
    turn crash, hang, return garbage, name an existing file, write a test that passes or cannot load, or change code
    (`test/support/chaos.ts`).

    How to measure (live; says so before it is run, it spends quota): the 12 bug tasks of `evals/real-tasks-2` with it
    on, against the plain cascade run on the same tasks:

        neuromesh eval --suite evals/real-tasks-2 --kinds bug --preset cascade-claude --enable reproduce-first --name rt2-cascade-repro-1

    Read from each task's events: how many fired (`reproduce.tests` outcomes: accepted, passed-on-seed, load-error,
    touched-code, not-a-failure, no-runner, none, turn-failed), the cost of the `reproduce` turns, and resolved or not
    against the plain run. The risk to look for is the one the plan names: an accepted test that is wrong gates the task
    (the build must make it pass), so a wrong test that fails for a plausible reason costs repairs and may climb.
    Known limits: (1) the trigger is the brief's kind, not the suite's label. Run offline on the suite's prompts, the
    brief calls 7 of the 12 bug tasks "bug" (nm-resume-usage-totals, nm-linger-plan-fail, nm-blind-resume,
    pb-checksum-lint and pb-normalizer-lint come out "feature" or "other") and also calls three feature-labelled tasks
    (nm-expert-patch, nm-two-step-escalation, nm-worker-ladder) "bug"; `--kinds bug` selects by label, so compare the
    tasks where it fired, not only the label. (2) Only the whole request as one task gets one. (3) The runner comes
    from the project's files (node:test, vitest, jest, mocha, pytest or unittest, cargo `tests/*.rs`); otherwise the
    writer's own command is used if it starts with a known runner and has no shell syntax. (4) A kept test that the
    build cannot satisfy is not dropped (unlike F101): it fails the task like any check.


60. **Graders left looping tests running (2026-11-17; eval tooling, not the engine).** After batch 2 was built,
    87 processes were still running, some of them for up to four and a half hours (load average about 100): `node --test` runners
    from the seeds of nm-expert-budget, nm-two-step-escalation and nm-worker-ladder, whose tests loop on the seed.
    `evals/real-task/grade.ts` and `evals/validate-task.ts` used `spawnSync`'s `timeout`, which signals only the shell; the runner under
    it lived on as an orphan. Now `shGroup` (grade.ts) runs the command in its own process group (`set -m`) and kills the whole group at the
    limit and when the command ends; `test/grade-timeout.test.ts` shows the old way leaving two loops and the new way none.
    nm-worker-ladder revalidated in 70 s with no process left. The 49 built copies of `hidden/grade.ts` were replaced in place.
    The engine's own checks were already safe (`src/backends/proc.ts` kills the group). Found before `rt2-haiku-1` started, so its
    grading runs on the fixed grader.


61. **`rt2-haiku-1`: Haiku alone passes 28 of 29 of batch 2 (2026-11-17; one run, live).** `solo-haiku` on `evals/real-tasks-2`,
    est. $1.12 at list prices, 6 points of the five-hour window, 2 of the weekly, 86 minutes of work, 0 engine failures
    (`evals/real-tasks-2/RESULTS.md`). The one miss is nm-split-payload (19 of 20 hidden tests). The ten ProofBench tasks were each
    answered in one call in 12 to 25 s. **Batch 2 is too easy to tell presets apart** (doc 22 phase 1 wants Haiku at 40 to 70
    percent), as batch 1 was: the cascade and Opus are not run on it. Keep nm-split-payload and look at the hardest few by tokens
    (nm-two-step-escalation, nm-worker-ladder, nm-senior-first-expert, over 2.3M each) for the final mix; batch 3 has to carry the
    difficulty. The night's run was interrupted twice: the network dropped (eight tasks recorded as failed with 0 tokens after 18 to
    24 minutes each; their entries were removed and redone, the old file kept as `results.before-network-redo.json`, see 62) and the
    machine restarted; re-running the same name continued where it stopped.


62. **F116 `network-pause` (2026-11-17; engine, offline).** A lost network was recorded as the model's failure: in `rt2-haiku-1` eight
    tasks failed with `ECONNREFUSED` and 0 tokens. Added to the fault harness first: an `offline` fault, and a run whose network goes for
    good from one call on (8 percent of seeds, their own dice); the rule that a lost network never fails a run or a task broke on 4 of
    300 seeds, one of them a task sent to the expert on a dead network. Fix: `ECONNREFUSED` and the DNS errors join the one-retry list;
    a turn that still cannot reach its service pauses the run ("check the network, then resume"), as F64 does for a lost login; all
    twelve stop checks go through `held()`. A stall or a 5xx is unchanged. npm test 361/361; 1000 seeds (26 paused) and kill 400 clean.

63. **Batch 3 baselines, why the cascade lost, F117 and F118 (2026-11-17).** `rt3-haiku-1`: 8 of 10, est. $1.40, 4 five-hour
    points, 64 minutes; it failed `em-hospital-lan` (0/1) and `em-unix-targets` (7/8). `rt3-cascade-1` (cascade-claude as it was): 7 of
    10, est. $2.86, 37 points (inflated: the advisor and four task-building sessions shared the window), 39 minutes; it rescued
    `em-unix-targets` and lost two tasks Haiku alone passed. Read from the runs' events: (1) **an-com-demand**: Haiku at medium gave
    confidence 0.45 and the F83 gate sent the task a whole tier up, past Haiku high, to Sonnet medium; Sonnet's patch command began
    with `cat > /tmp/p.py` waiting on stdin, hung, went to the background and never ran; the turn reported done (describing a test it had
    not written) and the engine accepted a 0-byte diff (14/15 is the seed's own score). (2) **an-leaf-effects**: Opus planned two tasks;
    the worker left `.venv` without pytest, the check exited 127, the engine dropped it as "cannot run here", both tasks and the final
    step ran no check and the Sonnet-medium part failed a hidden test. (3) Every cascade model ran at medium: Sonnet thought about 1k
    reasoning tokens a turn against solo Haiku high's 25k. Fixes, harness first: a `lostTool` damage (the work breaks the tool a
    check runs through) and two rules (no run passes with its checks dropped; no task passes with no change after one turn); both broke
    on today's engine (6 and 7 of 1000 seeds). **F117 `empty-done`**: a turn that ends with no change at all is asked once whether its
    edits landed; still blocked and empty, the task fails. **F118 `keep-checks`**: a check that ran at the baseline and is unavailable
    later counts as failed with a note, not dropped; and a task that never reached its checks no longer counts as passing them (the
    harness found F86 keeping a failed, unchecked task as "the checks pass"). **Preset**: cascade-claude's worker is Haiku high (one
    rung), senior Sonnet high (one rung), tester Sonnet high, worker gate 0.4 (was medium then high, medium then high, medium, 0.55);
    Opus stays medium and plans only. Batches 2 and 3 cannot measure this (Haiku passes them): the measure is the hard set
    (`evals/hard-tasks/DESIGN.md`): 12 tasks built by four Sonnet sessions and merged, all valid in this checkout. npm test 361/361; 1000 seeds and kill 400 clean.

64. **The hard set measured; SWE-bench-Live added (2026-11-17).** `hd-haiku-1` (solo-haiku, high): **9 of 12**, est. $1.16,
    4 five-hour points, 50 minutes; its three failures were near-misses (regex 452/453, chunked-csv 110/111, streaming-stats
    86/88). The design aimed at 2 to 5: synthetic, well-specified tasks of a few hundred lines no longer separate Haiku 5.5 at
    high effort from the frontier. `hd-cascade-1` (cascade-claude after STATUS 63): **11 of 12**, est. $3.12, 17 points (the
    advisor's own turns shared the window), 50 minutes, 0 engine failures: it turned all three near-misses into passes (one by
    Haiku, two by Sonnet) and lost `hd-py-ledger-cents` (32/35), which it gave to the same Haiku high in one 1-minute turn that
    solo Haiku passed: one run each, so a flip of one task either way is noise. One task paused mid-run when the Claude CLI's
    OAuth token was revoked (F64 paused it correctly; the eval summary called it "quota": a labelling bug to fix). Opus alone
    was skipped (owner's call: on a set Haiku passes 9 of 12 it shows little, and the weekly window was at 66 percent).
    Next measure: **SWE-bench-Live** (`evals/swe-live/`, MIT): real issues from June to September 2025, each in its own x86
    Docker image (a colima profile `swe` with Rosetta), the agent working on the host with a runner that executes commands in
    the image, the official harness as the hidden check, validated with the gold patch (seed fails, gold passes twice).
    31 instances from 25 repositories are being imported; the first 8 are all valid, grading in 26 to 153 s.
65. **SWE-bench-Live measured; F119 green-checks (2026-11-18).** 27 valid issues (4 of 31 rejected: two privacyidea, whose
    gradings outrun the eval's 10-minute hidden check or whose gold fails; pyinstaller, gold fails; braindecode, image pull
    failed). Five issues need a name the issue never states; they got an interface note (`interfaces.json`, as SWE-bench Pro
    does). `swl-haiku-1`: **8 of 27** (9 with the notes), est. $1.61, every attempt one turn. The first cascade run had **no
    tester on any issue**: the repositories' own tests pass before any change, and with `test: "no-checks"` they counted as
    verification. **F119 green-checks** (harness first: a green-start scenario, seed 387): checks that all passed at the
    baseline no longer stand in for the review, except for a refactor or a trivial request. `swl-cascade-1` with F119, on
    Haiku's 19 failures plus 2 of its passes: **5 of 21** (2 rescues: PyPSA, openai-agents-1633; both Haiku passes kept),
    est. $5.13, 0 engine failures, no escalation anywhere: the tester passed each final fix. Its 16 failures, read from the
    harness's own test logs: 4 need details the issue never gives (a deprecation message, an argument, an internal call, a
    migration name), 3 look environmental, 9 are wrong or incomplete fixes. On 5 of those 9, Opus alone (`swl-opus-1`)
    resolved **3** (est. $3.36) and Sonnet alone (`swl-sonnet-1`) **1** (est. $1.10). The tester did catch gaps (pint's
    second example, a2a's boolean id) and the worker fixed them; the hidden tests failed on cases the issue only implies.
    One run each on 5 issues, so a lead, not a finding: the gap is in reading what the issue implies, not in the builder's
    rung. Proposal for the owner: an expert step for bug and feature requests in an existing repository that lists the
    cases the request implies (acceptance cases), for the worker to build and the tester to check, at one short Opus turn
    per request. Results: `evals/swe-live/RESULTS.md`. Weekly window at 75 percent after these runs. Also fixed: the eval
    summary named every pause "quota"; it now says quota, sign-in or network (STATUS 64).
66. **The lead, built and not yet measured (2026-11-18; F120 to F123, preset `lead-claude`, `docs/24-lead.md`).** The
    owner's idea: a cheap model deciding first on a hard task decides badly. Opus leads and works only where it decides:
    a trivial or small self-contained request goes to Haiku alone with no model call to decide (F121); on a repository
    of more than 150 files Haiku first writes a report for the request (F122); Opus plans from it under about 700 words,
    with the acceptance cases (implied ones too) and a developer per task, grunt, worker, senior or itself (F120); after
    the build Haiku writes a probe per case and Neuromesh runs every probe again in its sandbox, so all holding plus
    passing checks accepts with no Opus turn, and anything else gets Opus's read-only review from that evidence, with
    follow-ups for whom it chooses, at most two rounds (F123). No Opus session is kept open while the team works; no
    separate tester. The lessons it applies are tabled in doc 24 (STATUS 3, 20, 23, 47, 53, 63, 65; docs 00 and 15).
    Harness first: a quarter of the scenarios lead; rules for review rounds, the review copy, calm work being checked,
    triage, and evidence acceptance; it found a review counted twice across a retry (rule), an Opus follow-up in
    blueprint mode (now the senior's), and a pause before the review re-running the evidence (now kept per round).
    chaos 1000 and kill 400 keep every rule; 366 of 366 tests. Sandboxed probes reach the Docker runner (checked offline:
    exit codes pass through). The first live attempt (before F121 to F123) paused on a revoked Claude login after one
    issue's plan and build. Test plan in doc 24, waiting for the owner's go.
67. **The lead measured and repaired, v2 to v5 (2026-11-18; F124 to F126; `evals/swe-live/RESULTS.md`).** Each live run
    found a crack, fixed harness first: the plan froze current behaviour as a case (a2a: -32600 for an unknown method,
    twice: once from a report on the code as it is, once because existing tests asserted it); F124 the lead writes its
    cases as a test file, kept only if it fails on the old code, which gates the build so the cascade climbs against a
    real oracle; F125 no expert takeover (they cost $0.90 to $2.12 an issue and saved nothing Opus alone did not); one
    change is one task (a split made a 4-cent Haiku pass cost $1.03); F126 one-call plan and review from a report that
    quotes the code (plan $0.35 to $0.52 down to $0.23 to $0.33); the evidence turn capped at 8 minutes. Eval: a hidden
    check that times out or prints nothing is now "error", not a failed task (five parallel runs broke the grader; 4 of
    7 such "fails" resolved when re-graded alone). Scoreboard on 20 issues: Opus alone 8 at $9.40, lead v3 7 at $15.22,
    Haiku alone 3. v4 and v5 on the issues both resolve cost 20 to 35 percent less than Opus alone, on 3 issues the
    lead was tuned on. Next: the final version on all 20, unchanged, once the five-hour window resets (95 percent).
68. **Research, K1 and K5 built, K1 measured (2026-11-18 and 19; docs/25, F127, F128).** The research (doc 25: the
    record since the first commit, the v1 to v5 cost spikes, Scrouting, AI21, routing and cascading, JevCoder,
    SWE-Verifier, CodeRescue) led to K1: Haiku scouts with a verified reproduction, Opus writes the patch in one call
    with no tools. Built harness first; the harness also gained a rule that every event prints (a K1 event crashed the
    CLI printer and failed both issues of the first probe as engine failures), and engine errors now log their stack.
    Measured on 21 issues: **2 of 21 at est. $5.74, against Opus alone 8 at $9.40**: cheaper per issue, far worse. Most
    first patches passed every visible check (existing tests, the scout's reproduction) and were accepted; the hidden
    tests failed. One-call patching without tools is not Opus's quality on real repositories; a cheap model's
    reproduction is not an oracle for implied cases. K5 (auto) routes repository changes to K1, so it is not run.
69. **K6, the dossier then Opus's own session (2026-11-19; F129, preset `dossier-claude`).** K1's scout writes the dossier
    and a kept reproduction; Opus then fixes the request in a normal tool session that opens with the dossier. On the two
    issues where K1 failed hardest and Opus alone passed: **2 of 2**, est. $1.57 against Opus alone's $1.69. black $0.88
    against $1.21 (Opus re-read 861k tokens instead of 1.51M); a2a-443 $0.69 against $0.48 (Opus read more than alone).
    Quality held; the saving is within the noise of one run on two issues.
70. **K6 helpers and the final design (2026-11-19; F130, F131, docs/26).** The gate (F130, no model call) gives a dossier
    only to a big repository whose request does not name code it defines; the scout pre-runs the reproduction and
    nearest tests; the expert checks only what it changed. On 4 issues Opus alone passed: 3 of 4 at est. $2.07 against
    $2.29; black down to $0.79 (Opus re-read 792k tokens against 1.51M alone). The loss (openai-1633) was the dossier's
    "root cause" and a mandatory reproduction steering Opus to the scout's reading; F131 makes the dossier facts only
    and the reproduction advice, and the rerun passes ($0.49). Opus's sessions never used the nm tool and their outputs
    were already short: its cost is the number of calls (24 on black), each re-reading the whole session. Final design
    in docs/26; trials A (Opus with the dossier) and B (Sonnet with the dossier) on the 21 issues decide Sonnet's place.

## Next steps

0a. F100 to F104 are on `neuromesh-research`. F100 and F101 have one live
   run each way; F102 to F104 none. The remaining live checks are at the end
   of `docs/21-phase-2-review.md`. The order of work from here is
   `docs/22-path-to-the-goal.md`, phase 1: a suite the cheap worker fails
   alone.
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
