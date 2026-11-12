create a python bot that checks a bunch of websites every few minutes and tells me when something changes on them, like if a price changes or some text gets updated, and save the old and new versions so i can see what changed, also make it work even if some websites are down or my internet stops working

Details that must hold:

- The program is `sitewatch.py`, run as `python3 sitewatch.py <command> --config CONFIG.json --db STATE.db [...]`. Only the Python standard library is available. Other modules next to `sitewatch.py` are fine.
- The config is a JSON file: `{"sites": [{"name": "shop", "url": "http://...", "pattern": "<p class=\"price\">([^<]+)</p>", "timeout": 5}, ...]}`. `pattern` is optional: a regular expression searched in the page; the watched value is its first group (the whole match if it has no group). Without a pattern the watched value is the page's visible text (tags, scripts and styles removed, whitespace collapsed). `timeout` is optional, in seconds, default 10.
- `check` looks at every site once and prints exactly one line per site, in config order, starting with one of these words and the site's name:
  - `NEW <name>` the first time a value is saved for the site;
  - `UNCHANGED <name>` when the value is the same as the last saved one;
  - `CHANGED <name>: <old> -> <new>` when it differs (long values may be shortened in this line); the new value is saved as a new version;
  - `DOWN <name>: <reason>` when the site cannot be read (refused, timed out, DNS failure, HTTP status 400 or above) or the pattern is not found. Nothing is saved, and the last saved version stays.
  `check` exits with status 0 even when sites are down. A site that never answers must not hold the others up beyond its own timeout, and no site's trouble may crash the program or print a traceback.
- `history NAME` prints the saved versions of a site, oldest first, one per line: a number starting at 1, the time it was saved, and the value. An unknown name prints a message to stderr and exits with status 2.
- `diff NAME` prints a unified diff between the last two saved versions (lines starting with `-` and `+`); when there are fewer than two versions it says so and exits with status 0.
- `run --interval SECONDS` repeats `check` forever, printing the same lines each round, and keeps going whatever happens to the sites. Ctrl-C (SIGINT) stops it promptly with exit status 0 or 130 and no traceback.
- Saved versions survive between runs (the `--db` file; SQLite or any format). A missing or unreadable config prints a message to stderr and exits with status 2.
- Include tests that run without the internet.
