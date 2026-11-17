# logstats

Reads a web access log and prints a report: how many requests, bytes, durations and
status classes, the busiest paths, the 5xx error rate per hour, and how many sessions
each user had. Standard library only.

    python -m logstats access.log

The report layout is in [docs/OUTPUT.md](docs/OUTPUT.md). The exact text matters: other
tools diff it from one day to the next.

## The log

One request per line, fields separated by blanks:

    2026-03-01T10:00:03Z u17 GET /api/users 200 5123 48

timestamp (UTC, `YYYY-MM-DDTHH:MM:SSZ`), user, method, path, status, bytes, duration in
milliseconds. Details:

- Methods are `GET POST PUT PATCH DELETE HEAD OPTIONS`. A path starts with `/` and has no blanks.
  The status is 100 to 599; bytes and milliseconds are whole numbers, 0 or more. A user is any
  text without blanks.
- A line that does not look like this (wrong number of fields, a timestamp that is not a real
  date and time, a status out of range, and so on) is *malformed*: it is counted and skipped.
- A line that is empty or only blanks is ignored altogether (it is not even counted).
- Lines end with `\n` or `\r\n`. The file is UTF-8; bytes that are not valid UTF-8 are read as the
  replacement character U+FFFD, they do not stop the run.
- **Order.** The shippers that write the log flush once a minute, so the log is in timestamp order
  except that a line can be up to 60 seconds older than the newest line before it. The report is what
  you get by sorting the lines by timestamp first. Lines further out of order than that do not occur.

## Layout

| file | what it does |
| --- | --- |
| `logstats/parse.py` | `parse_line(line)`: one line to a `Record`, or `None` when it is malformed |
| `logstats/reader.py` | reads a file into lines |
| `logstats/sessions.py` | `count_sessions(times)`: sessions in a sorted list of timestamps |
| `logstats/analysis.py` | `analyze(lines)`: all the numbers of the report, as a `Stats` |
| `logstats/render.py` | `render(stats)`: the report text |
| `logstats/cli.py` | the command line |

## Tests

    pytest
