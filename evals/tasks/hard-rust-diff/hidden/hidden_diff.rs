use linediff::unified_diff;
use std::time::Instant;

struct Hunk { os: usize, ol: usize, ns: usize, nl: usize, lines: Vec<(char, String)> }

fn parse(diff: &str) -> Vec<Hunk> {
    let mut hunks: Vec<Hunk> = Vec::new();
    assert!(diff.is_empty() || diff.ends_with('\n'), "output must end with a newline");
    for line in diff.lines() {
        if let Some(rest) = line.strip_prefix("@@ -") {
            let rest = rest.strip_suffix(" @@").unwrap_or_else(|| panic!("bad header {line:?}"));
            let (o, n) = rest.split_once(" +").unwrap_or_else(|| panic!("bad header {line:?}"));
            let pair = |s: &str| { let (a, b) = s.split_once(',').unwrap_or_else(|| panic!("header needs start,len: {line:?}")); (a.parse::<usize>().unwrap(), b.parse::<usize>().unwrap()) };
            let (os, ol) = pair(o);
            let (ns, nl) = pair(n);
            hunks.push(Hunk { os, ol, ns, nl, lines: Vec::new() });
        } else {
            let h = hunks.last_mut().unwrap_or_else(|| panic!("line before any header: {line:?}"));
            let mut chars = line.chars();
            let tag = chars.next().unwrap_or_else(|| panic!("empty diff line"));
            assert!(" -+".contains(tag), "bad line {line:?}");
            h.lines.push((tag, chars.as_str().to_string()));
        }
    }
    hunks
}

fn lcs(a: &[&str], b: &[&str]) -> usize {
    let mut row = vec![0usize; b.len() + 1];
    for x in a {
        let mut prev = 0;
        for (j, y) in b.iter().enumerate() {
            let tmp = row[j + 1];
            row[j + 1] = if x == y { prev + 1 } else { row[j + 1].max(row[j]) };
            prev = tmp;
        }
    }
    row[b.len()]
}

/// Check everything the task asks for; `minimal` is skipped for very large inputs.
fn verify(old: &str, new: &str, context: usize, minimal: bool) {
    let diff = unified_diff(old, new, context);
    let a: Vec<&str> = old.lines().collect();
    let b: Vec<&str> = new.lines().collect();
    if a == b { assert_eq!(diff, "", "identical texts"); return; }
    let hunks = parse(&diff);
    assert!(!hunks.is_empty());
    let mut out: Vec<String> = Vec::new();
    let mut next_old = 0usize; // lines of `a` consumed
    let mut changes = 0usize;
    let mut prev_end: Option<usize> = None;
    for h in &hunks {
        let ol = h.lines.iter().filter(|l| l.0 != '+').count();
        let nl = h.lines.iter().filter(|l| l.0 != '-').count();
        assert_eq!((h.ol, h.nl), (ol, nl), "header lengths match the hunk");
        let first_old = if h.ol == 0 { h.os } else { h.os - 1 };
        let first_new = if h.nl == 0 { h.ns } else { h.ns - 1 };
        assert!(first_old >= next_old, "hunks in order and not overlapping");
        for line in &a[next_old..first_old] { out.push(line.to_string()); }
        assert_eq!(first_new, out.len(), "new start matches position");
        let mut i = first_old;
        for (tag, text) in &h.lines {
            match tag {
                ' ' => { assert_eq!(a[i], text, "context line matches old"); out.push(text.clone()); i += 1; }
                '-' => { assert_eq!(a[i], text, "removed line matches old"); i += 1; changes += 1; }
                _ => { out.push(text.clone()); changes += 1; }
            }
        }
        next_old = i;
        // Context rules.
        let lead = h.lines.iter().take_while(|l| l.0 == ' ').count();
        let trail = h.lines.iter().rev().take_while(|l| l.0 == ' ').count();
        assert!(lead < h.lines.len(), "a hunk has changes");
        // Full context, unless the hunk reaches the start or end of the file (or the previous hunk).
        assert!(lead <= context && (lead == context || first_old == prev_end.unwrap_or(0)), "leading context");
        let after = a.len() - next_old;
        assert!(trail <= context && (trail == context || after == 0), "trailing context");
        // Inside a hunk, runs of unchanged lines between changes are at most 2 * context.
        let body = &h.lines[lead..h.lines.len() - trail];
        let mut run = 0;
        for l in body { if l.0 == ' ' { run += 1; assert!(run <= 2 * context, "hunk should have been split"); } else { run = 0; } }
        // '-' before '+' within each change run.
        let mut seen_plus = false;
        for l in body { match l.0 { '+' => seen_plus = true, '-' => assert!(!seen_plus, "'-' lines come first in a run"), _ => seen_plus = false } }
        prev_end = Some(next_old - trail);
    }
    for line in &a[next_old..] { out.push(line.to_string()); }
    assert_eq!(out, b, "applying the diff to old gives new");
    // Hunks are split only when changes are more than 2 * context apart.
    for w in hunks.windows(2) {
        let start0 = if w[0].ol == 0 { w[0].os } else { w[0].os - 1 };
        let end_of_changes = start0 + w[0].ol - w[0].lines.iter().rev().take_while(|l| l.0 == ' ').count();
        let start_next = (if w[1].ol == 0 { w[1].os } else { w[1].os - 1 }) + w[1].lines.iter().take_while(|l| l.0 == ' ').count();
        assert!(start_next - end_of_changes > 2 * context, "hunks closer than 2 * context should be merged");
    }
    if minimal {
        assert_eq!(changes, a.len() + b.len() - 2 * lcs(&a, &b), "diff is not minimal");
    }
}

