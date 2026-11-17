//! calsched: common free time for a group of people.
//! See README.md for the model and docs/RULES.md for the rules.

pub mod availability;
pub mod finder;
pub mod format;
pub mod interval;
pub mod person;

pub use availability::availability;
pub use finder::free_slots;
pub use interval::{intersect_all, normalize, subtract, Interval, Minute};
pub use person::{Exception, ExceptionKind, Meeting, Person, WeeklyBlock};
