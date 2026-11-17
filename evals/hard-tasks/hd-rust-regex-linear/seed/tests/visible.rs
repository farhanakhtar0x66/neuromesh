use linre::{Match, Regex};

fn m(start: usize, end: usize) -> Match {
    Match { start, end }
}

#[test]
fn a_literal_is_found() {
    let re = Regex::new("needle").unwrap();
    assert_eq!(re.find("hay needle hay"), Some(m(4, 10)));
    assert!(re.is_match("needle"));
    assert!(!re.is_match("needl e"));
}

#[test]
fn captures_of_a_literal_has_only_group_zero() {
    let caps = Regex::new("cat").unwrap().captures("a cat sat").unwrap();
    assert_eq!(caps.len(), 1);
    assert_eq!(caps.get(0), Some(m(2, 5)));
    assert_eq!(caps.get(1), None);
}

#[test]
fn find_iter_of_a_literal_does_not_overlap() {
    let found: Vec<Match> = Regex::new("aa").unwrap().find_iter("aaaaa").collect();
    assert_eq!(found, vec![m(0, 2), m(2, 4)]);
}

#[test]
fn positions_are_byte_offsets() {
    assert_eq!(Regex::new("é").unwrap().find("café"), Some(m(3, 5)));
}

// The cases below need the engine.

#[test]
#[ignore = "needs the engine"]
fn plus_and_alternation() {
    assert_eq!(Regex::new("a+b").unwrap().find("xaab"), Some(m(1, 4)));
    assert_eq!(Regex::new("cat|dog").unwrap().find("hotdog"), Some(m(3, 6)));
}

#[test]
#[ignore = "needs the engine"]
fn leftmost_first_is_not_longest() {
    assert_eq!(Regex::new("a|ab").unwrap().find("ab"), Some(m(0, 1)));
}

#[test]
#[ignore = "needs the engine"]
fn classes_and_escapes() {
    assert_eq!(Regex::new(r"\d+").unwrap().find("room 101b"), Some(m(5, 8)));
    assert_eq!(Regex::new("[^a-c]+").unwrap().find("abcxyzabc"), Some(m(3, 6)));
}

#[test]
#[ignore = "needs the engine"]
fn groups_are_captured() {
    let caps = Regex::new(r"(\w+)@(\w+)").unwrap().captures("mail ann@home now").unwrap();
    assert_eq!(caps.get(1), Some(m(5, 8)));
    assert_eq!(caps.get(2), Some(m(9, 13)));
}

#[test]
#[ignore = "needs the engine"]
fn a_lazy_quantifier_takes_as_little_as_it_can() {
    assert_eq!(Regex::new("a.*?b").unwrap().find("axbxb"), Some(m(0, 3)));
    assert_eq!(Regex::new("a.*b").unwrap().find("axbxb"), Some(m(0, 5)));
}

#[test]
#[ignore = "needs the engine"]
fn an_unclosed_group_is_an_error_with_a_position() {
    assert_eq!(Regex::new("ab(c").err().unwrap().position, 2);
}
