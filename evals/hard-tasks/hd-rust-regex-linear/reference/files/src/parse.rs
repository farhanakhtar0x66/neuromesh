//! Pattern text to syntax tree.

use crate::Error;

#[derive(Clone, Debug)]
pub enum ClassItem {
    Range(char, char),
    Digit(bool),
    Word(bool),
    Space(bool),
}

#[derive(Clone, Debug)]
pub struct Class {
    pub negated: bool,
    pub items: Vec<ClassItem>,
}

impl Class {
    pub fn matches(&self, c: char) -> bool {
        let hit = self.items.iter().any(|item| match *item {
            ClassItem::Range(lo, hi) => lo <= c && c <= hi,
            ClassItem::Digit(neg) => c.is_ascii_digit() != neg,
            ClassItem::Word(neg) => (c.is_ascii_alphanumeric() || c == '_') != neg,
            ClassItem::Space(neg) => matches!(c, ' ' | '\t' | '\n' | '\r' | '\x0b' | '\x0c') != neg,
        });
        hit != self.negated
    }
}

#[derive(Clone, Debug)]
pub enum Node {
    Empty,
    Char(char),
    Any,
    Class(Class),
    Start,
    End,
    /// `Some(n)`: capturing group number n.
    Group(Option<usize>, Box<Node>),
    Concat(Vec<Node>),
    Alt(Vec<Node>),
    Repeat { node: Box<Node>, min: u32, max: Option<u32>, greedy: bool },
}

pub struct Ast {
    pub root: Node,
    /// Number of capturing groups, not counting group 0.
    pub groups: usize,
}

const MAX_COUNT: u32 = 1000;

struct Parser {
    chars: Vec<(usize, char)>,
    pos: usize,
    len: usize,
    groups: usize,
}

fn err<T>(position: usize, message: &str) -> Result<T, Error> {
    Err(Error { position, message: message.to_string() })
}

pub fn parse(pattern: &str) -> Result<Ast, Error> {
    let mut p = Parser { chars: pattern.char_indices().collect(), pos: 0, len: pattern.len(), groups: 0 };
    let root = p.alt()?;
    if p.pos < p.chars.len() {
        // Only an unmatched ")" stops the top-level parse early.
        return err(p.here(), "unmatched )");
    }
    Ok(Ast { root, groups: p.groups })
}

impl Parser {
    fn peek(&self) -> Option<char> {
        self.chars.get(self.pos).map(|&(_, c)| c)
    }

    fn here(&self) -> usize {
        self.chars.get(self.pos).map(|&(i, _)| i).unwrap_or(self.len)
    }

    fn alt(&mut self) -> Result<Node, Error> {
        let mut branches = vec![self.concat()?];
        while self.peek() == Some('|') {
            self.pos += 1;
            branches.push(self.concat()?);
        }
        Ok(if branches.len() == 1 { branches.pop().unwrap() } else { Node::Alt(branches) })
    }

    fn concat(&mut self) -> Result<Node, Error> {
        let mut items = Vec::new();
        while let Some(c) = self.peek() {
            if c == '|' || c == ')' {
                break;
            }
            items.push(self.repeat()?);
        }
        Ok(match items.len() {
            0 => Node::Empty,
            1 => items.pop().unwrap(),
            _ => Node::Concat(items),
        })
    }

    fn repeat(&mut self) -> Result<Node, Error> {
        let atom = self.atom()?;
        let q_pos = self.here();
        let (min, max) = match self.peek() {
            Some('*') => {
                self.pos += 1;
                (0, None)
            }
            Some('+') => {
                self.pos += 1;
                (1, None)
            }
            Some('?') => {
                self.pos += 1;
                (0, Some(1))
            }
            Some('{') => self.counted()?,
            _ => return Ok(atom),
        };
        if matches!(atom, Node::Start | Node::End) {
            return err(q_pos, "nothing to repeat");
        }
        let greedy = if self.peek() == Some('?') {
            self.pos += 1;
            false
        } else {
            true
        };
        if matches!(self.peek(), Some('*') | Some('+') | Some('?') | Some('{')) {
            return err(self.here(), "repeated quantifier");
        }
        Ok(Node::Repeat { node: Box::new(atom), min, max, greedy })
    }

