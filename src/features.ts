// Feature registry. Every capability added on top of the v0.1 engine is listed
// here with an id, and every place in the code that belongs to it is marked
// with that id: a comment `[F04 screen-check]` at the code, a `feature` field
// on its events, and its id on any error it raises. So when Neuromesh goes
// wrong, the error, the event log and the usage log say which feature was
// involved, and the feature can be switched off to work around it:
//
//   NEUROMESH_DISABLE=screen-check,context-packet neuromesh run "..."
//   neuromesh run --disable F04 "..."
//   "disable": ["screen-check"] in a preset
//
// A feature with `defaultOff: true` is off until asked for, and its code stays:
//
//   NEUROMESH_ENABLE=blind-tests neuromesh run "..."
//   neuromesh run --enable F101 "..."
//   "enable": ["blind-tests"] in a preset
//
// (a disable always wins over an enable).
//
// NEUROMESH_FAULT=<key> makes a feature fail on purpose, to check the handling.
//
// `neuromesh features` lists them all.

export interface Feature {
  id: string;
  key: string;
  name: string;
  added: string;
  /** Where it lives; the first file is the main one. */
  files: string[];
  what: string;
  /**
   * An optional feature that fails is switched off for the rest of the run and
   * the run goes on without it. A core one stops the run with a tagged error.
   */
  optional: boolean;
  /**
   * Off unless asked for (NEUROMESH_ENABLE, --enable, or "enable" in a preset). Its code stays,
   * so it can be measured again later; `--disable` still wins.
   */
  defaultOff?: boolean;
}

