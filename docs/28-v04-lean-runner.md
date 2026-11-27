# v0.4 stage 1: the lean frontier runner (F136) and cache-aware accounting (F137)

Built 2026-11-27 under `docs/27-v04-build-rules.md`, offline only: no live model call was made. Nothing here is
measured on a real subscription yet.

## 1. Two bugs fixed first

**EISDIR in F12 and F100** (seen on `ansible__molecule-4534`, `evals/results/logs/swl-trialA2.out`). Both read every
path `git ls-files` lists as a file. Git lists a submodule (and a tracked link to a folder) as a path, so
`readFileSync` hit a folder. `src/context/packet.ts` now reads only what `regularFileSize()` says is a regular file
(`statSync`, which follows links; a broken link throws and is skipped). Regression tests: `test/eisdir.test.ts`. The
fault harness now builds a fifth of its repositories with a tracked link to a folder and a broken link, and breaks a
run on any feature error that says EISDIR. On the code before the fix, 60 seeds gave 13 start-here and 12
context-packet violations. After the fix, both full sweeps keep every rule.

**What Opus is sent under K6 when F130 skips the dossier, against solo-opus.** Measured offline: the real preset
files, the `claude` backend replaced by the fake one, one repository of 175 files, and one request that names
`merge_dicts` in `molecule/config.py` (so F130 skips the dossier). Opus's first turn on each:

| | solo-opus | dossier-claude, no dossier |
| --- | --- | --- |
| CLI flags, tools, system prompt | Claude Code's default system prompt; F08's lean flags; Bash, Edit, Write, Read, Grep, Glob; the report schema | identical |
| Prompt size | 9,142 characters | 9,311 characters |
| Request text | as typed | rewritten by the brief: the first letter is capitalised, so the identifier `merge_dicts` reads `Merge_dicts` (`src/intake/brief.ts`, the cleaning step) |
| Repository map (F12, up to 8,000 characters) | yes, about three quarters of the prompt | yes, the same |
| Start-here lines (F100) | when the request names a definition strongly enough; not on this request | the same |
| "Run only the tests that cover what you changed..." (F130's line) | no | yes |
| Brief standards | no brief | removed by F132 |
| Rules, check list, answer format, `.venv` note | yes | identical |

The repair turn (resumed session, the checks' output) was identical in both.

So on the no-dossier path K6 differs from Opus alone by one added line and a rewritten request. The costly part,
the repository map, is in both. Two more things seen while auditing, left alone because the rules say not to touch
`dossier-claude`:

- The staffing reason "the lead plans it, picks a developer per task and checks the result"
  (`src/engine/run.ts`, the lead block in `startRun`) is shown for K6 runs too, where nothing is planned. It goes to
  the run's log and display only, not to a prompt.
- `dossierSkip()` matches names in `state.prompt` (the brief's rewrite), not `state.request`. That breaks the F109
  rule for request-level inspection. It does no harm on the issues measured so far, since the rewrite only adds
  standards and capitalises a first letter.

The lean runner drops the map, the start-here lines, F130's line and the rewrite.

## 2. F136: the lean frontier runner

Opt-in through the new preset `temporal-claude`: Opus 5.5 medium, solo, as `solo-opus`, plus `"enable":
["lean-runner"]`. `cascade-claude`, `dossier-claude` and `solo-opus` are unchanged, and a test checks that solo-opus's
calls carry none of it. The code is in `src/engine/lean-runner.ts` and `src/tools/leanfilter.ts`.

- **Prompt.** The request as typed (`state.request` when a brief rewrote it, with any files it named attached), the
  project's checks, three lines of rules and the answer format. There is no map, no start-here, no standards and no
  dossier. On the audit request it is 1,263 characters, against 9,142 for solo-opus. Claude Code's own system prompt is
  kept, because solo-opus was measured with it and replacing it is untested.
- **Anti-waste skill.** Eleven lines (`LEAN_SKILL`) passed with `--append-system-prompt`. It is the same text on
  every call and every turn, so it stays in the cached prefix. It asks for parallel independent reads on the first
  turn, no re-reading what is already in the conversation, one reproduction script, the single covering test while
  iterating and the broad check once, and a stop when done. It holds none of the F132 phrases, and a test checks this.
- **Output filter (both ways, the owner's choice).**
  - *The hook:* a PreToolUse hook passed with `--settings` (`src/tools/lean-hook.ts`). It rewrites each Bash command
    to `node src/tools/lean-run.ts <base64>`. That script runs the original and prints it through `filterOutput()`:
    ANSI and carriage-return redraws removed, repeated and progress lines collapsed, then the first 30 lines, up to 40
    failure lines from the middle, the last 60 lines, a notice of exactly how many lines and bytes were left out, and
    the exit code. The script exits with the command's own code. Commands that change the shell (`cd`, `export`,
    `source`...), background commands and commands already shortened are left as written. If the hook fails it
    prints nothing, and the command runs unchanged.
  - *The instruction:* the skill also says that output arriving unshortened and long should go through the existing
    F114 `nm run --`.
- **History.** The stage prompt asked to mask stale tool output from turn 22. Claude Code owns the session's history,
  and Neuromesh cannot edit it without driving the tool through an internal protocol, which CLAUDE.md forbids. The
  owner chose the boundary version instead. A follow-up turn (a repair) after the session has made `LEAN_FRESH_AT` =
  22 model calls starts a fresh session instead of `--resume`. It starts from facts only: the lean prompt, the
  checks' raw output and the files on disk (`git diff`), never the earlier session's summary or transcript (F131).
  Below 22 calls the session is always resumed, so its cached prefix is never rewritten early. An unknown call count
  never triggers it.

**Not known until the live phase:** whether Claude Code applies `updatedInput` from a PreToolUse hook under
`--setting-sources ""` with `--settings` (the flags are documented, but they are untested together here), whether the
hook runs inside Neuromesh's write sandbox (F53), and whether any of this lowers Opus's calls or re-read tokens.
Opus's `cd` to a subfolder in a combined command (`cd x && pytest`) still runs, but the folder change no longer
carries over to later calls.

## 3. F137: cache-aware token fields

The Claude adapter counts model calls per message id in the stream (`usage.calls`). Every `agent.finished` event,
every turn and run line in `~/.neuromesh/record/record.jsonl`, and each model's entry in an eval's `results.json`
also carry `tokens: { inputUncached, cacheRead, cacheCreation, output, calls }`. These sit beside the old `usage`
object, whose field names (input, cacheRead, cacheWrite, output) stay, so `evals/bench.ts` and the record readers are
unchanged. The record backfill gets the fields too, since they come from the usage itself.

The stage prompt asked for cacheCreation to be "else 0". CLAUDE.md says an unknown number is recorded as unknown,
never as 0, so a count the tool did not report is left out. A run's or a model's total is left out when any of its
turns did not report that count.

## Gate (2026-11-27)

`npx tsc --noEmit` clean; `npm test` 393 of 393; `node evals/chaos.ts --seeds 1000` and `--kill 1 --seeds 400` keep
every rule.
