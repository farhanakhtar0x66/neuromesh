# hd-ts-recurrence-dst (advisor only: never shown to a model)

TypeScript, bug. Seed `remindly`: a reminder scheduler (`src/schedule.ts` dates and window, `src/zone.ts` wall-clock to instant,
`src/dates.ts` calendar helpers, `src/validate.ts`, a CLI), rules in `docs/RECURRENCE.md`, 25 visible tests (UTC, Kolkata, New York in
January, a monthly rule all year in New York: all of them away from a clock change, so they stay green after a shallow fix).

## The traps (three causes, the issue names the first and the third)
1. `schedule.ts` steps daily and weekly rules by `+ 24 h` in UTC and finds the local weekday afterwards: the local time drifts an hour
   at each change (an hour late in spring, an hour early in autumn), and a 00:30 rule lands on 23:30 of the day before, so it fires
   twice on 1 November. Fix: step the local calendar date, convert each date on its own.
2. A monthly rule for day 29 to 31 skips short months instead of using the last day (`if (day > daysInMonth) continue`).
3. `zone.ts localToInstant` takes the offset at "the wall time read as UTC". Right by accident for New York, wrong for zones east of
   UTC and for the rest of the edge: London's repeated hour takes the later instant, a skipped time comes out hours early, Chatham's
   02:45 change and Santiago's midnight change break it. The issue never mentions it; `docs/RECURRENCE.md` states the rule (skipped
   time moves forward by the gap, repeated time takes the earlier instant) with worked examples. A shallow fix of 1 and 2 still fails
   23 of the 73 tests (checked: the reference's `schedule.ts` over the seed's `zone.ts`).
Why Haiku should fail: it fixes what the issue lists, in the one zone it tests (New York), and never reads the rules file; hand
arithmetic with offsets is right for one zone and wrong at the edge of another.

## The oracle
`hidden/tests/test/support/oracle.ts`: `Temporal.ZonedDateTime.from({timeZone, year, month, day, hour, minute}, {disambiguation:
"compatible"})` for the conversion, `PlainDate` / `PlainYearMonth` arithmetic for the dates (`overflow: "constrain"` for month ends).
Node 26.13 has `Temporal` unflagged. The reference solution does NOT use Temporal: `localToInstant` tries the offsets in force a day
before and a day after (the one that fits; both fit: earlier; none: the pre-change offset, which moves a gap time forward by the
gap). It agrees with the oracle on every case below, so oracle and reference are independent implementations.
Tests (48 hidden): 15 named cases with hand-derived instants (New York, London, Lord Howe, Santiago, Chatham, month ends, leap
February, last Friday, `until` on a moved time, `count` across a change); 24 zone x kind tests (6 zones x daily/weekly/monthly day/
monthly last weekday, 3 years 2025-2027, each over 3 to 7 times of day chosen on or next to the zone's changes and 3 to 5 rule
variants) compared occurrence by occurrence; 6 batches of 50 random rules (`mulberry32(777 + batch)`: random zone, time, repeat,
start, `until`, `count`, window `from`/`to`/`limit`); 3 CLI tests on the printed lines.

## Fairness check
- Conversion rules (gap, fold, examples for New York, Lord Howe), month-end clamp, last weekday, start-date rule, `until` as a local date,
  `count` from the start of the series, window semantics, CLI line format: `docs/RECURRENCE.md`.
- Santiago, Chatham and London values follow from the same rules and the platform's tz data (ICU); I checked each hand-derived value
  against the oracle (they all agree). The zones with a change at midnight (Santiago) or at 02:45 (Chatham) are not in the docs by name; the
  rule covers them.
- Two things the docs fix that a reader could miss: a monthly rule's first month is the first whose (clamped) date is not before `start`;
  weeks have no "every N weeks" (weekly means every week).
- No assertion depends on tz data newer than Node 26's ICU: windows are 2025 to 2027 plus random windows up to 2029-02.

## Numbers
Seed 508 lines (src 346 + tests), reference touches two files (`schedule.ts` 45 lines, `zone.ts` +20): about 52 changed lines, which is
UNDER the 150 to 700 DESIGN asks for. It is a small fix to a small project; the discrimination comes from the three causes, not size.
Hidden check: 73 tests (40 fail-to-pass, 33 pass-to-pass), about 4.3 s on the reference, 1.4 s on the seed on the owner's Mac;
`validate-task.ts` about 16 s. No time limit used.
