//! The heap and its mark-and-sweep collector. Objects live in slots addressed by a u32 handle;
//! a `Value` holds the handle. The VM finds the roots and calls `mark`, then `trace` and `sweep`.
use crate::compiler::Op;
use crate::value::Value;

pub struct Function {
    pub name: String,
    pub arity: usize,
    pub code: Vec<Op>,
    pub constants: Vec<Value>,
    pub names: Vec<String>,
    /// For each upvalue the closure needs: (captured from the enclosing function's locals?, index).
    pub upvalues: Vec<(bool, usize)>,
}

pub enum Upvalue {
    Open(usize),
    Closed(Value),
}

pub struct Closure {
    pub func: u32,
    pub upvalues: Vec<u32>,
}

pub enum Obj {
    Str(String),
    Array(Vec<Value>),
    Func(Function),
    Closure(Closure),
    Upvalue(Upvalue),
}

impl Obj {
    /// What the object counts for against the heap, in bytes (an estimate, the same on every run).
    pub fn size(&self) -> usize {
        match self {
            Obj::Str(s) => 24 + s.len(),
            Obj::Array(a) => 24 + 8 * a.len(),
            Obj::Func(_) => 48,
            Obj::Closure(c) => 32 + 4 * c.upvalues.len(),
            Obj::Upvalue(_) => 24,
        }
    }
}

struct Slot {
    obj: Option<Obj>,
    marked: bool,
}

pub struct Heap {
    slots: Vec<Slot>,
    free: Vec<u32>,
    gray: Vec<u32>,
    pub bytes: usize,
    pub threshold: usize,
    pub runs: usize,
}

impl Heap {
    pub fn new(threshold: usize) -> Heap {
        Heap { slots: Vec::new(), free: Vec::new(), gray: Vec::new(), bytes: 0, threshold, runs: 0 }
    }

    /// Allocate without ever collecting (the compiler uses this; the VM decides when to collect).
    pub fn alloc(&mut self, obj: Obj) -> Value {
        self.bytes += obj.size();
        let slot = Slot { obj: Some(obj), marked: false };
        let handle = match self.free.pop() {
            Some(h) => { self.slots[h as usize] = slot; h }
            None => { self.slots.push(slot); (self.slots.len() - 1) as u32 }
        };
        Value::obj(handle)
    }

    pub fn get(&self, h: u32) -> &Obj {
        self.slots[h as usize].obj.as_ref().expect("a freed object was used")
    }
    pub fn get_mut(&mut self, h: u32) -> &mut Obj {
        self.slots[h as usize].obj.as_mut().expect("a freed object was used")
    }

    pub fn mark_value(&mut self, v: Value) {
        if v.is_obj() {
            self.mark(v.as_obj());
        }
    }
    pub fn mark(&mut self, h: u32) {
        let slot = &mut self.slots[h as usize];
        if !slot.marked {
            slot.marked = true;
            self.gray.push(h);
        }
    }

    /// Follow every marked object to what it refers to.
    pub fn trace(&mut self) {
        while let Some(h) = self.gray.pop() {
            let children: Vec<Value> = match self.slots[h as usize].obj.as_ref() {
                Some(Obj::Array(a)) => a.clone(),
                Some(Obj::Func(f)) => f.constants.clone(),
                Some(Obj::Closure(c)) => std::iter::once(Value::obj(c.func)).chain(c.upvalues.iter().map(|u| Value::obj(*u))).collect(),
                Some(Obj::Upvalue(Upvalue::Closed(v))) => vec![*v],
                _ => Vec::new(),
            };
            for c in children {
                self.mark_value(c);
            }
        }
    }

    /// Free everything unmarked and clear the marks.
    pub fn sweep(&mut self) {
        for (i, slot) in self.slots.iter_mut().enumerate() {
            if slot.obj.is_none() {
                continue;
            }
            if slot.marked {
                slot.marked = false;
            } else {
                self.bytes -= slot.obj.as_ref().map(Obj::size).unwrap_or(0);
                slot.obj = None;
                self.free.push(i as u32);
            }
        }
        self.runs += 1;
    }
}
