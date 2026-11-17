//! Syntax tree to a program for the Pike VM.

use crate::parse::{Ast, Class, Node};
use crate::Error;

#[derive(Clone, Debug)]
pub enum Inst {
    Char(char),
    Any,
    Class(usize),
    Start,
    End,
    Save(usize),
    /// Try the first target, then the second: the order is the match priority.
    Split(usize, usize),
    Jmp(usize),
    Match,
}

pub struct Program {
    pub insts: Vec<Inst>,
    pub classes: Vec<Class>,
    /// Groups including group 0.
    pub groups: usize,
}

const MAX_INSTS: usize = 4_000_000;

struct Compiler {
    insts: Vec<Inst>,
    classes: Vec<Class>,
}

pub fn compile(ast: &Ast) -> Result<Program, Error> {
    let mut c = Compiler { insts: Vec::new(), classes: Vec::new() };
    c.insts.push(Inst::Save(0));
    c.node(&ast.root)?;
    c.insts.push(Inst::Save(1));
    c.insts.push(Inst::Match);
    Ok(Program { insts: c.insts, classes: c.classes, groups: ast.groups + 1 })
}

impl Compiler {
    fn emit(&mut self, inst: Inst) -> Result<usize, Error> {
        if self.insts.len() >= MAX_INSTS {
            return Err(Error { position: 0, message: "pattern too large".to_string() });
        }
        self.insts.push(inst);
        Ok(self.insts.len() - 1)
    }

    fn node(&mut self, node: &Node) -> Result<(), Error> {
        match node {
            Node::Empty => {}
            Node::Char(c) => {
                self.emit(Inst::Char(*c))?;
            }
            Node::Any => {
                self.emit(Inst::Any)?;
            }
            Node::Class(class) => {
                self.classes.push(class.clone());
                let index = self.classes.len() - 1;
                self.emit(Inst::Class(index))?;
            }
            Node::Start => {
                self.emit(Inst::Start)?;
            }
            Node::End => {
                self.emit(Inst::End)?;
            }
            Node::Group(index, inner) => match index {
                Some(n) => {
                    self.emit(Inst::Save(2 * n))?;
                    self.node(inner)?;
                    self.emit(Inst::Save(2 * n + 1))?;
                }
                None => self.node(inner)?,
            },
            Node::Concat(items) => {
                for item in items {
                    self.node(item)?;
                }
            }
            Node::Alt(branches) => {
                // split L1, next; L1: branch; jmp end; next: split ...
                let mut jumps = Vec::new();
                for (i, branch) in branches.iter().enumerate() {
                    if i + 1 < branches.len() {
                        let split = self.emit(Inst::Split(0, 0))?;
                        self.node(branch)?;
                        jumps.push(self.emit(Inst::Jmp(0))?);
                        let next = self.insts.len();
                        self.insts[split] = Inst::Split(split + 1, next);
                    } else {
                        self.node(branch)?;
                    }
                }
                let end = self.insts.len();
                for j in jumps {
                    self.insts[j] = Inst::Jmp(end);
                }
            }
            Node::Repeat { node, min, max, greedy } => {
                for _ in 0..*min {
                    self.node(node)?;
                }
                match max {
                    None => {
                        // L: split body, end; body; jmp L
                        let split = self.emit(Inst::Split(0, 0))?;
                        self.node(node)?;
                        self.emit(Inst::Jmp(split))?;
                        let end = self.insts.len();
                        self.insts[split] = if *greedy { Inst::Split(split + 1, end) } else { Inst::Split(end, split + 1) };
                    }
                    Some(max) => {
                        let mut splits = Vec::new();
                        for _ in *min..*max {
                            splits.push(self.emit(Inst::Split(0, 0))?);
                            self.node(node)?;
                        }
                        let end = self.insts.len();
                        for s in splits {
                            self.insts[s] = if *greedy { Inst::Split(s + 1, end) } else { Inst::Split(end, s + 1) };
                        }
                    }
                }
            }
        }
        Ok(())
    }
}
