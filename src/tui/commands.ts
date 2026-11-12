// [F21 tui-slash] Every command the TUI offers: in the Ctrl+P popup, and as
// slash commands typed in the prompt. One list, so the two never disagree.
// Every action has a key too, for working without the mouse.

export type Action =
  | "help"
  | "new"
  | "sessions"
  | "preset"
  | "resume"
  | "diff"
  | "apply"
  | "discard"
  | "theme"
  | "details"
  | "usage"
  | "features"
  | "stop"
  | "motion"
  | "screensaver"
  | "quit"
  | "settings"
  | "verbose-none"
  | "verbose-medium"
  | "verbose-full"
  | "access"
  | "attach"
  | "sidebar"
  | "info"
  | "focus-sidebar"
  | "new-project"
  | "rename"
  | "compact"
  | "context"
  | "transparent";

export interface Command {
  /** The slash command, when it can be typed as one. */
  slash?: string;
  keys: string;
  label: string;
  action?: Action;
  group: string;
}

export const COMMANDS: Command[] = [
  { group: "Prompt", keys: "enter", label: "Send the instruction" },
  { group: "Prompt", keys: "shift+enter", label: "New line (also alt+enter, ctrl+j)" },
  { group: "Prompt", keys: "@", label: "Mention a file of this repository" },
  { group: "Prompt", slash: "/attach", keys: "ctrl+f", label: "Attach a file from anywhere", action: "attach" },
  { group: "Prompt", slash: "/access", keys: "shift+tab", label: "Normal or Turbo: ask first, or go ahead", action: "access" },
  { group: "Prompt", keys: "↑ ↓", label: "Earlier requests" },
  { group: "Prompt", keys: "esc esc", label: "Clear the prompt" },
  { group: "Run", slash: "/stop", keys: "esc esc", label: "Stop the run (it can be resumed)", action: "stop" },
  { group: "Run", slash: "/resume", keys: "r", label: "Resume a stopped or paused run", action: "resume" },
  { group: "Run", slash: "/verbose", keys: "ctrl+o", label: "Verbosity: medium, full, none (cycles)", action: "details" },
  { group: "Run", slash: "/verbose-none", keys: "", label: "Verbosity none: labels only", action: "verbose-none" },
  { group: "Run", slash: "/verbose-full", keys: "", label: "Verbosity full: every step", action: "verbose-full" },
  { group: "Run", slash: "/compact", keys: "ctrl+l", label: "Compact: next turn starts a fresh session", action: "compact" },
  { group: "Run", slash: "/context", keys: "", label: "Read context.md, what every agent gets", action: "context" },
  { group: "Run", keys: "pgup pgdn", label: "Scroll the stream (also the wheel)" },
  { group: "Review", slash: "/diff", keys: "d", label: "View the whole diff", action: "diff" },
  { group: "Review", slash: "/apply", keys: "a", label: "Apply the change to your repository", action: "apply" },
  { group: "Review", slash: "/discard", keys: "x x", label: "Discard the change", action: "discard" },
  { group: "Review", keys: "1-5", label: "Rate the run against your usual tools" },
  { group: "Projects", slash: "/sessions", keys: "ctrl+s", label: "Find a session in this folder", action: "sessions" },
  { group: "Projects", slash: "/new", keys: "ctrl+n", label: "New session", action: "new" },
  { group: "Projects", slash: "/project", keys: "", label: "New project: a name for a folder", action: "new-project" },
  { group: "Projects", slash: "/rename", keys: "ctrl+r", label: "Rename this project", action: "rename" },
  { group: "Projects", keys: "ctrl+e", label: "Sidebar keys: ↑↓ enter, space fold, r rename, x delete", action: "focus-sidebar" },
  { group: "View", slash: "/settings", keys: "", label: "Settings", action: "settings" },
  { group: "View", slash: "/preset", keys: "ctrl+k", label: "Choose the team for the next runs", action: "preset" },
  { group: "View", slash: "/sidebar", keys: "ctrl+b", label: "Show or hide the sidebar", action: "sidebar" },
  { group: "View", slash: "/info", keys: "ctrl+g", label: "Show or hide the info pane", action: "info" },
  { group: "View", slash: "/theme", keys: "ctrl+t", label: "Terminal colours or GitHub high contrast", action: "theme" },
  { group: "View", slash: "/transparent", keys: "", label: "Layered or transparent look", action: "transparent" },
  { group: "View", slash: "/motion", keys: "", label: "Animations on or off", action: "motion" },
  { group: "View", slash: "/screensaver", keys: "", label: "Show the screensaver now", action: "screensaver" },
  { group: "View", slash: "/usage", keys: "", label: "Real-use summary from the usage log", action: "usage" },
  { group: "View", slash: "/features", keys: "", label: "Features, and which are off or failed", action: "features" },
  { group: "View", slash: "/help", keys: "ctrl+p", label: "All commands", action: "help" },
  { group: "View", slash: "/quit", keys: "ctrl+q", label: "Quit", action: "quit" },
];

export const SLASH = COMMANDS.filter((c) => c.slash);

/** The command at a popup index (wrapping around). */
export function commandAt(index: number): Command {
  const n = COMMANDS.length;
  return COMMANDS[((index % n) + n) % n]!;
}
