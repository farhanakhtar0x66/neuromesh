# Build test: a typing speed test for the terminal

The owner's test before any TUI work on Neuromesh itself: have the factory
build a terminal typing test from three kinds of prompt, and compare with one
frontier agent (Claude Opus 5.5 at medium effort) given the same prompts.

| Task | Prompt |
| --- | --- |
| `typing-one-line` | One line, as the owner typed it |
| `typing-detailed` | A detailed description in prose |
| `typing-steps` | "Build what PLAN.md describes", with a 12-step plan in the repository |

Neuromesh wins a prompt when its app scores at least as high as the single
agent's on this rubric **and** costs less (estimated at API list prices) with
less of the expert models used.

## How it is scored

This rubric was written before any app was built. Every app is started in a
`tmux` pane of 80x24 and driven with real keystrokes; the screen is read back as
text and colour codes. One point per line, half a point where it only partly
holds. The same script of actions is used for every app.

### A. Starts and stops (6)

1. Starts with the command its README gives, with nothing to install first.
2. Shows words to type within two seconds.
3. The README gives the run command and the keys.
4. Its quit key ends it and the shell prompt is back.
5. After Ctrl-C mid-test the terminal is restored: cursor visible, typed
   characters echo, the earlier shell screen is back.
6. Started without a terminal (input piped in), it prints a clear message and
   exits instead of a stack trace or a hang.

### B. Typing (7)

7. Correctly typed characters are visibly marked.
8. Wrong characters are marked differently from correct ones.
9. Backspace takes back a character and its mark.
10. A test ends by itself (time up or last word typed) and results appear.
11. Results show words per minute, and the number is right for what was typed
    (correct characters / 5 per minute, within 15%).
12. Results show accuracy, and it is right for what was typed (within 5 points).
13. A key starts a new test with a new passage without restarting the program.

### C. Depth (5)

14. A timed test with at least two lengths to choose from.
15. A word-count test with at least two lengths to choose from.
16. Time or words left and live speed are shown while typing.
17. Kind and length can be changed inside the program (not only by flags).
18. Results show more than WPM and accuracy (raw speed, character counts,
    time, or a personal best).

### D. Robustness (4)

19. Resized to 60x15 mid-test: no crash, the passage re-wraps, progress kept.
20. Resized to 20x6: no crash and no stack trace.
21. Arrow keys, function keys and a pasted burst of 200 characters do not
    crash it or corrupt the screen.
22. The clock starts on the first keystroke, not on launch (wait five seconds
    before typing; the result must not count them).

### E. Engineering (5)

23. Automated tests exist and pass with one documented command.
24. The typing logic is in modules that do no terminal input or output.
25. Runs with no network and no dependency that needs installing, or its
    dependencies install with one documented command and no errors.
26. The screen is drawn by code that can be called without a terminal (and at
    least one test does so), or the equivalent for its framework.
27. No source file mixes everything: the largest source file is under 500
    lines.

Total: 27.

## What is recorded for each app

Rubric score, estimated API cost (all models; expert models separately), tokens
by model, wall-clock time, and the language chosen.
