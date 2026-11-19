# Plan: start a project on Flash, hand the repository to Opus with a facts file

Written 2026-11-19. A plan; nothing in it is built. Plan ids (S1, S2, ...) become feature ids (F133 on) when built.

## What it is for

The owner has a $20 Claude plan and a Google AI Pro subscription, which gives Gemini 3.8 Flash through Antigravity
(`agy`) on a separate, much larger quota. The aim is useful, not a benchmark: start real projects cheaply, then keep
working on them with Opus in Claude Code, spending the Claude windows on decisions and hard work only.

Two phases:

1. **Start** (Neuromesh): Opus or Sonnet decides what to build, in executable form; Flash builds it until the checks
   pass; Opus or Sonnet reviews once. Then Neuromesh writes a facts file for the repository.
2. **Continue** (Claude Code, or `solo-opus`): Opus works on the started repository alone. Claude Code loads
   `CLAUDE.md` by itself, so the facts file is read at no extra call; Codex and opencode read `AGENTS.md`.

## Facts this rests on (from the measurements, `HANDOFF.md`)

- Judgement handed between models lost quality every time; facts handed over did not. Prose plans built by a cheap
  model dropped implied cases (lead v2 to v5); worker rules given to the solver cost it 3 of 8 wins (F132).
- A cheaper model's verdict is not a gate; executable checks are.
- Opus's cost is its number of calls times the session it re-reads. A facts file that removes exploration calls
  saves (black: 36 calls to 22, 1.51M to 0.76M tokens re-read).
- Haiku draws from the same Claude windows as Opus at about 1/6 of Opus's rate, not 1/40; tokens moved to Flash
  leave the Claude windows entirely.
- Flash alone passed 20/20 standard, 4/4 hard and 1/1 large tasks of the first suite, 8 to 12 minutes per hard task
  (`docs/STATUS.md`, "Findings so far", 2 and 8); that suite was easy for every model. Gemini quota has run out
  before ("Your AI credits balance is too low", STATUS 14), and Flash has returned 503 "No capacity available" for
  long stretches; the engine pauses cleanly on both.
- `agy` headless: `--mode accept-edits` denies every shell command; commands need a session-only allow rule through
  `--settings` and then run unsandboxed; a denied action still ends SUCCESS with an empty response
  (`src/backends/antigravity.ts`).
- Building blocks that exist: spec step and expert spec (F02, F03), facts before the spec (F63), Opus plans the build
  in the spec turn (F65), acceptance runs (F58), one whole-build review (F71), one-answer workers (F77), the lead's
  test file as the oracle (F124), direct no-tool calls (F126), per-rung providers in a preset's ladder, quota shift
  (F104), the dossier scout and its facts-only rules (F127, F131).

## Phase 1: the start

| Step | Who | What | Claude window |
| --- | --- | --- | --- |
| 1. Brief and route | rules, no model | the brief engine reads the request; Tier 0 picks Sonnet (a small or familiar build) or Opus (several domains, a protocol, concurrency) as the decider | none |
| 2. Decide | Sonnet or Opus, one call | a short spec, the module layout with interfaces, and **acceptance tests as files** (the decisions in executable form), plus the test command | one call |
| 3. Build | Flash, tools | builds each part until the decider's tests and its own pass; the engine runs the checks after every turn | none |
| 4. Climb | Haiku, then Sonnet | a part whose tests still fail after N Flash turns (N = 3 to start) moves up a rung, as the cascade does | only if needed |
| 5. Review | the decider, one call, no tools | sees the diff summary and the test results, not the session; accepts, or answers with **more tests** (never prose instructions), which go back to step 3 | one call per round, at most 2 rounds |
| 6. Facts file | Flash, then the engine | writes the facts file (below); the engine verifies it | none |

Rules carried over from the measurements:

- The decider's tests are never weakened by a builder (the F124 rule). A builder that cannot meet them climbs.
- No working standards in the decider's prompt beyond the request (F132); the standards stay for the builders.
- No reviewer turn on Flash or Haiku: only the decider's review and the checks decide "done".
- If Flash is out of quota or capacity, its rung is skipped for the run (Haiku takes it), with a note in the events.

### S1. Flash builder rung

