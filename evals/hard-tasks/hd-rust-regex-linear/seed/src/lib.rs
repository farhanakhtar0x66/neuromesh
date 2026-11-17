//! linre: a regular expression engine that runs in time linear in the text. See README.md for the syntax and rules.
//!
//! This is the public API. Only plain literal patterns work so far (anything with a special character is refused
//! with an error); the engine behind it is yet to be written.

use std::fmt;

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
    literal: String,
}

impl Regex {
    /// Compiles a pattern.
    pub fn new(pattern: &str) -> Result<Regex, Error> {
        if pattern.is_empty() {
            return Err(Error { position: 0, message: "the empty pattern is not supported yet".to_string() });
        }
        if let Some((position, _)) = pattern.char_indices().find(|(_, c)| "\\.[](){}*+?|^$".contains(*c)) {
            return Err(Error { position, message: "only literal patterns are supported yet".to_string() });
        }
        Ok(Regex { literal: pattern.to_string() })
    }

    pub fn is_match(&self, text: &str) -> bool {
        self.find(text).is_some()
    }

    /// The leftmost-first match.
    pub fn find(&self, text: &str) -> Option<Match> {
        self.find_from(text, 0)
    }

    pub fn captures(&self, text: &str) -> Option<Captures> {
        self.find(text).map(|m| Captures { groups: vec![Some(m)] })
    }

    /// The successive matches in the text.
    pub fn find_iter<'r, 't>(&'r self, text: &'t str) -> FindIter<'r, 't> {
        FindIter { regex: self, text, next_start: 0 }
    }

    fn find_from(&self, text: &str, from: usize) -> Option<Match> {
        text[from..].find(&self.literal).map(|i| Match { start: from + i, end: from + i + self.literal.len() })
    }
}

pub struct FindIter<'r, 't> {
    regex: &'r Regex,
    text: &'t str,
    next_start: usize,
}

impl<'r, 't> Iterator for FindIter<'r, 't> {
    type Item = Match;

    fn next(&mut self) -> Option<Match> {
        let m = self.regex.find_from(self.text, self.next_start)?;
        self.next_start = m.end;
        Some(m)
    }
}
