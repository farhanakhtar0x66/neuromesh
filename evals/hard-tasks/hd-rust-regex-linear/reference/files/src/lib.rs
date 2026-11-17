//! linre: a regular expression engine that runs in time linear in the text. See README.md for the syntax and rules.

mod compile;
mod parse;
mod vm;

use std::fmt;

use compile::Program;

/// A match: the byte range `start..end` of the text.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Match {
    pub start: usize,
    pub end: usize,
}

impl Match {
    pub fn len(&self) -> usize {
        self.end - self.start
    }

    pub fn is_empty(&self) -> bool {
        self.start == self.end
    }
}

/// A pattern that cannot be compiled. `position` is a byte offset into the pattern (see README.md for which one).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Error {
    pub position: usize,
    pub message: String,
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "regex error at {}: {}", self.position, self.message)
    }
}

impl std::error::Error for Error {}

/// The groups of one match. Group 0 is the whole match; groups 1.. are the capturing groups in the order of their
/// opening parentheses. A group that took no part in the match is `None`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Captures {
    groups: Vec<Option<Match>>,
}

impl Captures {
    pub fn get(&self, index: usize) -> Option<Match> {
        self.groups.get(index).copied().flatten()
    }

    /// The number of groups including group 0.
    pub fn len(&self) -> usize {
        self.groups.len()
    }

    pub fn is_empty(&self) -> bool {
        self.groups.is_empty()
    }
}

pub struct Regex {
    program: Program,
}

impl Regex {
    pub fn new(pattern: &str) -> Result<Regex, Error> {
        let ast = parse::parse(pattern)?;
        Ok(Regex { program: compile::compile(&ast)? })
    }

    pub fn is_match(&self, text: &str) -> bool {
        self.find(text).is_some()
    }

    pub fn find(&self, text: &str) -> Option<Match> {
        vm::search(&self.program, text, 0, None).map(|caps| caps_to_match(&caps))
    }

    pub fn captures(&self, text: &str) -> Option<Captures> {
        vm::search(&self.program, text, 0, None).map(|caps| Captures {
            groups: (0..self.program.groups)
                .map(|g| match (caps[2 * g], caps[2 * g + 1]) {
                    (Some(start), Some(end)) => Some(Match { start, end }),
                    _ => None,
                })
                .collect(),
        })
    }

    pub fn find_iter<'r, 't>(&'r self, text: &'t str) -> FindIter<'r, 't> {
        FindIter { regex: self, text, next_start: 0, forbid_empty_at: None, done: false }
    }
}

fn caps_to_match(caps: &[Option<usize>]) -> Match {
    Match { start: caps[0].unwrap(), end: caps[1].unwrap() }
}

pub struct FindIter<'r, 't> {
    regex: &'r Regex,
    text: &'t str,
    next_start: usize,
    forbid_empty_at: Option<usize>,
    done: bool,
}

impl<'r, 't> Iterator for FindIter<'r, 't> {
    type Item = Match;

    fn next(&mut self) -> Option<Match> {
        if self.done || self.next_start > self.text.len() {
            return None;
        }
        match vm::search(&self.regex.program, self.text, self.next_start, self.forbid_empty_at) {
            None => {
                self.done = true;
                None
            }
            Some(caps) => {
                let m = caps_to_match(&caps);
                self.next_start = m.end;
                self.forbid_empty_at = if m.is_empty() { Some(m.end) } else { None };
                Some(m)
            }
        }
    }
}
