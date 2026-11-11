# The TUI

`neuromesh` with no command, in a terminal, opens it (also `neuromesh tui
[--preset <name>]`). It drives the same engine as `neuromesh run`, through the
engine's events and run records only. Feature id: F19 `tui`
(`docs/10-features.md`). The Signal Studio design pack was a starting point,
simplified on the owner's direction: no slogan, no tabs, one key for all
commands.

## Screens

**Landing.** The logo and a prompt box. Nothing else.

**Workspace**, after the first request:

- Left, on terminals 150 columns or wider: the sessions in this folder, newest
  first, with their state (ready to review, applied, failed, stopped).
- Middle: one stream, no tabs. Your request, what Neuromesh made of it, each
  agent turn as it finishes (model, time, tokens, estimated cost), checks,
  reviews, and when the run ends the change itself, as a diff. The pipeline at
  the top (plan, build, check, review) shows only what actually happened.
  Running agents show on live lines above the prompt.
- Right, on terminals 110 columns or wider: what needs you (apply, diff or
  discard), status and time, the team (before a run) or the agents (during
  one), check results, the reviewer's verdict, the changed files with line
  counts, estimated cost (all models, the expert, and the expert budget used),
  and any feature that failed.

**Bottom bar**, everywhere: `ctrl+p commands` on the left (or a message), the
preset and the working folder on the right.

**Command popup** (Ctrl+P): every key, grouped, selectable with the arrows;
Enter runs the selected command. Esc closes it.

## Keys

Enter sends; Alt+Enter (or Ctrl+J) adds a line; Ctrl+U clears. Esc twice stops a
run (resume it later with `neuromesh resume`). After a run: `a` apply, `d` the
whole diff (j/k, PgUp/PgDn, q back), `x` twice discard, `1` to `5` rate it
against your usual way of working (into the usage log), `i` back to the
prompt. PgUp/PgDn scroll the stream. Ctrl+N new session, Ctrl+T theme, Ctrl+Q
quit (during a run it asks first, then stops the run so it can be resumed).
Every way out restores the terminal.

## Colours

By default the TUI uses your terminal's own colours: no painted background,
accents from the terminal's palette, like Claude Code and opencode. Ctrl+T (or
`NEUROMESH_THEME=github`) switches to GitHub Dark High Contrast in true colour.
`NO_COLOR` turns colour off. State is always in words or symbols too.

## Trying it without quota

`neuromesh tui --preset demo` runs scripted agents that write one small file.
No model is called, and demo runs are never recorded in the usage log or rated.

## Not yet

Opening a past session from the sessions pane (resume or review it), a preset
picker and feature switches in the popup, the three graphs (task DAG, execution
waterfall, usage by model), and mouse support.
