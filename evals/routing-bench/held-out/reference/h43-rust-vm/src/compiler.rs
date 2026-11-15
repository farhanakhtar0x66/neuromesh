//! Source text to bytecode in one pass: a scanner, then recursive descent that emits ops as it goes.
use crate::gc::{Function, Heap, Obj};
use crate::value::Value;

#[derive(Clone, Copy, Debug)]
pub enum Op {
    Const(u16),
    Nil,
    True,
    False,
    Pop,
    /// Pop the value into the VM's "last result" register (a top-level expression statement).
    PopLast,
    GetLocal(u16),
    SetLocal(u16),
    GetGlobal(u16),
    DefGlobal(u16),
    SetGlobal(u16),
    GetUpvalue(u16),
    SetUpvalue(u16),
    Add,
    Sub,
    Mul,
    Div,
    Eq,
    Ne,
    Lt,
    Gt,
    Le,
    Ge,
    Not,
    Neg,
    Jump(u16),
    JumpIfFalse(u16),
    Call(u8),
    Closure(u16),
    CloseUpvalue,
    Return,
    Array(u16),
    Index,
}

#[derive(Clone, Debug, PartialEq)]
enum Tok {
    Int(i32),
    Float(f64),
    Str(String),
    Ident(String),
    Let, Fn, Return, If, Else, While, True, False, Nil,
    LParen, RParen, LBrace, RBrace, LBracket, RBracket, Comma, Semi,
    Plus, Minus, Star, Slash, Assign, EqEq, Ne, Lt, Gt, Le, Ge, Bang,
    Eof,
}

fn scan(src: &str) -> Result<Vec<Tok>, String> {
    let c: Vec<char> = src.chars().collect();
    let mut i = 0;
    let mut out = Vec::new();
    while i < c.len() {
        let ch = c[i];
        let next = c.get(i + 1).copied();
        match ch {
            ' ' | '\t' | '\r' | '\n' => i += 1,
            '/' if next == Some('/') => { while i < c.len() && c[i] != '\n' { i += 1; } }
            '(' => { out.push(Tok::LParen); i += 1 }
            ')' => { out.push(Tok::RParen); i += 1 }
            '{' => { out.push(Tok::LBrace); i += 1 }
            '}' => { out.push(Tok::RBrace); i += 1 }
            '[' => { out.push(Tok::LBracket); i += 1 }
            ']' => { out.push(Tok::RBracket); i += 1 }
            ',' => { out.push(Tok::Comma); i += 1 }
            ';' => { out.push(Tok::Semi); i += 1 }
            '+' => { out.push(Tok::Plus); i += 1 }
            '-' => { out.push(Tok::Minus); i += 1 }
            '*' => { out.push(Tok::Star); i += 1 }
            '/' => { out.push(Tok::Slash); i += 1 }
            '=' if next == Some('=') => { out.push(Tok::EqEq); i += 2 }
            '=' => { out.push(Tok::Assign); i += 1 }
            '!' if next == Some('=') => { out.push(Tok::Ne); i += 2 }
            '!' => { out.push(Tok::Bang); i += 1 }
            '<' if next == Some('=') => { out.push(Tok::Le); i += 2 }
            '<' => { out.push(Tok::Lt); i += 1 }
            '>' if next == Some('=') => { out.push(Tok::Ge); i += 2 }
            '>' => { out.push(Tok::Gt); i += 1 }
            '"' => {
                let mut s = String::new();
                i += 1;
                loop {
                    match c.get(i) {
                        None => return Err("unterminated string".into()),
                        Some('"') => { i += 1; break; }
                        Some('\\') => {
                            match c.get(i + 1) {
                                Some('n') => s.push('\n'),
                                Some('t') => s.push('\t'),
                                Some(o) => s.push(*o),
                                None => return Err("unterminated string".into()),
                            }
                            i += 2;
                        }
                        Some(o) => { s.push(*o); i += 1; }
                    }
                }
                out.push(Tok::Str(s));
            }
            d if d.is_ascii_digit() => {
                let start = i;
                while i < c.len() && c[i].is_ascii_digit() { i += 1; }
                let mut float = false;
                if i + 1 < c.len() && c[i] == '.' && c[i + 1].is_ascii_digit() {
                    float = true;
                    i += 1;
                    while i < c.len() && c[i].is_ascii_digit() { i += 1; }
                }
                let text: String = c[start..i].iter().collect();
                match (float, text.parse::<i32>()) {
                    (false, Ok(n)) => out.push(Tok::Int(n)),
                    _ => out.push(Tok::Float(text.parse::<f64>().map_err(|e| e.to_string())?)),
                }
            }
            a if a.is_alphabetic() || a == '_' => {
                let start = i;
                while i < c.len() && (c[i].is_alphanumeric() || c[i] == '_') { i += 1; }
                let word: String = c[start..i].iter().collect();
                out.push(match word.as_str() {
                    "let" => Tok::Let, "fn" => Tok::Fn, "return" => Tok::Return, "if" => Tok::If, "else" => Tok::Else,
                    "while" => Tok::While, "true" => Tok::True, "false" => Tok::False, "nil" => Tok::Nil,
                    _ => Tok::Ident(word),
                });
            }
            other => return Err(format!("unexpected character '{}'", other)),
        }
    }
    out.push(Tok::Eof);
    Ok(out)
}

