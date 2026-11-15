in a Rust crate (`src/value.rs`, `src/vm.rs`, `src/gc.rs`, `src/compiler.rs`, `src/lib.rs`, 0 external dependencies), implement a stack-based bytecode VM with:
1. 64-bit NaN-boxed `Value(u64)` in `src/value.rs` representing `f64`, `i32`, `bool`, `nil`, and heap object handles without exceeding 8 bytes per `Value`.
2. Lexical closures with upvalue capture (supporting both open stack upvalues and closed-over heap upvalues when the outer function returns, including mutable shared upvalues across sibling closures).
3. An exact tracing Mark-and-Sweep Garbage Collector in `src/gc.rs` tracing roots from the VM value stack, call frames, open upvalues, and globals, automatically triggered when live heap bytes exceed a configurable `gc_threshold_bytes`.
4. Public API in `src/lib.rs`:
   - `pub struct Vm` with `pub fn new(gc_threshold_bytes: usize) -> Self`
   - `pub fn eval(&mut self, source: &str) -> Result<String, String>`
   - `pub fn heap_bytes(&self) -> usize` and `pub fn gc_runs(&self) -> usize`
Support a minimal expression/statement language with `let x = ...;`, `fn name(a, b) { ... }`, `return`, `if / else`, `while`, arithmetic (`+`, `-`, `*`, `/`, `==`, `<`, `>`), string concatenation, and array literals `[a, b]` with indexing `arr[i]`.
