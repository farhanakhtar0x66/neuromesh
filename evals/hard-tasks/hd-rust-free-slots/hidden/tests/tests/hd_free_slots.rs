// Hidden check for hd-rust-free-slots. Every assertion follows from docs/RULES.md or README.md of the seed.
// The property tests compare free_slots with a minute-by-minute brute force that does not use the interval algebra.

use calsched::person::{Exception, ExceptionKind, Meeting, Person, FRI, MINUTES_PER_DAY, MON, SAT, SUN, THU, TUE, WED};
use calsched::{availability, free_slots, Interval};

const MONDAY: i64 = 19_002; // 2022-01-10, a Monday

fn at(day: i64, hour: i64, minute: i64) -> i64 {
    day * MINUTES_PER_DAY + hour * 60 + minute
}

fn iv(start: i64, end: i64) -> Interval {
    Interval::new(start, end)
}

fn week() -> Interval {
    iv(at(MONDAY, 0, 0), at(MONDAY + 7, 0, 0))
}

fn day_window(day: i64) -> Interval {
    iv(at(day, 0, 0), at(day + 1, 0, 0))
}

// ---------------------------------------------------------------- named cases

#[test]
fn hd_meeting_buffer_on_the_meeting_is_kept() {
    // Her default buffer is 10, but this meeting asks for 30 after: 11:15 must not be offered.
    let dana = Person::new("dana", 0)
        .work(TUE, 9 * 60, 17 * 60)
        .with_buffers(10, 10)
        .with_meeting(Meeting { span: iv(at(MONDAY + 1, 10, 0), at(MONDAY + 1, 11, 0)), buffer_before: None, buffer_after: Some(30) });
    let slots = free_slots(&[dana], week(), 15);
    assert_eq!(slots, vec![iv(at(MONDAY + 1, 9, 0), at(MONDAY + 1, 9, 50)), iv(at(MONDAY + 1, 11, 30), at(MONDAY + 1, 17, 0))]);
}

#[test]
fn hd_zero_buffer_on_a_meeting_overrides_the_default() {
    let dana = Person::new("dana", 0)
        .work(TUE, 9 * 60, 17 * 60)
        .with_buffers(20, 20)
        .with_meeting(Meeting::with_buffers(at(MONDAY + 1, 12, 0), at(MONDAY + 1, 13, 0), 0, 0));
    let slots = free_slots(&[dana], week(), 15);
    assert_eq!(slots, vec![iv(at(MONDAY + 1, 9, 0), at(MONDAY + 1, 12, 0)), iv(at(MONDAY + 1, 13, 0), at(MONDAY + 1, 17, 0))]);
}

#[test]
fn hd_buffers_of_different_meetings_do_not_combine() {
    // A: 10:00-11:00 buffer 5/5 -> blocks 09:55-11:05. B: 11:20-12:00 buffer 0/0 -> blocks 11:20-12:00.
    // The gap 11:05-11:20 is free. (A merged-first, buffered-once calendar would hide it.)
    let p = Person::new("p", 0)
        .work(MON, 8 * 60, 18 * 60)
        .with_meeting(Meeting::with_buffers(at(MONDAY, 10, 0), at(MONDAY, 11, 0), 5, 5))
        .with_meeting(Meeting::with_buffers(at(MONDAY, 11, 20), at(MONDAY, 12, 0), 0, 0));
    let slots = free_slots(&[p], day_window(MONDAY), 15);
    assert_eq!(
        slots,
        vec![iv(at(MONDAY, 8, 0), at(MONDAY, 9, 55)), iv(at(MONDAY, 11, 5), at(MONDAY, 11, 20)), iv(at(MONDAY, 12, 0), at(MONDAY, 18, 0))]
    );
}

