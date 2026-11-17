// Hidden check for hd-rust-regex-linear. Every assertion follows from README.md of the seed.
//   * hd_re_c*: cases whose expected results come from Python's `re` (hidden/make-fixtures.py).
//   * hd_err_*: error positions from the README table.
//   * hd_slow_*: patterns that make a backtracking matcher blow up, on long texts, with a time limit.

use std::time::{Duration, Instant};

use linre::{Match, Regex};

fn span(m: Match) -> (usize, usize) {
    (m.start, m.end)
}

fn check(pattern: &str, text: &str, find: Option<(usize, usize)>, caps: Option<&[Option<(usize, usize)>]>, iter: &[(usize, usize)]) {
    let re = match Regex::new(pattern) {
        Ok(re) => re,
        Err(e) => panic!("{pattern:?} should compile, got: {e}"),
    };
    assert_eq!(re.is_match(text), find.is_some(), "is_match of {pattern:?} on {text:?}");
    assert_eq!(re.find(text).map(span), find, "find of {pattern:?} on {text:?}");
    match (re.captures(text), find) {
        (None, None) => {}
        (Some(c), Some(f)) => {
            assert_eq!(c.get(0).map(span), Some(f), "group 0 of {pattern:?} on {text:?}");
            if let Some(expected) = caps {
                assert_eq!(c.len(), expected.len(), "number of groups of {pattern:?}");
                for (i, want) in expected.iter().enumerate() {
                    assert_eq!(c.get(i).map(span), *want, "group {i} of {pattern:?} on {text:?}");
                }
            }
        }
        (got, want) => panic!("captures of {pattern:?} on {text:?}: got {got:?}, find says {want:?}"),
    }
    // take(): an iterator that never advances must fail this test, not hang the run.
    let got: Vec<(usize, usize)> = re.find_iter(text).map(span).take(iter.len() + 1).collect();
    assert_eq!(got, iter, "find_iter of {pattern:?} on {text:?}");
}

macro_rules! re_case {
    ($name:ident, $pattern:expr, $text:expr, $find:expr, $caps:expr, $iter:expr) => {
        #[test]
        fn $name() {
            check($pattern, $text, $find, $caps, $iter);
        }
    };
}

include!("hd_regex_data/cases.in");

// ---------------------------------------------------------------- errors

fn error_position(pattern: &str) -> usize {
    match Regex::new(pattern) {
        Ok(_) => panic!("{pattern:?} should not compile"),
        Err(e) => {
            assert!(!e.message.is_empty(), "the message of {pattern:?} is empty");
            e.position
        }
    }
}

macro_rules! err_case {
    ($name:ident, $pattern:expr, $position:expr) => {
        #[test]
        fn $name() {
            assert_eq!(error_position($pattern), $position, "pattern {:?}", $pattern);
        }
    };
}

