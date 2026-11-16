#![deny(unused_variables)]

pub fn normalize_reading(raw: f64, _unused_scale: f64) -> f64 {
    raw * 100.0
}