export const FEATURES: Feature[] = [
  {
    id: "F01",
    key: "brief-engine",
    name: "Brief engine",
    added: "2026-11-11",
    files: ["src/intake/brief.ts", "src/engine/run.ts (startRun)"],
    what: "Cleans the request, attaches documents it names, adds working standards and decides the staffing, with no model call.",
    optional: true,
  },
  {
    id: "F02",
    key: "spec-step",
    name: "Spec step",
    added: "2026-11-11",
    files: ["src/engine/run.ts (specStep)", "src/engine/prompts.ts (specPrompt)"],
    what: "A spec writer turns a short request for something new into features, behaviour rules, scope and a design.",
    optional: true,
  },
  {
    id: "F03",
    key: "expert-spec",
    name: "Expert spec and design",
    added: "2026-11-11",
    files: ["src/intake/brief.ts (staff)", "presets/factory-opus-luna.json"],
    what: "With an expert spec writer, every new program gets a spec and design before the workers start.",
    optional: true,
  },
  {
    id: "F04",
    key: "screen-check",
    name: "Screen check",
    added: "2026-11-11",
    files: ["src/checks/screen.ts", "src/engine/run.ts (screensFor)"],
    what: "Runs a full-screen terminal program in tmux, plays generic user actions and gives the screens to the tester.",
    optional: true,
  },
  {
    id: "F05",
    key: "tester-severity",
    name: "Blocker and minor findings",
    added: "2026-11-11",
    files: ["src/engine/run.ts (test step)", "src/engine/prompts.ts (VERDICT_SCHEMA)"],
    what: "The tester marks findings blocker or minor; a review with only minor findings lets the task merge.",
    optional: true,
  },
  {
    id: "F06",
    key: "review-memory",
    name: "Review memory",
    added: "2026-11-11",
    files: ["src/engine/prompts.ts (earlierReviews)"],
    what: "The tester sees its earlier findings and may not reverse them or fail a choice the spec leaves open.",
    optional: true,
  },
  {
    id: "F07",
    key: "review-only-merge",
    name: "No rebuild over review-only objections",
    added: "2026-11-11",
    files: ["src/engine/run.ts (test step)"],
    what: "Once the expert's advice was tried and the checks pass, remaining reviewer objections are recorded instead of sent to an expert rebuild.",
    optional: true,
  },
  {
    id: "F08",
    key: "lean-claude",
    name: "Lean Claude sessions",
    added: "2026-11-11",
    files: ["src/backends/claude.ts (claudeArgs)"],
    what: "Claude Code gets only the tools a turn needs, a short system prompt for read-only turns, and nothing from the user's setup.",
    optional: true,
  },
  {
    id: "F09",
    key: "codex-session-totals",
    name: "Per-turn Codex usage",
    added: "2026-11-11",
    files: ["src/engine/run.ts (once, perTurnAttempts)", "src/backends/codex.ts"],
    what: "Resumed Codex sessions report running totals; the engine records the change per turn.",
    optional: false,
  },
  {
    id: "F10",
    key: "work-created-checks",
    name: "Checks created by the work",
    added: "2026-11-11",
    files: ["src/engine/run.ts (checks step)"],
    what: "A project with no checks picks up the tests the work itself adds, and they gate the task.",
    optional: true,
  },
  {
    id: "F11",
    key: "usage-log",
    name: "Usage log",
    added: "2026-11-11",
    files: ["src/usage/log.ts", "src/cli/main.ts (finish, rate, usage)"],
    what: "Records every real run and the owner's rating in ~/.neuromesh/usage/USAGE.md.",
    optional: true,
  },
  {
    id: "F12",
    key: "context-packet",
    name: "Context packet",
    added: "2026-11-11",
    files: ["src/context/packet.ts", "src/engine/prompts.ts (taskPrompt, advisePrompt, escalationPrompt)"],
    what: "A repository map and the signatures most relevant to the request, built with no model call and put in the prompt, so agents explore less.",
    optional: true,
  },
  {
    id: "F13",
    key: "nm-tools",
    name: "Universal agent tools",
    added: "2026-11-11",
    files: ["src/tools/nm.ts", "src/engine/prompts.ts (toolsNote)"],
    what: "One shell tool any agent CLI can call: repository map, symbol bodies, ranked search, the project's checks in short form.",
    optional: true,
  },
  {
    id: "F14",
    key: "expert-patch",
    name: "Expert patch instead of rebuild",
    added: "2026-11-11",
    files: ["src/engine/run.ts (escalate step)", "src/engine/prompts.ts (patchPrompt)"],
    what: "When checks pass and only review findings remain, the expert fixes the named problems in the worker's tree instead of rebuilding from the start.",
    optional: true,
  },
  {
    id: "F15",
    key: "spec-cap",
    name: "Spec length cap",
    added: "2026-11-11",
    files: ["src/engine/prompts.ts (specPrompt)"],
    what: "Asks the spec writer for a compact spec, since its output is most of an expert spec turn's cost.",
    optional: true,
  },
  {
    id: "F16",
    key: "dollar-budget",
    name: "Expert budget in dollars",
    added: "2026-11-11",
    files: ["src/engine/run.ts (budgetLeft)", "src/presets/presets.ts (expertBudgetUsd)"],
    what: "Caps a run's expert spending by estimated API cost as well as by tokens.",
    optional: true,
  },
  {
    id: "F17",
    key: "live-cost",
    name: "Live cost",
    added: "2026-11-11",
    files: ["src/engine/run.ts (once)", "src/cli/format.ts"],
    what: "Shows each turn's estimated cost as it finishes, and cost by role in the summary.",
    optional: true,
  },
  {
    id: "F18",
    key: "screen-check-2",
    name: "Screen check, round 2",
    added: "2026-11-11",
    files: ["src/checks/screen.ts (countdown wait)"],
    what: "Waits out a countdown the program shows, so a timed run that never ends by itself is caught.",
    optional: true,
  },
  {
    id: "F19",
    key: "tui",
    name: "Terminal UI",
    added: "2026-11-12",
    files: ["src/tui/app.ts", "src/tui/view.ts", "src/tui/canvas.ts", "src/tui/model.ts", "src/tui/blocks.ts", "src/tui/term.ts", "src/tui/composer.ts", "src/tui/text.ts", "src/tui/theme.ts"],
    what: "The full-screen interface: a top bar (brand, project, status), projects and sessions on the left, the run as agent boxes in the middle, the team and its numbers on the right, a bottom bar; drawn on a cell canvas.",
    optional: false,
  },
  {
    id: "F20",
    key: "tui-working",
    name: "Working indicator",
    added: "2026-11-12",
    files: ["src/tui/view.ts (workingLine)"],
    what: "While a run works: an animated glyph and a shimmering verb for the stage, with the time and tokens so far, just above the prompt.",
    optional: true,
  },
  {
    id: "F21",
    key: "tui-slash",
    name: "Slash commands",
    added: "2026-11-12",
    files: ["src/tui/commands.ts", "src/tui/app.ts (suggestions)"],
    what: "Typing / in the prompt lists commands with autocomplete; Enter or Tab runs one.",
    optional: true,
  },
  {
    id: "F22",
    key: "tui-mentions",
    name: "File mentions",
    added: "2026-11-12",
    files: ["src/tui/files.ts", "src/tui/app.ts (suggestions)"],
    what: "Typing @ in the prompt searches the repository's files; Tab or Enter puts the path in.",
    optional: true,
  },
  {
    id: "F23",
    key: "tui-history",
    name: "Prompt history",
    added: "2026-11-12",
    files: ["src/tui/files.ts (history)", "src/tui/app.ts"],
    what: "Up and Down in an empty or recalled prompt step through earlier requests, kept in ~/.neuromesh/history.json.",
    optional: true,
  },
  {
    id: "F24",
    key: "tui-sessions",
    name: "Session switcher",
    added: "2026-11-12",
    files: ["src/tui/app.ts (openSession, resume)", "src/tui/view.ts (pickerPopup)"],
    what: "Ctrl+S, /sessions or a click in the sidebar reopens a past run from its event log: review, apply, discard or resume it.",
    optional: true,
  },
  {
    id: "F25",
    key: "tui-presets",
    name: "Preset picker",
    added: "2026-11-12",
    files: ["src/tui/app.ts (choosePreset)", "src/tui/view.ts (pickerPopup)"],
    what: "/preset (or a click on the preset in the prompt bar) lists presets with what each does; the choice applies to the next runs.",
    optional: true,
  },
  {
    id: "F26",
    key: "tui-details",
    name: "Agent details",
    added: "2026-11-12",
    files: ["src/tui/app.ts (cycleVerbose)", "src/tui/blocks.ts"],
    what: "Ctrl+O cycles the verbosity (medium, full, none), the same as /verbose.",
    optional: true,
  },
  {
    id: "F27",
    key: "tui-diff-numbers",
    name: "Diffs with line numbers",
    added: "2026-11-12",
    files: ["src/tui/diff.ts"],
    what: "Diffs in the stream and the diff view show old and new line numbers per file.",
    optional: true,
  },
  {
    id: "F28",
    key: "tui-notify",
    name: "Bell, title and exit summary",
    added: "2026-11-12",
    files: ["src/tui/app.ts (notify)", "src/tui/term.ts (title, bell)"],
    what: "The terminal title shows the run's state, the bell rings when a run ends, and quitting prints what this session did.",
    optional: true,
  },
  {
    id: "F29",
    key: "tui-motion",
    name: "Motion",
    added: "2026-11-12",
    files: ["src/tui/anim.ts", "src/tui/view.ts"],
    what: "Animations, each a function of time: shimmering labels while agents work, the pipeline's lines growing into arrows, the status lighting up when it changes, the brand shimmer, popups unfolding, light along the graph's edges, the context grid filling, scrollbars fading. /motion or NEUROMESH_MOTION=off turns them off.",
    optional: true,
  },
  {
    id: "F30",
    key: "tui-intro",
    name: "Logo intro",
    added: "2026-11-12",
    files: ["src/tui/anim.ts (buildUp)", "src/tui/view.ts (logo)"],
    what: "On opening, the logo builds up by density from the left.",
    optional: true,
  },
  {
    id: "F31",
    key: "tui-screensaver",
    name: "Screensaver",
    added: "2026-11-12",
    files: ["src/tui/screensaver.ts", "src/tui/app.ts (startSaver, stopSaver)", "src/tui/term.ts (mouse, suspend)"],
    what: "During a long run with no key press for 4 minutes, the NEUROMESH logo plays animated effects; any key or mouse movement, or the run ending, brings the workspace back. After the owner's terminal-ascii-screensaver; NEUROMESH_SCREENSAVER=external uses that tool itself.",
    optional: true,
  },
  {
    id: "F32",
    key: "tui-layers",
    name: "Layered look",
    added: "2026-11-12",
    files: ["src/tui/theme.ts", "src/tui/canvas.ts", "src/tui/term.ts (queryColours)"],
    what: "Surfaces in shades of the terminal's own background (asked from the terminal at start), so bars, panes, cards and popups sit on distinct layers with shadows, as opencode does. Transparent mode (settings) paints no backgrounds and draws lines instead.",
    optional: true,
  },
  {
    id: "F33",
    key: "tui-mouse",
    name: "Mouse",
    added: "2026-11-12",
    files: ["src/tui/term.ts (parseKeys mouse)", "src/tui/app.ts (onMouse)", "src/tui/canvas.ts (regions)"],
    what: "Click any button, session, project or agent box; hover shows a row's own buttons; the wheel scrolls the pane under the pointer; double-click renames. Every action also has a key.",
    optional: true,
  },
  {
    id: "F34",
    key: "tui-projects",
    name: "Projects and recents",
    added: "2026-11-12",
    files: ["src/tui/store.ts", "src/tui/view.ts (sidebar)", "src/tui/app.ts (projects)"],
    what: "The sidebar lists named projects (folders, ~/.neuromesh/tui/projects.json) with their sessions, and recent sessions from any other folder. New project with a folder picker, rename, remove (the folder is never touched), and delete a session (its record moves to ~/.neuromesh/trash).",
    optional: true,
  },
  {
    id: "F35",
    key: "tui-agent-boxes",
    name: "Agent boxes and verbosity",
    added: "2026-11-12",
    files: ["src/tui/blocks.ts", "src/tui/view.ts (stream)"],
    what: "The stream as one box per agent, labelled with its role and model; the label shimmers while the agent works. Verbosity none, medium (default: the lead's and expert's words, the workers' task list) or full (every step); click a box to open it.",
    optional: false,
  },
  {
    id: "F36",
    key: "tui-pipeline-box",
    name: "Pipeline buttons",
    added: "2026-11-12",
    files: ["src/tui/view.ts (pipelineBox)"],
    what: "Plan, build, check and review as buttons in a raised box; the line after a finished step grows into an arrow. Clicking a step scrolls to its first box.",
    optional: true,
  },
  {
    id: "F37",
    key: "tui-scroll",
    name: "Scrollbars and list shadows",
    added: "2026-11-12",
    files: ["src/tui/view.ts (scrollbar, fadeEdges)"],
    what: "As in btop: a scrollbar appears while scrolling, and a list longer than its pane fades out at the edge where more is hidden.",
    optional: true,
  },
  {
    id: "F38",
    key: "attachments",
    name: "Attached files",
    added: "2026-11-12",
    files: ["src/engine/run.ts (startRun attachments)", "src/tui/app.ts (attach)"],
    what: "Files from anywhere on the computer (+ in the prompt bar, or Ctrl+F) go with the request: text files are included in the brief every agent works from, others by path.",
    optional: true,
  },
  {
    id: "F39",
    key: "ask-first",
    name: "Normal and Turbo",
    added: "2026-11-12",
    files: ["src/engine/run.ts (askUser)", "src/tui/app.ts (answer)"],
    what: "In Normal mode the run stops to ask before the lead's plan is carried out (approve, change it, or stop) and before the expert is called in. Turbo goes ahead on its own. Changing your repository (Apply) is always yours. Only for callers that can answer (the TUI); `neuromesh run` never asks.",
    optional: true,
  },
  {
    id: "F40",
    key: "tui-agent-graph",
    name: "Agent graph",
    added: "2026-11-12",
    files: ["src/tui/view.ts (agentGraph)"],
    what: "The team as an animated graph: who hands work to whom, who is working, each model's subscription usage where the tool reports it, and the estimated API cost.",
    optional: true,
  },
  {
    id: "F41",
    key: "tui-context",
    name: "Context view",
    added: "2026-11-12",
    files: ["src/tui/view.ts (contextCard)", "src/tui/model.ts (context)"],
    what: "What an agent's last turn was made of (context.md, instructions, its own reading and tools, output) as a grid, as Claude Code's /context shows it, with a Compact button.",
    optional: true,
  },
  {
    id: "F42",
    key: "compact",
    name: "Compaction",
    added: "2026-11-12",
    files: ["src/engine/run.ts (turn)"],
    what: "On request, an agent's next follow-up turn starts a fresh session from the brief and its last report instead of continuing a long one.",
    optional: true,
  },
  {
    id: "F43",
    key: "quota-windows",
    name: "Usage windows",
    added: "2026-11-12",
    files: ["src/backends/claude.ts (rate_limit_event)", "src/engine/run.ts (agent.finished)"],
    what: "Claude Code's usage windows (5 hours, 7 days) with when each resets, passed on with every turn. Codex does not report its windows in headless mode, so they stay unknown.",
    optional: true,
  },
  {
    id: "F44",
    key: "task-report",
    name: "Worker reports",
    added: "2026-11-12",
    files: ["src/engine/run.ts (driveTask)"],
    what: "What a worker said it did at the end of each turn, as an event, so the TUI shows it in the worker's box.",
    optional: true,
  },
  {
    id: "F45",
    key: "tui-settings",
    name: "TUI settings",
    added: "2026-11-12",
    files: ["src/tui/store.ts (settings)", "src/tui/view.ts (settingsOverlay)"],
    what: "/settings: layered or transparent, theme, motion, frame rate, verbosity, Normal or Turbo, mouse, panes. Kept in ~/.neuromesh/tui/settings.json.",
    optional: true,
  },
  {
    id: "F46",
    key: "tui-fps",
    name: "Frame pacing",
    added: "2026-11-12",
    files: ["src/tui/app.ts (schedule)"],
    what: "Animations are drawn at 60 or 120 frames a second (settings), only while something moves; slow motion (a scrolling project name) ticks four times a second; nothing at all when still.",
    optional: true,
  },
  {
    id: "F47",
    key: "tui-markdown",
    name: "Final report",
    added: "2026-11-12",
    files: ["src/tui/markdown.ts", "src/tui/view.ts (placeFinal)", "src/tui/app.ts (settle)"],
    what: "When a run ends, the agents' final report is shown as rendered markdown (headings, lists, code, tables) and the stream scrolls to its first line, so it reads from the top.",
    optional: true,
  },
  {
    id: "F48",
    key: "tui-theme",
    name: "Neuromesh look",
    added: "2026-11-12",
    files: ["src/tui/theme.ts (NEUROMESH_DARK)", "src/tui/view.ts (box, divider, LOGO_MID)"],
    what: "Neuromesh's own look: the neuromesh-dark theme (from the owner's Obsidian Bloom, neutral black) by default, panes and boxes drawn as rounded frames with their titles set into the top edge, the big logo with a smaller one drawn in its style for narrow panes.",
    optional: true,
  },
  {
    id: "F49",
    key: "follow-up",
    name: "Follow-ups in a session",
    added: "2026-11-12",
    files: ["src/engine/run.ts (followFrom)", "src/tui/app.ts (start)", "src/tui/store.ts (sessions)"],
    what: "An instruction given after a run, in the same session, starts from that run's result (applied or not) and is told what was asked and done before; the session's runs show as one session in the sidebar.",
    optional: true,
  },
  {
    id: "F50",
    key: "opencode",
    name: "opencode and logins",
    added: "2026-11-12",
    files: ["src/backends/opencode.ts", "src/tui/app.ts (connect)"],
    what: "opencode as a fourth backend (`opencode run --format json`), so any model opencode knows can work, including API-key models added with `opencode auth login` (the key stays with opencode; their cost is real money and shown as reported). /connect signs in to Codex, Claude Code, Antigravity and opencode through each tool's own login.",
    optional: true,
  },
  {
    id: "F51",
    key: "tui-teams",
    name: "Favourite and custom teams",
    added: "2026-11-12",
    files: ["src/tui/team.ts", "src/tui/app.ts (openPicker, team dialog)", "src/presets/presets.ts (own presets)"],
    what: "The preset list offers two favourites (Opus 5.5 lead with GPT-6 Luna workers; GPT-6.1 Sol high with Gemini 3.8 Flash workers) and a Custom team: a model, or none, for expert, worker and tester, saved as ~/.neuromesh/presets/custom.json.",
    optional: true,
  },
  {
    id: "F52",
    key: "telemetry",
    name: "Testers' reports",
    added: "2026-11-12",
    files: ["src/telemetry/telemetry.ts", "telemetry-endpoint/src/index.js", "src/tui/app.ts (consent)"],
    what: "With the tester's consent (asked once), each real run's numbers, request, final reports and rating go to the owner's endpoint; never code, diffs, file locations or identity. Unsent reports wait in ~/.neuromesh/telemetry/outbox. `neuromesh telemetry on|off|pull`.",
    optional: true,
  },
  {
    id: "F53",
    key: "write-sandbox",
    name: "Write sandbox",
    added: "2026-11-12",
    files: ["src/backends/sandbox.ts", "src/backends/shared.ts (runCli)", "src/engine/run.ts (once)"],
    what: "On macOS, Claude Code, Antigravity and opencode run under the system sandbox (sandbox-exec): they may write only in the run's copy of the repository, git's shared objects, temporary and cache folders, and their own state. Reading and the network are unchanged. Codex keeps its own sandbox.",
    optional: true,
  },
  {
    id: "F54",
    key: "work-env",
    name: "Working environment",
    added: "2026-11-12",
    files: ["src/engine/env.ts", "src/engine/run.ts (prepareEnv)", "src/checks/checks.ts (runChecks env)"],
    what: "The engine makes the work folder's environment: .venv for Python (with uv when installed), node_modules for Node, installing what requirements.txt, pyproject.toml or package.json declare before the first turn and before every check. Agents and checks use it; it never enters the diff. From the python-bot run, where a sandboxed worker could not install the package its design named.",
    optional: true,
  },
  {
    id: "F55",
    key: "worker-network",
    name: "Network for new programs",
    added: "2026-11-12",
    files: ["src/backends/codex.ts (codexArgs)", "src/engine/run.ts (once)"],
    what: "Writing turns on a new program may reach the network inside Codex's sandbox (sandbox_workspace_write.network_access), so workers can install packages and try the real data. Writes stay confined. Other tools already had the network.",
    optional: true,
  },
  {
    id: "F56",
    key: "env-blocked",
    name: "Environment problems are not task failures",
    added: "2026-11-12",
    files: ["src/engine/run.ts (environmentProblem)", "src/engine/env.ts (environmentTrouble)", "src/engine/prompts.ts (envRepairPrompt)"],
    what: "When the checks fail because a package is missing or an install failed (or the worker reports being blocked by the environment), the worker gets up to two turns to declare it, which do not count as repair rounds; then the run stops with an environment failure. It never goes to the expert.",
    optional: true,
  },
  {
    id: "F57",
    key: "hollow-checks",
    name: "Checks that test nothing",
    added: "2026-11-12",
    files: ["src/checks/checks.ts (hollowReason)", "src/engine/run.ts (check)"],
    what: "A check that exits 0 but ran no tests, or skipped tests over a missing package, counts as failed (unless it already did so before the work started). Python checks print skip reasons (unittest -v, pytest -rs) so these are seen.",
    optional: true,
  },
  {
    id: "F58",
    key: "acceptance-runs",
    name: "Acceptance runs",
    added: "2026-11-12",
    files: ["src/checks/acceptance.ts (runAcceptance)", "src/engine/prompts.ts (specPrompt, testerPrompt)", "src/intake/brief.ts (renderBrief)"],
    what: "The spec names 2 to 4 real uses of the program (a command and what must be true of its result). The engine runs them in the reviewer's copy, sandboxed, and hands the reviewer the output, the files written and their first lines. Workers see them in the brief.",
    optional: true,
  },
  {
    id: "F59",
    key: "reproduced-findings",
    name: "Only shown findings count",
    added: "2026-11-12",
    files: ["src/checks/acceptance.ts (verifyFindings)", "src/engine/run.ts (checkFindings)"],
    what: "Each reviewer blocker comes with a check command that fails while the problem is there. The engine runs it: a blocker whose check passes is dropped, one without a check becomes minor (it never calls the expert in). Terminal programs keep screen-based findings.",
    optional: true,
  },
  {
    id: "F60",
    key: "no-rebuild",
    name: "No expert rebuild",
    added: "2026-11-12",
    files: ["src/engine/run.ts (escalate step, once)", "src/engine/prompts.ts (fixInPlacePrompt)", "src/backends/claude.ts (onUsage)"],
    what: "The expert's takeover never resets the work folder: it fixes the worker's code in place with the smallest change. A running expert turn is stopped when the run's estimated expert spending passes the dollar budget (Claude Code reports usage during the turn); its changes so far are kept and checked.",
    optional: true,
  },
  {
    id: "F61",
    key: "advice-facts",
    name: "The expert sees what the worker observed",
    added: "2026-11-12",
    files: ["src/engine/observed.ts", "src/engine/prompts.ts (advisePrompt)"],
    what: "Advice and in-place fixes get the commands that failed in the worker's environment and its blocked report, labelled as facts about the environment. Its reasoning is still left out.",
    optional: true,
  },
  {
    id: "F62",
    key: "advice-cap",
    name: "A small advice packet",
    added: "2026-11-12",
    files: ["src/engine/prompts.ts (compactAttempts)"],
    what: "The stuck state sent to the expert is cut to a few thousand characters: the latest change's files and the start of its diff, the failure, open findings, and only the file list of the attempt before.",
    optional: true,
  },
  {
    id: "F63",
    key: "scout-facts",
    name: "Facts before the spec",
    added: "2026-11-12",
    files: ["src/engine/run.ts (scoutStep)", "src/engine/prompts.ts (scoutPrompt)"],
    what: "Before an expert writes a new program's spec, a cheap worker turn (network on, scratch folder) checks the machine and fetches one real example of the data the program handles, and the spec writer gets up to 10 facts.",
    optional: true,
  },
  {
    id: "F64",
    key: "auth-pause",
    name: "Signed out: pause, do not escalate",
    added: "2026-11-12",
    files: ["src/engine/run.ts (signedOut, stopFor)"],
    what: "When a tool's server rejects its login (expired or revoked), the run pauses with a sign-in hint instead of skipping the spec, calling the expert on the same dead login, or failing. After signing in, resume continues where it stopped.",
    optional: true,
  },
  {
    id: "F65",
    key: "spec-plan",
    name: "Opus plans the build in the spec turn",
    added: "2026-11-12",
    files: ["src/engine/run.ts (specStep)", "src/engine/prompts.ts (specPrompt, SPEC_SCHEMA)", "src/intake/brief.ts (renderBrief)"],
    what: "For a new program, the expert's spec turn also splits the build into 2 to 5 tasks of one short worker session each (about 300 lines and tests), with owned files and build order, and marks any part it should build itself. Those tasks become the plan with no extra planning turn; they start on the first worker rung. Acceptance runs move to the last task.",
    optional: true,
  },
  {
    id: "F66",
    key: "tier-pricing",
    name: "Long calls at their real price",
    added: "2026-11-12",
    files: ["src/backends/claude.ts (claudeParser)", "src/usage/prices.ts (estimateCost)", "src/backends/types.ts (LONG_PROMPT)"],
    what: "Claude Code calls whose prompt is over 100K tokens are counted apart and priced at the model's long-context rates (Haiku 5.5: five times). The SiteWatch run showed $0.36 where it cost about $0.80.",
    optional: true,
  },
  {
    id: "F67",
    key: "session-cap",
    name: "Fresh session past 90K",
    added: "2026-11-12",
    files: ["src/engine/run.ts (turn, SESSION_CAP)", "src/backends/claude.ts (peakPrompt)"],
    what: "A session whose largest prompt passed 90K tokens is not resumed: the next turn starts fresh from the brief and what went wrong. Only for tools that report usage per call (Claude Code).",
    optional: true,
  },
  {
    id: "F68",
    key: "split-ask",
    name: "The worker asks the expert to split",
    added: "2026-11-12",
    files: ["src/engine/run.ts (splitStep)", "src/engine/prompts.ts (splitNote, splitPrompt)"],
    what: "A worker that finds its task too big for one session, or too hard to get right, answers status \"split\". The expert divides it into worker-sized parts, keeping for itself only what needs deep reasoning (built before the parts that depend on it). The work so far is kept; whatever depended on the task depends on all the parts. Once per task; parts cannot be split again.",
    optional: true,
  },
  {
    id: "F69",
    key: "budget-handoff",
    name: "Expert parts go to a worker when the budget is spent",
    added: "2026-11-12",
    files: ["src/engine/run.ts (expertCanTake, driveTask)"],
    what: "A task the plan gives the expert goes to the top worker rung when the expert budget left cannot pay for one expert turn (estimated from this run's expert turns, at least $0.15). The same when the preset has no expert at all. An expert-owned turn stopped at the budget keeps its work; the checks decide, and any further turns on that task are the worker's, never a second expert turn.",
    optional: true,
  },
  {
    id: "F70",
    key: "cut-usage",
    name: "A stopped turn keeps the usage it streamed",
    added: "2026-11-12",
    files: ["src/engine/run.ts (once)", "src/backends/types.ts (Usage.estimated)"],
    what: "A Claude Code turn stopped before its final event (budget cut, timeout, stop) records the usage its stream reported so far: exact input and cache counts, output estimated from the text written and the thinking counts, marked estimated. It was recorded as unknown, which hid real spending.",
    optional: true,
  },
  {
    id: "F71",
    key: "one-review",
    name: "A planned build is reviewed once, as a whole",
    added: "2026-11-12",
    files: ["src/engine/run.ts (wantsTester, test step)", "src/engine/prompts.ts (testerPrompt)"],
    what: "When the spec split a new program into tasks (F65), the parts merge on their own checks and only the last one gets the tester, who reviews the whole program against the request with the acceptance runs. The earlier parts' testers could not run the unfinished program and found nothing (bookshelf run, 2026-11-12).",
    optional: true,
  },
  {
    id: "F72",
    key: "quota-log",
    name: "The usage log records the subscription quota used",
    added: "2026-11-12",
    files: ["src/usage/log.ts (quotaSpan, quotaText)", "src/engine/run.ts (once)"],
    what: "Each run records, per tool that reports it, the 5-hour and weekly quota readings at its first and last turn (Claude Code's rate-limit events), and the usage log shows them. Quota, not the API-price estimate, is what a subscription run costs.",
    optional: true,
  },
  {
    id: "F73",
    key: "heal-worktree",
    name: "Work folders are put right after an agent has been in them",
    added: "2026-11-12",
    files: ["src/workspace/workspace.ts (healWorktree)", "src/engine/run.ts (healTask)"],
    what: "Before and after every agent turn that may write, the engine checks the work folder and repairs what agents and their tools do to it: a deleted folder (made again from its branch), a stale git lock file, a half-done merge or rebase, a switched branch or detached HEAD (the branch name is put back, keeping the commits), and a git repository started inside the work, which would silently leave those files out of the result. Git commands that meet another process's lock file are tried again. Each used to end the run with an engine error or lose work. Found by the fault harness (evals/chaos.ts).",
    optional: true,
  },
  {
    id: "F74",
    key: "adapter-guard",
    name: "A crashing tool adapter is a failed turn, not a crashed run",
    added: "2026-11-12",
    files: ["src/engine/run.ts (once)"],
    what: "When a backend adapter throws (the tool could not be started, or its output broke the parser), the turn ends as an error like any other, with its usage unknown and its record kept; the fallback chain, the ladder and the expert apply as usual. It used to end the run with an engine error and leave the turn open in the event log.",
    optional: true,
  },
  {
    id: "F75",
    key: "sync-before-checks",
    name: "A task is tested with what the others have merged",
    added: "2026-11-12",
    files: ["src/engine/run.ts (syncTask)"],
    what: "Before a task's checks run, the work other tasks merged since it started is merged into its folder, and its diff is counted from there. The later of two tasks built at the same time used to be tested without the other's work: its checks failed through no fault of its own, the worker repaired nothing, the expert was called in and the task was marked failed while the merged result passed. Found by the fault harness (evals/chaos.ts).",
    optional: true,
  },
  {
    id: "F76",
    key: "leftover-stop",
    name: "A finished tool always ends its turn, and what it left running is stopped",
    added: "2026-11-12",
    files: ["src/backends/proc.ts (runProcess, taggedProcesses)"],
    what: "Every program a turn, a check or an acceptance run starts carries a tag in its environment. When the tool has exited, or was stopped at a time limit or by the person, whatever still carries the tag is stopped, and the turn ends even if its output pipe is still held open. A program the tool left running in a group of its own (a server started in the background) used to keep the turn waiting for as long as it lived, past every time limit, and survived the run. Found while reviewing the process runner for the fault harness.",
    optional: true,
  },
  {
    id: "F77",
    key: "direct-build",
    name: "A worker writes a planned part in one answer; the engine runs the checks",
    added: "2026-11-13",
    files: ["src/engine/run.ts (directApplies, directTurn, writeDirect)", "src/engine/prompts.ts (directPrompt, parseDirect)", "src/backends/claude.ts (claudeArgs)"],
    what: "Experimental, and only in presets that set \"direct\": true. For a worker's part of a program that has a spec, the worker is run with no tools: its prompt holds the spec, its task and the project's files, and its one answer holds its files. Neuromesh writes them and runs the checks; a failure goes back to it once the same way, and after that the worker gets its tools as before. One model call with a prompt of a few thousand tokens, in place of dozens of calls that each reread the whole conversation. After the owner's earlier research (a tight context and one low-effort answer) and the bookshelf run, where Haiku's agent turns were most of the quota.",
    optional: true,
  },
  {
    id: "F78",
    key: "three-tier",
    name: "Three tiers by difficulty: cheap workers, a senior tier, the expert",
    added: "2026-11-13",
    files: ["src/engine/run.ts (startRung, newTask, planFromSpec)", "src/engine/prompts.ts (specPrompt, parsePlan)", "src/presets/presets.ts (seniorLadder)"],
    what: "Only in presets that set a seniorLadder. The lead engineer marks each part of the build plan by how hard it is: \"worker\" (routine and fully specified; the cheapest model), \"senior\" (design judgement or many interacting rules; a mid-priced model) or \"expert\" (the hardest logical core; the lead engineer builds it, within the expert budget). The senior rungs sit above the worker rungs on one ladder: a senior part starts on the first senior rung, and a worker stuck on its last rung climbs to the senior rungs before the expert is asked. The spec is also told the preset's task limit, so its plan is not cut off. The owner's idea (2026-11-13): Opus plans and takes what would defeat the others, Sonnet builds the moderately hard parts, Haiku the easy repetitive ones.",
    optional: false,
  },
  {
    id: "F79",
    key: "finding-owner",
    name: "A reviewer's finding is fixed on the rung that built the file it names",
    added: "2026-11-13",
    files: ["src/engine/run.ts (strongerOwner, climbTo)"],
    what: "The finished program gets one review, and its findings used to go to the last task's worker, usually the cheapest model, whatever file they were in. When a finding names a file that another task built on a stronger rung (a senior part, or the expert's), the fix now starts on that rung in a fresh session that is told the findings. From the first three-tier run on the hard task (2026-11-13): a flaw in the senior tier's number formatting went to Haiku, which first documented it as a known difference, then needed 19 minutes and 200K output tokens over two more turns; that loop was 21 of the run's 49 minutes.",
    optional: true,
  },
  {
    id: "F80",
    key: "tier-router",
    name: "Tier 0: the request's starting tier, with no model call",
    added: "2026-11-14",
    files: ["src/routing/router.ts (routeTier, stripMeta)", "src/engine/run.ts (startRun, newTask, rungForTier)"],
    what: "Only in presets that set \"cascade\". The routing architecture's zero-token bouncer: rules first (a trivial change is the grunt's; a very large request is the expert's to blueprint), then a weighted match of the request against four clusters of work (grunt, worker, senior, expert) standing in for the architecture's local embeddings, since Neuromesh has no runtime dependencies. When the best cluster has under 65% of the match, stage 0C (F81) decides. Sentences that tell the router which model to use are removed before scoring. The run's one task starts on the first rung of the chosen tier; an expert request in a team preset is planned (the sandwich, F85). From the routing architecture the owner brought in (2026-11-13).",
    optional: true,
  },
  {
    id: "F81",
    key: "route-calibration",
    name: "Tier 0C: the cheapest tier that past runs say will succeed",
    added: "2026-11-14",
    files: ["src/routing/calibration.ts (calibrated, record, demote)", "src/engine/run.ts (cascadeEnd)"],
    what: "Only in presets that set \"cascade\". For an ambiguous request, picks the cheapest tier whose estimated success on that cluster of work is at least alpha (default 0.8). The estimate starts from a stated prior and moves with this machine's own outcomes: at the end of a finished run, every task Tier 0 placed adds its tiers (each failed except the last, which passed or failed) to ~/.neuromesh/routing/calibration.json, once. A shadow grade that rejects a pass (F88) counts it as a failure. `neuromesh routing` prints the table. Stands in for the architecture's RouteLLM classifier, which needs win-rate data Neuromesh does not have.",
    optional: true,
  },
  {
    id: "F82",
    key: "grunt-tier",
    name: "A grunt tier below the workers, gated only by deterministic checks",
    added: "2026-11-14",
    files: ["src/engine/run.ts (gruntGate, tierAtRung, wantsTester, onStuck)", "src/presets/presets.ts (gruntLadder)"],
    what: "Only in presets that set a gruntLadder. The cheapest rungs come first on the ladder; the plan may give a part to \"grunt\" (mechanical work the brief fully determines). Gate 1 of the routing architecture: a grunt is never asked to judge or repair its own work. When its work fails the checks or the reviewer, or its turn fails, the task goes to the first worker rung at once with the errors. A grunt's work that no check verifies is always reviewed.",
    optional: true,
  },
  {
    id: "F83",
    key: "early-exit",
    name: "Early exit: a worker or senior turn that judges the task beyond it is stopped and climbs a tier",
    added: "2026-11-14",
    files: ["src/routing/preamble.ts (parsePreamble, shouldExit)", "src/engine/run.ts (preambleGate, once, driveTask)", "src/backends/claude.ts, codex.ts, opencode.ts (onText)"],
    what: "Only in presets that set \"cascade\". Gate 2 of the routing architecture: a worker or senior turn's first message must be a one-line JSON preamble (confidence, escalate, reason, bottleneck). When it asks to escalate or its confidence is under the tier's threshold (default 0.75 worker, 0.80 senior), the engine stops the tool's process and the task climbs to the first rung of the next tier, or goes to the expert from the senior tier. The CLIs give no log-probabilities and stream whole messages, so the gate reads the first text message instead of the first 25 tokens. Self-reported confidence is not calibrated: the grunt never gets the preamble, and a turn that does not start with one is let through.",
    optional: true,
  },
  {
    id: "F84",
    key: "bottleneck-diagnostic",
    name: "The expert sees the stuck developer's diagnosis of the one sub-problem, not the whole history",
    added: "2026-11-14",
    files: ["src/engine/run.ts (diagnoseStep)", "src/engine/prompts.ts (diagnosePrompt, advisePrompt)"],
    what: "Only in presets that set \"cascade\". Gate 3 of the routing architecture: before the expert's advice, the stuck developer is asked, in its own session and read-only, for at most 150 words isolating the sub-problem (or its early-exit preamble already gave one). The advice prompt then holds that diagnosis and the latest failure in place of the attempt history. The expert can still read the code.",
    optional: true,
  },
  {
    id: "F85",
    key: "blueprint-expert",
    name: "The expert writes the blueprint and builds nothing",
    added: "2026-11-14",
    files: ["src/engine/prompts.ts (cascadeOwners, parsePlan)", "src/engine/run.ts (blueprintOn)"],
    what: "Only in presets that set \"cascade\" (blueprint defaults to on). The routing architecture's Architect-Worker sandwich: the lead engineer's spec or plan gives no part to itself; for the hardest part it writes the decision, the algorithm as numbered steps and the invariants into that part's brief, for a senior (or worker) developer to build. A plan that still marks a part \"expert\" has it moved to the senior tier. From the hard-task run, where Opus spent the whole $3 expert budget building the query executor itself (docs/18-hard-task.md).",
    optional: true,
  },
  {
    id: "F86",
    key: "escalation-breaker",
    name: "At most N tasks per run go to the expert",
    added: "2026-11-14",
    files: ["src/engine/run.ts (breakerTripped)"],
    what: "Only in presets that set \"cascade\" (default 2). The routing architecture's circuit breaker: once that many tasks of a run have had the expert's advice or takeover, another stuck task keeps its work if the project's checks pass, or fails, instead of calling the expert. The ladder itself only climbs, so escalation cannot ping-pong.",
    optional: true,
  },
  {
    id: "F87",
    key: "routing-summary",
    name: "The cascade's measured economics at the end of a run",
    added: "2026-11-14",
    files: ["src/routing/summary.ts (routingSummary, describeSummary)", "src/engine/run.ts (cascadeEnd, cascadeTierOf)"],
    what: "Only in presets that set \"cascade\". At the end of a finished run, the routing.summary event gives the architecture's cost model measured on the run: the share of tasks that finished on each tier (p_i), each tier's turns and estimated cost, the cost outside the ladder, the cascade overhead (turns on tiers a task later left, and turns the early-exit gate stopped) and the same tokens priced at the expert model. All dollar figures are estimates at API list prices; unpriced turns are counted, never priced at $0.",
    optional: true,
  },
  {
    id: "F88",
    key: "shadow-eval",
    name: "A sample of the cheap tiers' passes is kept for a stronger model to grade",
    added: "2026-11-14",
    files: ["src/routing/shadow.ts (maybeEnqueue, gradePrompt)", "src/cli/main.ts (routing grade)"],
    what: "Only in presets that set \"cascade\" (default 1%). When a task passes on the grunt or worker tier, its brief and diff are kept, with that chance, in ~/.neuromesh/routing/shadow on this machine. `neuromesh routing grade` (live model calls, run only when asked) has the preset's senior model grade them; a rejected pass counts as a failure in the calibration table (F81), so Tier 0 learns where it routed too low.",
    optional: true,
  },
  {
    id: "F89",
    key: "instruction-scoring",
    name: "Tier 0 scores the instruction, not pasted material, and sends inline transforms to the grunt",
    added: "2026-11-14",
    files: ["src/routing/router.ts (splitPayload, isTransform, stripMeta)", "src/engine/run.ts (startRun)"],
    what: "Only with the cascade. The request is split into its instruction and the material pasted into it (quoted text, fenced code, log and data lines, a block after a line ending in a colon, data after a colon). Only the instruction is scored, so a quoted note that mentions a migration, or a kernel log full of eBPF jargon, no longer looks like senior or expert work. A request whose instruction only changes the form of the pasted text (turn into, rewrite, extract, list, sort...) and asks for no judgement (flag, summarise, debug, fix, make it thread-safe...) goes to the grunt, empty workspace or not; negated verbs (\"dont debug it yet\") do not count. Also keeps the request's line breaks when sentences asking for a model are removed (they used to be flattened). From the first routing benchmark run (2026-11-14): Tier 0 picked the suite's starting tier for 6 of 15 prompts and never the grunt; with this, 11 of 15, and 10 of 10 on prompts outside the suite.",
    optional: true,
  },
  {
    id: "F90",
    key: "direct-grunt",
    name: "The grunt answers an inline transform once, with no tools",
    added: "2026-11-14",
    files: ["src/engine/run.ts (directGrunt, directApplies, directTurn)", "src/engine/prompts.ts (directAnswerPrompt)"],
    what: "Only with the cascade, when Tier 0 found an inline transform (F89) and the task is on a grunt rung. The grunt gets one call with no tools (F77's one-answer mode: no Claude Code tool definitions, a one-line system prompt) holding the request and the project's few files, and returns the files as JSON; Neuromesh writes them and runs the checks. An unusable answer gives the grunt its tools; failing checks send the task to the worker (F82). On the first benchmark run Haiku processed 30K to 86K tokens per formatting prompt, most of them Claude Code's own session prompt.",
    optional: true,
  },
  {
    id: "F91",
    key: "gate-floor",
    name: "The early-exit gate trusts the developer's own escalate: false above a floor",
    added: "2026-11-14",
    files: ["src/routing/preamble.ts (GATE_FLOOR)", "src/engine/run.ts (startRun)"],
    what: "Only with the cascade. A worker or senior turn is stopped when its preamble says escalate: true, or when its confidence is below the floor (0.55, or the preset's thresholds), instead of below the architecture's 0.75 and 0.80. From the first benchmark run: Sonnet reported 0.70 and escalate false on prompt 4.2, the 0.80 threshold sent it to Opus anyway, and Sonnet then built it with no gain ($0.11 more). Haiku's 0.30 on the impossible sort is still caught. Off, the gate uses 0.75 and 0.80.",
    optional: true,
  },
  {
    id: "F92",
    key: "blueprint-cap",
    name: "The expert's blueprint is asked to stay under about 400 words",
    added: "2026-11-14",
    files: ["src/engine/prompts.ts (cascadeOwners)"],
    what: "Only with the cascade's blueprint mode (F85). The lead engineer's plan is asked to stay under about 400 words: bullet points, invariants and the signatures the parts build against, with no function bodies, full code blocks or prose about what the developers will write. The CLIs have no output-token limit, so the limit is in the brief. On the first benchmark run Opus's plan for 4.1 was 6,543 output tokens ($0.20), and the sandwich cost as much as Opus alone.",
    optional: true,
  },
  {
    id: "F93",
    key: "senior-first-expert",
    name: "An expert request that is not large starts on the senior; the expert advises only on escalation",
    added: "2026-11-14",
    files: ["src/engine/run.ts (startRun)"],
    what: "Only with the cascade. Tier 0 sends a request to the expert either by its size rule (800 words or 12 files named: many parts) or by what it is like (similarity or calibration). Only the first gets the sandwich, where the expert plans and blueprints and the tiers below build. The second starts on the senior's first rung with its preamble gate; if the senior escalates, the expert advises from its bottleneck diagnostic (F84) and builds nothing. On both benchmark runs prompt 4.1 (one Rust file and its explanation) cost as much in the sandwich as Opus alone ($0.339 against $0.338): the plan for a single deliverable is nearly the size of the deliverable, and the 400-word cap (F92) was not kept. Off, every expert route gets the sandwich.",
    optional: true,
  },
  {
    id: "F94",
    key: "subsystem-breadth",
    name: "A short new build across three or more subsystems goes to the expert's plan",
    added: "2026-11-14",
    files: ["src/routing/router.ts (DOMAINS, buildBreadth, routeTier)", "src/engine/run.ts (startRun)", "src/cli/routing.ts"],
    what: "Only with the cascade. Tier 0's rules stage counts the technical domains a request to build something names (auth, crypto, network, storage, runtime, interface, ingest, ml). Three or more, with no code file named and the thing to build not a single unit (a function, script, middleware, hook, endpoint...), means several subsystems nobody has designed: the request goes to the expert at the rules stage, so it gets the sandwich (F93). Not for a fix, a refactor or a trivial change. From the owner's friend's review: a 45-word request for an agent that logs in to sites, routes keys through a proxy and keeps state in a file went to Sonnet with no plan, while the plan rules only look at length (800 words, 12 files). Checked against 4 such requests and 3 decoys written outside the project; none of the 15 benchmark prompts changes route.",
    optional: true,
  },
  {
    id: "F95",
    key: "stub-gate",
    name: "Stand-ins for an implementation fail the task like a failing check",
    added: "2026-11-14",
    files: ["src/checks/stubs.ts", "src/engine/run.ts (the checks step)"],
    what: "After each build turn the lines it added to non-test source files are scanned for unambiguous stand-ins: unimplemented!() and todo!() in Rust, raise NotImplementedError, throw new Error(\"not implemented\"), panic(\"todo\"), 'TODO: implement' and the like, and a Python function whose body is only pass or .... Abstract methods, overloads and protocols are exempt, and a plain TODO, a mock_ name or an empty callback is never a stub. A stub adds a failing 'stub-gate' result, so the task is repaired (or climbs, for the grunt) with the places listed. No model call.",
    optional: true,
  },
  {
    id: "F96",
    key: "scope-escalate",
    name: "The developer may say a request needs a design first; the expert then divides it",
    added: "2026-11-14",
    files: ["src/routing/preamble.ts (preambleInstruction, parsePreamble, shouldExit)", "src/engine/run.ts (scopeAsked, the early-exit step, splitStep)"],
    what: "Only with the cascade, and only for the run's one unplanned task (a planned part's design is already in its brief). The worker's or senior's preamble may say scope: true, meaning the work needs 4 or more new source files or modules, interfaces or formats the request does not specify. The turn stops at once and the expert divides the task (F68's split, blueprint-only with F85), instead of a stronger builder taking it whole or the expert only advising. The safety net for a request Tier 0 misjudged (F94). If the split is not usable, the developer starts the task fresh.",
    optional: true,
  },
  {
    id: "F97",
    key: "retry-first-turn",
    name: "A first turn that stopped before changing anything is tried again as a first turn",
    added: "2026-11-14",
    files: ["src/engine/run.ts (leftChanges, the turn-stopped step, resumeRun)"],
    what: "When a task's first turn stops on quota, a revoked login or an interrupt, or the engine dies during it, the next turn used to be a 'continue' turn in case files had changed. A continue turn gets no confidence preamble (F83, F96) and no one-answer mode (F77, F90). Now it is a continue turn only if the task's folder holds changes; otherwise the first turn is asked again. Seen in a real run: resumed after a revoked Claude login, Sonnet's turn on the agent request had no preamble, so the F96 scope question was never asked. Off, as before.",
    optional: false,
  },
  {
    id: "F98",
    key: "cascade-one-review",
    name: "A build the cascade's expert planned or split is reviewed once, when it is whole",
    added: "2026-11-14",
    files: ["src/engine/run.ts (reviewsWhole)"],
    what: "Only with the cascade. F71's one review of the whole program, which applied only to plans made from a spec, now also applies when the expert planned the run (the sandwich) or split its task (F68, F96). The parts are not reviewed one by one; the last one gets the whole-program review, and the preset's test setting still decides whether that runs ('no-checks': only when the finished program has no checks). From the first live F96 run: three per-part Sonnet reviews were 42% of the cost ($0.22 of $0.53) and found no blocker, while the last part, the one that joined them, was not reviewed because by then the program had tests.",
    optional: true,
  },
  {
    id: "F99",
    key: "prose-guard",
    name: "A sentence after \"In <file>:\" is the instruction, not pasted data",
    added: "2026-11-14",
    files: ["src/routing/router.ts (inlineData, splitPayload)"],
    what: "F89 took the text after a colon on one line as pasted data when it held six digits or separators, so \"In src/ringbuf.rs: fix the memory ordering race condition when capacity > 1024, consumers == 8, and wrap-around exceeds 65535\" was scored as \"In src/ringbuf.rs\" alone and went to the worker instead of the expert. Now that text is data only if it does not start with an imperative verb and at least a quarter of its characters are digits or the punctuation of lists, tables, JSON and logs. Found on a real follow-up request (373 characters of instruction treated as data). Off, F89's rule as before.",
    optional: true,
  },
  {
    id: "F100",
    key: "start-here",
    name: "Where a task most likely begins, as line ranges",
    added: "2026-11-14",
    files: ["src/context/packet.ts (startHere)", "src/engine/prompts.ts (startSection)", "src/engine/run.ts (start step)"],
    what: "Per task, from the task's own brief and with no model call: the definitions whose names match its words, as file:line ranges, the body of the best match when it is short, with files of the last commits breaking ties. F12 maps the repository once for the request; this points one task at its starting lines, so a planned part does not spend its first turns finding them. The match is lexical and can be wrong, so it is worded as where to look first and never as a limit, and it says nothing unless the task names a definition outright (written as an identifier), one of its words is a file's own name, or several weaker matches fall in one file. From a friend's review (docs/21-phase-2-review.md). kept: fired 11 times, under $0.001; first read hit a listed file 7 of 10.",
    optional: true,
  },
  {
    id: "F101",
    key: "blind-tests",
    name: "Tests written without seeing the code",
    added: "2026-11-14",
    files: ["src/checks/blind.ts", "src/engine/run.ts (blindStep, blindApplies, checks step)", "src/engine/prompts.ts (blindPrompt, blindFinding)"],
    what: "For work on state, parsing, limits or an algorithm that has passed the project's checks: a cheap developer gets the task and the signatures of what was written (taken from the files, no model call), in a folder that holds nothing of the code, and writes one or two test files; the engine runs them on a copy. All pass: nothing changes and they are not kept. They cannot load (a guessed name): dropped. Some fail: they go into the task's folder and the developer gets one turn to judge each against the task (fix the code, or correct the test). If the checks still fail with them after that turn, the engine takes them out and records them, so a wrong blind test costs one cheap turn at most and never an escalation. Once per task; not for the expert's own work or the grunt's. The answer is kept with the task while its tests run, so an engine that dies there does not pay for it again. After the first live run (signatures alone gave 15 wrong tests of 22, and the gap that mattered was one the request leaves open): the tester is also shown the start of the tests that were already there for the changed files, as they were before the work, and may add one open probe (above all for something that grows without limit, checked by comparing sizes); a failing open probe is a one-sentence question for the person, shown with the result, never a gate, a turn or a kept file. From a friend's review. One live run each way (docs/21-phase-2-review.md). Off by default 2026-11-17: 83 live turns across rb-cascade-3..6, ho-*, rt-haiku-1; about 7% of cascade-claude cost (27% on solo presets); no bug caught that a later check confirmed (helped 1 arguably, hurt 3: a wrong test in ss2-notes-bound, empty results in nm-stub-scanner and nm-first-turn-retry). Switch it on with --enable blind-tests, NEUROMESH_ENABLE=blind-tests or \"enable\": [\"blind-tests\"] in a preset. Re-measure on evals/real-tasks-2 with it on.",
    optional: true,
    defaultOff: true,
  },
  {
    id: "F102",
    key: "repair-race",
    name: "Two fresh repair attempts side by side before a dearer tier",
    added: "2026-11-14",
    files: ["src/engine/run.ts (raceStep, raceApplies)", "src/engine/prompts.ts (racePrompt, RACE_HINTS)"],
    what: "A task whose checks still fail after its repair rounds, at the point where the next step is a dearer tier or the expert: two fresh developers of its own tier repair it side by side, each in its own copy and each told to go about it differently (patch in place; rewrite the failing part from the requirement). The project's checks pick the winner (the smaller change when both pass) and its change becomes the task's; with no winner the task goes on to where it was headed. Only where the project has checks, once per task, and only in runs that have somewhere dearer to go. A stopped race is run again from the start on resume. From a friend's review. Not yet measured live. Unmeasured: never fired in 285 runs.",
    optional: true,
  },
  {
    id: "F103",
    key: "evidence-override",
    name: "This machine's record overrules a confident Tier 0 match",
    added: "2026-11-14",
    files: ["src/routing/calibration.ts (evidencePick)", "src/routing/router.ts (routeTier, probeDraw)", "src/engine/run.ts (startRun)"],
    what: "F81's table was consulted only when the similarity stage was unsure. Now, when that stage is confident but the tier it picked has been tried at least 5 times on that kind of work and its estimate is under the quality bar, the request starts on the cheapest tier above that clears it; and a cheaper tier with 5 tries that clears the bar is used instead of the matched one. A preset may also set cascade.probe, the share of confident senior matches started on the worker (chosen by a hash of the request, so a benchmark repeats), which is the only way the worker's rate on senior work is ever learned; default 0. From a friend's review. Not yet measured live. Unmeasured: never fired in 285 runs.",
    optional: true,
  },
  {
    id: "F104",
    key: "quota-shift",
    name: "Cheap turns leave a subscription that is running low",
    added: "2026-11-14",
    files: ["src/engine/quota.ts", "src/engine/run.ts (quotaShiftFor, turn, once)", "src/presets/presets.ts (quotaShift)", "presets/cascade-hybrid.json"],
    what: "A preset names a tool whose subscription window is watched, a threshold, and another plan's models. Every reading a tool reports is kept in ~/.neuromesh/quota.json; when the window is at or past the threshold, grunt, worker and reviewer turns on that tool go to the other models first, and senior and expert turns stay. A reading whose window has reset, or older than five hours, is unknown, and an unknown moves nothing. From a friend's review. Not yet measured live. Unmeasured: never fired in 285 runs; its only preset, cascade-hybrid, targets GPT-6 Luna, which is no longer used.",
    optional: true,
  },
  {
    id: "F105",
    key: "choices-shown",
    name: "What the developer chose alone and left open, shown in full",
    added: "2026-11-15",
    files: ["src/engine/prompts.ts (reportSchema, choiceFields)", "src/engine/run.ts (task.report events)", "src/cli/format.ts", "src/tui/blocks.ts, src/tui/app.ts"],
    what: "A developer's report has two more fields, choices (each decision it made alone because nobody could be asked) and open (what it left out or could not settle). They are kept whole in the task's report and shown in full under the task, instead of being cut to 200 characters inside the notes (the first live run of F101 showed the worker had written \"no size cap; the request did not ask for one\" and the owner never saw it). No extra turn, no extra check. Off, the report is as before. Plan item D6. Not yet measured live.",
    optional: true,
  },
  {
    id: "F106",
    key: "input-split",
    name: "Where a turn's input tokens went, in five parts",
    added: "2026-11-15",
    files: ["src/usage/split.ts", "src/engine/run.ts (inputSplitOf, once)", "src/tui/view.ts (context meter)", "evals/bench.ts (--split)"],
    what: "For Claude turns, the turn's kept log is read after the turn and every model call's prompt (which the tool reports exactly) is shared out between the tool's own start-up (system prompt and tool definitions), Neuromesh's prompt, files read (Read, Grep, Glob results), command output (everything else a tool returned) and the model's own earlier output in the turn; the shares come from character counts, so they are estimates and say so. The split is kept in the turn's usage and summed with it, shown in the TUI context meter and in `node evals/bench.ts --split`, which can also read it from the kept logs of runs made before this existed (then start-up and prompt stay together). A resumed session's first call is shown as its own part. No turn, no token. Plan item M5. Not yet checked against a live run.",
    optional: true,
  },
  {
    id: "F107",
    key: "paired-bootstrap",
    name: "Two configurations compared task by task, with an interval",
    added: "2026-11-15",
    files: ["src/eval/stats.ts", "evals/bench.ts (--compare)"],
    what: "`node evals/bench.ts --compare a1,a2,a3 b1,b2,b3 [--margin 10]` takes each configuration's runs, scores each task as the share of its runs that passed, pairs the tasks both ran, and resamples the tasks 10,000 times (seeded, no dependency) for a 90% interval of the mean difference. It prints \"not worse than B by more than d: shown / not shown\" (shown when the interval's low end is above -d), whether A is better or worse or cannot be told apart, and the margin the data can show at best; an interval with no width is called a ceiling, not a margin. Plan item M2. No model call; checked on synthetic data (test/stats.test.ts) and saved evals.",
    optional: true,
  },
  {
    id: "F108",
    key: "run-record",
    name: "One append-only record of every turn and decision",
    added: "2026-11-15",
    files: ["src/record/record.ts", "src/record/backfill.ts", "src/record/cli.ts", "src/engine/store.ts (EventLog)"],
    what: "Every engine event that is a model turn or a decision (started on a tier, climbed, raced, asked for a review, split...) is also appended, as one JSON line with the inputs the event carried, to ~/.neuromesh/record/record.jsonl; a run's end adds a run line and a line per task from run.json, which is what happened after. The same lines are made from run folders already on disk by `node src/record/cli.ts backfill` (also benchmark results, evals and the owner's ratings), and asked with summary, turns, decisions, runs and results. No request text, code, diffs or paths; an unknown number is left out, never 0; a cost is an estimate. A failure in the record switches it off for that run and is tagged with the feature; the run is never touched. Plan item L1; the base of replay (M6), regret (D3) and the controller. Not yet read by anything.",
    optional: true,
  },
  {
    id: "F109",
    key: "direct-worker",
    name: "A cascade worker answers a small self-contained request, or a planned part with a spec, in one call with no tools",
    added: "2026-11-15",
    files: ["src/routing/selfcontained.ts (selfContained)", "src/engine/run.ts (directWorker, directApplies, directTurn)"],
    what: "Only with the cascade, for a task on a worker rung that has not been escalated or advised. (1) The task is the whole request and it is small and self-contained (at most 100 words, at most 2 named files, a small project, nothing to run, install or look at, no explanation, derivation or complexity bound asked for): one no-tools call with the request and the project's files, as F90 does for the grunt; Neuromesh writes the files and runs the checks, and a failure goes to a worker with tools. (2) The task is a part the expert planned and it has a spec: as F77 does, a build and one repair with no tools, then tools. An unusable answer gives the worker its tools. Tier 0 is not involved (router.ts and brief.ts are untouched): this only decides how a worker turn already on a worker rung is run. From F106 on the live benchmark runs: a tool turn read 95 to 1,033 thousand tokens, 42 to 50 percent of the cascade's input start-up and prompt and 47 to 55 percent earlier turns, against about 4 thousand for one no-tools call. A no-tools turn has no confidence preamble, so the early-exit gate (F83, F91) does not see it: a request that may be impossible is kept on tools by the rule's judgement and complexity-bound cues. Plan item C1. The first live run (rb-cascade-5, ho-cascade-2) never fired it: the one-line check was given the engine's prompt, which has the brief's working standards appended (182 words for a 44-word request, and the word \"install\"), instead of the user's own request; fixed 2026-11-16 (STATUS 49). KEPT 2026-11-16 on rb-cascade-6 (one run): it fired on 2.1, 2.2, 2.3, 3.1 and 5.1, which went from 43 calls and 794.7k input tokens (rb-cascade-5) to 8 calls and 46.3k (minus 94.2 percent), all five 10.0 of 10; 4.3 and 5.3 stayed on tools with their preamble, and the 5.3 gate still stopped the worker. Whole suite: 84 to 54 calls, 1,370k to 969k input, 147.8 of 150 against 147.9 (Gap@Oracle 0.1 percent), CostSave 82.3 percent (87.1 weighted). Not yet re-run on the held-out set (H1.3 and H5.1 are the ones it should take).",
    optional: true,
  },
  {
    id: "F110",
    key: "structured-rescue",
    name: "A report the tool could not format is taken from its last attempt, and the report schemas ask for less",
    added: "2026-11-16",
    files: ["src/engine/prompts.ts (the report, direct-answer and blind-test schemas, rescueStructured)", "src/engine/run.ts (once)", "src/backends/claude.ts (lastStructured)"],
    what: "In the kept logs of 394 Claude turns that gave their answer through the StructuredOutput tool, 79 had a rejection (\"must have required property 'notes'\", 'run', 'choices', 'open') and 5 failed after the tool's fifth: the model leaves out a string field it thinks is empty, and the tool ends the turn with error_max_structured_output_retries after the work is done. That ended a solo task (the work kept but graded as a failure) or climbed a cascade task a rung. Now (1) the report schema requires only status and summary, the one-answer schema only files and summary, and a blind test only path and content (the other fields stay in the schemas and in the prompts' wording, an empty string when there is none; the tester's verdict is unchanged); (2) the Claude adapter keeps the input of the last StructuredOutput call, and when a turn ends with that error the engine takes it as the answer if the matching parser would accept it (a summary for a report; at least one usable file for a one-answer turn), keeping only keys the schema has, and says so in a structured.rescued event with the fields that were missing. Anything else ends as before. Off, the schemas and the failure are as before. Measured on the kept logs only: 134 rejected calls carried 4.39M of 56.1M tokens, and the 5 failed turns 1.53M tokens and 276 s; not measured live yet.",
    optional: true,
  },
  {
    id: "F111",
    key: "telemetry-summary",
    name: "Weekly reader for testers' reports",
    added: "2026-11-16",
    files: ["src/telemetry/summary.ts", "src/cli/main.ts (commandTelemetry)", "src/telemetry/telemetry.ts (flush, pull)"],
    what: "`neuromesh telemetry summary [--since 7d|24h|2w|<date>|all] [--offline]` (the author's): fetches new reports with the admin token (unless --offline or there is none), then prints from the inbox the runs by preset, the rating spread, the bad runs (failed, paused, checks failed or rated 1 or 2) labelled engine, environment, wrong code, unclear request or unknown by fixed rules over the report's fields (no model call), the features that failed, and the five lowest-rated runs with what was asked and what came back. With it, a report the endpoint refuses for good (400, 413) moves to ~/.neuromesh/telemetry/rejected instead of blocking the ones behind it, `flush` says why a report is still waiting (shown after a CLI run, as a notice in the TUI, and by `telemetry status`), and `pull` goes on past 1,000 reports. Plan items B4 and L5. Off, none of these changes: the summary command says so.",
    optional: true,
  },
  {
    id: "F112",
    key: "tool-preflight",
    name: "Check the tools before a run",
    added: "2026-11-16",
    files: ["src/cli/preflight.ts", "src/cli/main.ts (commandRun, commandDoctor)", "src/tui/app.ts (start)", "src/doctor/doctor.ts (installHint)"],
    what: "Before `neuromesh run` or a TUI run, each tool the preset calls is asked for its version (no model call). If one is not installed, the run does not start and the message says which tool, where to get it and to sign in; before this, a tester without Claude Code watched five retries and an escalation end in \"execvp() of 'claude' failed\" with `neuromesh resume` offered. `neuromesh doctor` now says how to install a missing tool, warns that it makes a few tiny live calls, and ends by saying whether the default preset is ready. Off (or with --backend, which replaces the worker's tool), the run starts as before. Found in the first-run check of 2026-11-16.",
    optional: true,
  },
  {
    id: "F113",
    key: "bad-run-report",
    name: "Report a bad run in one command",
    added: "2026-11-17",
    files: ["src/telemetry/report.ts", "src/cli/main.ts (commandReport)", "src/telemetry/telemetry.ts (redact)"],
    what: "`neuromesh report [run] [--note \"what went wrong\"]` writes ~/.neuromesh/reports/<run-id>.md for a tester to read and paste into a GitHub issue: the version, OS, Node, preset and models; how the run ended and which features failed; the run's event timeline (types, tiers, models, stop reasons, durations, token counts, check names with pass or fail; the agents' own activity is left out); the agents' final reports; the request and the note. Nothing is sent anywhere and no run data goes in the URL it prints. The text goes through the same redactor as F52 (now `redact` in telemetry.ts, which F52's `scrub` calls): fenced code and diff hunks, emails, URLs and host names, keys and tokens (sk-, ghp_, long hex or base64, name=value secrets), the user, host and repository names, and every file path (as <path>) are taken out, and the report says how many of each. The file is cut to about 30 KB from the front of the timeline, so the end of the run stays. Plan item B5 (docs/22). Before it, TESTING.md asked testers to paste `neuromesh status last` and remove the private parts by hand. Off, the command says so.",
    optional: true,
  },
  {
    id: "F114",
    key: "short-output",
    name: "Agents run long-output commands through nm run, which keeps the failures and both ends",
    added: "2026-11-17",
    files: ["src/tools/shortout.ts (shorten, onlyCommand)", "src/tools/nm.ts (run, checks --only)", "src/engine/prompts.ts (toolsNote)"],
    what: "In a worker turn every model call reads the whole conversation again, so a long command output is paid for again on every later call; in the logged 2.05M-token turn (nm-first-turn-retry) 29 percent of the input was command output (107k characters; test runs printing 5 to 13k each). Neuromesh cannot edit Claude Code's history, but it controls the tool and the prompt. (1) `nm run -- <command...>` (F13's tool) runs the command (sh -c, the repository as cwd, the 5-minute limit `checks` uses), saves everything it prints to a log in the system temp folder (never in the repository), and prints `exit <code>`, the log's path and: all of the output when it is under 2,000 characters; otherwise the lines that look like failures (fail, error, panic, assert, expected, not ok, ✗, ×; one line of context after each, at most 40), the first 15 and last 25 lines, about 3,000 characters in all, and how many lines were left out. (2) `nm checks --only <file or pattern>` runs one test file through node --test (the package's own flags), `cargo test <name>` or pytest; any other project gets a line saying so and all the checks. (3) The nm-tools prompt (workers, seniors, reviewers: every prompt that carries it) gains one short line telling the agent to run tests, builds and long commands through these, one test file while iterating and the full checks once at the end, and to batch related edits. Plan item C7. Not measured live: judge it by input tokens per prompt on the next routing run (4.3 is the target: 633k of 969k). Off, the tool still works but no prompt mentions it.",
    optional: true,
  },
  {
    id: "F115",
    key: "reproduce-first",
    name: "Reproduce the bug first",
    added: "2026-11-17",
    files: ["src/engine/reproduce.ts", "src/engine/run.ts (reproduceStep, reproduceGuard)"],
    what: "For a request the brief calls a bug fix (Brief kind \"bug\"; the whole request as one task, not on a grunt rung, not a no-tools direct answer), before the first build turn: one turn on the preset's cheapest worker model at low effort, with tools, writes ONE new test file that reproduces the reported bug through the public interface, in the project's test style and runner, changing no other file. The engine runs only that file (its runner picked from the project's files, no model call) and keeps it only if it FAILS on the current code for a reason other than a syntax, name or import error. A test that passes on the seed, cannot load, or came with a changed non-test file is discarded, with an event, and the task goes on as if the feature were off. A kept test stays in the work; its command joins the task's checks, so the build must make it pass; the build prompt gets one line saying where it is and not to weaken it; if a build turn edits it, the engine puts it back (reproduce.restored). At most one turn per task, recorded as its own attempt kind (reproduce). A crash, timeout or garbage answer from the turn switches the feature off for the run. Plan item O1 (docs/22-path-to-the-goal.md): the oracle F101's blind tests were not, because a test that must fail on the seed is filtered for being wrong. Off by default until measured: neuromesh eval --suite evals/real-tasks-2 --kinds bug --preset cascade-claude --enable reproduce-first --name rt2-cascade-repro-1, against the plain cascade run on the same tasks. Switch it on with --enable reproduce-first, NEUROMESH_ENABLE=reproduce-first or \"enable\": [\"reproduce-first\"] in a preset.",
    optional: true,
    defaultOff: true,
  },
  {
    id: "F116",
    key: "network-pause",
    name: "Lost network: pause, do not fail or escalate",
    added: "2026-11-17",
    files: ["src/engine/run.ts (OFFLINE, offline, held, stopFor)", "test/support/chaos.ts (offline fault, outage scenario)"],
    what: "A turn that cannot reach its service (connection refused, DNS failure, no route, connection reset, a firewall or proxy) is tried once more, as a dropped connection always was (ECONNREFUSED and the DNS errors joined that list); if it fails the same way again, the run pauses with \"check the network, then resume\" instead of failing the task, climbing the ladder or calling the expert, since no model can get past it. A stall or a 5xx is left as it was: those can be the model's own trouble. Seen 2026-11-17: overnight, the network dropped during rt2-haiku-1 and eight tasks were recorded as failed with 0 tokens after 18 to 24 minutes each; the fault harness then showed the cascade sending a task to the expert on a dead network. Same shape as F64 auth-pause.",
    optional: true,
  },
  {
    id: "F117",
    key: "empty-done",
    name: "Done with no change: asked once",
    added: "2026-11-17",
    files: ["src/engine/run.ts (EMPTY_DONE, the checks step)", "src/engine/types.ts (emptyAsked)", "test/support/chaos.ts (rule: a task passed with no change after one turn)"],
    what: "When a build turn ends (done, blocked or with no answer; not a split), the workspace has no change at all, no check is failing and no other task of the run changed anything, a failing 'empty-done' result is added once, so the task gets a repair turn telling it that its edits did not land and to check git status. A second done with no change is accepted (the request may need none); a second blocked with no change fails the task instead of passing it empty (the fault harness found blocked-and-empty tasks passing in runs with no checks). Seen 2026-11-17 in rt3-cascade-1 (an-com-demand): Sonnet's patch command began with a cat waiting on stdin, hung, was moved to the background and never ran; the turn reported done, described a test it had not written, the visible checks passed on the unchanged seed and the engine accepted a 0-byte diff.",
    optional: true,
  },
  {
    id: "F118",
    key: "keep-checks",
    name: "A check that ran at the start is never dropped",
    added: "2026-11-17",
    files: ["src/engine/run.ts (LOST_CHECK, keepLostChecks, checksPass)", "test/support/chaos.ts (lostTool damage, rule: no checks left after the baseline ran one)"],
    what: "A check that ran at the baseline (passed or failed) and is 'unavailable' later (exit 127, command not found) is a failure of the work, not a check that cannot run here: it is kept and counted as failed, with a note that the work removed or broke what the check needs, so the task is repaired (or treated as an environment problem by F56). Before, it was dropped for the rest of the run and the task and run finished with no checks. Also: a task that never reached its checks (latest unset) no longer counts as passing them, so the escalation breaker (F86) and the budget rules stop keeping failed, unchecked work as \"the checks pass\" (found by the harness rule). Seen 2026-11-17 in rt3-cascade-1 (an-leaf-effects): a worker left .venv without pytest, the check exited 127, both tasks and the final step ran no check (outcome 'none') and a hidden test failed.",
    optional: true,
  },
  {
    id: "F119",
    key: "green-checks",
    name: "Checks green at the start do not replace the review",
    added: "2026-11-18",
    files: ["src/engine/run.ts (wantsTester, greenChecks)", "test/support/chaos.ts (green start, rule: unverifiable work accepted without review)"],
    what: "With test \"no-checks\" (the tester only where nothing else verifies the work), checks that ALL passed before the work started now count as verifying nothing, so the tester reviews: they are the project's existing suite and cannot tell whether a bug was fixed or a feature added. Not for a refactor (green checks that stay green are its proof) or a trivial request, and not when an accepted reproduction (F115) joined the checks. Seen 2026-11-18 in swl-cascade-1 (SWE-bench-Live): on all 6 issues before it was stopped, the existing tests passed at the baseline, no tester ran, and the cascade did what Haiku alone did (one turn, 'tests passed', hidden tests failed); cascade-claude's staffing said 'a tester reviews the work'.",
    optional: true,
  },
  {
    id: "F120",
    key: "lead",
    name: "The expert leads: plans with cases, assigns, decides on failure",
    added: "2026-11-18",
    files: ["src/engine/run.ts (leadStep, the lead step, planStep's cases)", "src/engine/prompts.ts (leadPlanLines, LEAD_PLAN_SCHEMA, leadReviewPrompt, LEAD_SCHEMA, parseLead, parseCases)", "src/presets/presets.ts (lead)", "presets/lead-claude.json", "docs/24-lead.md", "test/support/chaos.ts (lead dice, rules)"],
    what: "A preset with \"lead\" (team mode) makes the expert the team's lead. Its plan (under about 700 words) lists the request's acceptance cases, the implied ones included, puts each in the brief of the task that covers it, and picks a developer per task: grunt, worker, senior, or itself. After the tasks are merged, the evidence step (F123) probes every case; when all hold and the checks pass the work is accepted with no expert turn. Otherwise the lead reviews, read-only, from the evidence and the change, and accepts or adds 1 to 3 follow-up tasks with the developer it chose (itself included); the scheduler runs them one after another and the next round checks again, at most `reviews` rounds (default 2). No expert session is kept open while the team works. A failed task, a spent expert budget, a preset with no orchestrator or an unusable answer ends the rounds and the run goes on to its final step as it stands. The owner's idea (2026-11-18): a cheap model deciding first on a hard task decides badly; on SWE-bench-Live the cascade's Haiku fixed only the examples an issue gave, where Opus alone covered the implied cases on 3 of 5. Design and lessons applied: docs/24-lead.md.",
    optional: true,
  },
  {
    id: "F121",
    key: "lead-triage",
    name: "Small requests skip the lead",
    added: "2026-11-18",
    files: ["src/engine/run.ts (the lead block in startRun)"],
    what: "With the lead (F120), a request the brief calls trivial, or one F109's test finds small and self-contained in a project of at most 60 files, goes to a worker alone (no plan, no expert turn), decided with no model call. The worker can still hand a task up (F68) and get help when stuck. From STATUS 3 and doc 00: planning a small task costs the expert nearly as much as doing it, and every delegation has a fixed start-up cost.",
    optional: true,
  },
  {
    id: "F122",
    key: "lead-scout",
    name: "A cheap report on a big repository before the lead plans",
    added: "2026-11-18",
    files: ["src/engine/run.ts (leadScout, SCOUT_FILES, leadHelper)", "src/engine/prompts.ts (leadReportPrompt, REPORT_SCHEMA, parseRepoReport)"],
    what: "With the lead (F120), on a repository of more than 150 files, one read-only turn on the first worker rung writes a report for the request (at most about 800 words: where the code is with line numbers, how it works now, the conventions nearby, the tests and how they run, what the request implies), and the plan prompt carries it, with the instruction to trust it and open files only to confirm a detail. Asked once per run; an unusable report is skipped. The owner's idea (2026-11-18); from doc 15: a fresh Opus prompt costs about $0.15 in cache writes, and reading a big repository is the expert's dearest part.",
    optional: true,
  },
  {
    id: "F123",
    key: "lead-evidence",
    name: "Cheap probes of the lead's cases; the lead is asked only on a failure",
    added: "2026-11-18",
    files: ["src/engine/run.ts (leadEvidence, leadStep)", "src/engine/prompts.ts (leadEvidencePrompt, EVIDENCE_SCHEMA, parseEvidence, CaseResult)"],
    what: "With the lead (F120) and a plan that listed acceptance cases: after the tasks, one turn on the first worker rung, in a disposable copy of the merged work, writes one probe command per case and runs it; then Neuromesh runs every probe again in its write sandbox (2 minutes each), and the exit status is the result: holds, fails, or unconfirmed (no command, 126, 127, timed out). Every case holds and the checks pass: accepted, no expert turn (lead.review by evidence). Otherwise the lead's review sees each case with its probe and output. The factory picture (2026-11-10): the expert fixes problems when there are any and otherwise conserves his energy.",
    optional: true,
  },
  {
    id: "F124",
    key: "lead-tests",
    name: "The lead writes its cases as a test file: the build's oracle",
    added: "2026-11-18",
    files: ["src/engine/run.ts (leadTestStep, leadTestCommand, LEAD_TESTS, reproduceGuard, leadStep)", "src/engine/prompts.ts (LEAD_PLAN_SCHEMA test, parseLeadTest, leadPlanLines)"],
    what: "With the lead (F120), its plan also gives the acceptance cases as one new test file (path, content, the command that runs it the way the project's checks run). Before anyone builds, Neuromesh writes it and runs it on the code as it is; it is kept only if it fails there with a failed test or assertion, not a load error (F115's rule). Kept, it is committed so every task starts with it; a one-task plan gets it as a check (so a worker that does not pass it is repaired, climbs to the senior, then goes to the expert, as any failing check does) and it is guarded like a reproduction: a worker's edit is put back, an expert's correction is kept. After the tasks the lead step runs it once more instead of the cheap probes (F123): passing, with the checks, accepts with no model turn; failing, the lead reviews with its output. The command is the lead's own when it starts with the same runner as one of the project's checks (a container runner), else F115's. Not kept, the file is deleted and the run goes on with the prose cases. From swl-lead-2 (2026-11-18): every setup missed implied cases (a2a's -32601, pint's dB + dB, authlib's alg none on the implicit flow, simplejwt's sliding serializer) that the cheap builders never think of; the expert that does think of them now hands them over as an oracle the cascade can climb against.",
    optional: true,
  },
  {
    id: "F125",
    key: "lead-no-takeover",
    name: "Under the lead the expert advises a stuck task but never builds it",
    added: "2026-11-18",
    files: ["src/engine/run.ts (the escalate step, leadStep)"],
    what: "With the lead (F120), a developer's task that the senior could not finish gets the expert's advice (a read-only turn) as before, but no takeover: when its project checks pass and only the lead's tests (F124) fail, the work is kept and the lead's review decides; otherwise the task ends. A follow-up the review gives the expert goes to the senior instead. Tasks the lead's plan gives the expert are still the expert's. Seen 2026-11-18 in swl-lead-3: takeovers cost $0.90 to $1.36 an issue (authlib-802, dbbackup-604) and resolved nothing Opus alone resolved, which made the lead dearer than Opus alone.",
    optional: true,
  },
  {
    id: "F126",
    key: "lead-direct",
    name: "The lead plans and reviews in one call with no tools",
    added: "2026-11-18",
    files: ["src/engine/run.ts (planStep, leadStep, leadCanDirect)", "src/engine/prompts.ts (leadPlanLines, leadReviewPrompt, leadReportPrompt)"],
    what: "With the lead (F120): when the cheap report (F122) exists, the plan is one model call with no tools (F77's one-answer mode), from the request, the repository map and the report, which now quotes up to about 250 lines of the code the change touches and the nearest tests; a plan that is unusable or does not finish is asked for again as a normal turn with tools. The lead's review is always one call: its prompt already holds the change and the evidence. Only where the lead's tool can answer with no tools (Claude Code). From F109 (STATUS 52): a no-tools call used 94 percent fewer tokens than a tool session; in swl-lead-3 and swl-lead-4pair the lead's tool-using plan cost $0.35 to $0.79, about what Opus alone spends on the whole issue.",
    optional: true,
  },
  {
    id: "F127",
    key: "patch-lead",
    name: "Cheap models explore, the expert writes the patch in one call (K1)",
    added: "2026-11-18",
    files: ["src/engine/run.ts (patchScout, patchApplies, patchTurn, applyEdits, neededFiles, the plan step)", "src/engine/prompts.ts (SCOUT_SCHEMA, scoutPromptK1, PATCH_SCHEMA, parsePatch, leadPatchPrompt)", "presets/patch-claude.json", "docs/25-cascade-research.md (K1)"],
    what: "A lead preset with mode \"patch\": no plan. The first worker rung, with tools in a disposable copy, writes a dossier (the code the change touches, quoted, with lines; how a single test file runs here) and one test that reproduces the request; the test is judged as the lead's test file (F124): kept, committed and made a check only if it fails on the code as it is with a failed assertion. The expert's one task is the patch: one call with no tools, from the request, the dossier and the kept reproduction with its failing output, answered as search-and-replace edits (a search must occur exactly once; an empty search creates a file); it may ask once to read up to four files, which Neuromesh reads with no model turn. Neuromesh applies the edits and runs the checks; a failure (or edits that did not apply) goes back as a repair call with the output and the change so far, at most three patch calls in all; the expert never runs a tool session on such a run (F125's guard covers its task too). A trivial or small request still goes to a worker alone (F121). From Scrouting (arXiv 2608.04804) and AI21 (2026): a cheap scout's verified handoff let the cheapest fixer match a frontier model, and a frontier model patching once from a prepared brief cost a third of a frontier agent; in this project's runs the expert's reading and planning cost about what Opus alone spends on the whole issue.",
    optional: true,
  },
  {
    id: "F128",
    key: "lead-auto",
    name: "The lead chooses its path per request (K5)",
    added: "2026-11-18",
    files: ["src/engine/run.ts (bigRequest, the lead's mode)", "src/presets/presets.ts (lead mode auto)", "presets/auto-claude.json", "docs/25-cascade-research.md (K5)"],
    what: "A lead preset with mode \"auto\" picks one of three paths per request, with no model call: a trivial or small self-contained request goes to a worker alone (F121); a request the brief would plan anyway (a new program, numbered parts, a long or many-file request) gets the lead's plan with a test file and cheap builders (F120, F124: K2); anything else, a bug or a change in an existing repository, goes to the scout and the expert's one-call patch (F127: K1). Scrouting (2026) found no learned router beating simple choices once the handoff is good, so the rule is kept simple; K3 (cheap first with an expert judge) waits for the run record to say where the cheap model usually succeeds.",
    optional: true,
  },
  {
    id: "F129",
    key: "lead-dossier",
    name: "The scout's dossier, then the expert's own session (K6)",
    added: "2026-11-19",
    files: ["src/engine/run.ts (the lead's mode, the plan step)", "src/engine/prompts.ts (dossierSection, taskPrompt)", "presets/dossier-claude.json"],
    what: "A lead preset with mode \"dossier\": K1's scout (F127) writes the dossier and a reproduction, kept only if it fails on the code as it is (F124); then the expert's one task runs as a normal session with tools, its prompt opening with the dossier and the instruction to start from the code it quotes rather than exploring again, and the kept reproduction as a check. No plan, no patch mode, no takeover. From K1 (2 of 21 against Opus alone's 8): one-call patching without tools lost Opus's quality, because Opus alone reads further, runs the tests and repairs what it broke; the handoff (Scrouting) is kept, the iteration restored.",
    optional: true,
  },
  {
    id: "F130",
    key: "dossier-gate",
    name: "The dossier only where there is a search to save",
    added: "2026-11-19",
    files: ["src/engine/run.ts (dossierSkip, requestNames, the plan step)", "src/engine/prompts.ts (dossierSection, scoutPromptK1)"],
    what: "With K6 (F129), decided with no model call before the scout: no dossier for a repository of at most 150 files (the preset's lead.dossierMinFiles), nor for a request whose names (backticked, paths, dotted names, CamelCase, snake_case) that occur outside the tests in at most three files each lead to two files or fewer; the expert then works from the request itself. Both ways the expert is asked to run only the tests that cover its change, since Neuromesh runs the project's checks after its turn and sends any failure back; with a dossier, the scout has already run the reproduction and the nearest test file and put the commands and outputs in it. From swl-k6-pair: on a2a-443 the dossier added cost (Opus read more than alone); on black, a large formatter, it cut Opus's re-reading from 1.51M to 861k tokens.",
    optional: true,
  },
  {
    id: "F131",
    key: "advisory-repro",
    name: "On K6 the scout reports facts and its reproduction is advice, not a check",
    added: "2026-11-19",
    files: ["src/engine/run.ts (patchScout, the plan step)", "src/engine/prompts.ts (scoutPromptK1, dossierSection)"],
    what: "With K6 (F129): the scout's dossier gives facts only (code, conventions, how tests run and what they print), no root cause and no suggested approach; its reproduction is committed into the run's folder and named in the expert's prompt as one developer's attempt that may test the wrong thing, which the expert may use, change or drop, and is not made a check (F124 is not applied on K6). Seen in swl-k6-helpers (openai-agents-1633): the dossier's 'root cause' and a reproduction made mandatory steered Opus to the scout's reading of the issue (reading a default client) where the fix the tests check was custom headers; Opus alone, reasoning from the issue, found it. AI21 (2026) notes the same: irrelevant context can steer the frontier model away from the right solution.",
    optional: true,
  },
  {
    id: "F132",
    key: "solver-own-judgement",
    name: "On K6 the solver gets the request without the brief's working standards",
    added: "2026-11-19",
    files: ["src/engine/run.ts (the plan step)"],
    what: "With K6 (F129): the solver works in its own session from the request as typed (attachments kept), without the brief's working standards. The bug standards ('keep the change small; behaviour the request does not mention must stay as it is', 'add a test', 'find the cause first') are rules written for cheap workers; for the solver they are judgement handed in from outside. Seen in swl-trialA and swl-trialB (21 issues each): Opus and Sonnet with the dossier and the standards resolved the same 5 of the 20 that Opus alone (no brief) resolved 8 of; the three lost (a2a-414, pint-2194, openai-1633) are the issues whose hidden tests check cases the issue only implies, which 'behaviour the request does not mention must stay as it is' tells the solver to leave alone.",
    optional: false,
  },
  {
    id: "F133",
    key: "new-project-tests",
    name: "On a new project the lead's test file may fail because nothing is built yet",
    added: "2026-11-23",
    files: ["src/engine/reproduce.ts (isNewProject, failsBeforeTheBuild)", "src/engine/run.ts (leadTestStep)", "src/engine/prompts.ts (leadPlanLines)", "presets/start-opus-flash.json"],
    what: "With the lead's test file (F124) on a project with no source file yet (test files and docs do not count): the lead is told nothing is built, to import the code at the top as the finished project will (so the file fixes the interface the developers build) and to use the language's built-in test runner; and the file is kept when it fails before the build with a missing module or name, as well as with a failed assertion. It is still dropped when it passes with nothing built, times out, cannot start, or does not parse. Before, F124's rule (a load error is a broken test) dropped every test file on a new project, since the code it imports does not exist, so a project started under the lead had no oracle: PLAN.md's S2 (decisions as tests) for the Opus and Flash start route.",
    optional: true,
  },
  {
    id: "F134",
    key: "lead-new-programs",
    name: "Under the lead a new program is always planned",
    added: "2026-11-23",
    files: ["src/engine/run.ts (the lead block in startRun)"],
    what: "With the lead (F120), a request the brief calls greenfield (a new program) is never sent to a worker alone by F121's small-request test; only a trivial one is. F109's test calls a short request that names one file small, which suits an edit to a small project but sent a whole new program (a CLI todo app with four commands and a JSON store, 44 words naming todos.json) to one no-tools worker call with no plan and no test file, so the start route (start-opus-flash) skipped the lead entirely. Same rule as F128's auto mode, where a new program gets the lead's plan.",
    optional: true,
  },
  {
    id: "F135",
    key: "lead-first-rung",
    name: "Under the lead a worker task starts on the first worker rung",
    added: "2026-11-23",
    files: ["src/engine/run.ts (startRung)"],
    what: "With the lead (F120) and a worker ladder with no grunt rungs, a task the lead gives a worker starts on the ladder's first rung and climbs from there when stuck. Before, only a preset with grunt rungs (F82) placed it there; otherwise the brief's rule for something new (start on the strongest worker rung) applied, which in start-opus-flash is Claude Haiku: in the first live run (2026-11-23, a CLI todo app) Opus planned and Haiku built, and Gemini Flash, the preset's builder, was never called. The lead picks the developer and its tests let a worker climb, so the strongest-rung start is not needed under it.",
    optional: true,
  },
];