struct Local {
    name: String,
    depth: i32,
    captured: bool,
}

struct FnState {
    name: String,
    arity: usize,
    code: Vec<Op>,
    constants: Vec<Value>,
    names: Vec<String>,
    upvalues: Vec<(bool, usize)>,
    locals: Vec<Local>,
    depth: i32,
    script: bool,
}

impl FnState {
    fn new(name: &str, script: bool) -> FnState {
        // slot 0 holds the function being called
        FnState { name: name.into(), arity: 0, code: vec![], constants: vec![], names: vec![], upvalues: vec![], locals: vec![Local { name: String::new(), depth: 0, captured: false }], depth: 0, script }
    }
}

struct Compiler<'a> {
    toks: Vec<Tok>,
    pos: usize,
    heap: &'a mut Heap,
    fns: Vec<FnState>,
}

pub fn compile(source: &str, heap: &mut Heap) -> Result<u32, String> {
    let toks = scan(source)?;
    let mut c = Compiler { toks, pos: 0, heap, fns: vec![FnState::new("script", true)] };
    while c.peek() != &Tok::Eof {
        c.declaration()?;
    }
    c.emit(Op::Nil);
    c.emit(Op::Return);
    let state = c.fns.pop().unwrap();
    Ok(c.finish(state).as_obj())
}

type R<T> = Result<T, String>;

impl<'a> Compiler<'a> {
    fn peek(&self) -> &Tok { &self.toks[self.pos] }
    fn advance(&mut self) -> Tok { let t = self.toks[self.pos].clone(); if self.pos < self.toks.len() - 1 { self.pos += 1; } t }
    fn eat(&mut self, t: Tok) -> bool { if self.peek() == &t { self.advance(); true } else { false } }
    fn expect(&mut self, t: Tok, what: &str) -> R<()> {
        if self.eat(t) { Ok(()) } else { Err(format!("expected {} but found {:?}", what, self.peek())) }
    }
    fn ident(&mut self) -> R<String> {
        match self.advance() { Tok::Ident(s) => Ok(s), t => Err(format!("expected a name but found {:?}", t)) }
    }
    fn cur(&mut self) -> &mut FnState { self.fns.last_mut().unwrap() }
    fn emit(&mut self, op: Op) -> usize { let f = self.cur(); f.code.push(op); f.code.len() - 1 }
    fn here(&mut self) -> usize { self.cur().code.len() }
    fn patch(&mut self, at: usize) {
        let to = self.here() as u16;
        match &mut self.cur().code[at] { Op::Jump(t) | Op::JumpIfFalse(t) => *t = to, _ => unreachable!() }
    }
    fn constant(&mut self, v: Value) -> R<u16> {
        let f = self.cur();
        if f.constants.len() >= u16::MAX as usize { return Err("too many constants".into()); }
        f.constants.push(v);
        Ok((f.constants.len() - 1) as u16)
    }
    fn name_index(&mut self, name: &str) -> u16 {
        let f = self.cur();
        if let Some(i) = f.names.iter().position(|n| n == name) { return i as u16; }
        f.names.push(name.to_string());
        (f.names.len() - 1) as u16
    }
    fn finish(&mut self, s: FnState) -> Value {
        self.heap.alloc(Obj::Func(Function { name: s.name, arity: s.arity, code: s.code, constants: s.constants, names: s.names, upvalues: s.upvalues }))
    }

