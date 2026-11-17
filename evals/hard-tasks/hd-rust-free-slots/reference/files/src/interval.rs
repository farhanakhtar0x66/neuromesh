//! Half-open intervals of minutes and the small algebra the finder is built on.

/// Minutes since 1970-01-01T00:00 UTC. "Local minutes" are the same count shifted by a person's UTC offset.
pub type Minute = i64;

/// `[start, end)`: `start` is inside, `end` is not. An interval with `end <= start` is empty.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Interval {
    pub start: Minute,
    pub end: Minute,
}

impl Interval {
    pub fn new(start: Minute, end: Minute) -> Interval {
        Interval { start, end }
    }

    /// Length in minutes; 0 for an empty interval.
    pub fn len(&self) -> i64 {
        (self.end - self.start).max(0)
    }

    pub fn is_empty(&self) -> bool {
        self.end <= self.start
    }

    pub fn contains(&self, t: Minute) -> bool {
        self.start <= t && t < self.end
    }

    pub fn shift(&self, by: i64) -> Interval {
        Interval::new(self.start + by, self.end + by)
    }

    /// The part both intervals share, if it is not empty.
    pub fn intersect(&self, other: &Interval) -> Option<Interval> {
        let start = self.start.max(other.start);
        let end = self.end.min(other.end);
        if start < end {
            Some(Interval::new(start, end))
        } else {
            None
        }
    }
}

/// Sorts the intervals, drops empty ones and joins the ones that overlap or touch.
/// The result is sorted, and no two of its intervals overlap or touch.
pub fn normalize(items: &[Interval]) -> Vec<Interval> {
    let mut sorted: Vec<Interval> = items.iter().copied().filter(|i| !i.is_empty()).collect();
    sorted.sort();
    let mut out: Vec<Interval> = Vec::new();
    for item in sorted {
        match out.last_mut() {
            Some(last) if item.start <= last.end => last.end = last.end.max(item.end),
            _ => out.push(item),
        }
    }
    out
}

/// What is left of the intervals in `a` after removing every minute covered by `blocked`.
/// `a` may be in any order; `blocked` must be sorted by start.
pub fn subtract(a: &[Interval], blocked: &[Interval]) -> Vec<Interval> {
    let mut out = Vec::new();
    for piece in a {
        let mut cursor = piece.start;
        for block in blocked {
            if block.start >= piece.end {
                break;
            }
            if block.end <= cursor {
                continue;
            }
            if block.start > cursor {
                out.push(Interval::new(cursor, block.start));
            }
            cursor = cursor.max(block.end);
            if cursor >= piece.end {
                break;
            }
        }
        if cursor < piece.end {
            out.push(Interval::new(cursor, piece.end));
        }
    }
    out
}

/// The minutes that are in every set. Each set must be normalized.
pub fn intersect_all(sets: &[Vec<Interval>]) -> Vec<Interval> {
    let mut iter = sets.iter();
    let mut current = match iter.next() {
        Some(first) => first.clone(),
        None => return Vec::new(),
    };
    for next in iter {
        let mut out = Vec::new();
        let (mut i, mut j) = (0, 0);
        while i < current.len() && j < next.len() {
            if let Some(common) = current[i].intersect(&next[j]) {
                out.push(common);
            }
            if current[i].end < next[j].end {
                i += 1;
            } else {
                j += 1;
            }
        }
        current = out;
    }
    current
}