#[test]
fn hd_overlapping_meetings_with_large_buffer_on_the_short_one() {
    // Long meeting 09:00-12:00 with no buffer; short one 10:00-10:30 with 90 minutes after: blocked until 12:00 anyway,
    // and one with 120 after: blocked until 12:30.
    let base = Person::new("p", 0).work(MON, 8 * 60, 18 * 60).with_meeting(Meeting::with_buffers(at(MONDAY, 9, 0), at(MONDAY, 12, 0), 0, 0));
    let a = base.clone().with_meeting(Meeting::with_buffers(at(MONDAY, 10, 0), at(MONDAY, 10, 30), 0, 90));
    let b = base.with_meeting(Meeting::with_buffers(at(MONDAY, 10, 0), at(MONDAY, 10, 30), 0, 120));
    assert_eq!(free_slots(&[a], day_window(MONDAY), 15), vec![iv(at(MONDAY, 8, 0), at(MONDAY, 9, 0)), iv(at(MONDAY, 12, 0), at(MONDAY, 18, 0))]);
    assert_eq!(free_slots(&[b], day_window(MONDAY), 15), vec![iv(at(MONDAY, 8, 0), at(MONDAY, 9, 0)), iv(at(MONDAY, 12, 30), at(MONDAY, 18, 0))]);
}

#[test]
fn hd_back_to_back_meetings_leave_no_gap() {
    let p = Person::new("p", 0)
        .work(MON, 9 * 60, 17 * 60)
        .with_meeting(Meeting::new(at(MONDAY, 10, 0), at(MONDAY, 11, 0)))
        .with_meeting(Meeting::new(at(MONDAY, 11, 0), at(MONDAY, 12, 0)));
    assert_eq!(free_slots(&[p], day_window(MONDAY), 1), vec![iv(at(MONDAY, 9, 0), at(MONDAY, 10, 0)), iv(at(MONDAY, 12, 0), at(MONDAY, 17, 0))]);
}

#[test]
fn hd_a_buffer_is_blocked_even_outside_working_hours() {
    let p = Person::new("p", 0).work(MON, 9 * 60, 17 * 60).with_meeting(Meeting::with_buffers(at(MONDAY, 17, 0), at(MONDAY, 18, 0), 30, 0));
    assert_eq!(free_slots(&[p], day_window(MONDAY), 15), vec![iv(at(MONDAY, 9, 0), at(MONDAY, 16, 30))]);
}

#[test]
fn hd_extra_hours_cross_midnight() {
    // Extra hours Tuesday 22:00 to Wednesday 02:00 local, for someone at UTC-05:00.
    let p = Person::new("p", -300).with_exception(Exception::extra(iv(at(MONDAY + 1, 22, 0), at(MONDAY + 2, 2, 0))));
    let slots = free_slots(&[p], week(), 30);
    // Local 22:00 Tue = 03:00 UTC Wed.
    assert_eq!(slots, vec![iv(at(MONDAY + 2, 3, 0), at(MONDAY + 2, 7, 0))]);
}

#[test]
fn hd_extra_hours_after_midnight_are_found_by_a_window_that_starts_after_midnight() {
    let p = Person::new("p", 0).with_exception(Exception::extra(iv(at(MONDAY + 1, 22, 0), at(MONDAY + 2, 2, 0))));
    let window = iv(at(MONDAY + 2, 0, 30), at(MONDAY + 2, 12, 0));
    assert_eq!(free_slots(&[p], window, 30), vec![iv(at(MONDAY + 2, 0, 30), at(MONDAY + 2, 2, 0))]);
}

#[test]
fn hd_time_off_crossing_midnight_covers_the_whole_span() {
    let p = Person::new("p", 0)
        .work_weekdays(9 * 60, 17 * 60)
        .with_exception(Exception::off(iv(at(MONDAY + 1, 18, 0) - 6 * 60, at(MONDAY + 2, 12, 0))));
    // Off from Tuesday 12:00 to Wednesday 12:00.
    let slots = free_slots(&[p], week(), 30);
    assert_eq!(
        slots,
        vec![
            iv(at(MONDAY, 9, 0), at(MONDAY, 17, 0)),
            iv(at(MONDAY + 1, 9, 0), at(MONDAY + 1, 12, 0)),
            iv(at(MONDAY + 2, 12, 0), at(MONDAY + 2, 17, 0)),
            iv(at(MONDAY + 3, 9, 0), at(MONDAY + 3, 17, 0)),
            iv(at(MONDAY + 4, 9, 0), at(MONDAY + 4, 17, 0)),
        ]
    );
}

