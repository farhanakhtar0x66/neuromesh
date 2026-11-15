//! The virtual machine: a value stack, call frames, and the garbage collector's roots.
use std::collections::HashMap;

use crate::compiler::{compile, Op};
use crate::gc::{Closure, Function, Heap, Obj, Upvalue};
use crate::value::Value;

struct Frame {
    closure: u32,
    ip: usize,
    base: usize,
}

pub struct Vm {
    heap: Heap,
    stack: Vec<Value>,
    frames: Vec<Frame>,
    globals: HashMap<String, Value>,
    open: Vec<u32>,
    last: Value,
}

type R<T> = Result<T, String>;

const MAX_FRAMES: usize = 400;

impl Vm {
    pub fn new(gc_threshold_bytes: usize) -> Self {
        Vm { heap: Heap::new(gc_threshold_bytes), stack: Vec::new(), frames: Vec::new(), globals: HashMap::new(), open: Vec::new(), last: Value::NIL }
    }

    pub fn heap_bytes(&self) -> usize {
        self.heap.bytes
    }

    pub fn gc_runs(&self) -> usize {
        self.heap.runs
    }

    pub fn eval(&mut self, source: &str) -> Result<String, String> {
        let func = compile(source, &mut self.heap)?;
        self.stack.clear();
        self.frames.clear();
        self.open.clear();
        self.last = Value::NIL;
        // no collection can happen yet: the compiler's functions are not rooted until this closure is on the stack
        let closure = self.heap.alloc(Obj::Closure(Closure { func, upvalues: Vec::new() }));
        self.stack.push(closure);
        self.frames.push(Frame { closure: closure.as_obj(), ip: 0, base: 0 });
        let result = self.run();
        if result.is_err() {
            self.close_upvalues(0); // closures kept in globals must not point at a stack we are about to clear
        }
        self.stack.clear();
        self.frames.clear();
        result?;
        Ok(self.display(self.last))
    }

    // ---- memory ----
    fn alloc(&mut self, obj: Obj) -> Value {
        if self.heap.bytes + obj.size() > self.heap.threshold {
            self.collect();
        }
        self.heap.alloc(obj)
    }

    fn collect(&mut self) {
        for v in &self.stack { self.heap.mark_value(*v); }
        for f in &self.frames { self.heap.mark(f.closure); }
        for u in &self.open { self.heap.mark(*u); }
        for v in self.globals.values() { self.heap.mark_value(*v); }
        self.heap.mark_value(self.last);
        self.heap.trace();
        self.heap.sweep();
    }

    // ---- helpers ----
    fn function(&self, closure: u32) -> &Function {
        match self.heap.get(closure) {
            Obj::Closure(c) => match self.heap.get(c.func) { Obj::Func(f) => f, _ => unreachable!() },
            _ => unreachable!(),
        }
    }

    fn pop(&mut self) -> Value { self.stack.pop().expect("stack underflow") }
    fn peek(&self, d: usize) -> Value { self.stack[self.stack.len() - 1 - d] }

    fn display(&self, v: Value) -> String {
        if v.is_int() { return v.as_int().to_string(); }
        if v.is_float() {
            let f = v.as_f64();
            return if f.fract() == 0.0 && f.abs() < 1e15 { format!("{}", f as i64) } else { format!("{}", f) };
        }
        if v.is_nil() { return "nil".into(); }
        if v.is_bool() { return (v == Value::TRUE).to_string(); }
        match self.heap.get(v.as_obj()) {
            Obj::Str(s) => s.clone(),
            Obj::Array(a) => format!("[{}]", a.iter().map(|x| self.display(*x)).collect::<Vec<_>>().join(", ")),
            Obj::Func(f) => format!("<fn {}>", f.name),
            Obj::Closure(c) => match self.heap.get(c.func) { Obj::Func(f) => format!("<fn {}>", f.name), _ => "<fn>".into() },
            Obj::Upvalue(_) => "<upvalue>".into(),
        }
    }

    fn is_str(&self, v: Value) -> bool { v.is_obj() && matches!(self.heap.get(v.as_obj()), Obj::Str(_)) }

    fn equal(&self, a: Value, b: Value) -> bool {
        if a.is_number() && b.is_number() { return a.as_f64() == b.as_f64(); }
        if self.is_str(a) && self.is_str(b) {
            return match (self.heap.get(a.as_obj()), self.heap.get(b.as_obj())) { (Obj::Str(x), Obj::Str(y)) => x == y, _ => false };
        }
        a == b
    }

