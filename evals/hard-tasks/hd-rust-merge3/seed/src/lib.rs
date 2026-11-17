//! textdiff: line diffs. See README.md.

pub mod hunk;
pub mod lines;
pub mod myers;
pub mod unified;

pub use hunk::{hunks, Hunk};
pub use lines::{join_lines, split_lines};
pub use myers::{diff, distance, Edit};
pub use unified::unified_diff;