err_case!(hd_err_unclosed_group_1, "(", 0);
err_case!(hd_err_unclosed_group_2, "ab(c", 2);
err_case!(hd_err_unclosed_group_last, "(a(b", 2);
err_case!(hd_err_unclosed_group_outer, "((a)", 0);
err_case!(hd_err_unclosed_group_after_closed, "(()", 0);
err_case!(hd_err_unclosed_noncapturing, "x(?:ab", 1);
err_case!(hd_err_unmatched_paren_only, ")", 0);
err_case!(hd_err_unmatched_paren_after_text, "a)", 1);
err_case!(hd_err_unmatched_second_paren, "(a))", 3);
err_case!(hd_err_group_syntax_lookahead, "(?=a)", 0);
err_case!(hd_err_group_syntax_flags, "x(?i)", 1);
err_case!(hd_err_group_syntax_named, "(?P<n>a)", 0);
err_case!(hd_err_group_syntax_truncated, "(?", 0);
err_case!(hd_err_nothing_to_repeat_star, "*a", 0);
err_case!(hd_err_nothing_to_repeat_after_bar, "a|*", 2);
err_case!(hd_err_nothing_to_repeat_in_group, "(+)", 1);
err_case!(hd_err_nothing_to_repeat_counted, "{2}", 0);
err_case!(hd_err_nothing_to_repeat_in_noncapturing, "x(?:*)", 4);
err_case!(hd_err_nothing_to_repeat_question_after_bar, "a|?b", 2);
err_case!(hd_err_quantifier_after_caret, "^*", 1);
err_case!(hd_err_quantifier_after_dollar, "a$+", 2);
err_case!(hd_err_repeated_star, "a**", 2);
err_case!(hd_err_repeated_after_lazy, "a+?*", 3);
err_case!(hd_err_repeated_counted, "a{2}{3}", 4);
err_case!(hd_err_repeated_lazy_twice, "a*??", 3);
err_case!(hd_err_repeated_question_plus, "a?+", 2);
err_case!(hd_err_counted_unfinished, "a{", 1);
err_case!(hd_err_counted_not_a_number, "a{x}", 1);
err_case!(hd_err_counted_no_minimum, "a{,2}", 1);
err_case!(hd_err_counted_min_above_max, "a{2,1}", 1);
err_case!(hd_err_counted_too_large, "a{1001}", 1);
err_case!(hd_err_counted_max_too_large, "a{1,1001}", 1);
err_case!(hd_err_counted_unclosed_after_text, "ab{2", 2);
err_case!(hd_err_counted_bad_maximum, "a{2,x}", 1);
err_case!(hd_err_counted_space, "a{ 2}", 1);
err_case!(hd_err_unclosed_class_only, "[", 0);
err_case!(hd_err_unclosed_class, "[a", 0);
err_case!(hd_err_unclosed_class_after_dash, "x[a-", 1);
err_case!(hd_err_unclosed_class_range, "[a-z", 0);
err_case!(hd_err_empty_class, "[]", 0);
err_case!(hd_err_empty_negated_class, "[^]", 0);
err_case!(hd_err_empty_class_in_middle, "a[]b", 1);
err_case!(hd_err_reversed_range, "[z-a]", 1);
err_case!(hd_err_reversed_range_digits, "x[9-0]", 2);
err_case!(hd_err_reversed_range_after_item, "[ab-a]", 2);
err_case!(hd_err_unknown_escape_letter, "\\q", 0);
err_case!(hd_err_unknown_escape_word_boundary, "a\\b", 1);
err_case!(hd_err_unknown_escape_backreference, "\\1", 0);
err_case!(hd_err_trailing_backslash, "ab\\", 2);
err_case!(hd_err_lone_backslash, "\\", 0);
err_case!(hd_err_unknown_escape_in_class, "[\\q]", 1);

#[test]
fn hd_valid_patterns_that_look_odd() {
    for pattern in ["]", "}", "a}", "a]b", "[a-]", "[-a]", "[a\\-z]", "[\\]]", "\\-", "(?:)", "()", "a||b", "[.]", "a{1000}", "a{0}", "a{2,}", "a{0,0}", "\\.", "[\\d\\w]", "[+--]", "x{1,1000}?"] {
        assert!(Regex::new(pattern).is_ok(), "{pattern:?} should compile");
    }
}

#[test]
fn hd_api_shapes() {
    let re = Regex::new("(a)(b)?").unwrap();
    let caps = re.captures("xa").unwrap();
    assert_eq!(caps.len(), 3);
    assert_eq!(caps.get(0).map(span), Some((1, 2)));
    assert_eq!(caps.get(1).map(span), Some((1, 2)));
    assert_eq!(caps.get(2), None);
    assert_eq!(caps.get(7), None);
    assert!(re.captures("zzz").is_none());
    let m = re.find("xab").unwrap();
    assert_eq!((m.len(), m.is_empty()), (2, false));
}

// ---------------------------------------------------------------- time

/// Runs `f` and fails if it takes longer than `limit_ms` (about ten times what the reference needs, never below the floor).
fn within<T>(limit_ms: u64, f: impl FnOnce() -> T) -> T {
    let start = Instant::now();
    let out = f();
    let took = start.elapsed();
    assert!(took <= Duration::from_millis(limit_ms), "took {took:?}, the limit is {limit_ms} ms");
    out
}

fn rep(s: &str, n: usize) -> String {
    s.repeat(n)
}

