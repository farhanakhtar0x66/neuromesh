# The TUI

`neuromesh` with no command, in a terminal, opens it (also `neuromesh tui
[--preset <name>]`). It drives the same engine as `neuromesh run`, through the
engine's events and run records only. Feature ids F19 to F30
(`docs/10-features.md`); any of F20 to F30 can be switched off with
`--disable <key>`. Ideas taken from Claude Code and opencode are noted below.

## Screens

**Landing.** The logo and a prompt box. Nothing else.

**Workspace**, after the first request:

- Left, on terminals 150 columns or wider: the sessions in this folder, newest
  first, with their state.
- Middle: one stream, no tabs. Your request, how Neuromesh read it, each agent
  turn as it finishes (model, time, tokens, estimated cost), checks, reviews,
  and when the run ends the change itself, with file headers and old and new
  line numbers. The pipeline at the top shows only what actually happened.
- While a run works, a working line above the prompt (from Claude Code): a
  pulsing glyph and a verb for the stage ("Cooking…", "Reviewing…") with a
  light sweeping across it, the time, the tokens so far and how to stop; under
  it one `⎿` line per active agent with what it is doing right now.
- Right, on terminals 110 columns or wider: what needs you (apply, diff,
  discard, or resume), status and time, the team or the agents, check results,
  the reviewer's verdict, changed files, estimated cost against the expert
  budget, and any feature that failed.

**Bottom bar**, everywhere: `ctrl+p commands` on the left (or a message), the
preset and the working folder on the right.

## Prompt

- `/` lists commands as you type, with autocomplete (Claude Code, opencode):
  `/sessions`, `/preset`, `/resume`, `/diff`, `/apply`, `/discard`, `/details`,
  `/usage`, `/features`, `/theme`, `/new`, `/help`, `/quit`.
- `@` searches the repository's files with fuzzy matching; Tab or Enter puts
  the path in (Claude Code, opencode).
- ↑ and ↓ in an empty prompt step through earlier requests, kept between
  sessions in `~/.neuromesh/history.json` (Claude Code).
- Alt+Enter (or Ctrl+J) adds a line. Esc twice clears the prompt (Claude Code).

## Sessions and presets

- Ctrl+S (or `/sessions`) opens any earlier run of this folder, replayed from
  its event log: review its stream and diff, apply or discard it, or press `r`
  to resume a run that was stopped, paused or failed (opencode's session list).
- Ctrl+K (or `/preset`) chooses the team preset for the next runs, with what
  each one does (opencode's model picker).

## Keys

Ctrl+P lists everything. While a run works: Esc twice stops it (it can be
resumed), Ctrl+O shows or hides each agent's steps (Claude Code). After a run:
`a` apply, `d` the whole diff (j/k, space, PgUp/PgDn, q back), `x` twice discard,
`r` resume, `1` to `5` rate it against your usual way of working (into the usage
log), `i` back to the prompt. PgUp/PgDn scroll the stream; a line says how much
is below when scrolled up. Ctrl+N new session, Ctrl+T theme, Ctrl+Q quit (during
a run it asks first, then stops the run so it can be resumed).

When a run ends the terminal bell rings (most terminals flash or badge the tab),
and the window title always shows the run's state. Quitting prints what the
session did and any runs not yet applied. Every way out restores the terminal.

## Motion

Things move only while something happens, and the screen is not redrawn at all
when nothing does (about 30 frames a second while animating, none when idle).
Feature F29 `tui-motion`, plus F30 `tui-intro`:

- On opening, the logo builds up by density, `:` then `+` then `#`, in a wave
  from the left.
- The prompt's border lights up while there is text in it.
- While the team works: a light sweeps along under the pipeline, the active
  step pulses and the step just finished flashes, and the working verb decodes
  into the next one when it changes ("Cooking…" → "Wiring…").
- New lines in the stream are bright for a moment as they arrive; agents flash
  ✓ in the right pane as they finish; the estimated cost counts up.
- Messages in the bottom bar type in, and dim just before they go.
- Popups unfold from their middle.
- When a run ends, the outcome card drops in (with a sparkle if it went well)
  and the diff unrolls line by line.

`/motion` turns animations off or on; `NEUROMESH_MOTION=off` starts without
them; `--disable tui-motion` removes them entirely.

## Colours

By default the TUI uses your terminal's own colours: no painted background,
accents from the terminal's palette, like Claude Code and opencode. Ctrl+T (or
`NEUROMESH_THEME=github`) switches to GitHub Dark High Contrast in true colour.
`NO_COLOR` turns colour off. State is always in words or symbols too.

## Trying it without quota

`neuromesh tui --preset demo` runs scripted agents that write one small file.
No model is called, and demo runs are never recorded in the usage log or rated.

## Not yet

The three graphs (task DAG, execution waterfall, usage by model), mouse
support, undoing an applied change, and running a shell command from the prompt.
