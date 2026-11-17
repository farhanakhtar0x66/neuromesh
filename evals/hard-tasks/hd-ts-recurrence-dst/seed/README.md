# remindly

Recurring reminder schedules for a team calendar: "every weekday at 09:00 New York time", "the last Friday of the month at
16:00 London time", "the 31st of every month". A rule is a small JSON object; `occurrences(rule, window)` returns the instants
(`Date`s) at which the reminder fires.

    import { occurrences } from "./src/index.ts";

    const rule = { zone: "America/New_York", start: "2026-01-05", time: "09:00", repeat: { type: "daily", every: 1 } };
    occurrences(rule, { from: new Date("2026-03-01T00:00:00Z"), limit: 3 });

The rule format and exactly how a rule becomes instants (nonexistent and repeated local times, month ends, `until`, `count`)
is in [docs/RECURRENCE.md](docs/RECURRENCE.md).

On the command line:

    node src/cli.ts next examples/standup.json --from 2026-03-01T00:00:00Z --count 3

## Layout

    src/schedule.ts   occurrences(): the dates a rule produces and the window
    src/zone.ts       wall-clock time in a zone: offsets, local date, local time to instant
    src/dates.ts      calendar arithmetic without a zone
    src/validate.ts   what a rule may contain (RuleError messages)
    src/format.ts     the line the command prints
    test/             node --test

## Tests

    npm test      (or: node --test test/*.test.ts)

Needs Node 26 or later (it runs the TypeScript directly). No dependencies.
