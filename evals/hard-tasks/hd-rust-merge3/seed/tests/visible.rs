use std::fs;
use std::path::PathBuf;
use std::process::Command;

use textdiff::{diff, distance, hunks, join_lines, split_lines, unified_diff, Edit, Hunk};

fn tmp(name: &str, content: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("textdiff-visible-{}", std::process::id()));
    fs::create_dir_all(&dir).unwrap();
    let path = dir.join(name);
    fs::write(&path, content).unwrap();
    path
}

fn apply(a: &[&str], b: &[&str], edits: &[Edit]) -> Vec<String> {
    let mut out = Vec::new();
    for e in edits {
        match e {
            Edit::Equal { a: i, b: j } => {
                assert_eq!(a[*i], b[*j]);
                out.push(a[*i].to_string());
            }
            Edit::Delete { .. } => {}
            Edit::Insert { b: j } => out.push(b[*j].to_string()),
        }
    }
    out
}

#[test]
fn split_and_join_are_inverse() {
    for text in ["", "a\n", "a\nb\n", "a\nb", "\n\n"] {
        assert_eq!(join_lines(&split_lines(text)), text);
    }
    assert_eq!(split_lines("a\nb"), vec!["a\n", "b"]);
}

#[test]
fn identical_texts_have_no_edits() {
    let a = ["x\n", "y\n"];
    assert_eq!(distance(&diff(&a, &a)), 0);
    assert!(hunks(&a, &a).is_empty());
}

#[test]
fn the_classic_myers_example_is_five_edits() {
    let a: Vec<char> = "ABCABBA".chars().collect();
    let b: Vec<char> = "CBABAC".chars().collect();
    assert_eq!(distance(&diff(&a, &b)), 5);
}

#[test]
fn applying_the_script_gives_the_new_text() {
    let a = ["1\n", "2\n", "3\n", "4\n", "5\n"];
    let b = ["1\n", "x\n", "3\n", "5\n", "6\n"];
    let edits = diff(&a, &b);
    assert_eq!(apply(&a, &b, &edits), b.iter().map(|s| s.to_string()).collect::<Vec<_>>());
}

#[test]
fn hunks_group_adjacent_changes() {
    let a = ["a\n", "b\n", "c\n", "d\n", "e\n"];
    let b = ["a\n", "X\n", "Y\n", "d\n", "e\n", "f\n"];
    assert_eq!(
        hunks(&a, &b),
        vec![Hunk { a_start: 1, a_end: 3, b_start: 1, b_end: 3 }, Hunk { a_start: 5, a_end: 5, b_start: 5, b_end: 6 }]
    );
}

#[test]
fn a_pure_insertion_has_an_empty_old_range() {
    let a = ["a\n", "c\n"];
    let b = ["a\n", "b\n", "c\n"];
    assert_eq!(hunks(&a, &b), vec![Hunk { a_start: 1, a_end: 1, b_start: 1, b_end: 2 }]);
}

#[test]
fn unified_diff_of_a_replaced_line() {
    let out = unified_diff("old", "a\nb\nc\n", "new", "a\nB\nc\n", 3);
    assert_eq!(out, "--- old\n+++ new\n@@ -1,3 +1,3 @@\n a\n-b\n+B\n c\n");
}

#[test]
fn unified_diff_of_equal_texts_is_empty() {
    assert_eq!(unified_diff("a", "x\n", "b", "x\n", 3), "");
}

#[test]
fn unified_diff_with_two_blocks() {
    let old: String = (1..=20).map(|i| format!("{i}\n")).collect();
    let mut lines: Vec<String> = (1..=20).map(|i| format!("{i}\n")).collect();
    lines[1] = "two\n".into();
    lines[17] = "eighteen\n".into();
    let new = lines.concat();
    let out = unified_diff("a", &old, "b", &new, 2);
    assert_eq!(out.matches("@@ -").count(), 2);
    assert!(out.contains("@@ -1,4 +1,4 @@"));
    assert!(out.contains("@@ -16,5 +16,5 @@"));
}

#[test]
fn a_missing_final_newline_is_marked() {
    let out = unified_diff("a", "x\ny", "b", "x\nz", 3);
    assert!(out.contains("-y\n\\ No newline at end of file\n+z\n\\ No newline at end of file\n"));
}

#[test]
fn the_command_line_reports_equal_and_different_files() {
    let a = tmp("a.txt", "one\ntwo\n");
    let b = tmp("b.txt", "one\nTWO\n");
    let same = Command::new(env!("CARGO_BIN_EXE_textdiff")).args(["diff", a.to_str().unwrap(), a.to_str().unwrap()]).output().unwrap();
    assert_eq!(same.status.code(), Some(0));
    assert!(same.stdout.is_empty());
    let differ = Command::new(env!("CARGO_BIN_EXE_textdiff")).args(["diff", a.to_str().unwrap(), b.to_str().unwrap()]).output().unwrap();
    assert_eq!(differ.status.code(), Some(1));
    assert!(String::from_utf8_lossy(&differ.stdout).contains("-two\n+TWO\n"));
}

#[test]
fn the_command_line_fails_with_status_2_on_a_missing_file() {
    let a = tmp("c.txt", "x\n");
    let out = Command::new(env!("CARGO_BIN_EXE_textdiff")).args(["diff", a.to_str().unwrap(), "/nonexistent/file"]).output().unwrap();
    assert_eq!(out.status.code(), Some(2));
    assert!(out.stdout.is_empty());
}

#[test]
fn an_unknown_command_fails_with_status_2() {
    let out = Command::new(env!("CARGO_BIN_EXE_textdiff")).arg("frobnicate").output().unwrap();
    assert_eq!(out.status.code(), Some(2));
}
