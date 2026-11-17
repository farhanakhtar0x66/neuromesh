# How a rule becomes a list of instants

A rule says "this, at this local time, in this time zone". Everything is decided on the local calendar of the rule's
zone; instants (what the scheduler fires on) come last.

## The rule

    {
      "zone": "America/New_York",     IANA time zone name
      "start": "2026-01-05",          first local date that may produce an occurrence (YYYY-MM-DD)
      "time": "09:00",                local wall-clock time, HH:MM, 24 hours
      "repeat": { ... },              see below
      "until": "2026-12-31",          optional: last local date that may produce an occurrence (inclusive)
      "count": 10                     optional: stop after this many occurrences
    }

`repeat` is one of:

| repeat | local dates it produces |
| --- | --- |
| `{ "type": "daily", "every": N }` | the start date, then every N-th calendar day after it (N whole days of the calendar, not 24 hours) |
| `{ "type": "weekly", "days": ["MO","WE"] }` | every date on or after the start date whose weekday is listed (`MO TU WE TH FR SA SU`) |
| `{ "type": "monthly", "day": D }` | day D of each month, from the first month whose day D is on or after the start date |
| `{ "type": "monthly", "last": "FR" }` | the last Friday (any weekday) of each month, from the first month whose last such day is on or after the start date |

A monthly rule for day 29, 30 or 31 in a month that does not have that day uses the last day of that month
(day 31 gives 28 or 29 February, 30 April, and so on). Every month produces exactly one occurrence.

## From a local date and time to an instant

For one local date and the rule's time the zone gives one of three answers:

- the wall-clock time happens once: that instant;
- it does not happen (the clocks jumped forward over it): the instant is the wall-clock time moved **forward by the
  length of the gap**. In America/New_York on 2026-03-08 the clocks go from 02:00 to 03:00, so 02:30 becomes 03:30
  (07:30 UTC). In Australia/Lord_Howe the gap is 30 minutes: on 2026-10-04 02:00 becomes 02:30, so 02:15 becomes 02:45;
- it happens twice (the clocks went back): the **earlier** instant. In America/New_York on 2026-11-01 01:30 happens at
  05:30 UTC (still summer time) and at 06:30 UTC; the occurrence is 05:30 UTC.

The occurrences of a rule are these instants for its dates, in order, one per date. A date's occurrence is never
skipped and never doubled, and the time of day stays the rule's time on every date where that time exists.

## `until`, `count`, and the window

- `until` is a local date, compared with the dates the rule produces (before any move for a gap): a date after `until`
  produces nothing, and nothing after it does either.
- `count` counts occurrences from the start of the series, not from the window: the 10th occurrence is the last, even if
  the window begins after the 9th.
- `occurrences(rule, { from, to, limit })` returns the occurrences of the series whose instant is at or after `from` and
  before `to` (both optional), in order, at most `limit` of them (optional).

## Command line

    node src/cli.ts next <rule.json> --from <ISO instant> [--count <n>]

prints the next `n` (default 5) occurrences at or after the instant, one per line: the local date and time with its UTC
offset, two spaces, then the instant in UTC:

    2026-03-08 09:00 -04:00  2026-03-08T13:00:00.000Z
