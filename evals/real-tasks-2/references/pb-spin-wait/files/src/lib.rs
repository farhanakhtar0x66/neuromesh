#![deny(deprecated)]

/// Executes up to `max_spins` spin-loop iterations signaling the CPU.
/// Returns the number of spin iterations actually executed.
pub fn spin_wait(max_spins: usize) -> usize {
    for _ in 0..max_spins {
        std::hint::spin_loop();
    }
    max_spins
}