    // ---- statements ----
    fn declaration(&mut self) -> R<()> {
        match self.peek() {
            Tok::Let => { self.advance(); self.let_decl() }
            Tok::Fn => { self.advance(); self.fn_decl() }
            _ => self.statement(),
        }
    }

    fn global_scope(&mut self) -> bool { let f = self.cur(); f.script && f.depth == 0 }

    fn let_decl(&mut self) -> R<()> {
        let name = self.ident()?;
        if self.eat(Tok::Assign) { self.expression()?; } else { self.emit(Op::Nil); }
        self.expect(Tok::Semi, "';' after a let")?;
        self.define(&name);
        Ok(())
    }

    /// The value is on the stack: make it a global, or let it stay as the next local slot.
    fn define(&mut self, name: &str) {
        if self.global_scope() {
            let i = self.name_index(name);
            self.emit(Op::DefGlobal(i));
        } else {
            let d = self.cur().depth;
            self.cur().locals.push(Local { name: name.into(), depth: d, captured: false });
        }
    }

    fn fn_decl(&mut self) -> R<()> {
        let name = self.ident()?;
        if !self.global_scope() {
            // a local function can call itself: declare it before compiling the body
            let d = self.cur().depth;
            self.emit(Op::Nil);
            self.cur().locals.push(Local { name: name.clone(), depth: d, captured: false });
            let slot = self.cur().locals.len() - 1;
            self.function(&name)?;
            self.emit(Op::SetLocal(slot as u16));
            self.emit(Op::Pop);
        } else {
            self.function(&name)?;
            self.define(&name);
        }
        Ok(())
    }

    fn function(&mut self, name: &str) -> R<()> {
        self.fns.push(FnState::new(name, false));
        self.cur().depth = 1;
        self.expect(Tok::LParen, "'(' after the function name")?;
        if self.peek() != &Tok::RParen {
            loop {
                let p = self.ident()?;
                let f = self.cur();
                f.arity += 1;
                f.locals.push(Local { name: p, depth: 1, captured: false });
                if !self.eat(Tok::Comma) { break; }
            }
        }
        self.expect(Tok::RParen, "')' after the parameters")?;
        self.expect(Tok::LBrace, "'{' before the function body")?;
        while self.peek() != &Tok::RBrace && self.peek() != &Tok::Eof { self.declaration()?; }
        self.expect(Tok::RBrace, "'}' after the function body")?;
        self.emit(Op::Nil);
        self.emit(Op::Return);
        let state = self.fns.pop().unwrap();
        let f = self.finish(state);
        let k = self.constant(f)?;
        self.emit(Op::Closure(k));
        Ok(())
    }

