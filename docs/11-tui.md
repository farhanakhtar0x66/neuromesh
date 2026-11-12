# The TUI

`neuromesh` with no command, in a terminal, opens it (also `neuromesh tui
[--preset <name>]`). It drives the same engine as `neuromesh run`, through the
engine's events and run records only. Feature ids F19 to F47
(`docs/10-features.md`); the optional ones can be switched off with
`--disable <key>`. The design follows the owner's sketch of 2026-11-12, with
ideas from opencode (layers), Claude Code (the working line, /context) and btop
(scrollbars, fading lists).

## Look

Everything sits on layers. The base is the terminal's own background. The panes
are a step lighter, the bars and cards lighter again, and popups lighter still,
with a soft shadow under raised boxes. The shades come from the terminal: at
start the TUI asks for its foreground, background and 16 colours (OSC 10, 11
and 4), so it fits the terminal's theme. When the terminal doesn't answer,
GitHub Dark High Contrast stands in. Feature F32 `tui-layers`.

**Transparent mode** (`/transparent`, or in `/settings`) paints no backgrounds,
for a see-through terminal. Boxes are drawn with lines instead, and only buttons
are filled. `NO_COLOR` implies it.

The screen is drawn as a grid of cells, and only cells that changed are written,
so animations never rewrite whole rows.

## The bars

**Top bar:**
- **Left:** the brand. It shimmers once when clicked and when a run ends.
- **Middle:** the project's name. A long name scrolls instead of widening the
  box; double-click it (or Ctrl+R) to rename the project.
- **Right:** the status (`● building 12s`, `? approve the plan`, `✓ ready to
  review`). It lights up in its colour when it changes and pulses while the
  team works.

**Bottom bar:** buttons for the menu (Ctrl+P), commands (`/`) and files (`@`);
while a run works, they become menu, verbosity and stop. On the right is the
working folder. Messages appear between them.

## Left: projects and recents

- **Projects** are named folders, kept in `~/.neuromesh/tui/projects.json`.
  - Each project folds open to show its sessions.
  - `+` on the header adds one: a name, and a folder chosen with the system's
    folder picker (Finder on macOS) or typed. A folder that doesn't exist yet is
    made, with `git init` and an empty first commit.
  - Hovering a project shows `+` (a new session in it) and `×`. `×` removes the
    project from the sidebar after asking; the folder and its sessions are never
    touched.
  - Double-click a project to rename it.
- **Recents** are sessions from any other folder. Its `+` starts a new session.
- **Sessions:**
  - Hovering a session shows `×`, which deletes it after asking. Its record
    moves to `~/.neuromesh/trash` and its checkouts are removed. Its branches
    stay, so the work can still be found.
  - Clicking a session opens it, from any folder; the TUI then works in that
    folder.
- **Folding:** the arrow on a header folds the whole section.
- **Scrolling:** a list longer than its room scrolls with the wheel. It fades
  out at the edge where more is hidden, and shows a scrollbar while you scroll.
- **Keyboard:** Ctrl+E moves into the sidebar. Then ↑↓ choose, Enter opens,
  Space folds, `r` renames, `x` deletes or removes, `n` adds a project, and Esc
  goes back to the prompt.
- Ctrl+B hides or shows the sidebar.

Feature F34 `tui-projects`.

## Middle: the run

**The pipeline** (F36 `tui-pipeline-box`) is a row of buttons in a raised box:
Plan, Build, Check, Review.
- The step being worked on is lit and spins.
- The line after a finished step grows into an arrow.
- Clicking a step scrolls to its first box.

**The stream** (F35 `tui-agent-boxes`) is one box per agent, labelled with its
role and model (`Orchestrator · Opus 5.5 med`).
- The label shimmers while the agent works.
- Turns of the same role, one after another, share a box: parallel workers list
  their tasks in one.
- Your messages appear just above the prompt, and older ones move up.

What a box says depends on the **verbosity** (`/verbose none|medium|full`,
Ctrl+O cycles, kept in settings):
- **medium** (the default): the orchestrator's and expert's words, the workers'
  task list with each task's state and report, the tester's verdict, and
  warnings.
- **full**: every command, edit and message each agent produced.
- **none**: the labels only.

Click a box to open it fully whatever the verbosity; click again to close it.

**Your call** (F39 `ask-first`). In Normal mode the run stops and asks:
- after the orchestrator plans: Approve, Change… (type what to change, and the
  plan is revised), or Stop;
- before the expert is called in: Call the expert, or Not now.

Use the buttons, or `y`, `c` and `n` while the prompt is empty. In Turbo mode
the run goes ahead on its own. Applying the change to your repository is always
yours. `neuromesh run` never asks.

**The final report** (F47 `tui-markdown`). When a run ends, what the agents
reported is shown as markdown, drawn rather than shown as raw text: headings,
bold and italic, lists, code blocks, tables and quotes. The stream scrolls to
the report's first line by itself, so it reads from the top. Markdown in the
agents' boxes is drawn the same way.

**After the report** come the change itself (old and new line numbers, added
and removed lines tinted) and a result card. The card has buttons: Apply, Diff,
Discard, Resume, and Rate 1 to 5.

**The working line**, just above the prompt while a run works: a pulsing glyph,
a verb for the stage with a light running along it, the time and the tokens so
far.

