//! Splitting text into lines.

/// The lines of `text`, each keeping its trailing `\n`. A last line without a newline is a line too.
/// The empty text has no lines.
pub fn split_lines(text: &str) -> Vec<&str> {
    let mut lines = Vec::new();
    let mut start = 0;
    for (i, byte) in text.bytes().enumerate() {
        if byte == b'\n' {
            lines.push(&text[start..=i]);
            start = i + 1;
        }
    }
    if start < text.len() {
        lines.push(&text[start..]);
    }
    lines
}

/// The inverse of `split_lines`.
pub fn join_lines(lines: &[&str]) -> String {
    lines.concat()
}