const byAny = new Map<string, Feature>();
for (const f of FEATURES) {
  byAny.set(f.id.toLowerCase(), f);
  byAny.set(f.key, f);
}

export function feature(idOrKey: string): Feature {
  const f = byAny.get(idOrKey.toLowerCase());
  if (!f) throw new Error(`Unknown feature "${idOrKey}"`);
  return f;
}

/** "F04 screen-check": how a feature is named in messages and code comments. */
export function tag(idOrKey: string): string {
  const f = feature(idOrKey);
  return `${f.id} ${f.key}`;
}

// The switched-off features for this process: NEUROMESH_DISABLE, --disable,
// and a preset's "disable" list. Optional features that fail are added too.
const disabled = new Set<string>();
// The default-off features switched on for this process: NEUROMESH_ENABLE, --enable, a preset's "enable" list.
const enabled = new Set<string>();

function parse(list: string | string[] | undefined): Feature[] {
  const items = Array.isArray(list) ? list : (list ?? "").split(",");
  return items
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => byAny.get(s.toLowerCase()))
    .filter((f): f is Feature => f !== undefined);
}

export function disable(list: string | string[] | undefined): void {
  for (const f of parse(list)) disabled.add(f.key);
}

/** Switch on features that are off by default (ids or keys; other features are already on). */
export function enable(list: string | string[] | undefined): void {
  for (const f of parse(list)) if (f.defaultOff) enabled.add(f.key);
}

