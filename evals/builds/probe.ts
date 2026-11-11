#!/usr/bin/env node
// Drive a terminal typing-test app through tmux with the same script of
// actions for every app, and print what the screen showed at each stage. The
// output is read by a person (or an agent) scoring evals/builds/RUBRIC.md.
//
//   node evals/builds/probe.ts <project dir> <run command> [--quit <key>] [--restart <key>]
//
// Needs tmux. Keys are tmux key names (Escape, Tab, Enter, q, C-c).

import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const flag = (name: string, fallback: string): string => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const value = args[i + 1] ?? fallback;
  args.splice(i, 2);
  return value;
};
const quitKey = flag("quit", "Escape");
const restartKey = flag("restart", "Tab");
const typeSeconds = Number(flag("seconds", "33"));
const [dir, command] = args;
if (!dir || !command) {
  console.error("usage: node evals/builds/probe.ts <project dir> <run command> [--quit key] [--restart key] [--seconds n]");
  process.exit(2);
}

const session = `probe-${process.pid}`;
const sleep = (ms: number): void => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};
const tmux = (...a: string[]): string => {
  const r = spawnSync("tmux", a, { encoding: "utf8" });
  return (r.stdout ?? "") + (r.status === 0 ? "" : (r.stderr ?? ""));
};
const key = (...keys: string[]): void => void tmux("send-keys", "-t", session, ...keys);
const text = (s: string): void => void tmux("send-keys", "-t", session, "-l", s);
const screen = (escapes = false): string => tmux("capture-pane", "-p", ...(escapes ? ["-e"] : []), "-t", session);
const info = (format: string): string => tmux("display-message", "-p", "-t", session, format).trim();
const foreground = (): string => info("#{pane_current_command}");

function show(title: string, body: string): void {
  const lines = body.replace(/\x1b/g, "␛").split("\n").map((l) => l.trimEnd());
  while (lines.length > 0 && lines.at(-1) === "") lines.pop();
  console.log(`\n===== ${title} =====\n${lines.filter((l, i) => l !== "" || lines[i - 1] !== "").join("\n")}`);
}

/** The words to type: screen lines that are only lowercase words. */
function passage(): string {
  const lines = screen()
    .split("\n")
    .map((l) => l.replace(/[│┃|▏█▌_]/g, " ").trim())
    .filter((l) => /^[a-z']+( [a-z']+){2,}$/.test(l));
  return lines.join(" ");
}

function launch(): void {
  key(command!, "Enter");
  sleep(2_000);
}

tmux("kill-session", "-t", session);
tmux("new-session", "-d", "-s", session, "-x", "80", "-y", "24", "-c", dir, "env", "PS1=$ ", "sh");
sleep(500);
const shell = foreground();