#[test]
fn hd_time_off_wins_over_extra_hours() {
    let p = Person::new("p", 0)
        .work(MON, 9 * 60, 17 * 60)
        .with_exception(Exception::extra(iv(at(MONDAY, 17, 0), at(MONDAY, 20, 0))))
        .with_exception(Exception::off(iv(at(MONDAY, 16, 0), at(MONDAY, 18, 0))));
    assert_eq!(free_slots(&[p], day_window(MONDAY), 15), vec![iv(at(MONDAY, 9, 0), at(MONDAY, 16, 0)), iv(at(MONDAY, 18, 0), at(MONDAY, 20, 0))]);
}

#[test]
fn hd_day_offs_listed_newest_first_are_all_honoured() {
    // Two day offs, the later one listed first.
    let p = Person::new("p", 0)
        .work_weekdays(9 * 60, 17 * 60)
        .with_exception(Exception::day_off(MONDAY + 3))
        .with_exception(Exception::day_off(MONDAY + 1));
    let slots = free_slots(&[p], week(), 60);
    let starts: Vec<i64> = slots.iter().map(|s| s.start).collect();
    assert_eq!(starts, vec![at(MONDAY, 9, 0), at(MONDAY + 2, 9, 0), at(MONDAY + 4, 9, 0)]);
}

#[test]
fn hd_a_day_off_is_the_local_day() {
    // UTC+05:30: local Wednesday is 18:30 UTC Tuesday to 18:30 UTC Wednesday.
    let p = Person::new("p", 330).work(TUE, 0, 1440).work(WED, 0, 1440).work(THU, 0, 1440).with_exception(Exception::day_off(MONDAY + 2));
    let slots = free_slots(&[p], week(), 30);
    // Local Tuesday: 18:30 UTC Mon .. 18:30 UTC Tue. Local Thursday: 18:30 UTC Wed .. 18:30 UTC Thu.
    assert_eq!(slots, vec![iv(at(MONDAY, 18, 30), at(MONDAY + 1, 18, 30)), iv(at(MONDAY + 2, 18, 30), at(MONDAY + 3, 18, 30))]);
}

#[test]
fn hd_split_hours_around_noon_are_one_block() {
    let p = Person::new("p", 0).work(MON, 9 * 60, 12 * 60).work(MON, 12 * 60, 17 * 60);
    assert_eq!(free_slots(&[p], day_window(MONDAY), 240), vec![iv(at(MONDAY, 9, 0), at(MONDAY, 17, 0))]);
}

#[test]
fn hd_a_night_shift_is_one_block_across_midnight() {
    let p = Person::new("p", 0).work(MON, 22 * 60, 1440).work(TUE, 0, 2 * 60);
    assert_eq!(free_slots(&[p], week(), 240), vec![iv(at(MONDAY, 22, 0), at(MONDAY + 1, 2, 0))]);
}

#[test]
fn hd_two_people_whose_hours_only_touch_have_no_common_time() {
    let a = Person::new("a", 0).work(MON, 9 * 60, 12 * 60);
    let b = Person::new("b", 0).work(MON, 12 * 60, 15 * 60);
    assert!(free_slots(&[a, b], week(), 1).is_empty());
}

#[test]
fn hd_a_meeting_that_touches_hours_changes_nothing() {
    let p = Person::new("p", 0).work(MON, 9 * 60, 17 * 60).with_meeting(Meeting::new(at(MONDAY, 17, 0), at(MONDAY, 18, 0))).with_meeting(Meeting::new(at(MONDAY, 8, 0), at(MONDAY, 9, 0)));
    assert_eq!(free_slots(&[p], day_window(MONDAY), 1), vec![iv(at(MONDAY, 9, 0), at(MONDAY, 17, 0))]);
}

