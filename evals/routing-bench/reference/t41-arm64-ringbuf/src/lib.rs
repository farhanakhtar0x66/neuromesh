use std::cell::UnsafeCell;
use std::mem::MaybeUninit;
use std::sync::atomic::{AtomicUsize, Ordering};

pub struct Ring<T, const N: usize> {
    slots: [UnsafeCell<MaybeUninit<T>>; N],
    head: AtomicUsize,
    tail: AtomicUsize,
}

unsafe impl<T: Send, const N: usize> Sync for Ring<T, N> {}

impl<T: Copy, const N: usize> Ring<T, N> {
    pub fn new() -> Self {
        Ring { slots: std::array::from_fn(|_| UnsafeCell::new(MaybeUninit::uninit())), head: AtomicUsize::new(0), tail: AtomicUsize::new(0) }
    }
    pub fn push(&self, v: T) -> bool {
        let tail = self.tail.load(Ordering::Relaxed);
        if tail.wrapping_sub(self.head.load(Ordering::Acquire)) == N { return false; }
        unsafe { (*self.slots[tail % N].get()).write(v); }
        self.tail.store(tail.wrapping_add(1), Ordering::Release);
        true
    }
    pub fn pop(&self) -> Option<T> {
        loop {
            let head = self.head.load(Ordering::Relaxed);
            if head == self.tail.load(Ordering::Acquire) { return None; }
            let v = unsafe { (*self.slots[head % N].get()).assume_init_read() };
            if self.head.compare_exchange(head, head.wrapping_add(1), Ordering::AcqRel, Ordering::Relaxed).is_ok() { return Some(v); }
        }
    }
}
