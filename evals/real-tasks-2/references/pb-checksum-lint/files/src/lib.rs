//! Mechanical fix fixture with strict compiler lints
#![deny(unused_imports)]

pub fn compute_checksum(data: &[u8]) -> u32 {
    let mut sum = 0u32;
    for &b in data {
        sum = sum.wrapping_add(b as u32);
    }
    sum
}
