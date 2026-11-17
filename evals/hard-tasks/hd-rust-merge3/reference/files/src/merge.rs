//! Three-way merge of text by lines, with conflict markers in git's format.

use crate::hunk::{hunks, Hunk};
use crate::lines::split_lines;

/// How a conflict is written.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ConflictStyle {
    /// `<<<<<<< ours`, our lines, `=======`, their lines, `>>>>>>> theirs`.
    Merge,
    /// Like `Merge`, with the base lines between `||||||| base` and `=======`.
    Diff3,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MergeResult {
    pub text: String,
    /// The number of conflict blocks in `text`.
    pub conflicts: usize,
}

/// One side's version of the base lines `start..end`: the base with that side's hunks in the range applied.
fn region<'a>(base: &[&'a str], side: &[&'a str], hunks: &[Hunk], start: usize, end: usize) -> Vec<&'a str> {
    let mut out = Vec::new();
    let mut pos = start;
    for h in hunks {
        out.extend_from_slice(&base[pos..h.a_start]);
        out.extend_from_slice(&side[h.b_start..h.b_end]);
        pos = h.a_end;
    }
    out.extend_from_slice(&base[pos..end]);
    out
}

fn push_lines(text: &mut String, lines: &[&str]) {
    for line in lines {
        text.push_str(line);
    }
}

/// Starts a marker line: a last line that has no newline gets one first.
fn marker(text: &mut String, line: &str) {
    if !text.is_empty() && !text.ends_with('\n') {
        text.push('\n');
    }
    text.push_str(line);
    text.push('\n');
}

pub fn merge3(base: &str, ours: &str, theirs: &str, style: ConflictStyle) -> MergeResult {
    let b = split_lines(base);
    let o = split_lines(ours);
    let t = split_lines(theirs);
    let oh = hunks(&b, &o);
    let th = hunks(&b, &t);
    let mut text = String::new();
    let mut conflicts = 0;
    let (mut i, mut j) = (0, 0);
    let mut pos = 0;
    while i < oh.len() || j < th.len() {
        let (i0, j0) = (i, j);
        let first = if j >= th.len() || (i < oh.len() && oh[i].a_start <= th[j].a_start) {
            i += 1;
            oh[i0]
        } else {
            j += 1;
            th[j0]
        };
        let start = first.a_start;
        let mut end = first.a_end;
        loop {
            let mut grew = false;
            if i < oh.len() && oh[i].a_start <= end {
                end = end.max(oh[i].a_end);
                i += 1;
                grew = true;
            }
            if j < th.len() && th[j].a_start <= end {
                end = end.max(th[j].a_end);
                j += 1;
                grew = true;
            }
            if !grew {
                break;
            }
        }
        push_lines(&mut text, &b[pos..start]);
        pos = end;
        let ours_lines = region(&b, &o, &oh[i0..i], start, end);
        let theirs_lines = region(&b, &t, &th[j0..j], start, end);
        if ours_lines == theirs_lines || i0 == i {
            // Same change on both sides, or only they changed it.
            push_lines(&mut text, &theirs_lines);
        } else if j0 == j {
            push_lines(&mut text, &ours_lines);
        } else {
            conflicts += 1;
            marker(&mut text, "<<<<<<< ours");
            push_lines(&mut text, &ours_lines);
            if style == ConflictStyle::Diff3 {
                marker(&mut text, "||||||| base");
                push_lines(&mut text, &b[start..end]);
            }
            marker(&mut text, "=======");
            push_lines(&mut text, &theirs_lines);
            marker(&mut text, ">>>>>>> theirs");
        }
    }
    push_lines(&mut text, &b[pos..]);
    MergeResult { text, conflicts }
}
