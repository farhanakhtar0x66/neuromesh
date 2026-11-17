//! Myers' O(ND) shortest edit script between two sequences.

/// One step of an edit script. Indexes are positions in the old (`a`) and new (`b`) sequence.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Edit {
    Equal { a: usize, b: usize },
    Delete { a: usize },
    Insert { b: usize },
}

/// A shortest script that turns `a` into `b`, in order. Among the shortest scripts it prefers the one that keeps the
/// earliest lines of `a` (deletions come before insertions at the same place).
pub fn diff<T: PartialEq>(a: &[T], b: &[T]) -> Vec<Edit> {
    let n = a.len() as isize;
    let m = b.len() as isize;
    let max = n + m;
    let offset = max;
    let idx = |k: isize| (k + offset) as usize;
    let mut v = vec![0isize; (2 * max + 3) as usize];
    let mut trace: Vec<Vec<isize>> = Vec::new();
    'search: for d in 0..=max {
        trace.push(v.clone());
        let mut k = -d;
        while k <= d {
            let mut x = if k == -d || (k != d && v[idx(k - 1)] < v[idx(k + 1)]) { v[idx(k + 1)] } else { v[idx(k - 1)] + 1 };
            let mut y = x - k;
            while x < n && y < m && a[x as usize] == b[y as usize] {
                x += 1;
                y += 1;
            }
            v[idx(k)] = x;
            if x >= n && y >= m {
                break 'search;
            }
            k += 2;
        }
    }
    backtrack(&trace, n, m, offset)
}

fn backtrack(trace: &[Vec<isize>], n: isize, m: isize, offset: isize) -> Vec<Edit> {
    let idx = |k: isize| (k + offset) as usize;
    let mut edits = Vec::new();
    let (mut x, mut y) = (n, m);
    for d in (0..trace.len() as isize).rev() {
        let v = &trace[d as usize];
        let k = x - y;
        let prev_k = if k == -d || (k != d && v[idx(k - 1)] < v[idx(k + 1)]) { k + 1 } else { k - 1 };
        let prev_x = v[idx(prev_k)];
        let prev_y = prev_x - prev_k;
        while x > prev_x && y > prev_y {
            edits.push(Edit::Equal { a: (x - 1) as usize, b: (y - 1) as usize });
            x -= 1;
            y -= 1;
        }
        if d > 0 {
            if x == prev_x {
                edits.push(Edit::Insert { b: (y - 1) as usize });
            } else {
                edits.push(Edit::Delete { a: (x - 1) as usize });
            }
        }
        x = prev_x;
        y = prev_y;
    }
    edits.reverse();
    edits
}

/// The number of insertions and deletions in a script.
pub fn distance(edits: &[Edit]) -> usize {
    edits.iter().filter(|e| !matches!(e, Edit::Equal { .. })).count()
}
