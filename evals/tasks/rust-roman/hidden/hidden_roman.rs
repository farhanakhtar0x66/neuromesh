use roman::to_roman;

#[test]
fn hidden_cases() {
    assert_eq!(to_roman(1994).as_deref(), Some("MCMXCIV"));
    assert_eq!(to_roman(3999).as_deref(), Some("MMMCMXCIX"));
    assert_eq!(to_roman(444).as_deref(), Some("CDXLIV"));
    assert_eq!(to_roman(0), None);
    assert_eq!(to_roman(4000), None);
}
