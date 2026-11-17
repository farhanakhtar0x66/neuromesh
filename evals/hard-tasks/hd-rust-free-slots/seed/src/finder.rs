//! Common free time for a group.

use crate::availability::availability;
use crate::interval::{intersect_all, Interval};
use crate::person::Person;

/// The time inside `window` when everybody is bookable, as maximal intervals in ascending order, each at least
/// `min_len` minutes long. `min_len` below 1 counts as 1: a slot is never empty. Nobody in the list, no slots.
pub fn free_slots(people: &[Person], window: Interval, min_len: i64) -> Vec<Interval> {
    if people.is_empty() {
        return Vec::new();
    }
    let sets: Vec<Vec<Interval>> = people.iter().map(|p| availability(p, window)).collect();
    let min = min_len.max(1);
    intersect_all(&sets).into_iter().filter(|s| s.len() >= min).collect()
}
