// Hidden check for hd-rust-merge3. Every assertion follows from the prompt's rules.
//   * hd_merge_* / hd_diff3_*: cases whose expected text was printed by `git merge-file -p` (see hidden/make-fixtures.py).
//   * hd_property_*: seeded random files built from segments, expected text constructed directly.
//   * hd_cli_*: the `textdiff merge` command.

use std::fs;
use std::path::PathBuf;
use std::process::Command;

use textdiff::{merge3, ConflictStyle};

macro_rules! merge_case {
    ($name:ident, $base:expr, $ours:expr, $theirs:expr, $want:expr, $conflicts:expr) => {
        #[test]
        fn $name() {
            let r = merge3($base, $ours, $theirs, ConflictStyle::Merge);
            assert_eq!(r.text, $want);
            assert_eq!(r.conflicts, $conflicts);
        }
    };
}

macro_rules! diff3_case {
    ($name:ident, $base:expr, $ours:expr, $theirs:expr, $want:expr, $conflicts:expr) => {
        #[test]
        fn $name() {
            let r = merge3($base, $ours, $theirs, ConflictStyle::Diff3);
            assert_eq!(r.text, $want);
            assert_eq!(r.conflicts, $conflicts);
        }
    };
}

include!("hd_merge3_data/cases.in");

// ---------------------------------------------------------------- hand-written examples of the rules

const BASE5: &str = "a1\na2\na3\na4\na5\n";

#[test]
fn hd_named_changes_far_apart_both_apply() {
    let r = merge3(BASE5, "a1\nX\na3\na4\na5\n", "a1\na2\na3\nY\na5\n", ConflictStyle::Merge);
    assert_eq!((r.text.as_str(), r.conflicts), ("a1\nX\na3\nY\na5\n", 0));
}

#[test]
fn hd_named_changes_on_neighbouring_lines_conflict() {
    let r = merge3(BASE5, "a1\nX\na3\na4\na5\n", "a1\na2\nY\na4\na5\n", ConflictStyle::Merge);
    assert_eq!(r.text, "a1\n<<<<<<< ours\nX\na3\n=======\na2\nY\n>>>>>>> theirs\na4\na5\n");
    assert_eq!(r.conflicts, 1);
}

#[test]
fn hd_named_diff3_shows_the_whole_region_of_the_base() {
    let r = merge3(BASE5, "a1\nX\na3\na4\na5\n", "a1\na2\nY\na4\na5\n", ConflictStyle::Diff3);
    assert_eq!(r.text, "a1\n<<<<<<< ours\nX\na3\n||||||| base\na2\na3\n=======\na2\nY\n>>>>>>> theirs\na4\na5\n");
}

#[test]
fn hd_named_identical_changes_are_taken_once() {
    let both = "a1\nX\na3\na4\na5\n";
    let r = merge3(BASE5, both, both, ConflictStyle::Merge);
    assert_eq!((r.text.as_str(), r.conflicts), (both, 0));
    let r = merge3("a1\na2\n", "a1\nN\na2\n", "a1\nN\na2\n", ConflictStyle::Diff3);
    assert_eq!((r.text.as_str(), r.conflicts), ("a1\nN\na2\n", 0));
}

#[test]
fn hd_named_inserts_at_the_same_place_conflict_with_an_empty_base_section() {
    let r = merge3("a1\na2\n", "a1\nN\na2\n", "a1\nM\na2\n", ConflictStyle::Diff3);
    assert_eq!(r.text, "a1\n<<<<<<< ours\nN\n||||||| base\n=======\nM\n>>>>>>> theirs\na2\n");
    assert_eq!(r.conflicts, 1);
}

#[test]
fn hd_named_a_chain_of_touching_changes_is_one_conflict() {
    // ours changes a2 and a4; theirs changes a3: a2-a3 touch, a3-a4 touch, so one region a2..a4.
    let r = merge3(BASE5, "a1\nX\na3\nZ\na5\n", "a1\na2\nY\na4\na5\n", ConflictStyle::Diff3);
    assert_eq!(r.text, "a1\n<<<<<<< ours\nX\na3\nZ\n||||||| base\na2\na3\na4\n=======\na2\nY\na4\n>>>>>>> theirs\na5\n");
    assert_eq!(r.conflicts, 1);
}