    fn capture(&mut self, slot: usize) -> u32 {
        for h in &self.open {
            if let Obj::Upvalue(Upvalue::Open(s)) = self.heap.get(*h) {
                if *s == slot { return *h; }
            }
        }
        let v = self.alloc(Obj::Upvalue(Upvalue::Open(slot)));
        self.open.push(v.as_obj());
        v.as_obj()
    }

    fn close_upvalues(&mut self, from: usize) {
        let mut keep = Vec::new();
        for h in std::mem::take(&mut self.open) {
            let slot = match self.heap.get(h) { Obj::Upvalue(Upvalue::Open(s)) => *s, _ => usize::MAX };
            if slot >= from && slot < self.stack.len() {
                let v = self.stack[slot];
                *self.heap.get_mut(h) = Obj::Upvalue(Upvalue::Closed(v));
            } else if slot < from {
                keep.push(h);
            }
        }
        self.open = keep;
    }

    fn upvalue_get(&self, h: u32) -> Value {
        match self.heap.get(h) { Obj::Upvalue(Upvalue::Open(s)) => self.stack[*s], Obj::Upvalue(Upvalue::Closed(v)) => *v, _ => unreachable!() }
    }

    fn upvalue_set(&mut self, h: u32, v: Value) {
        let open = match self.heap.get(h) { Obj::Upvalue(Upvalue::Open(s)) => Some(*s), _ => None };
        match open {
            Some(s) => self.stack[s] = v,
            None => *self.heap.get_mut(h) = Obj::Upvalue(Upvalue::Closed(v)),
        }
    }

    fn closure_upvalue(&self, frame_closure: u32, i: usize) -> u32 {
        match self.heap.get(frame_closure) { Obj::Closure(c) => c.upvalues[i], _ => unreachable!() }
    }

    fn arith(&mut self, op: Op) -> R<()> {
        let (b, a) = (self.pop(), self.pop());
        if !a.is_number() || !b.is_number() { return Err("operands must be numbers".into()); }
        if a.is_int() && b.is_int() {
            let (x, y) = (a.as_int(), b.as_int());
            let r = match op { Op::Add => x.checked_add(y), Op::Sub => x.checked_sub(y), Op::Mul => x.checked_mul(y), _ => None };
            if let Some(r) = r { self.stack.push(Value::int(r)); return Ok(()); }
        }
        let (x, y) = (a.as_f64(), b.as_f64());
        let r = match op {
            Op::Add => x + y,
            Op::Sub => x - y,
            Op::Mul => x * y,
            Op::Div => { if y == 0.0 { return Err("division by zero".into()); } x / y }
            _ => unreachable!(),
        };
        self.stack.push(Value::number(r));
        Ok(())
    }

    fn compare(&mut self, op: Op) -> R<()> {
        let (b, a) = (self.pop(), self.pop());
        if !a.is_number() || !b.is_number() { return Err("operands must be numbers".into()); }
        let (x, y) = (a.as_f64(), b.as_f64());
        self.stack.push(Value::boolean(match op { Op::Lt => x < y, Op::Gt => x > y, Op::Le => x <= y, _ => x >= y }));
        Ok(())
    }

    fn call(&mut self, argc: usize) -> R<()> {
        let callee = self.peek(argc);
        let ok = callee.is_obj() && matches!(self.heap.get(callee.as_obj()), Obj::Closure(_));
        if !ok { return Err("can only call functions".into()); }
        let arity = self.function(callee.as_obj()).arity;
        if arity != argc { return Err(format!("expected {} arguments but got {}", arity, argc)); }
        if self.frames.len() >= MAX_FRAMES { return Err("stack overflow".into()); }
        self.frames.push(Frame { closure: callee.as_obj(), ip: 0, base: self.stack.len() - argc - 1 });
        Ok(())
    }