#[test]
fn hd_meetings_listed_in_any_order() {
    let ms = [
        Meeting::new(at(MONDAY, 15, 0), at(MONDAY, 16, 0)),
        Meeting::new(at(MONDAY, 9, 30), at(MONDAY, 10, 0)),
        Meeting::new(at(MONDAY, 12, 0), at(MONDAY, 14, 0)),
        Meeting::new(at(MONDAY, 13, 0), at(MONDAY, 13, 30)),
    ];
    let mut p = Person::new("p", 0).work(MON, 9 * 60, 17 * 60);
    for m in ms {
        p = p.with_meeting(m);
    }
    let want = vec![
        iv(at(MONDAY, 9, 0), at(MONDAY, 9, 30)),
        iv(at(MONDAY, 10, 0), at(MONDAY, 12, 0)),
        iv(at(MONDAY, 14, 0), at(MONDAY, 15, 0)),
        iv(at(MONDAY, 16, 0), at(MONDAY, 17, 0)),
    ];
    assert_eq!(free_slots(&[p], day_window(MONDAY), 15), want);
}

#[test]
fn hd_time_off_listed_out_of_order() {
    let p = Person::new("p", 0)
        .work(MON, 0, 1440)
        .with_exception(Exception::off(iv(at(MONDAY, 20, 0), at(MONDAY, 21, 0))))
        .with_exception(Exception::off(iv(at(MONDAY, 2, 0), at(MONDAY, 3, 0))))
        .with_exception(Exception::off(iv(at(MONDAY, 8, 0), at(MONDAY, 22, 0))));
    let slots = free_slots(&[p], day_window(MONDAY), 15);
    assert_eq!(slots, vec![iv(at(MONDAY, 0, 0), at(MONDAY, 2, 0)), iv(at(MONDAY, 3, 0), at(MONDAY, 8, 0)), iv(at(MONDAY, 22, 0), at(MONDAY + 1, 0, 0))]);
}

#[test]
fn hd_weekday_follows_the_local_date() {
    // A person at UTC+14 works Monday 09:00-10:00 local: that is Sunday 19:00-20:00 UTC.
    let p = Person::new("p", 14 * 60).work(MON, 9 * 60, 10 * 60);
    let slots = free_slots(&[p], iv(at(MONDAY - 3, 0, 0), at(MONDAY + 7, 0, 0)), 30);
    assert_eq!(slots, vec![iv(at(MONDAY - 1, 19, 0), at(MONDAY - 1, 20, 0)), iv(at(MONDAY + 6, 19, 0), at(MONDAY + 6, 20, 0))]);
    let q = Person::new("q", -11 * 60).work(SUN, 20 * 60, 23 * 60);
    // Sunday 20:00 local at UTC-11 is Monday 07:00 UTC.
    assert_eq!(free_slots(&[q], week(), 30), vec![iv(at(MONDAY, 7, 0), at(MONDAY, 10, 0))]);
}

#[test]
fn hd_min_len_boundaries() {
    let p = Person::new("p", 0).work(MON, 9 * 60, 9 * 60 + 45).work(MON, 12 * 60, 13 * 60);
    assert_eq!(free_slots(&[p.clone()], day_window(MONDAY), 45).len(), 2);
    assert_eq!(free_slots(&[p.clone()], day_window(MONDAY), 46), vec![iv(at(MONDAY, 12, 0), at(MONDAY, 13, 0))]);
    assert_eq!(free_slots(&[p.clone()], day_window(MONDAY), 0), free_slots(&[p.clone()], day_window(MONDAY), 1));
    assert_eq!(free_slots(&[p], day_window(MONDAY), -5).len(), 2);
}

#[test]
fn hd_window_clips_slots_and_drops_what_is_left_too_short() {
    let p = Person::new("p", 0).work(MON, 9 * 60, 17 * 60);
    assert_eq!(free_slots(&[p.clone()], iv(at(MONDAY, 16, 30), at(MONDAY, 20, 0)), 30), vec![iv(at(MONDAY, 16, 30), at(MONDAY, 17, 0))]);
    assert!(free_slots(&[p], iv(at(MONDAY, 16, 30), at(MONDAY, 20, 0)), 31).is_empty());
}

#[test]
fn hd_availability_is_sorted_and_joined() {
    let p = Person::new("p", 0)
        .work(MON, 9 * 60, 12 * 60)
        .work(MON, 12 * 60, 15 * 60)
        .with_exception(Exception::extra(iv(at(MONDAY, 15, 0), at(MONDAY, 16, 0))))
        .with_meeting(Meeting::new(at(MONDAY, 13, 0), at(MONDAY, 13, 30)));
    assert_eq!(availability(&p, day_window(MONDAY)), vec![iv(at(MONDAY, 9, 0), at(MONDAY, 13, 0)), iv(at(MONDAY, 13, 30), at(MONDAY, 16, 0))]);
}