    fn statement(&mut self) -> R<()> {
        match self.peek() {
            Tok::Return => {
                self.advance();
                let script = self.cur().script;
                if self.peek() == &Tok::Semi { self.emit(Op::Nil); } else { self.expression()?; }
                self.expect(Tok::Semi, "';' after return")?;
                if script { self.emit(Op::PopLast); self.emit(Op::Nil); }
                self.emit(Op::Return);
                Ok(())
            }
            Tok::If => { self.advance(); self.if_stmt() }
            Tok::While => { self.advance(); self.while_stmt() }
            Tok::LBrace => { self.advance(); self.block() }
            _ => {
                self.expression()?;
                self.expect(Tok::Semi, "';' after an expression")?;
                let script = self.cur().script;
                self.emit(if script { Op::PopLast } else { Op::Pop });
                Ok(())
            }
        }
    }

    fn block(&mut self) -> R<()> {
        self.cur().depth += 1;
        while self.peek() != &Tok::RBrace && self.peek() != &Tok::Eof { self.declaration()?; }
        self.expect(Tok::RBrace, "'}'")?;
        let f = self.cur();
        f.depth -= 1;
        let depth = f.depth;
        while f.locals.last().map_or(false, |l| l.depth > depth) {
            let l = f.locals.pop().unwrap();
            f.code.push(if l.captured { Op::CloseUpvalue } else { Op::Pop });
        }
        Ok(())
    }

    fn if_stmt(&mut self) -> R<()> {
        self.expression()?;
        let skip = self.emit(Op::JumpIfFalse(0));
        self.expect(Tok::LBrace, "'{' after the condition")?;
        self.block()?;
        if self.eat(Tok::Else) {
            let over = self.emit(Op::Jump(0));
            self.patch(skip);
            if self.eat(Tok::If) { self.if_stmt()?; } else { self.expect(Tok::LBrace, "'{' after else")?; self.block()?; }
            self.patch(over);
        } else {
            self.patch(skip);
        }
        Ok(())
    }

    fn while_stmt(&mut self) -> R<()> {
        let top = self.here();
        self.expression()?;
        let exit = self.emit(Op::JumpIfFalse(0));
        self.expect(Tok::LBrace, "'{' after the condition")?;
        self.block()?;
        self.emit(Op::Jump(top as u16));
        self.patch(exit);
        Ok(())
    }

    // ---- expressions, lowest precedence first ----
    fn expression(&mut self) -> R<()> {
        if let (Tok::Ident(name), Some(Tok::Assign)) = (self.peek().clone(), self.toks.get(self.pos + 1)) {
            self.advance();
            self.advance();
            self.expression()?;
            return self.set_variable(&name);
        }
        self.equality()
    }