    // ---- the loop ----
    fn run(&mut self) -> R<()> {
        loop {
            let (closure, ip, base) = { let f = self.frames.last().unwrap(); (f.closure, f.ip, f.base) };
            let op = self.function(closure).code[ip];
            self.frames.last_mut().unwrap().ip += 1;
            match op {
                Op::Const(i) => { let v = self.function(closure).constants[i as usize]; self.stack.push(v); }
                Op::Nil => self.stack.push(Value::NIL),
                Op::True => self.stack.push(Value::TRUE),
                Op::False => self.stack.push(Value::FALSE),
                Op::Pop => { self.pop(); }
                Op::PopLast => { self.last = self.pop(); }
                Op::GetLocal(s) => { let v = self.stack[base + s as usize]; self.stack.push(v); }
                Op::SetLocal(s) => { let v = self.peek(0); self.stack[base + s as usize] = v; }
                Op::GetGlobal(i) => {
                    let name = self.function(closure).names[i as usize].clone();
                    match self.globals.get(&name) { Some(v) => { let v = *v; self.stack.push(v); } None => return Err(format!("undefined variable '{}'", name)) }
                }
                Op::DefGlobal(i) => { let name = self.function(closure).names[i as usize].clone(); let v = self.pop(); self.globals.insert(name, v); }
                Op::SetGlobal(i) => {
                    let name = self.function(closure).names[i as usize].clone();
                    if !self.globals.contains_key(&name) { return Err(format!("undefined variable '{}'", name)); }
                    let v = self.peek(0);
                    self.globals.insert(name, v);
                }
                Op::GetUpvalue(i) => { let h = self.closure_upvalue(closure, i as usize); let v = self.upvalue_get(h); self.stack.push(v); }
                Op::SetUpvalue(i) => { let h = self.closure_upvalue(closure, i as usize); let v = self.peek(0); self.upvalue_set(h, v); }
                Op::Add => {
                    let (b, a) = (self.peek(0), self.peek(1));
                    if self.is_str(a) || self.is_str(b) {
                        // both operands stay on the stack while the result is allocated, so a collection cannot free them
                        let s = format!("{}{}", self.display(a), self.display(b));
                        let v = self.alloc(Obj::Str(s));
                        self.pop();
                        self.pop();
                        self.stack.push(v);
                    } else {
                        self.arith(Op::Add)?;
                    }
                }
                Op::Sub | Op::Mul | Op::Div => self.arith(op)?,
                Op::Eq => { let (b, a) = (self.pop(), self.pop()); let r = self.equal(a, b); self.stack.push(Value::boolean(r)); }
                Op::Ne => { let (b, a) = (self.pop(), self.pop()); let r = !self.equal(a, b); self.stack.push(Value::boolean(r)); }
                Op::Lt | Op::Gt | Op::Le | Op::Ge => self.compare(op)?,
                Op::Not => { let v = self.pop(); self.stack.push(Value::boolean(v.is_falsey())); }
                Op::Neg => {
                    let v = self.pop();
                    if v.is_int() && v.as_int() != i32::MIN { self.stack.push(Value::int(-v.as_int())); }
                    else if v.is_number() { self.stack.push(Value::number(-v.as_f64())); }
                    else { return Err("operand must be a number".into()); }
                }
                Op::Jump(t) => self.frames.last_mut().unwrap().ip = t as usize,
                Op::JumpIfFalse(t) => { if self.pop().is_falsey() { self.frames.last_mut().unwrap().ip = t as usize; } }
                Op::Call(n) => self.call(n as usize)?,
                Op::Closure(k) => {
                    let func = self.function(closure).constants[k as usize].as_obj();
                    let descs = match self.heap.get(func) { Obj::Func(f) => f.upvalues.clone(), _ => unreachable!() };
                    let c = self.alloc(Obj::Closure(Closure { func, upvalues: Vec::with_capacity(descs.len()) }));
                    self.stack.push(c); // rooted while its upvalues are captured below
                    for (is_local, index) in descs {
                        let up = if is_local { self.capture(base + index) } else { self.closure_upvalue(closure, index) };
                        if let Obj::Closure(cl) = self.heap.get_mut(c.as_obj()) { cl.upvalues.push(up); }
                    }
                }
                Op::CloseUpvalue => { self.close_upvalues(self.stack.len() - 1); self.pop(); }
                Op::Return => {
                    let result = self.pop();
                    self.close_upvalues(base);
                    self.frames.pop();
                    self.stack.truncate(base);
                    if self.frames.is_empty() { return Ok(()); }
                    self.stack.push(result);
                }
                Op::Array(n) => {
                    let n = n as usize;
                    let items = self.stack[self.stack.len() - n..].to_vec();
                    let v = self.alloc(Obj::Array(items)); // the elements are still on the stack
                    let keep = self.stack.len() - n;
                    self.stack.truncate(keep);
                    self.stack.push(v);
                }
                Op::Index => {
                    let (i, a) = (self.pop(), self.pop());
                    if !a.is_obj() || !i.is_number() { return Err("can only index an array with a number".into()); }
                    match self.heap.get(a.as_obj()) {
                        Obj::Array(items) => {
                            let at = i.as_f64();
                            if at < 0.0 || at.fract() != 0.0 || at as usize >= items.len() { return Err(format!("index {} out of range", self.display(i))); }
                            let v = items[at as usize];
                            self.stack.push(v);
                        }
                        _ => return Err("can only index an array".into()),
                    }
                }
            }
        }
    }
}