A preset `start-flash`: decider Sonnet high (Opus for an expert route), builder ladder Flash high, Haiku high, Sonnet
high. Needs: the `agy` allow rule for test commands (exists), a rule that a Flash turn ending with an empty response
and denied actions counts as a failed turn, and the climb after N failing Flash turns.

### S2. Decisions as tests

The spec turn (F02/F65) also writes the acceptance test files and the command (F124's format: `{path, content,
command}`). The engine runs them on the empty seed (they must fail or not run), then after every build turn. The
review turn's schema allows only `accept` or `tests` (new or changed test files with a one-line reason each).

### S3. Facts file

After the start (and on `neuromesh facts` later), Flash writes facts about the repository as it now is:

- how to install, build, run and test: each a command, **run by the engine**, with its exit code and a few lines of
  output; a command that does not run as written is dropped;
- the layout: folders and main files, one line each, from the repository map (F12);
- interfaces: the public functions, types and endpoints, each quoted with `path:line`; **every quote is checked
  against the file** and dropped if it is not there word for word;
- conventions seen in the code (test framework, formatting, error style), each with one `path:line` example;
- the acceptance tests and what they cover (names only).

Left out on purpose: why things were decided, what to do next, opinions on quality. Those are judgement, and the
next model decides them itself.

Written to `CLAUDE.md` between `<!-- neuromesh facts start -->` and `<!-- neuromesh facts end -->` markers, so the
owner's own text in the file is never touched; the same block in `AGENTS.md` if that file exists or is asked for.
Kept under about 150 lines. On refresh, only sections whose files changed since the last facts commit are redone.

### S4. Facts refresh

`neuromesh facts [--refresh]` in any repository: Flash rewrites the changed sections, the engine verifies them, the
block is replaced. Cheap enough to run after every few commits. This is doc 25's C10 (cross-run repository facts),
in a form Claude Code reads with no change to Claude Code.

## Phase 2: continue with Opus

Nothing to build: the owner opens the repository in Claude Code (or runs `neuromesh run --preset solo-opus`), and
the facts block is in its context from the first call. Hard bug fixes in a big repository can still use K6
(`dossier-claude`), whose dossier can now start from the facts block.

## How it is judged

On the owner's real projects first, then a small fixed set:

- **Start:** Claude window points and estimated dollars for `start-flash` against Opus alone starting the same
  project; the acceptance tests and the owner's rating (usage log) as quality. Three to five projects of the owner's
  kind (a CLI tool, a small web app, a TUI, an agent script).
- **Facts file:** on 5 follow-up requests per started repository, Opus alone with the facts block against Opus alone
  without it: calls, tokens re-read, result. The block is kept if it lowers calls without lowering results.
- **Facts accuracy:** share of quotes and commands Flash wrote that passed verification; below about 80 percent,
  Haiku writes the facts instead.

One run per project is a hint; the owner's ratings over weeks are the evidence.

## Order

1. S3 and S4 first (the facts file): useful on its own for every existing repository, measurable on Flash's quota
   alone, and the same checks make Flash's K6 dossier safe.
2. S1 (Flash rung) with the cascade as it is.
3. S2 (decisions as tests) and the `start-flash` preset.
4. The TUI clean-up below, in parallel; it changes no behaviour.

## The TUI clean-up

The TUI (`docs/11-tui.md`, `src/tui/`) is kept as the face of Neuromesh and as a design reference. The clean-up is
visual and textual only, no behaviour change:

- go through every screen with the `demo` preset and a real run, and list what is cluttered, inconsistent or stale
  (labels that name old presets or Luna, the factory wording, panes that show nothing useful);
- show the new facts that matter now: which provider did each turn, and the Claude window used against the estimate
  for Claude alone;
- keep the look (the neuromesh-dark theme, titled frames, the agent graph) as the reference design;
- screenshots before and after in `docs/assets/`, so the design can be reused elsewhere.

## Risks

- Flash quota and capacity: the run falls back to Haiku, which costs Claude window again. Measured by how often it
  happens.
- Flash builds code that passes the tests and is badly made: only the decider's review sees it; one review per round
  may not be enough on large builds.
- `agy` commands run unsandboxed when allowed; projects are started in their own new folder, and the engine stops
  leftover processes (F76).
- Facts that are true but misleading (an old command still runs but is no longer how the project is tested): the
  refresh redoes sections whose files changed; anything else is the next model's judgement.