/** Back to the process-wide setting (NEUROMESH_DISABLE and NEUROMESH_ENABLE, which --disable and --enable extend). */
export function resetFeatures(): void {
  disabled.clear();
  enabled.clear();
  disable(process.env.NEUROMESH_DISABLE);
  enable(process.env.NEUROMESH_ENABLE);
}

/** Switch off everything not in `keys` (a resumed run keeps the features it started with). */
export function onlyThese(keys: string[]): void {
  for (const f of FEATURES) {
    if (!keys.includes(f.key)) disabled.add(f.key);
    else if (f.defaultOff) enabled.add(f.key); // a run that started with it keeps it
  }
}
resetFeatures();

export function isOn(idOrKey: string): boolean {
  const f = feature(idOrKey);
  return !disabled.has(f.key) && (!f.defaultOff || enabled.has(f.key));
}

export function activeKeys(): string[] {
  return FEATURES.filter((f) => isOn(f.key)).map((f) => f.key);
}

/** An error raised inside a feature, carrying which one. */
export class FeatureError extends Error {
  readonly feature: Feature;
  constructor(f: Feature, cause: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause);
    super(`[${f.id} ${f.key}] ${message}`, { cause });
    this.name = "FeatureError";
    this.feature = f;
  }
}

/** Run `fn` as part of a feature: any error it throws is tagged with the feature. */
export function inFeature<T>(idOrKey: string, fn: () => T): T {
  const f = feature(idOrKey);
  // Fault injection, to check that a failing feature is handled: NEUROMESH_FAULT=screen-check
  if (parse(process.env.NEUROMESH_FAULT).some((x) => x.key === f.key)) throw new FeatureError(f, new Error("injected fault (NEUROMESH_FAULT)"));
  try {
    const value = fn();
    if (value instanceof Promise) {
      return value.catch((error: unknown) => {
        throw error instanceof FeatureError ? error : new FeatureError(f, error);
      }) as T;
    }
    return value;
  } catch (error) {
    throw error instanceof FeatureError ? error : new FeatureError(f, error);
  }
}

/** What to tell the owner when a feature failed. */
export function hint(f: Feature): string {
  return `This came from ${f.id} ${f.key} (${f.name}; ${f.files[0]}). To run without it: --disable ${f.key}, or NEUROMESH_DISABLE=${f.key}.`;
}

export function featureTable(): string {
  return FEATURES.map((f) => `${f.id}  ${f.key.padEnd(22)} ${isOn(f.key) ? "on " : "OFF"}  ${f.optional ? "optional" : "core    "}  ${f.what}\n      ${f.files.join("; ")}`).join("\n");
}
