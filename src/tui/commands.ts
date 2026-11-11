// [F21 tui-slash] Every command the TUI offers: in the Ctrl+P popup, and as
// slash commands typed in the prompt. One list, so the two never disagree.

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
  | "quit";

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
  { group: "Prompt", keys: "alt+enter", label: "New line" },
  { group: "Prompt", keys: "@", label: "Mention a file of this repository" },
  { group: "Prompt", keys: "↑ ↓", label: "Earlier requests" },
  { group: "Prompt", keys: "esc esc", label: "Clear the prompt" },
  { group: "Run", slash: "/stop", keys: "esc esc", label: "Stop the run (it can be resumed)", action: "stop" },
  { group: "Run", slash: "/resume", keys: "r", label: "Resume a stopped or paused run", action: "resume" },
  { group: "Run", slash: "/details", keys: "ctrl+o", label: "Show or hide each agent's steps", action: "details" },
  { group: "Run", keys: "pgup pgdn", label: "Scroll the conversation" },
  { group: "Review", slash: "/diff", keys: "d", label: "View the whole diff", action: "diff" },
  { group: "Review", slash: "/apply", keys: "a", label: "Apply the change to your repository", action: "apply" },
  { group: "Review", slash: "/discard", keys: "x x", label: "Discard the change", action: "discard" },
  { group: "Review", keys: "1-5", label: "Rate the run against your usual way of working" },
  { group: "Session", slash: "/sessions", keys: "ctrl+s", label: "Open an earlier session of this folder", action: "sessions" },
  { group: "Session", slash: "/preset", keys: "ctrl+k", label: "Choose the team preset for the next runs", action: "preset" },
  { group: "Session", slash: "/new", keys: "ctrl+n", label: "New session", action: "new" },
  { group: "Session", slash: "/usage", keys: "", label: "Real-use summary from the usage log", action: "usage" },
  { group: "Session", slash: "/features", keys: "", label: "Features, and which are off or failed", action: "features" },
  { group: "Session", slash: "/theme", keys: "ctrl+t", label: "Theme: terminal colours or GitHub dark high contrast", action: "theme" },
  { group: "Session", slash: "/help", keys: "ctrl+p", label: "All commands", action: "help" },
  { group: "Session", slash: "/quit", keys: "ctrl+q", label: "Quit", action: "quit" },
];

export const SLASH = COMMANDS.filter((c) => c.slash);

/** The command at a popup index (wrapping around). */
export function commandAt(index: number): Command {
  const n = COMMANDS.length;
  return COMMANDS[((index % n) + n) % n]!;
}
