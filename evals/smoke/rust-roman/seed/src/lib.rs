/// Convert a number to a Roman numeral.
pub fn to_roman(n: u32) -> Option<String> {
    let _ = n;
    todo!("convert to a Roman numeral")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn small_numbers() {
        assert_eq!(to_roman(3).as_deref(), Some("III"));
        assert_eq!(to_roman(4).as_deref(), Some("IV"));
    }
}