try {
  // --- Phase 1: one whole test --------------------------------------------
  launch();
  show("1. two seconds after launch (80x24)", screen());
  const first = passage();
  console.log(`\n[passage read from the screen: ${first.length} characters] ${first.slice(0, 100)}`);
  if (first.length < 20) console.log("[!] could not read a passage; the typing phases below type blind");
  const target = first.length >= 20 ? first : "the quick brown fox jumps over the lazy dog and keeps running far away from here today";

  console.log("[waiting 5 seconds before the first keystroke]");
  sleep(5_000);
  const started = Date.now();
  let correct = 0;
  let wrong = 0;
  for (const c of target.slice(0, 20)) {
    text(c);
    correct += 1;
    sleep(180);
  }
  show("2. after 20 correct characters (with colour codes)", screen(true));
  for (let i = 0; i < 3; i++) {
    const expected = target[20 + i];
    text(expected === "q" ? "z" : "q");
    wrong += 1;
    sleep(180);
  }
  show("3. after 3 wrong characters (with colour codes)", screen(true));
  key("BSpace", "BSpace", "BSpace");
  sleep(400);
  show("4. after 3 backspaces (with colour codes)", screen(true));
  let at = 20;
  while (Date.now() - started < typeSeconds * 1_000 && at < target.length) {
    text(target[at]!);
    correct += 1;
    at += 1;
    sleep(180);
  }
  const typedFor = (Date.now() - started) / 1_000;
  sleep(Math.max(1_500, (typeSeconds + 2) * 1_000 - (Date.now() - started)));
  show("5. after the test should have ended", screen());
  console.log(
    `\n[typed ${correct} correct and ${wrong} wrong characters (then took the wrong ones back) over ${typedFor.toFixed(1)}s of typing; ` +
      `${at >= target.length ? "the whole passage was typed" : "stopped by time"}. ` +
      `If a 30s timed test: expected net WPM about ${Math.round(correct / 5 / 0.5)}, or less if the app stopped counting at 30s (${Math.round((30 / typedFor) * correct / 5 / 0.5)}). ` +
      `If the test ended when the passage did: about ${Math.round(correct / 5 / (typedFor / 60))}. Accuracy about ${Math.round((correct / (correct + wrong)) * 100)}%.]`,
  );

  key(restartKey);
  sleep(1_200);
  show(`6. after the restart key (${restartKey})`, screen());
  const second = passage();
  console.log(`\n[new passage differs from the first: ${second.length >= 20 && second !== first ? "yes" : "NO or unreadable"}] foreground: ${foreground()}`);

  // --- Phase 2: resizing and junk input -----------------------------------
  const p2 = second.length >= 20 ? second : target;
  for (const c of p2.slice(0, 10)) {
    text(c);
    sleep(120);
  }
  tmux("resize-window", "-t", session, "-x", "60", "-y", "15");
  sleep(1_200);
  show("7. resized to 60x15 after 10 characters", screen(true));
  for (const c of p2.slice(10, 15)) {
    text(c);
    sleep(120);
  }
  tmux("resize-window", "-t", session, "-x", "20", "-y", "6");
  sleep(1_200);
  show("8. resized to 20x6", screen());
  console.log(`[foreground after 20x6: ${foreground()}]`);
  tmux("resize-window", "-t", session, "-x", "80", "-y", "24");
  sleep(1_000);
  key("Up", "Down", "Left", "Right", "F5", "PageUp", "Home");
  sleep(300);
  text("lorem ipsum dolor sit amet ".repeat(8).slice(0, 200));
  sleep(1_500);
  show("9. back at 80x24, after arrow keys, F5 and a 200-character burst", screen());
  console.log(`[foreground after junk input: ${foreground()}]`);

  // --- Phase 3: Ctrl-C mid-test --------------------------------------------
  key(restartKey);
  sleep(800);
  const p3 = passage();
  for (const c of (p3.length >= 5 ? p3 : target).slice(0, 5)) {
    text(c);
    sleep(120);
  }
  key("C-c");
  sleep(1_500);
  const afterCtrlC = foreground();
  console.log(`\n===== 10. after Ctrl-C mid-test =====\nforeground: ${afterCtrlC} (the shell is ${shell}) · cursor visible: ${info("#{cursor_flag}")} · alternate screen on: ${info("#{alternate_on}")}`);
  if (afterCtrlC !== shell) {
    console.log("[!] still running after Ctrl-C; sending the quit key and another Ctrl-C");
    key(quitKey);
    sleep(500);
    key("C-c");
    sleep(1_000);
  }
  key("stty -a | head -3; echo typed-text-echoes", "Enter");
  sleep(800);
  show("11. the shell after Ctrl-C (stty should show icanon and echo, not -icanon -echo)", screen());

  // --- Phase 4: the quit key ----------------------------------------------
  key("clear", "Enter");
  launch();
  key(quitKey);
  sleep(1_500);
  console.log(`\n===== 12. after the quit key (${quitKey}) =====\nforeground: ${foreground()} (the shell is ${shell}) · cursor visible: ${info("#{cursor_flag}")} · alternate screen on: ${info("#{alternate_on}")}`);
  if (foreground() !== shell) {
    key("C-c");
    sleep(800);
    console.log(`[!] the quit key did not end it; after Ctrl-C the foreground is ${foreground()}]`);
  }
} finally {
  tmux("kill-session", "-t", session);
}

// --- Phase 5: started without a terminal ------------------------------------
const piped = spawnSync("sh", ["-c", `echo hello | ${command}`], { cwd: dir, encoding: "utf8", timeout: 8_000 });
show(
  `13. started with input piped in (exit code ${piped.status === null ? "none: still running after 8s, killed" : piped.status})`,
  `${piped.stdout ?? ""}${piped.stderr ?? ""}`.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "").slice(0, 1_200),
);
