//! One person's bookable time inside a window.

use crate::interval::{normalize, subtract, Interval};
use crate::person::{to_local, to_utc, weekday_of_day, ExceptionKind, Person, MINUTES_PER_DAY};

/// The regular blocks of every local day the window touches, in UTC minutes.
fn regular_hours(person: &Person, window: Interval) -> Vec<Interval> {
    let first_day = to_local(window.start, person.utc_offset_min).div_euclid(MINUTES_PER_DAY) - 1;
    let last_day = to_local(window.end, person.utc_offset_min).div_euclid(MINUTES_PER_DAY) + 1;
    let mut hours = Vec::new();
    for day in first_day..=last_day {
        let weekday = weekday_of_day(day);
        for block in person.weekly.iter().filter(|b| b.weekday == weekday) {
            let start = day * MINUTES_PER_DAY + block.start_min;
            let end = day * MINUTES_PER_DAY + block.end_min;
            hours.push(Interval::new(to_utc(start, person.utc_offset_min), to_utc(end, person.utc_offset_min)));
        }
    }
    hours
}

fn exceptions_of(person: &Person, kind: ExceptionKind) -> Vec<Interval> {
    let list: Vec<Interval> = person
        .exceptions
        .iter()
        .filter(|e| e.kind == kind)
        .map(|e| Interval::new(to_utc(e.local.start, person.utc_offset_min), to_utc(e.local.end, person.utc_offset_min)))
        .collect();
    normalize(&list)
}

/// The time the meetings keep the person from being booked, buffers included.
fn busy_blocks(person: &Person) -> Vec<Interval> {
    let blocked: Vec<Interval> = person
        .meetings
        .iter()
        .map(|m| {
            let before = m.buffer_before.unwrap_or(person.buffer_before);
            let after = m.buffer_after.unwrap_or(person.buffer_after);
            Interval::new(m.span.start - before, m.span.end + after)
        })
        .collect();
    normalize(&blocked)
}

/// The person's bookable time inside `window`: regular hours plus extra hours, minus time off, minus meetings and
/// their buffers. Sorted, and no two intervals overlap or touch.
pub fn availability(person: &Person, window: Interval) -> Vec<Interval> {
    let mut hours = regular_hours(person, window);
    hours.extend(exceptions_of(person, ExceptionKind::Extra));
    let hours = normalize(&hours);
    let free = subtract(&hours, &exceptions_of(person, ExceptionKind::Off));
    let free = subtract(&free, &busy_blocks(person));
    let clipped: Vec<Interval> = free.iter().filter_map(|i| i.intersect(&window)).collect();
    normalize(&clipped)
}
