//! Grouping an edit script into hunks.

use crate::myers::{diff, Edit};

/// A maximal run of changes: the lines `a[a_start..a_end]` of the old text were replaced by `b[b_start..b_end]` of the
/// new text. A pure insertion has `a_start == a_end`, a pure deletion has `b_start == b_end`. Hunks of one diff are
/// separated by at least one unchanged line.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Hunk {
    pub a_start: usize,
    pub a_end: usize,
    pub b_start: usize,
    pub b_end: usize,
}

/// The hunks that turn `a` into `b`, in order.
pub fn hunks<T: PartialEq>(a: &[T], b: &[T]) -> Vec<Hunk> {
    hunks_of(&diff(a, b))
}

pub fn hunks_of(edits: &[Edit]) -> Vec<Hunk> {
    let mut out: Vec<Hunk> = Vec::new();
    let (mut ai, mut bi) = (0usize, 0usize);
    let mut open: Option<Hunk> = None;
    for edit in edits {
        match edit {
            Edit::Equal { .. } => {
                if let Some(h) = open.take() {
                    out.push(h);
                }
                ai += 1;
                bi += 1;
            }
            Edit::Delete { .. } => {
                let h = open.get_or_insert(Hunk { a_start: ai, a_end: ai, b_start: bi, b_end: bi });
                ai += 1;
                h.a_end = ai;
            }
            Edit::Insert { .. } => {
                let h = open.get_or_insert(Hunk { a_start: ai, a_end: ai, b_start: bi, b_end: bi });
                bi += 1;
                h.b_end = bi;
            }
        }
    }
    if let Some(h) = open.take() {
        out.push(h);
    }
    out
}