**The prompt.** A box for the text, with a brighter bar under it holding:
- `+`: attach files from anywhere (F38 `attachments`; the system's file picker,
  or Ctrl+F). Text files go into the brief every agent works from; other files
  go in by path.
- **Normal / Turbo**: Shift+Tab switches.
- The preset: click it to choose another.

`/` lists commands and `@` searches the repository's files. ↑ recalls earlier
requests. Shift+Enter, Alt+Enter or Ctrl+J adds a new line, and Esc twice clears
the prompt.

## Right: the team and its numbers

- **Project:** name, branch and folder.
- **Agents** (F40 `tui-agent-graph`): Lead → Worker → Tester, with the Expert
  under the Worker.
  - The node working now pulses, and light runs along the edge into it. A
    tester sending work back runs the other way.
  - Each node shows its model and its subscription usage where the tool reports
    it, or the estimated API cost.
  - Under the graph: each model's fullest usage window, as a bar, with when it
    resets. Claude Code reports its 5-hour and 7-day windows (F43
    `quota-windows`). Codex does not in headless mode, so its usage is shown as
    "not reported", never as zero.
  - Click a node to show its context below.
- **context.md** (F41 `tui-context`), after Claude Code's /context. A grid of
  what the chosen agent's last turn was made of: context.md (the repository map
  every agent gets), its instructions, its own reading and tools, and its
  output.
  - **Compact** (Ctrl+L, F42 `compact`) makes the agent's next follow-up turn
    start a fresh session from the brief and its last report, instead of
    continuing a long one.
  - Click the title to read context.md.
- **Changes:** `± +1,230 −20`, with Diff and Apply.
- **Cost:** the run's estimate at API list prices, with the expert budget as a
  bar.

Ctrl+G hides or shows this pane.

## Mouse and keys

Everything can be clicked (F33 `tui-mouse`):
- **Hover** shows a row's own buttons.
- **The wheel** scrolls the pane under the pointer.
- **Double-click** renames.
- **Text selection:** while the mouse is on, the terminal's own selection needs
  Shift (Option in some terminals). `/settings` turns the mouse off.

Every action also has a key or a slash command:

| Key | What |
| --- | --- |
| Ctrl+P | All commands (also `/help`) |
| Enter, Shift+Enter | Send, new line |
| Shift+Tab | Normal or Turbo |
| Ctrl+F | Attach files |
| Ctrl+O | Verbosity: medium, full, none |
| Ctrl+L | Compact |
| Esc Esc | Stop the run (it can be resumed), or clear the prompt |
| a, d, x x, r, 1-5 | After a run: apply, diff, discard, resume, rate |
| y, c, n | Answer the plan or expert question |
| PgUp, PgDn | Scroll the stream |
| Ctrl+S | Find a session in this folder |
| Ctrl+N | New session |
| Ctrl+E | Into the sidebar, and back |
| Ctrl+R | Rename the project |
| Ctrl+B, Ctrl+G | Sidebar, info pane |
| Ctrl+K | Presets |
| Ctrl+T | Terminal colours or GitHub high contrast |
| Ctrl+Q | Quit (twice while a run works) |

## Settings

`/settings` (F45 `tui-settings`), kept in `~/.neuromesh/tui/settings.json`.
Click a row or use ←→ to change it; each change is saved at once.
- the look: layered or transparent;
- colours;
- animations;
- the frame rate: 60 or 120 Hz;
- verbosity;
- Normal or Turbo;
- the mouse;
- which panes are shown.

## Motion

Every animation is a function of time, so frames can come at any rate (F29
`tui-motion`). While something moves, frames come at 60 or 120 a second (F46
`tui-fps`). A scrolling project name ticks four times a second. When nothing
moves, nothing is drawn, and the TUI uses no processor time. `/motion` or
`NEUROMESH_MOTION=off` turns animation off.

## Screensaver

During a long run, after 4 minutes with no key press or mouse movement, the
screen shows the NEUROMESH logo playing animated effects: decrypt, beams, rain,
waves, spotlight, scatter and matrix, each once per shuffled cycle. A quiet line
at the bottom says the run is still working. Any key or mouse movement brings
the workspace back, and so does the run ending. Feature F31 `tui-screensaver`,
after the owner's
[terminal-ascii-screensaver](https://github.com/farhanakhtar0x66/terminal-ascii-screensaver).

- `/screensaver` shows it now.
- `NEUROMESH_SCREENSAVER_AFTER=<seconds>` changes the wait (at least 10);
  `NEUROMESH_SCREENSAVER_AFTER=off` or `NEUROMESH_SCREENSAVER=off` turns it off.
- `NEUROMESH_SCREENSAVER=external` hands the terminal to the owner's own
  `screensaver` command (if installed).

## Trying it without quota

`neuromesh tui --preset demo` runs scripted agents (`NEUROMESH_DEMO_STEP_MS`
sets how long each of their steps takes). No model is called, and demo runs are
never recorded in the usage log or rated. A request with 20 numbered parts gets
a plan, so it shows the plan question and two tasks. Each demo worker writes a
markdown report, so it shows the final report too.

## Not yet

Undoing an applied change; running a shell command from the prompt; a usage
history graph over time.