#[test]
fn exact_small_case() {
    let old = "a\nb\nc\nd\ne\nf\ng\nh\ni\nj\n";
    let new = "a\nb\nc\nd\nE\nf\ng\nh\ni\nj\n";
    assert_eq!(unified_diff(old, new, 2), "@@ -3,5 +3,5 @@\n c\n d\n-e\n+E\n f\n g\n");
    assert_eq!(unified_diff("", "x\ny\n", 3), "@@ -0,0 +1,2 @@\n+x\n+y\n");
    assert_eq!(unified_diff("x\ny\n", "", 3), "@@ -1,2 +0,0 @@\n-x\n-y\n");
    assert_eq!(unified_diff("a\nb\n", "a\nb\n", 3), "");
}

#[test]
fn edge_cases() {
    for (old, new) in [("", ""), ("a\n", "b\n"), ("a\nb\nc\n", "c\nb\na\n"), ("a\na\na\n", "a\na\n"), ("x\n", "x\ny\nz\n"), ("a\nb\nc\nd\n", "b\nd\n"), ("same\n", "same")] {
        for ctx in [0, 1, 3] { verify(old, new, ctx, true); }
    }
}

fn rng(seed: &mut u64) -> u64 { *seed ^= *seed << 13; *seed ^= *seed >> 7; *seed ^= *seed << 17; *seed }

#[test]
fn random_texts() {
    let mut seed = 0x9E37_79B9_7F4A_7C15u64;
    for _ in 0..300 {
        let len = (rng(&mut seed) % 40) as usize;
        let words = ["alpha", "beta", "gamma", "delta", "", "}", "x = 1;"];
        let old: Vec<String> = (0..len).map(|_| words[(rng(&mut seed) % words.len() as u64) as usize].to_string()).collect();
        let mut new = old.clone();
        for _ in 0..(rng(&mut seed) % 6) {
            let op = rng(&mut seed) % 3;
            let at = if new.is_empty() { 0 } else { (rng(&mut seed) % new.len() as u64) as usize };
            match op {
                0 if !new.is_empty() => { new.remove(at); }
                1 => new.insert(at, words[(rng(&mut seed) % words.len() as u64) as usize].to_string()),
                _ if !new.is_empty() => new[at] = format!("changed {}", rng(&mut seed) % 5),
                _ => {}
            }
        }
        let ctx = (rng(&mut seed) % 4) as usize;
        let join = |v: &Vec<String>| v.iter().map(|l| format!("{l}\n")).collect::<String>();
        verify(&join(&old), &join(&new), ctx, true);
    }
}

#[test]
fn large_texts_are_fast() {
    let old: String = (0..2000).map(|i| format!("line {i} of a long file\n")).collect();
    let mut lines: Vec<String> = old.lines().map(String::from).collect();
    lines[100] = "edited near the top".into();
    lines.insert(1000, "inserted in the middle".into());
    lines.remove(1900);
    let new: String = lines.iter().map(|l| format!("{l}\n")).collect();
    let started = Instant::now();
    verify(&old, &new, 3, false);
    assert!(started.elapsed().as_millis() < 1000, "too slow: {:?}", started.elapsed());
}
