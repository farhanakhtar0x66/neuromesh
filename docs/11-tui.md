# The TUI

`neuromesh` with no command, in a terminal, opens it (also `neuromesh tui
[--preset <name>]`). It drives the same engine as `neuromesh run`, through the
engine's events and run records only. Feature id: F19 `tui`
(`docs/10-features.md`).

## Using it

1. **Landing.** The logo, one line about Neuromesh, and the composer. Type the
   request; Alt+Enter (or Ctrl+J) adds a line; Enter starts the run.
2. **Workspace.** Your request appears at once. Above it, the pipeline
   (plan, build, check, review) shows what has actually happened. The
   transcript shows each agent turn, check and review as it happens; live agents
   and their latest action sit above the composer. On terminals 110 columns or
   wider, a right-hand rail lists every agent with its model, turns, tokens and
   estimated cost, the run's estimated cost (expert separately) and any feature
   that failed.
3. **Outcome.** When the run ends: what happened, the size of the change, the
   estimated cost, and the keys: `a` apply to your repository, `d` view the diff
   (j/k, PgUp/PgDn, q back), `x` discard (press twice), `1` to `5` rate the run
   against your usual way of working (goes into the usage log), `i` write the
   next instruction.

Esc twice stops a run (resume it later with `neuromesh resume`). Ctrl+Q quits;
during a run it asks first, then stops the run so it can be resumed. PgUp/PgDn
scroll the transcript. Every way out restores the terminal.

Try it without spending any quota: `neuromesh tui --preset demo` runs scripted
agents that write one small file. Demo runs are never recorded in the usage log.

## Not yet

Planned next, from the design pack (`NEUROMESH_SIGNAL_STUDIO_MASTER_SPEC.md`,
used as a reference): a sessions rail and resuming past runs from the TUI, a
command palette (Ctrl+P) with a preset picker and feature switches, and the
three graphs (task DAG, execution waterfall, usage by model). Mouse support and
themes come after those.
