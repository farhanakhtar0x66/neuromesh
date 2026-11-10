use bounded::BoundedStack;

#[test]
fn hidden_capacity_and_peek() {
    let mut s: BoundedStack<i32> = BoundedStack::new(2);
    assert_eq!(s.peek(), None);
    assert!(s.is_empty());
    assert_eq!(s.push(1), Ok(()));
    assert_eq!(s.push(2), Ok(()));
    assert_eq!(s.push(3), Err(3));
    assert_eq!(s.len(), 2);
    assert_eq!(s.peek(), Some(&2));
    assert_eq!(s.pop(), Some(2));
    assert_eq!(s.push(4), Ok(()));
    let mut zero: BoundedStack<u8> = BoundedStack::new(0);
    assert_eq!(zero.push(9), Err(9));
}
