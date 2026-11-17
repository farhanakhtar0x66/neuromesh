# The report

    logstats report
    lines: 12
    malformed: 2
    requests: 10
    period: 2026-03-01T10:00:00Z .. 2026-03-01T14:12:09Z
    bytes: 123456
    duration ms: min 3, max 910, mean 123.4
    status: 1xx=0 2xx=7 3xx=1 4xx=1 5xx=1
    top paths:
      /api/users  120
      /index.html  96
    errors per hour (5xx):
      2026-03-01 10:00  3/120  2.50%
    users: 2
      u1  requests=12 sessions=2
      u2  requests=3 sessions=1
    sessions: total 3

## Rules

- `lines` counts every line that is not blank; `malformed` those among them that do not parse;
  `requests` is the rest.
- `period` is the earliest and the latest timestamp among the requests. `duration ms` is the
  smallest, the largest and the mean (`sum / requests`, printed with one decimal). With no requests,
  `period: n/a`, `bytes: 0` and `duration ms: n/a`.
- `status` counts requests per status class (the first digit), always all five classes.
- **top paths**: the ten paths with the most requests, most first. Paths with the same count go in
  ascending order of the path (plain string comparison). Fewer than ten paths: all of them. No
  requests: the line `  (none)`.
- **errors per hour**: one line for every UTC hour that has at least one request, in time order:
  the hour, `errors/requests` where an error is a 5xx status, and the percentage
  (`100 * errors / requests`, two decimals). No requests: `  (none)`.
- **users**: every user, sorted by name (plain string comparison), with their number of requests and
  of sessions. No requests: `  (none)`.
- **Sessions.** A user's requests, in timestamp order, form a new session whenever the gap to that
  user's previous request is more than 30 minutes (1800 seconds). A gap of exactly 1800 seconds
  continues the session. `sessions: total` is the sum over all users.
- The report ends with a newline.
