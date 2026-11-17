# calsched

`calsched` finds common free time for a group of people. It is a small library; the team's booking bot calls
`free_slots` to propose meeting times.

```rust
use calsched::person::{Person, MINUTES_PER_DAY};
use calsched::{free_slots, Interval};

let ana = Person::new("ana", 60).work_weekdays(9 * 60, 17 * 60);
let ben = Person::new("ben", -300).work_weekdays(8 * 60, 16 * 60);
let monday = 19_000 * MINUTES_PER_DAY; // minutes since the epoch, UTC
let slots = free_slots(&[ana, ben], Interval::new(monday, monday + 7 * MINUTES_PER_DAY), 30);
```

## Model

- Time is whole minutes since 1970-01-01T00:00 UTC. Intervals are half-open: `[start, end)`. Two intervals that
  only touch (`[0,10)` and `[10,20)`) do not overlap, and together they are one continuous block.
- A person has a fixed UTC offset, regular weekly hours in local time, exceptions (time off, extra hours) in local
  time, and meetings in UTC. Meetings may carry their own buffers; the person's buffers are the default.
- Lists (meetings, exceptions, weekly blocks) are plain `Vec`s in whatever order the calendar export produced them:
  unsorted, and with overlaps.
- `free_slots(people, window, min_len)` returns the maximal intervals inside `window` when everybody is bookable and
  that are at least `min_len` minutes long, in ascending order.

The exact rules, including how exceptions and buffers combine, are in [docs/RULES.md](docs/RULES.md).

## Layout

| file | what |
| --- | --- |
| `src/interval.rs` | `Interval`, `normalize`, `subtract`, `intersect_all` |
| `src/person.rs` | `Person`, `Meeting`, `Exception`, `WeeklyBlock`, local-time helpers |
| `src/availability.rs` | one person's bookable time in a window |
| `src/finder.rs` | `free_slots` |
| `src/format.rs` | printing slots in a person's local time |
| `tests/visible.rs` | the tests that run in CI |

## Tests

    cargo test --offline
