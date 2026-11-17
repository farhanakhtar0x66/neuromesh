//! The Pike VM: all threads advance together over the text, in priority order, so the time is
//! O(text length * program size) whatever the pattern.

use crate::compile::{Inst, Program};

const NONE: usize = usize::MAX;

/// The threads at one text position.
struct Threads {
    /// Marks the instructions already reached at this position (a second thread there has a lower priority and
    /// would do the same work, so it is dropped).
    seen: Vec<bool>,
    /// The marked instructions, to reset them cheaply.
    visited: Vec<usize>,
    /// The instructions that wait for a character (or are `Match`), in priority order.
    order: Vec<usize>,
    /// Capture slots of the thread waiting at each instruction.
    caps: Vec<usize>,
    slots: usize,
}

impl Threads {
    fn new(insts: usize, slots: usize) -> Threads {
        Threads { seen: vec![false; insts], visited: Vec::new(), order: Vec::new(), caps: vec![NONE; insts * slots], slots }
    }

    fn clear(&mut self) {
        for &pc in &self.visited {
            self.seen[pc] = false;
        }
        self.visited.clear();
        self.order.clear();
    }
}

enum Frame {
    Explore(usize),
    Restore(usize, usize),
}

/// Adds the thread at `pc` and everything it reaches without consuming a character, highest priority first.
/// An explicit stack keeps long chains of empty transitions (`(a?){1000}`) from overflowing the call stack.
fn add(program: &Program, list: &mut Threads, stack: &mut Vec<Frame>, pc: usize, pos: usize, text_len: usize, caps: &mut [usize]) {
    stack.push(Frame::Explore(pc));
    while let Some(frame) = stack.pop() {
        match frame {
            Frame::Restore(slot, old) => caps[slot] = old,
            Frame::Explore(pc) => {
                if list.seen[pc] {
                    continue;
                }
                list.seen[pc] = true;
                list.visited.push(pc);
                match program.insts[pc] {
                    Inst::Jmp(t) => stack.push(Frame::Explore(t)),
                    Inst::Split(x, y) => {
                        stack.push(Frame::Explore(y));
                        stack.push(Frame::Explore(x));
                    }
                    Inst::Save(slot) => {
                        stack.push(Frame::Restore(slot, caps[slot]));
                        caps[slot] = pos;
                        stack.push(Frame::Explore(pc + 1));
                    }
                    Inst::Start => {
                        if pos == 0 {
                            stack.push(Frame::Explore(pc + 1));
                        }
                    }
                    Inst::End => {
                        if pos == text_len {
                            stack.push(Frame::Explore(pc + 1));
                        }
                    }
                    Inst::Char(_) | Inst::Any | Inst::Class(_) | Inst::Match => {
                        list.order.push(pc);
                        let s = list.slots;
                        list.caps[pc * s..(pc + 1) * s].copy_from_slice(caps);
                    }
                }
            }
        }
    }
}

/// The leftmost-first match starting at or after byte `from`: the capture slots (start and end of every group).
/// With `forbid_empty_at = Some(p)`, an empty match at `p` is not accepted (the search goes on to other
/// possibilities), which is how `find_iter` steps past an empty match.
pub fn search(program: &Program, text: &str, from: usize, forbid_empty_at: Option<usize>) -> Option<Vec<Option<usize>>> {
    let n = program.insts.len();
    let slots = program.groups * 2;
    let mut clist = Threads::new(n, slots);
    let mut nlist = Threads::new(n, slots);
    let mut stack: Vec<Frame> = Vec::new();
    let mut scratch = vec![NONE; slots];
    let mut best: Option<Vec<usize>> = None;
    let mut pos = from;
    loop {
        if best.is_none() {
            // A new thread that starts here has the lowest priority.
            scratch.iter_mut().for_each(|s| *s = NONE);
            add(program, &mut clist, &mut stack, 0, pos, text.len(), &mut scratch);
        }
        if clist.order.is_empty() && (best.is_some() || pos >= text.len()) {
            break;
        }
        let (cur, next_pos) = match text[pos..].chars().next() {
            Some(c) => (Some(c), pos + c.len_utf8()),
            None => (None, pos),
        };
        for k in 0..clist.order.len() {
            let pc = clist.order[k];
            let advance = match &program.insts[pc] {
                Inst::Char(c) => cur == Some(*c),
                Inst::Any => cur.map_or(false, |c| c != '\n'),
                Inst::Class(i) => cur.map_or(false, |c| program.classes[*i].matches(c)),
                Inst::Match => {
                    let caps = &clist.caps[pc * slots..(pc + 1) * slots];
                    if Some(pos) == forbid_empty_at && caps[0] == pos {
                        continue; // an empty match here is not allowed; lower priorities may still match
                    }
                    best = Some(caps.to_vec());
                    break; // every thread after this one has a lower priority
                }
                _ => false,
            };
            if advance {
                let mut caps: Vec<usize> = clist.caps[pc * slots..(pc + 1) * slots].to_vec();
                add(program, &mut nlist, &mut stack, pc + 1, next_pos, text.len(), &mut caps);
            }
        }
        clist.clear();
        std::mem::swap(&mut clist, &mut nlist);
        if cur.is_none() {
            break;
        }
        pos = next_pos;
    }
    best.map(|caps| caps.into_iter().map(|v| if v == NONE { None } else { Some(v) }).collect())
}