#[test]
fn hd_named_nearby_conflicts_stay_separate() {
    // Two conflicts with one unchanged line between them: two blocks, never joined.
    let base = "a1\na2\na3\na4\na5\n";
    let r = merge3(base, "a1\nO1\na3\nO2\na5\n", "a1\nT1\na3\nT2\na5\n", ConflictStyle::Diff3);
    assert_eq!(r.conflicts, 2);
    assert_eq!(
        r.text,
        "a1\n<<<<<<< ours\nO1\n||||||| base\na2\n=======\nT1\n>>>>>>> theirs\na3\n<<<<<<< ours\nO2\n||||||| base\na4\n=======\nT2\n>>>>>>> theirs\na5\n"
    );
}

#[test]
fn hd_named_one_side_unchanged_gives_the_other_side() {
    for style in [ConflictStyle::Merge, ConflictStyle::Diff3] {
        let theirs = "a1\nX\nY\na4\n";
        let r = merge3("a1\na2\na3\na4\n", "a1\na2\na3\na4\n", theirs, style);
        assert_eq!((r.text.as_str(), r.conflicts), (theirs, 0));
        let r = merge3("a1\na2\na3\na4\n", theirs, "a1\na2\na3\na4\n", style);
        assert_eq!((r.text.as_str(), r.conflicts), (theirs, 0));
    }
}

#[test]
fn hd_named_empty_texts() {
    let r = merge3("", "", "", ConflictStyle::Merge);
    assert_eq!((r.text.as_str(), r.conflicts), ("", 0));
    let r = merge3("", "x\n", "x\n", ConflictStyle::Merge);
    assert_eq!((r.text.as_str(), r.conflicts), ("x\n", 0));
    let r = merge3("", "x\n", "y\n", ConflictStyle::Merge);
    assert_eq!((r.text.as_str(), r.conflicts), ("<<<<<<< ours\nx\n=======\ny\n>>>>>>> theirs\n", 1));
}

// ---------------------------------------------------------------- seeded random files built from segments

struct Rng(u64);

impl Rng {
    fn new(seed: u64) -> Rng {
        Rng(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) ^ 0xA076_1D64_78BD_642F)
    }

    fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }

    fn range(&mut self, lo: usize, hi: usize) -> usize {
        lo + (self.next() % ((hi - lo + 1) as u64)) as usize
    }
}

#[derive(Clone, Copy, Debug)]
enum Action {
    Keep,
    Ours,
    Theirs,
    Both,
    Conflict,
}

