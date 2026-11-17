//! Unified diff output, as `diff -u` writes it.

use crate::hunk::{hunks, Hunk};
use crate::lines::split_lines;

/// "--- a_name", "+++ b_name" and one `@@ -l,s +l,s @@` block per group of changes with `context` unchanged lines
/// around them. Changes closer than `2 * context` lines share a block. The empty string when the texts are equal.
pub fn unified_diff(a_name: &str, a_text: &str, b_name: &str, b_text: &str, context: usize) -> String {
    let a = split_lines(a_text);
    let b = split_lines(b_text);
    let all = hunks(&a, &b);
    if all.is_empty() {
        return String::new();
    }
    let mut out = format!("--- {a_name}\n+++ {b_name}\n");
    let mut group_start = 0;
    while group_start < all.len() {
        let mut group_end = group_start + 1;
        while group_end < all.len() && all[group_end].a_start - all[group_end - 1].a_end <= 2 * context {
            group_end += 1;
        }
        write_block(&mut out, &a, &b, &all[group_start..group_end], context);
        group_start = group_end;
    }
    out
}

fn range_text(start: usize, len: usize) -> String {
    // diff -u counts from 1, and names the line *before* an empty range.
    match len {
        0 => format!("{},0", start),
        1 => format!("{}", start + 1),
        _ => format!("{},{}", start + 1, len),
    }
}

fn push_line(out: &mut String, sign: char, line: &str) {
    out.push(sign);
    out.push_str(line);
    if !line.ends_with('\n') {
        out.push_str("\n\\ No newline at end of file\n");
    }
}

fn write_block(out: &mut String, a: &[&str], b: &[&str], group: &[Hunk], context: usize) {
    let first = group[0];
    let last = group[group.len() - 1];
    let a_from = first.a_start.saturating_sub(context);
    let a_to = (last.a_end + context).min(a.len());
    let b_from = first.b_start - (first.a_start - a_from);
    let b_to = last.b_end + (a_to - last.a_end);
    out.push_str(&format!("@@ -{} +{} @@\n", range_text(a_from, a_to - a_from), range_text(b_from, b_to - b_from)));
    let mut ai = a_from;
    for h in group {
        while ai < h.a_start {
            push_line(out, ' ', a[ai]);
            ai += 1;
        }
        for line in &a[h.a_start..h.a_end] {
            push_line(out, '-', line);
        }
        for line in &b[h.b_start..h.b_end] {
            push_line(out, '+', line);
        }
        ai = h.a_end;
    }
    while ai < a_to {
        push_line(out, ' ', a[ai]);
        ai += 1;
    }
}