    /// `{m}`, `{m,}` or `{m,n}` at the current `{`.
    fn counted(&mut self) -> Result<(u32, Option<u32>), Error> {
        let open = self.here();
        let bad = |m: &str| -> Result<(u32, Option<u32>), Error> { err(open, m) };
        let mut i = self.pos + 1;
        let mut number = |i: &mut usize| -> Option<u32> {
            let start = *i;
            let mut v: u64 = 0;
            while let Some(&(_, c)) = self.chars.get(*i) {
                if let Some(d) = c.to_digit(10) {
                    v = (v * 10 + d as u64).min(1_000_000);
                    *i += 1;
                } else {
                    break;
                }
            }
            if *i == start {
                None
            } else {
                Some(v as u32)
            }
        };
        let min = match number(&mut i) {
            Some(m) => m,
            None => return bad("malformed repetition"),
        };
        let max = match self.chars.get(i).map(|&(_, c)| c) {
            Some('}') => Some(min),
            Some(',') => {
                i += 1;
                if self.chars.get(i).map(|&(_, c)| c) == Some('}') {
                    None
                } else {
                    match number(&mut i) {
                        Some(n) => Some(n),
                        None => return bad("malformed repetition"),
                    }
                }
            }
            _ => return bad("malformed repetition"),
        };
        if self.chars.get(i).map(|&(_, c)| c) != Some('}') {
            return bad("malformed repetition");
        }
        if min > MAX_COUNT || max.map_or(false, |n| n > MAX_COUNT) {
            return bad("repetition count too large");
        }
        if max.map_or(false, |n| n < min) {
            return bad("repetition minimum is larger than the maximum");
        }
        self.pos = i + 1;
        Ok((min, max))
    }

    fn atom(&mut self) -> Result<Node, Error> {
        let at = self.here();
        let c = self.peek().expect("atom is only called before the end");
        self.pos += 1;
        match c {
            '*' | '+' | '?' | '{' => err(at, "nothing to repeat"),
            '.' => Ok(Node::Any),
            '^' => Ok(Node::Start),
            '$' => Ok(Node::End),
            '(' => self.group(at),
            '[' => self.class(at),
            '\\' => match self.escape(at)? {
                Escaped::Char(c) => Ok(Node::Char(c)),
                Escaped::Class(item) => Ok(Node::Class(Class { negated: false, items: vec![item] })),
            },
            c => Ok(Node::Char(c)),
        }
    }

    fn group(&mut self, open: usize) -> Result<Node, Error> {
        let mut index = None;
        if self.peek() == Some('?') {
            self.pos += 1;
            if self.peek() != Some(':') {
                return err(open, "unsupported group syntax");
            }
            self.pos += 1;
        } else {
            self.groups += 1;
            index = Some(self.groups);
        }
        let inner = self.alt()?;
        if self.peek() != Some(')') {
            return err(open, "unclosed group");
        }
        self.pos += 1;
        Ok(Node::Group(index, Box::new(inner)))
    }

    /// After a backslash at `at`.
    fn escape(&mut self, at: usize) -> Result<Escaped, Error> {
        let c = match self.peek() {
            Some(c) => c,
            None => return err(at, "trailing backslash"),
        };
        self.pos += 1;
        Ok(match c {
            'd' => Escaped::Class(ClassItem::Digit(false)),
            'D' => Escaped::Class(ClassItem::Digit(true)),
            'w' => Escaped::Class(ClassItem::Word(false)),
            'W' => Escaped::Class(ClassItem::Word(true)),
            's' => Escaped::Class(ClassItem::Space(false)),
            'S' => Escaped::Class(ClassItem::Space(true)),
            'n' => Escaped::Char('\n'),
            't' => Escaped::Char('\t'),
            'r' => Escaped::Char('\r'),
            c if c.is_ascii_punctuation() => Escaped::Char(c),
            _ => return err(at, "unknown escape"),
        })
    }

    fn class(&mut self, open: usize) -> Result<Node, Error> {
        let negated = if self.peek() == Some('^') {
            self.pos += 1;
            true
        } else {
            false
        };
        if self.peek() == Some(']') {
            return err(open, "empty class");
        }
        let mut items = Vec::new();
        loop {
            let at = self.here();
            let c = match self.peek() {
                Some(c) => c,
                None => return err(open, "unclosed class"),
            };
            self.pos += 1;
            if c == ']' {
                break;
            }
            let lo = if c == '\\' {
                match self.escape(at)? {
                    Escaped::Char(c) => c,
                    Escaped::Class(item) => {
                        items.push(item);
                        continue;
                    }
                }
            } else {
                c
            };
            // A range lo-hi, unless the "-" is the last item.
            let dash_follows = self.peek() == Some('-') && self.chars.get(self.pos + 1).map_or(false, |&(_, c)| c != ']');
            if dash_follows {
                self.pos += 1;
                let hi_at = self.here();
                let hc = self.peek().unwrap();
                self.pos += 1;
                let hi = if hc == '\\' {
                    match self.escape(hi_at)? {
                        Escaped::Char(c) => c,
                        Escaped::Class(_) => return err(at, "bad range"),
                    }
                } else {
                    hc
                };
                if hi < lo {
                    return err(at, "reversed range");
                }
                items.push(ClassItem::Range(lo, hi));
            } else {
                items.push(ClassItem::Range(lo, lo));
            }
        }
        Ok(Node::Class(Class { negated, items }))
    }
}

enum Escaped {
    Char(char),
    Class(ClassItem),
}