#[test]
fn hd_slow_nested_star_then_b() {
    within(LIMIT_NESTED_STAR, || {
        let re = Regex::new("(a*)*b").unwrap();
        let a = rep("a", 30_000);
        assert!(!re.is_match(&a));
        assert_eq!(re.find(&a), None);
        let with_b = format!("{a}b");
        assert_eq!(re.find(&with_b).map(span), Some((0, 30_001)));
        let caps = re.captures(&with_b).unwrap();
        assert_eq!(caps.get(0).map(span), Some((0, 30_001)));
    });
}

#[test]
fn hd_slow_a_or_aa_then_c() {
    within(LIMIT_A_OR_AA, || {
        let re = Regex::new("(a|aa)*c").unwrap();
        let a = rep("a", 30_000);
        assert_eq!(re.find(&a), None);
        assert_eq!(re.find(&format!("{a}c")).map(span), Some((0, 30_001)));
        assert_eq!(re.find(&format!("xx{a}c")).map(span), Some((2, 30_003)));
    });
}

#[test]
fn hd_slow_plus_plus_then_y() {
    within(LIMIT_PLUS_PLUS, || {
        let re = Regex::new("(x+x+)+y").unwrap();
        let x = rep("x", 30_000);
        assert_eq!(re.find(&x), None);
        assert_eq!(re.find(&format!("{x}y")).map(span), Some((0, 30_001)));
    });
}

#[test]
fn hd_slow_anchored_nested_plus() {
    within(LIMIT_ANCHORED, || {
        let re = Regex::new("^(a+)+$").unwrap();
        let a = rep("a", 30_000);
        assert_eq!(re.find(&format!("{a}!")), None);
        assert_eq!(re.find(&a).map(span), Some((0, 30_000)));
        assert_eq!(re.captures(&a).unwrap().get(1).map(span), Some((0, 30_000)));
    });
}

#[test]
fn hd_slow_optional_then_required_counted() {
    within(LIMIT_COUNTED, || {
        let re = Regex::new("(a?){30}a{30}").unwrap();
        assert_eq!(re.find(&rep("a", 30)).map(span), Some((0, 30)));
        assert_eq!(re.find(&rep("a", 29)), None);
        assert_eq!(re.find(&rep("a", 60)).map(span), Some((0, 60)));
    });
}

#[test]
fn hd_slow_many_dot_stars() {
    within(LIMIT_DOT_STARS, || {
        let re = Regex::new("(.*)(.*)(.*)(.*)(.*)(.*)x").unwrap();
        assert_eq!(re.find(&rep("a", 30_000)), None);
        let caps = re.captures(&format!("{}x", rep("a", 20_000))).unwrap();
        assert_eq!(caps.get(0).map(span), Some((0, 20_001)));
        assert_eq!(caps.len(), 7);
        // Greedy groups: the first takes everything it can, the rest are empty.
        assert_eq!(caps.get(1).map(span), Some((0, 20_000)));
        assert_eq!(caps.get(6).map(span), Some((20_000, 20_000)));
    });
}

#[test]
fn hd_slow_nested_stars_three_deep() {
    within(LIMIT_THREE_DEEP, || {
        let re = Regex::new("((a*)*)*b").unwrap();
        let a = rep("a", 30_000);
        assert_eq!(re.find(&a), None);
        assert_eq!(re.find(&format!("{a}b")).map(span), Some((0, 30_001)));
    });
}

#[test]
fn hd_slow_two_stars_in_a_row() {
    within(LIMIT_TWO_STARS, || {
        let re = Regex::new("(a*)*(b*)*c").unwrap();
        let text = format!("{}{}", rep("a", 15_000), rep("b", 15_000));
        assert_eq!(re.find(&text), None);
        assert_eq!(re.find(&format!("{text}c")).map(span), Some((0, 30_001)));
    });
}

#[test]
fn hd_slow_captures_over_a_long_text() {
    within(LIMIT_CAPTURES, || {
        let re = Regex::new("(a+)(b+)").unwrap();
        let text = format!("{}{}", rep("a", 20_000), rep("b", 20_000));
        let caps = re.captures(&text).unwrap();
        assert_eq!(caps.get(1).map(span), Some((0, 20_000)));
        assert_eq!(caps.get(2).map(span), Some((20_000, 40_000)));
    });
}