    fn equality(&mut self) -> R<()> {
        self.comparison()?;
        loop {
            let op = match self.peek() { Tok::EqEq => Op::Eq, Tok::Ne => Op::Ne, _ => return Ok(()) };
            self.advance();
            self.comparison()?;
            self.emit(op);
        }
    }
    fn comparison(&mut self) -> R<()> {
        self.term()?;
        loop {
            let op = match self.peek() { Tok::Lt => Op::Lt, Tok::Gt => Op::Gt, Tok::Le => Op::Le, Tok::Ge => Op::Ge, _ => return Ok(()) };
            self.advance();
            self.term()?;
            self.emit(op);
        }
    }
    fn term(&mut self) -> R<()> {
        self.factor()?;
        loop {
            let op = match self.peek() { Tok::Plus => Op::Add, Tok::Minus => Op::Sub, _ => return Ok(()) };
            self.advance();
            self.factor()?;
            self.emit(op);
        }
    }
    fn factor(&mut self) -> R<()> {
        self.unary()?;
        loop {
            let op = match self.peek() { Tok::Star => Op::Mul, Tok::Slash => Op::Div, _ => return Ok(()) };
            self.advance();
            self.unary()?;
            self.emit(op);
        }
    }
    fn unary(&mut self) -> R<()> {
        match self.peek() {
            Tok::Minus => { self.advance(); self.unary()?; self.emit(Op::Neg); Ok(()) }
            Tok::Bang => { self.advance(); self.unary()?; self.emit(Op::Not); Ok(()) }
            _ => self.postfix(),
        }
    }
    fn postfix(&mut self) -> R<()> {
        self.primary()?;
        loop {
            if self.eat(Tok::LParen) {
                let mut argc = 0u8;
                if self.peek() != &Tok::RParen {
                    loop {
                        self.expression()?;
                        argc = argc.checked_add(1).ok_or("too many arguments")?;
                        if !self.eat(Tok::Comma) { break; }
                    }
                }
                self.expect(Tok::RParen, "')' after the arguments")?;
                self.emit(Op::Call(argc));
            } else if self.eat(Tok::LBracket) {
                self.expression()?;
                self.expect(Tok::RBracket, "']' after the index")?;
                self.emit(Op::Index);
            } else {
                return Ok(());
            }
        }
    }
    fn primary(&mut self) -> R<()> {
        match self.advance() {
            Tok::Int(n) => { let k = self.constant(Value::int(n))?; self.emit(Op::Const(k)); }
            Tok::Float(f) => { let k = self.constant(Value::number(f))?; self.emit(Op::Const(k)); }
            Tok::Str(s) => { let v = self.heap.alloc(Obj::Str(s)); let k = self.constant(v)?; self.emit(Op::Const(k)); }
            Tok::True => { self.emit(Op::True); }
            Tok::False => { self.emit(Op::False); }
            Tok::Nil => { self.emit(Op::Nil); }
            Tok::Ident(name) => self.get_variable(&name)?,
            Tok::LParen => { self.expression()?; self.expect(Tok::RParen, "')'")?; }
            Tok::LBracket => {
                let mut n = 0u16;
                if self.peek() != &Tok::RBracket {
                    loop {
                        self.expression()?;
                        n += 1;
                        if !self.eat(Tok::Comma) { break; }
                    }
                }
                self.expect(Tok::RBracket, "']' after the array")?;
                self.emit(Op::Array(n));
            }
            t => return Err(format!("unexpected {:?}", t)),
        }
        Ok(())
    }

    // ---- variables ----
    fn resolve_local(&self, f: usize, name: &str) -> Option<usize> {
        self.fns[f].locals.iter().rposition(|l| l.name == name)
    }

    fn resolve_upvalue(&mut self, f: usize, name: &str) -> Option<usize> {
        if f == 0 { return None; }
        if let Some(slot) = self.resolve_local(f - 1, name) {
            self.fns[f - 1].locals[slot].captured = true;
            return Some(self.add_upvalue(f, true, slot));
        }
        let up = self.resolve_upvalue(f - 1, name)?;
        Some(self.add_upvalue(f, false, up))
    }

    fn add_upvalue(&mut self, f: usize, is_local: bool, index: usize) -> usize {
        let ups = &mut self.fns[f].upvalues;
        if let Some(i) = ups.iter().position(|u| *u == (is_local, index)) { return i; }
        ups.push((is_local, index));
        ups.len() - 1
    }

    fn get_variable(&mut self, name: &str) -> R<()> {
        let f = self.fns.len() - 1;
        if let Some(s) = self.resolve_local(f, name) { self.emit(Op::GetLocal(s as u16)); }
        else if let Some(u) = self.resolve_upvalue(f, name) { self.emit(Op::GetUpvalue(u as u16)); }
        else { let i = self.name_index(name); self.emit(Op::GetGlobal(i)); }
        Ok(())
    }

    fn set_variable(&mut self, name: &str) -> R<()> {
        let f = self.fns.len() - 1;
        if let Some(s) = self.resolve_local(f, name) { self.emit(Op::SetLocal(s as u16)); }
        else if let Some(u) = self.resolve_upvalue(f, name) { self.emit(Op::SetUpvalue(u as u16)); }
        else { let i = self.name_index(name); self.emit(Op::SetGlobal(i)); }
        Ok(())
    }
}
