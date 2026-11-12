Write a small single-file CLI tool in Python called `logstat.py` that reads JSONL log lines from stdin (fields: ts, level, service, msg, latency_ms) and prints a summary table of request counts, error rates, and p95 latency grouped by service. Make sure it handles malformed JSON lines gracefully without crashing, supports a `--min-level` filter, and includes a quick test script that pipes in edge-case data (empty input, broken lines, missing fields) and verifies the output.

Details that must hold:

- Levels, lowest first: DEBUG, INFO, WARN, ERROR, FATAL (case does not matter; WARNING means WARN). `--min-level LEVEL` leaves out lines below that level. A line with a missing or unknown level counts as INFO.
- A line is an error when its level is ERROR or FATAL. The error rate of a service is errors divided by its counted lines.
- p95 uses the nearest-rank method on the numeric `latency_ms` values of the service's counted lines: sort them, take the value at position ceil(0.95 × n) (1-based). Lines without a numeric latency still count as requests but not towards p95. A service with no latencies has no p95.
- A line that is not a JSON object is skipped and counted as skipped. Blank lines (empty or only whitespace) are ignored and not counted at all. A line without a service (missing, empty, or not a string) is counted under the service `unknown`.
- `--json` prints, instead of the table, exactly one JSON object: `{"services": {"<name>": {"count": 3, "errors": 1, "error_rate": 0.3333, "p95_ms": 120.0}}, "skipped": 2}`. `error_rate` is a number from 0 to 1, `p95_ms` is a number or null. Services with no counted lines are left out.
- The exit status is 0 for any input, including empty input. An unknown `--min-level` value prints a message to stderr and exits with status 2.
- It must cope with large input (200,000 lines within a few seconds) and with values that are valid JSON but odd: huge numbers, nested objects, strings where numbers are expected.
