//! The `textdiff` command line.

use std::fs;
use std::process;

use textdiff::{merge3, unified_diff, ConflictStyle};

const USAGE: &str = "usage: textdiff diff <old> <new>\n       textdiff merge [--diff3] <base> <ours> <theirs>\n";

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    process::exit(run(&args));
}

fn run(args: &[String]) -> i32 {
    match args.first().map(String::as_str) {
        Some("diff") => diff_command(&args[1..]),
        Some("merge") => merge_command(&args[1..]),
        Some("--help") | Some("-h") => {
            print!("{USAGE}");
            0
        }
        _ => {
            eprint!("{USAGE}");
            2
        }
    }
}

fn read(path: &str) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| format!("textdiff: cannot read {path}: {e}"))
}

/// `textdiff diff <old> <new>`: prints a unified diff with 3 lines of context. Exit status 0 when the files are equal,
/// 1 when they differ, 2 on trouble (bad arguments, unreadable file).
fn diff_command(args: &[String]) -> i32 {
    if args.len() != 2 {
        eprint!("{USAGE}");
        return 2;
    }
    let (old, new) = match (read(&args[0]), read(&args[1])) {
        (Ok(old), Ok(new)) => (old, new),
        (Err(e), _) | (_, Err(e)) => {
            eprintln!("{e}");
            return 2;
        }
    };
    let out = unified_diff(&args[0], &old, &args[1], &new, 3);
    print!("{out}");
    if out.is_empty() {
        0
    } else {
        1
    }
}

/// `textdiff merge [--diff3] <base> <ours> <theirs>`: prints the merged text. Exit status: the number of conflicts, at
/// most 127 (0 is a clean merge); 255 on trouble (bad arguments, an unreadable file), with nothing on stdout.
fn merge_command(args: &[String]) -> i32 {
    let (style, paths) = match args.first().map(String::as_str) {
        Some("--diff3") => (ConflictStyle::Diff3, &args[1..]),
        _ => (ConflictStyle::Merge, args),
    };
    if paths.len() != 3 {
        eprint!("{USAGE}");
        return 255;
    }
    let mut texts = Vec::new();
    for path in paths {
        match read(path) {
            Ok(text) => texts.push(text),
            Err(e) => {
                eprintln!("{e}");
                return 255;
            }
        }
    }
    let merged = merge3(&texts[0], &texts[1], &texts[2], style);
    print!("{}", merged.text);
    merged.conflicts.min(127) as i32
}