/// Segments of base lines separated by one unchanged separator line, so edits in different segments never touch.
/// Returns (base, ours, theirs, expected merge text, expected diff3 text, conflicts).
fn build(rng: &mut Rng) -> (String, String, String, String, String, usize) {
    let mut counter = 0;
    let mut fresh = |tag: &str, k: usize| -> Vec<String> {
        (0..k)
            .map(|_| {
                counter += 1;
                format!("{tag} {counter:04}\n")
            })
            .collect()
    };
    let segments = rng.range(1, 9);
    let (mut base, mut ours, mut theirs, mut merged, mut merged3) = (String::new(), String::new(), String::new(), String::new(), String::new());
    let mut conflicts = 0;
    let sep = |text: &mut String, s: &str| text.push_str(s);
    for i in 0..=segments {
        if i > 0 {
            let line = format!("sep {i:02}\n");
            for t in [&mut base, &mut ours, &mut theirs, &mut merged, &mut merged3] {
                sep(t, &line);
            }
        }
        if i == segments && rng.range(0, 1) == 0 {
            continue; // sometimes no segment after the last separator
        }
        let base_lines = fresh("base", rng.range(0, 3));
        let action = [Action::Keep, Action::Ours, Action::Theirs, Action::Both, Action::Conflict, Action::Conflict][rng.range(0, 5)];
        let new_len = |rng: &mut Rng| rng.range(0, 3);
        // An edit must change something: an empty segment can only be edited by inserting.
        let non_empty = |n: usize| if base_lines.is_empty() { n.max(1) } else { n };
        let b = base_lines.concat();
        base.push_str(&b);
        match action {
            Action::Keep => {
                for t in [&mut ours, &mut theirs, &mut merged, &mut merged3] {
                    t.push_str(&b);
                }
            }
            Action::Ours => {
                let n = fresh("ours", non_empty(new_len(rng))).concat();
                ours.push_str(&n);
                theirs.push_str(&b);
                merged.push_str(&n);
                merged3.push_str(&n);
            }
            Action::Theirs => {
                let n = fresh("theirs", non_empty(new_len(rng))).concat();
                ours.push_str(&b);
                theirs.push_str(&n);
                merged.push_str(&n);
                merged3.push_str(&n);
            }
            Action::Both => {
                let n = fresh("same", non_empty(new_len(rng))).concat();
                ours.push_str(&n);
                theirs.push_str(&n);
                merged.push_str(&n);
                merged3.push_str(&n);
            }
            Action::Conflict => {
                // Two different versions: at most one of them may be empty (two deletions would be the same change).
                let (on, tn) = (non_empty(new_len(rng)), non_empty(new_len(rng)));
                let on = if on == 0 && tn == 0 { 1 } else { on };
                let o = fresh("ours", on).concat();
                let t = fresh("theirs", tn).concat();
                ours.push_str(&o);
                theirs.push_str(&t);
                conflicts += 1;
                merged.push_str(&format!("<<<<<<< ours\n{o}=======\n{t}>>>>>>> theirs\n"));
                merged3.push_str(&format!("<<<<<<< ours\n{o}||||||| base\n{b}=======\n{t}>>>>>>> theirs\n"));
            }
        }
    }
    (base, ours, theirs, merged, merged3, conflicts)
}

#[test]
fn hd_property_segments_equal_the_constructed_merge() {
    for case in 0..300u64 {
        let mut rng = Rng::new(7000 + case);
        let (base, ours, theirs, want, want3, conflicts) = build(&mut rng);
        let m = merge3(&base, &ours, &theirs, ConflictStyle::Merge);
        assert_eq!((m.text.as_str(), m.conflicts), (want.as_str(), conflicts), "merge case {case}\nbase:\n{base}ours:\n{ours}theirs:\n{theirs}");
        let d = merge3(&base, &ours, &theirs, ConflictStyle::Diff3);
        assert_eq!((d.text.as_str(), d.conflicts), (want3.as_str(), conflicts), "diff3 case {case}\nbase:\n{base}ours:\n{ours}theirs:\n{theirs}");
    }
}

#[test]
fn hd_property_trivial_merges_and_symmetry() {
    for case in 0..200u64 {
        let mut rng = Rng::new(9000 + case);
        let (base, ours, theirs, _, _, _) = build(&mut rng);
        for style in [ConflictStyle::Merge, ConflictStyle::Diff3] {
            let same = merge3(&base, &ours, &ours, style);
            assert_eq!((same.text.as_str(), same.conflicts), (ours.as_str(), 0), "ours == theirs, case {case}");
            let take_theirs = merge3(&base, &base, &theirs, style);
            assert_eq!((take_theirs.text.as_str(), take_theirs.conflicts), (theirs.as_str(), 0), "ours unchanged, case {case}");
            let take_ours = merge3(&base, &ours, &base, style);
            assert_eq!((take_ours.text.as_str(), take_ours.conflicts), (ours.as_str(), 0), "theirs unchanged, case {case}");
            let all = merge3(&base, &base, &base, style);
            assert_eq!((all.text.as_str(), all.conflicts), (base.as_str(), 0));
            let a = merge3(&base, &ours, &theirs, style);
            let b = merge3(&base, &theirs, &ours, style);
            assert_eq!(a.conflicts, b.conflicts, "swapping the sides keeps the conflicts, case {case}");
            if a.conflicts == 0 {
                assert_eq!(a.text, b.text, "a clean merge does not depend on the side order, case {case}");
            }
        }
    }
}

// ---------------------------------------------------------------- the command

