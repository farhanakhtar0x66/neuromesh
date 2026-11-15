//! A small stack-based bytecode VM: NaN-boxed values, closures with upvalues, mark-and-sweep GC.
pub mod compiler;
pub mod gc;
pub mod value;
pub mod vm;

pub use vm::Vm;
