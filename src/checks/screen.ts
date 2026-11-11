// A screen check for full-screen terminal programs: the engine runs the
// program in tmux, plays a fixed set of generic user actions, and records what
// the screen showed after each. No model is involved. The tester reads the
// screens as evidence, because agents in a sandbox usually cannot run tmux
// themselves, and reading the code says little about what the user sees.

import { spawnSync } from "node:child_process";

export interface Screen {
  title: string;
  text: string;
}

export interface ScreenCheck {
  command: string;
  screens: Screen[];
  /** The program was still running after Esc, Ctrl-C and q. */
  stuck: boolean;
}

const sleep = (ms: number): void => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

export function hasTmux(): boolean {
  return spawnSync("tmux", ["-V"], { encoding: "utf8" }).status === 0;
}

const EXIT_MARK = "[the program exited";

/** Run `command` in `dir` inside tmux and record the screen after each action. */
export function screenCheck(dir: string, command: string): ScreenCheck {
  // Our own tmux server, so the user's sessions are never touched.
  const server = `neuromesh-${process.pid}-${Date.now()}`;
  const tmux = (...args: string[]): string => {
    const r = spawnSync("tmux", ["-L", server, ...args], { encoding: "utf8", timeout: 10_000 });
    return r.stdout ?? "";
  };
  const send = (...keys: string[]): void => void tmux("send-keys", "-t", "app", ...keys);
  const capture = (): string =>
    tmux("capture-pane", "-p", "-t", "app")
      .split("\n")
      .map((l) => l.trimEnd())
      .join("\n")
      .replace(/\n+$/, "");
  const screens: Screen[] = [];
  const shot = (title: string): void => void screens.push({ title, text: capture() });
  const exited = (): boolean => capture().includes(EXIT_MARK);

  // After the program ends, the pane stays open and says how it ended and
  // whether the terminal was left in a usable state.
  const wrapper = `${command}; code=$?; printf '\\n${EXIT_MARK} with code %s; terminal modes: %s]\\n' "$code" "$(stty -a 2>/dev/null | tr ' ' '\\n' | grep -E '^-?(icanon|echo)$' | tr '\\n' ' ')"; sleep 600`;
  try {
    tmux("new-session", "-d", "-s", "app", "-x", "80", "-y", "24", "-c", dir, "sh", "-c", wrapper);
    sleep(2_500);
    shot("2.5 seconds after start, 80x24");
    if (!exited()) {
      send("-l", "the quick brown fox ");
      sleep(800);
      shot('after typing "the quick brown fox "');
      send("-l", "zzz");
      sleep(500);
      shot('after typing "zzz" (likely mistakes)');
      send("BSpace", "BSpace", "BSpace");
      sleep(500);
      shot("after three Backspaces");
      tmux("resize-window", "-t", "app", "-x", "60", "-y", "15");
      sleep(1_000);
      shot("after resizing to 60x15");
      tmux("resize-window", "-t", "app", "-x", "80", "-y", "24");
      send("Up", "Down", "Left", "Right", "F5", "PageDown");
      send("-l", "lorem ipsum dolor sit amet ".repeat(8));
      sleep(1_500);
      shot("back at 80x24, after arrow keys, F5, PageDown and a pasted burst of 216 characters");
      send("Tab");
      sleep(800);
      shot("after Tab");
    }
    let stuck = false;
    for (const key of ["Escape", "C-c", "q"]) {
      if (exited()) break;
      send(key);
      sleep(1_200);
      shot(`after ${key === "C-c" ? "Ctrl-C" : key}`);
    }
    stuck = !exited();
    return { command, screens, stuck };
  } finally {
    tmux("kill-server");
  }
}

/** The screens as text for a prompt. */
export function screenText(check: ScreenCheck): string {
  const frames = check.screens.map((s) => `--- ${s.title} ---\n${s.text || "(blank screen)"}`).join("\n\n");
  const end = check.stuck ? "\n\nThe program was still running after Esc, Ctrl-C and q; it was then stopped." : "";
  return `Neuromesh ran \`${check.command}\` in a real 80x24 terminal and recorded the screen after each step:\n\n${frames}${end}`;
}