// ---------------------------------------------------------------- the brute force

struct Rng(u64);

impl Rng {
    fn new(seed: u64) -> Rng {
        Rng(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) ^ 0xD1B5_4A32_D192_ED03)
    }

    fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }

    fn range(&mut self, lo: i64, hi: i64) -> i64 {
        lo + (self.next() % ((hi - lo + 1) as u64)) as i64
    }

    fn chance(&mut self, percent: i64) -> bool {
        self.range(1, 100) <= percent
    }
}

/// Is `p` bookable at the single minute `t`? Written from the rules, without intervals.
fn bookable(p: &Person, t: i64) -> bool {
    let local = t + p.utc_offset_min;
    let day = local.div_euclid(MINUTES_PER_DAY);
    let minute_of_day = local.rem_euclid(MINUTES_PER_DAY);
    let weekday = (day + 3).rem_euclid(7) as u8;
    let regular = p.weekly.iter().any(|b| b.weekday == weekday && b.start_min <= minute_of_day && minute_of_day < b.end_min);
    let extra = p.exceptions.iter().any(|e| e.kind == ExceptionKind::Extra && e.local.start <= local && local < e.local.end);
    let off = p.exceptions.iter().any(|e| e.kind == ExceptionKind::Off && e.local.start <= local && local < e.local.end);
    let blocked = p.meetings.iter().any(|m| {
        let before = m.buffer_before.unwrap_or(p.buffer_before);
        let after = m.buffer_after.unwrap_or(p.buffer_after);
        m.span.start - before <= t && t < m.span.end + after
    });
    (regular || extra) && !off && !blocked
}

fn brute_force(people: &[Person], window: Interval, min_len: i64) -> Vec<Interval> {
    let min = min_len.max(1);
    let mut out = Vec::new();
    let mut run_start: Option<i64> = None;
    for t in window.start..window.end {
        let ok = !people.is_empty() && people.iter().all(|p| bookable(p, t));
        match (ok, run_start) {
            (true, None) => run_start = Some(t),
            (false, Some(s)) => {
                if t - s >= min {
                    out.push(iv(s, t));
                }
                run_start = None;
            }
            _ => {}
        }
    }
    if let Some(s) = run_start {
        if window.end - s >= min {
            out.push(iv(s, window.end));
        }
    }
    out
}

fn shuffle<T>(rng: &mut Rng, v: &mut Vec<T>) {
    for i in (1..v.len()).rev() {
        let j = rng.range(0, i as i64) as usize;
        v.swap(i, j);
    }
}

