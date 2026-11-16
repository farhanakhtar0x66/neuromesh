The screen check (src/checks/screen.ts) runs a full-screen program in tmux and looks at what it shows. A program that puts a countdown on its first screen and only ends when it runs out (a typing test showing "time 15 [30] 60" and "30s left") is never caught for not ending by itself, because the check never waits the countdown out.

First step: add an exported function `countdown(text: string): number | undefined` to src/checks/screen.ts that finds a countdown in a screen's text and returns its length in seconds when it is short enough to wait out.

- A countdown is a number of seconds written the way a program shows one ("30s", "30 seconds left"). A countdown of up to a minute is worth waiting out; a longer one is not, and text with no countdown has none to report.
- `countdown("stillkeys  time 15 [30] 60\n  30s left   0 wpm")` is 30; `countdown("30 seconds left")` is 30; `countdown("Accuracy 98%  time 120s")` is undefined (too long to wait); `countdown("no timer here")` is undefined.

(Using the function inside the screen check to wait a countdown out is a later change; this one is the function and its behaviour.) Tests are in test/features.test.ts.
