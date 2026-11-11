# Terminal typing test: build plan

A typing speed test that runs full-screen in the terminal. Give it its own
name; do not copy any existing product's name, texts or artwork.

## Steps

1. **Word list and passages.** Ship a built-in list of at least 200 common
   English words (no network). Write a function that makes a random passage of
   N words from it.
2. **Typing state.** Model one test as plain data: the passage, what has been
   typed, the position, and the start and end times. Write the function that
   applies one keystroke: a character, a space, or Backspace. Characters typed
   past the end of a word count as errors. Backspace goes back one character.
3. **Scoring.** From a finished or running test compute: net WPM (correct
   characters / 5, per minute), raw WPM (all typed characters / 5, per minute),
   accuracy (percentage of keystrokes that were correct), counts of correct and
   incorrect characters, and the time taken.
4. **Test kinds.** Two kinds: timed (15, 30 or 60 seconds) and word count (10,
   25 or 50 words). The default is 30 seconds. The clock starts on the first
   keystroke. A timed test ends when the time is up; a word-count test ends when
   the last word is typed.
5. **Unit tests** for steps 1 to 4, runnable with one command.
6. **Drawing.** A function from the state and the terminal size to the text of
   the screen: the passage wrapped to the width and centred; correct characters
   in one style, wrong ones in a clearly different style, untyped ones dim; a
   caret at the current position; the time left (or words left) and live WPM
   above the passage; the available keys at the bottom.
7. **Terminal handling.** Full-screen raw-mode input and output. Leave the
   terminal exactly as it was found on every way out, including Ctrl-C and
   errors. Re-wrap and redraw when the terminal is resized, keeping progress. If
   not started in a terminal, print a clear message and exit.
8. **Keys.** Tab restarts with a new passage at any time. Esc or Ctrl-C quits.
   The kind and length can be changed from inside the program without
   restarting it.
9. **Results screen.** After a test show everything from step 3. Enter or Tab
   starts a new test.
10. **Options.** Command-line options choose the kind and length at start.
11. **Personal bests.** Keep the best net WPM for each kind and length in a
    small file in the user's home directory, and say on the results screen when
    a result is a new best.
12. **README** with how to run it, the options and the keys.