fn random_person(rng: &mut Rng, index: usize, window: Interval) -> Person {
    let offsets = [0, 60, -300, 330, -480, 540, 345, -210, 765, -660, 120];
    let offset = offsets[rng.range(0, offsets.len() as i64 - 1) as usize];
    let mut p = Person::new(&format!("p{index}"), offset);
    // Regular hours: a start and end per weekday, sometimes split in two touching blocks, sometimes a night shift.
    let start = rng.range(5, 11) * 60 + 15 * rng.range(0, 3);
    let end = rng.range(15, 21) * 60 + 15 * rng.range(0, 3);
    for weekday in 0..7u8 {
        if rng.chance(70) {
            if rng.chance(25) {
                let mid = (start + end) / 2 / 15 * 15;
                p = p.work(weekday, start, mid).work(weekday, mid, end);
            } else {
                p = p.work(weekday, start, end);
            }
        }
        if rng.chance(8) {
            p = p.work(weekday, 22 * 60, 1440).work((weekday + 1) % 7, 0, rng.range(1, 6) * 60);
        }
    }
    let local_start = window.start + offset - MINUTES_PER_DAY;
    let local_end = window.end + offset + MINUTES_PER_DAY;
    let mut exceptions = Vec::new();
    for _ in 0..rng.range(0, 3) {
        let s = rng.range(local_start, local_end);
        let len = rng.range(30, 14 * 60);
        exceptions.push(Exception::off(iv(s, s + len)));
    }
    for _ in 0..rng.range(0, 2) {
        let day = rng.range(local_start.div_euclid(MINUTES_PER_DAY), local_end.div_euclid(MINUTES_PER_DAY));
        exceptions.push(Exception::day_off(day));
    }
    for _ in 0..rng.range(0, 3) {
        let s = rng.range(local_start, local_end);
        let len = rng.range(30, 10 * 60);
        exceptions.push(Exception::extra(iv(s, s + len)));
    }
    shuffle(rng, &mut exceptions);
    p.exceptions = exceptions;
    p.buffer_before = 5 * rng.range(0, 4);
    p.buffer_after = 5 * rng.range(0, 4);
    let mut meetings = Vec::new();
    for _ in 0..rng.range(0, 9) {
        let s = rng.range(window.start - 60, window.end);
        let len = 15 * rng.range(1, 8);
        let mut m = Meeting::new(s, s + len);
        if rng.chance(40) {
            m.buffer_before = Some(5 * rng.range(0, 10));
        }
        if rng.chance(40) {
            m.buffer_after = Some(5 * rng.range(0, 10));
        }
        meetings.push(m);
        if rng.chance(20) {
            // Back to back, or overlapping.
            let s2 = s + len - rng.range(0, 2) * 15;
            meetings.push(Meeting::new(s2, s2 + 15 * rng.range(1, 4)));
        }
    }
    shuffle(rng, &mut meetings);
    p.meetings = meetings;
    p
}

#[test]
fn hd_property_free_slots_equals_the_minute_grid() {
    let mut non_empty = 0;
    for case in 0..300u64 {
        let mut rng = Rng::new(1000 + case);
        let start = at(MONDAY, 0, 0) + rng.range(-3, 3) * MINUTES_PER_DAY + rng.range(0, 47) * 30;
        let window = iv(start, start + rng.range(1, 4) * MINUTES_PER_DAY + rng.range(0, 11) * 60);
        let people: Vec<Person> = (0..rng.range(1, 3) as usize).map(|i| random_person(&mut rng, i, window)).collect();
        let min_len = [1, 15, 30, 60, 90, 120][rng.range(0, 5) as usize];
        let want = brute_force(&people, window, min_len);
        let got = free_slots(&people, window, min_len);
        if !want.is_empty() {
            non_empty += 1;
        }
        assert_eq!(got, want, "case {case}: window {window:?}, min_len {min_len}\npeople: {people:#?}");
    }
    assert!(non_empty >= 150, "the generator should produce slots in at least half the cases, got {non_empty}");
}

#[test]
fn hd_property_the_order_of_the_lists_does_not_matter() {
    for case in 0..100u64 {
        let mut rng = Rng::new(50_000 + case);
        let start = at(MONDAY, 0, 0) + rng.range(-3, 3) * MINUTES_PER_DAY;
        let window = iv(start, start + 3 * MINUTES_PER_DAY);
        let people: Vec<Person> = (0..2).map(|i| random_person(&mut rng, i, window)).collect();
        let mut shuffled = people.clone();
        for p in shuffled.iter_mut() {
            shuffle(&mut rng, &mut p.meetings);
            shuffle(&mut rng, &mut p.exceptions);
            shuffle(&mut rng, &mut p.weekly);
        }
        shuffled.reverse();
        assert_eq!(free_slots(&people, window, 30), free_slots(&shuffled, window, 30), "case {case}");
    }
}

#[test]
fn hd_property_one_person_availability_equals_the_minute_grid() {
    for case in 0..100u64 {
        let mut rng = Rng::new(90_000 + case);
        let start = at(MONDAY, 0, 0) + rng.range(-3, 3) * MINUTES_PER_DAY;
        let window = iv(start, start + 2 * MINUTES_PER_DAY);
        let p = random_person(&mut rng, 0, window);
        assert_eq!(availability(&p, window), brute_force(&[p.clone()], window, 1), "case {case}\n{p:#?}");
    }
}

#[test]
fn hd_weekday_constants_are_what_the_docs_say() {
    assert_eq!((MON, TUE, WED, THU, FRI, SAT, SUN), (0, 1, 2, 3, 4, 5, 6));
}
