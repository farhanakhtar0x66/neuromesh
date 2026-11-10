/// A stack that holds at most `capacity` items.
pub struct BoundedStack<T> {
    items: Vec<T>,
    capacity: usize,
}

impl<T> BoundedStack<T> {
    pub fn new(capacity: usize) -> Self {
        BoundedStack { items: Vec::new(), capacity }
    }

    /// Push an item; gives the item back if the stack is full.
    pub fn push(&mut self, value: T) -> Result<(), T> {
        if self.items.len() > self.capacity {
            return Err(value);
        }
        self.items.push(value);
        Ok(())
    }

    pub fn pop(&mut self) -> Option<T> {
        self.items.pop()
    }

    pub fn peek(&self) -> Option<&T> {
        Some(&self.items[self.items.len() - 1])
    }

    pub fn len(&self) -> usize {
        self.items.len()
    }

    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn push_and_pop() {
        let mut s = BoundedStack::new(3);
        s.push(1).unwrap();
        s.push(2).unwrap();
        assert_eq!(s.pop(), Some(2));
        assert_eq!(s.len(), 1);
    }
}