#[test]
fn hd_slow_no_match_over_a_million_characters() {
    // Trying every start position separately is quadratic here.
    within(LIMIT_MILLION, || {
        let re = Regex::new("a*b").unwrap();
        let text = rep("a", 1_000_000);
        assert_eq!(re.find(&text), None);
        assert_eq!(re.find(&format!("{text}b")).map(span), Some((0, 1_000_001)));
    });
}

#[test]
fn hd_slow_find_iter_many_matches() {
    within(LIMIT_ITER, || {
        let re = Regex::new("a").unwrap();
        let n = re.find_iter(&rep("a", 50_000)).take(100_000).count();
        assert_eq!(n, 50_000);
        let re = Regex::new("a*").unwrap();
        let text = rep("ba", 15_000);
        let all: Vec<(usize, usize)> = re.find_iter(&text).map(span).take(100_000).collect();
        assert_eq!(all.len(), 1 + 2 * 15_000);
        assert_eq!(all[0], (0, 0));
        assert_eq!(all[1], (1, 2));
        assert_eq!(all[2], (2, 2));
        assert_eq!(*all.last().unwrap(), (30_000, 30_000));
        let words = Regex::new(r"\w+").unwrap();
        let text: String = (0..5_000).map(|i| format!("word{i} ")).collect();
        assert_eq!(words.find_iter(&text).take(100_000).count(), 5_000);
    });
}

#[test]
fn hd_slow_find_iter_without_a_match_is_not_quadratic() {
    within(LIMIT_ITER_FAIL, || {
        let re = Regex::new("a*b|c").unwrap();
        let text = rep("a", 200_000);
        assert_eq!(re.find_iter(&text).take(100_000).count(), 0);
        let text = format!("{}c", rep("a", 200_000));
        assert_eq!(re.find_iter(&text).map(span).take(100_000).collect::<Vec<_>>(), vec![(200_000, 200_001)]);
    });
}

#[test]
fn hd_slow_a_pattern_with_many_alternatives() {
    within(LIMIT_ALTERNATIVES, || {
        let pattern = format!("(?:{})", (0..300).map(|i| format!("w{i:04}")).collect::<Vec<_>>().join("|"));
        let re = Regex::new(&pattern).unwrap();
        let text = format!("{}w0299{}", rep("w9999 ", 3_000), rep(" w0000", 100));
        assert_eq!(re.find(&text).map(span), Some((18_000, 18_005)));
        assert_eq!(re.find_iter(&text).take(100_000).count(), 101);
    });
}

#[test]
fn hd_slow_deeply_nested_groups_and_long_chains() {
    within(LIMIT_DEEP, || {
        let depth = 300;
        let pattern = format!("{}a{}b", "(".repeat(depth), ")".repeat(depth));
        let re = Regex::new(&pattern).unwrap();
        let caps = re.captures("xxab").unwrap();
        assert_eq!(caps.len(), depth + 1);
        assert_eq!(caps.get(depth).map(span), Some((2, 3)));
        let chain = Regex::new("(?:a?){1000}b").unwrap();
        assert_eq!(chain.find(&format!("{}b", rep("a", 500))).map(span), Some((0, 501)));
        let long = "ab".repeat(2_000);
        let re = Regex::new(&long).unwrap();
        assert_eq!(re.find(&format!("zz{long}zz")).map(span), Some((2, 4_002)));
    });
}

// Time limits in milliseconds: ten times the slowest of six runs of the reference solution on the builder's Mac (all
// tests running at once, optimised build), never below 400 ms so that a busy machine does not fail a correct
// linear-time engine. See NOTES.md.
const LIMIT_NESTED_STAR: u64 = 700;
const LIMIT_A_OR_AA: u64 = 700;
const LIMIT_PLUS_PLUS: u64 = 720;
const LIMIT_ANCHORED: u64 = 650;
const LIMIT_COUNTED: u64 = 400;
const LIMIT_DOT_STARS: u64 = 600;
const LIMIT_THREE_DEEP: u64 = 450;
const LIMIT_TWO_STARS: u64 = 400;
const LIMIT_CAPTURES: u64 = 400;
const LIMIT_MILLION: u64 = 4100;
const LIMIT_ITER: u64 = 2200;
const LIMIT_ITER_FAIL: u64 = 1400;
const LIMIT_ALTERNATIVES: u64 = 6000;
const LIMIT_DEEP: u64 = 5000;
