Build a typing speed test that runs full-screen in the terminal, in the spirit of the minimal typing-test websites: a calm screen with a line of words, you type them, and you get your speed at the end. Give it its own name; do not copy any existing product's name, texts or artwork.

What it must do:

- Show a passage of random common English words (ship a built-in list of at least 200 words; no network). The passage wraps to the terminal width and is centred on the screen.
- As the user types, each character of the passage is marked: correct characters in one style, wrong ones in a clearly different style, not-yet-typed ones dim. A caret shows the current position. Backspace goes back and un-marks a character. Extra characters typed past the end of a word are shown as errors.
- Two kinds of test: a timed test (15, 30 or 60 seconds) and a word-count test (10, 25 or 50 words). The default is 30 seconds. The kind and length can be chosen with command-line options and also changed from inside the program without restarting it.
- The clock starts on the first keystroke, not when the screen appears. While typing, show the time left (or words left) and the live words per minute.
- When the test ends, show a results screen: net WPM (correct characters divided by 5, per minute), raw WPM (all typed characters divided by 5, per minute), accuracy as a percentage of keystrokes that were correct, the count of correct and incorrect characters, and the time taken.
- Keys: Tab restarts with a new passage at any time; Esc or Ctrl-C quits. From the results screen, Enter or Tab starts a new test. The available keys are always shown at the bottom of the screen.
- Keep the best net WPM for each kind and length in a small file in the user's home directory, and say on the results screen when a result is a new best.
- The terminal must be left exactly as it was found on every way out, including Ctrl-C and errors. Resizing the terminal mid-test must re-wrap the passage and keep the progress. If it is not started in a terminal, it prints a clear message and exits.

Keep the typing logic (passage generation, keystroke handling, scoring) separate from the terminal drawing, and cover it with automated tests that run with one command. Write a README with how to run it, the options and the keys.
