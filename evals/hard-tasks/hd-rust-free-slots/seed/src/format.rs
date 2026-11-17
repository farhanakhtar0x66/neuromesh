//! Printing slots for people.

use crate::interval::{Interval, Minute};
use crate::person::{to_local, weekday_of_day, MINUTES_PER_DAY};

const NAMES: [&str; 7] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/// "Tue 09:30" for a UTC minute shown in local time with the given offset.
pub fn format_minute(utc: Minute, offset: i64) -> String {
    let local = to_local(utc, offset);
    let day = local.div_euclid(MINUTES_PER_DAY);
    let rest = local.rem_euclid(MINUTES_PER_DAY);
    format!("{} {:02}:{:02}", NAMES[weekday_of_day(day) as usize], rest / 60, rest % 60)
}

/// "Tue 09:30-10:15 (45 min)".
pub fn format_slot(slot: Interval, offset: i64) -> String {
    let end = format_minute(slot.end, offset);
    let end_clock = end.split(' ').nth(1).unwrap_or("");
    format!("{}-{} ({} min)", format_minute(slot.start, offset), end_clock, slot.len())
}
