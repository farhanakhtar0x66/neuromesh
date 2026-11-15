//! A 64-bit NaN-boxed value. Anything that is not a quiet NaN with the top mantissa bits set is a
//! plain f64. Otherwise bits 48-49 say what is stored in the low bits.

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Value(pub u64);

const QNAN: u64 = 0x7ffc_0000_0000_0000;
const TAG_MASK: u64 = 0x0003_0000_0000_0000;
const TAG_SPECIAL: u64 = 0;
const TAG_INT: u64 = 0x0001_0000_0000_0000;
const TAG_OBJ: u64 = 0x0002_0000_0000_0000;
const CANONICAL_NAN: u64 = 0x7ff8_0000_0000_0000;

impl Value {
    pub const NIL: Value = Value(QNAN | TAG_SPECIAL | 1);
    pub const FALSE: Value = Value(QNAN | TAG_SPECIAL | 2);
    pub const TRUE: Value = Value(QNAN | TAG_SPECIAL | 3);

    pub fn number(f: f64) -> Value {
        if f.is_nan() { Value(CANONICAL_NAN) } else { Value(f.to_bits()) }
    }
    pub fn int(i: i32) -> Value {
        Value(QNAN | TAG_INT | (i as u32 as u64))
    }
    pub fn obj(handle: u32) -> Value {
        Value(QNAN | TAG_OBJ | handle as u64)
    }
    pub fn boolean(b: bool) -> Value {
        if b { Value::TRUE } else { Value::FALSE }
    }

    fn boxed(self) -> bool {
        self.0 & QNAN == QNAN
    }
    pub fn is_float(self) -> bool {
        !self.boxed()
    }
    pub fn is_int(self) -> bool {
        self.boxed() && self.0 & TAG_MASK == TAG_INT
    }
    pub fn is_number(self) -> bool {
        self.is_float() || self.is_int()
    }
    pub fn is_obj(self) -> bool {
        self.boxed() && self.0 & TAG_MASK == TAG_OBJ
    }
    pub fn is_nil(self) -> bool {
        self == Value::NIL
    }
    pub fn is_bool(self) -> bool {
        self == Value::TRUE || self == Value::FALSE
    }
    pub fn is_falsey(self) -> bool {
        self == Value::NIL || self == Value::FALSE
    }

    pub fn as_f64(self) -> f64 {
        if self.is_int() { self.as_int() as f64 } else { f64::from_bits(self.0) }
    }
    pub fn as_int(self) -> i32 {
        self.0 as u32 as i32
    }
    pub fn as_obj(self) -> u32 {
        self.0 as u32
    }
}