fn work_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("textdiff-hd-merge3-{}-{}", std::process::id(), name));
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn run_merge(name: &str, args: &[&str], base: &str, ours: &str, theirs: &str) -> (Option<i32>, String, String) {
    let dir = work_dir(name);
    let paths: Vec<String> = [("base", base), ("ours", ours), ("theirs", theirs)]
        .iter()
        .map(|(n, c)| {
            let p = dir.join(n);
            fs::write(&p, c).unwrap();
            p.to_str().unwrap().to_string()
        })
        .collect();
    let out = Command::new(env!("CARGO_BIN_EXE_textdiff")).arg("merge").args(args).args(&paths).output().unwrap();
    (out.status.code(), String::from_utf8_lossy(&out.stdout).into_owned(), String::from_utf8_lossy(&out.stderr).into_owned())
}

#[test]
fn hd_cli_clean_merge_exits_zero() {
    let (code, out, _) = run_merge("clean", &[], BASE5, "a1\nX\na3\na4\na5\n", "a1\na2\na3\nY\na5\n");
    assert_eq!(code, Some(0));
    assert_eq!(out, "a1\nX\na3\nY\na5\n");
}

#[test]
fn hd_cli_exit_status_is_the_number_of_conflicts() {
    let base = "a1\na2\na3\na4\na5\n";
    let (code, out, _) = run_merge("two", &[], base, "a1\nO1\na3\nO2\na5\n", "a1\nT1\na3\nT2\na5\n");
    assert_eq!(code, Some(2));
    assert_eq!(out.matches("<<<<<<< ours\n").count(), 2);
    let (code, out, _) = run_merge("one", &[], base, "a1\nO1\na3\na4\na5\n", "a1\nT1\na3\na4\na5\n");
    assert_eq!(code, Some(1));
    assert_eq!(out, "a1\n<<<<<<< ours\nO1\n=======\nT1\n>>>>>>> theirs\na3\na4\na5\n");
}

#[test]
fn hd_cli_diff3_flag_adds_the_base_section() {
    let (code, out, _) = run_merge("diff3", &["--diff3"], "a1\na2\na3\n", "a1\nO\na3\n", "a1\nT\na3\n");
    assert_eq!(code, Some(1));
    assert_eq!(out, "a1\n<<<<<<< ours\nO\n||||||| base\na2\n=======\nT\n>>>>>>> theirs\na3\n");
}

fn many_conflicts(n: usize) -> (String, String, String) {
    let (mut base, mut ours, mut theirs) = (String::new(), String::new(), String::new());
    for i in 0..n {
        base.push_str(&format!("keep {i}\nchange {i}\n"));
        ours.push_str(&format!("keep {i}\nours {i}\n"));
        theirs.push_str(&format!("keep {i}\ntheirs {i}\n"));
    }
    (base, ours, theirs)
}

#[test]
fn hd_cli_exit_status_stops_at_127() {
    for (n, want) in [(126, 126), (127, 127), (128, 127), (300, 127)] {
        let (b, o, t) = many_conflicts(n);
        let r = merge3(&b, &o, &t, ConflictStyle::Merge);
        assert_eq!(r.conflicts, n);
        let (code, out, _) = run_merge(&format!("many{n}"), &[], &b, &o, &t);
        assert_eq!(code, Some(want), "{n} conflicts");
        assert_eq!(out, r.text);
    }
}

#[test]
fn hd_cli_trouble_exits_255_with_nothing_on_stdout() {
    let dir = work_dir("trouble");
    let base = dir.join("base");
    fs::write(&base, "x\n").unwrap();
    let out = Command::new(env!("CARGO_BIN_EXE_textdiff"))
        .args(["merge", base.to_str().unwrap(), base.to_str().unwrap(), "/nonexistent/theirs"])
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(255));
    assert!(out.stdout.is_empty());
    assert!(!out.stderr.is_empty());
    let out = Command::new(env!("CARGO_BIN_EXE_textdiff")).args(["merge", base.to_str().unwrap()]).output().unwrap();
    assert_eq!(out.status.code(), Some(255));
    assert!(out.stdout.is_empty());
}
