use calsched::person::{Exception, Meeting, Person, FRI, MINUTES_PER_DAY, MON, TUE, WED};
use calsched::{availability, free_slots, normalize, subtract, Interval};

/// Day 19_000 (2022-01-08) is a Saturday; 19_002 is a Monday.
const MONDAY: i64 = 19_002;

fn at(day: i64, hour: i64, minute: i64) -> i64 {
    day * MINUTES_PER_DAY + hour * 60 + minute
}

fn iv(start: i64, end: i64) -> Interval {
    Interval::new(start, end)
}

fn week() -> Interval {
    iv(at(MONDAY, 0, 0), at(MONDAY + 7, 0, 0))
}

#[test]
fn weekdays_are_counted_from_the_epoch() {
    assert_eq!(calsched::person::weekday_of_day(0), 3);
    assert_eq!(calsched::person::weekday_of_day(MONDAY), MON);
}

#[test]
fn one_person_regular_hours() {
    let ana = Person::new("ana", 0).work(MON, 9 * 60, 17 * 60);
    let slots = free_slots(&[ana], week(), 30);
    assert_eq!(slots, vec![iv(at(MONDAY, 9, 0), at(MONDAY, 17, 0))]);
}

#[test]
fn two_people_in_different_zones() {
    let ana = Person::new("ana", 60).work_weekdays(9 * 60, 17 * 60); // 08:00-16:00 UTC
    let ben = Person::new("ben", -300).work_weekdays(8 * 60, 16 * 60); // 13:00-21:00 UTC
    let slots = free_slots(&[ana, ben], iv(at(MONDAY, 0, 0), at(MONDAY + 1, 0, 0)), 30);
    assert_eq!(slots, vec![iv(at(MONDAY, 13, 0), at(MONDAY, 16, 0))]);
}

#[test]
fn a_meeting_blocks_its_time() {
    let ana = Person::new("ana", 0)
        .work(MON, 9 * 60, 17 * 60)
        .with_meeting(Meeting::new(at(MONDAY, 12, 0), at(MONDAY, 13, 0)));
    let slots = free_slots(&[ana], week(), 30);
    assert_eq!(slots, vec![iv(at(MONDAY, 9, 0), at(MONDAY, 12, 0)), iv(at(MONDAY, 13, 0), at(MONDAY, 17, 0))]);
}

#[test]
fn the_default_buffer_applies_to_a_meeting() {
    let ana = Person::new("ana", 0)
        .work(MON, 9 * 60, 17 * 60)
        .with_buffers(10, 15)
        .with_meeting(Meeting::new(at(MONDAY, 12, 0), at(MONDAY, 13, 0)));
    let slots = free_slots(&[ana], week(), 30);
    assert_eq!(slots, vec![iv(at(MONDAY, 9, 0), at(MONDAY, 11, 50)), iv(at(MONDAY, 13, 15), at(MONDAY, 17, 0))]);
}

#[test]
fn a_day_off_removes_the_day() {
    let ana = Person::new("ana", 0).work_weekdays(9 * 60, 17 * 60).with_exception(Exception::day_off(MONDAY + 1));
    let slots = free_slots(&[ana], week(), 60);
    assert_eq!(slots.len(), 4);
    assert!(slots.iter().all(|s| s.start != at(MONDAY + 1, 9, 0)));
}

#[test]
fn extra_hours_add_time() {
    let ana = Person::new("ana", 0)
        .work(MON, 9 * 60, 12 * 60)
        .with_exception(Exception::extra(iv(at(MONDAY + 5, 10, 0), at(MONDAY + 5, 12, 0))));
    let slots = free_slots(&[ana], week(), 30);
    assert_eq!(slots, vec![iv(at(MONDAY, 9, 0), at(MONDAY, 12, 0)), iv(at(MONDAY + 5, 10, 0), at(MONDAY + 5, 12, 0))]);
}

#[test]
fn slots_shorter_than_the_minimum_are_dropped() {
    let ana = Person::new("ana", 0).work(MON, 9 * 60, 10 * 60);
    assert_eq!(free_slots(&[ana.clone()], week(), 60).len(), 1);
    assert_eq!(free_slots(&[ana], week(), 61).len(), 0);
}

#[test]
fn slots_stay_inside_the_window() {
    let ana = Person::new("ana", 0).work(MON, 9 * 60, 17 * 60);
    let window = iv(at(MONDAY, 10, 0), at(MONDAY, 11, 0));
    assert_eq!(free_slots(&[ana], window, 30), vec![window]);
}

#[test]
fn nobody_means_no_slots() {
    assert!(free_slots(&[], week(), 30).is_empty());
}

#[test]
fn the_interval_helpers_work_on_simple_input() {
    assert_eq!(normalize(&[iv(5, 10), iv(0, 6), iv(20, 20)]), vec![iv(0, 10)]);
    assert_eq!(subtract(&[iv(0, 100)], &[iv(10, 20), iv(30, 40)]), vec![iv(0, 10), iv(20, 30), iv(40, 100)]);
}

#[test]
fn availability_of_a_person_with_hours_on_two_days() {
    let ana = Person::new("ana", 0).work(TUE, 9 * 60, 10 * 60).work(WED, 9 * 60, 10 * 60).work(FRI, 0, 60);
    let free = availability(&ana, week());
    assert_eq!(free.len(), 3);
}
