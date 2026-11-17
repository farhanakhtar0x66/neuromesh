//! What the finder knows about one person.

use crate::interval::{Interval, Minute};

pub const MON: u8 = 0;
pub const TUE: u8 = 1;
pub const WED: u8 = 2;
pub const THU: u8 = 3;
pub const FRI: u8 = 4;
pub const SAT: u8 = 5;
pub const SUN: u8 = 6;

pub const MINUTES_PER_DAY: i64 = 1440;

/// Regular hours: on this weekday, from `start_min` to `end_min` minutes after local midnight.
/// A block stays inside one local day (`start_min < end_min <= 1440`); a night shift is written as two blocks.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct WeeklyBlock {
    pub weekday: u8,
    pub start_min: i64,
    pub end_min: i64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ExceptionKind {
    /// Time off: the person cannot be booked, whatever their regular or extra hours say.
    Off,
    /// Extra hours on top of the regular ones.
    Extra,
}

/// A one-off change to the regular hours. `local` is in the person's local minutes (UTC minutes plus the offset)
/// and may cross local midnight: a day off is `[midnight, next midnight)`, a late shift may run to 02:00.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Exception {
    pub kind: ExceptionKind,
    pub local: Interval,
}

impl Exception {
    pub fn off(local: Interval) -> Exception {
        Exception { kind: ExceptionKind::Off, local }
    }

    pub fn extra(local: Interval) -> Exception {
        Exception { kind: ExceptionKind::Extra, local }
    }

    /// The whole local day `day` (days since 1970-01-01 in local time) off.
    pub fn day_off(day: i64) -> Exception {
        Exception::off(Interval::new(day * MINUTES_PER_DAY, (day + 1) * MINUTES_PER_DAY))
    }
}

/// A meeting on the person's calendar, in UTC minutes. The buffers keep the person free of other bookings around it;
/// `None` means "use the person's default buffer", `Some(0)` means "no buffer for this meeting".
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Meeting {
    pub span: Interval,
    pub buffer_before: Option<i64>,
    pub buffer_after: Option<i64>,
}

impl Meeting {
    pub fn new(start: Minute, end: Minute) -> Meeting {
        Meeting { span: Interval::new(start, end), buffer_before: None, buffer_after: None }
    }

    pub fn with_buffers(start: Minute, end: Minute, before: i64, after: i64) -> Meeting {
        Meeting { span: Interval::new(start, end), buffer_before: Some(before), buffer_after: Some(after) }
    }
}

#[derive(Clone, Debug)]
pub struct Person {
    pub name: String,
    /// Fixed offset of the person's local time from UTC, in minutes (+330 is UTC+05:30).
    pub utc_offset_min: i64,
    pub weekly: Vec<WeeklyBlock>,
    pub exceptions: Vec<Exception>,
    pub meetings: Vec<Meeting>,
    /// Default buffers for meetings that do not set their own.
    pub buffer_before: i64,
    pub buffer_after: i64,
}

impl Person {
    pub fn new(name: &str, utc_offset_min: i64) -> Person {
        Person {
            name: name.to_string(),
            utc_offset_min,
            weekly: Vec::new(),
            exceptions: Vec::new(),
            meetings: Vec::new(),
            buffer_before: 0,
            buffer_after: 0,
        }
    }

    /// Adds a regular block; times are minutes after local midnight.
    pub fn work(mut self, weekday: u8, start_min: i64, end_min: i64) -> Person {
        self.weekly.push(WeeklyBlock { weekday, start_min, end_min });
        self
    }

    /// The same hours on Monday to Friday.
    pub fn work_weekdays(mut self, start_min: i64, end_min: i64) -> Person {
        for weekday in MON..=FRI {
            self.weekly.push(WeeklyBlock { weekday, start_min, end_min });
        }
        self
    }

    pub fn with_exception(mut self, exception: Exception) -> Person {
        self.exceptions.push(exception);
        self
    }

    pub fn with_meeting(mut self, meeting: Meeting) -> Person {
        self.meetings.push(meeting);
        self
    }

    pub fn with_buffers(mut self, before: i64, after: i64) -> Person {
        self.buffer_before = before;
        self.buffer_after = after;
        self
    }
}

/// Local minutes for a UTC minute.
pub fn to_local(utc: Minute, offset: i64) -> Minute {
    utc + offset
}

/// UTC minutes for a local minute.
pub fn to_utc(local: Minute, offset: i64) -> Minute {
    local - offset
}

/// 0 = Monday ... 6 = Sunday, for a local day number (days since 1970-01-01, which was a Thursday).
pub fn weekday_of_day(day: i64) -> u8 {
    (day + 3).rem_euclid(7) as u8
}
