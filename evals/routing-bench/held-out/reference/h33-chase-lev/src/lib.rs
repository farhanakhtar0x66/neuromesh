//! A bounded Chase-Lev work-stealing deque (Le, Pop, Cohen, Nardelli, "Correct and efficient
//! work-stealing for weak memory models"). One `Worker` pushes and pops at the bottom;
//! any number of `Stealer`s take from the top.

use std::cell::{Cell, UnsafeCell};
use std::mem::MaybeUninit;
use std::ptr;
use std::sync::atomic::{fence, AtomicIsize, Ordering};
use std::sync::Arc;

struct Inner<T> {
    top: AtomicIsize,
    bottom: AtomicIsize,
    mask: isize,
    buf: Box<[UnsafeCell<MaybeUninit<T>>]>,
}

// Items move between threads, and the indices decide who may touch which slot.
unsafe impl<T: Send> Send for Inner<T> {}
unsafe impl<T: Send> Sync for Inner<T> {}

impl<T> Inner<T> {
    fn slot(&self, i: isize) -> *mut MaybeUninit<T> {
        self.buf[(i & self.mask) as usize].get()
    }
}

impl<T> Drop for Inner<T> {
    fn drop(&mut self) {
        // Exclusive access here: drop what is still between top and bottom, once each.
        let (t, b) = (*self.top.get_mut(), *self.bottom.get_mut());
        for i in t..b {
            unsafe { ptr::drop_in_place((*self.slot(i)).as_mut_ptr()) };
        }
    }
}

pub struct Worker<T> {
    inner: Arc<Inner<T>>,
    _not_sync: std::marker::PhantomData<Cell<()>>, // Send, but not Sync: one owner thread at a time
}

pub struct Stealer<T> {
    inner: Arc<Inner<T>>,
}

impl<T> Clone for Stealer<T> {
    fn clone(&self) -> Self {
        Stealer { inner: self.inner.clone() }
    }
}

pub fn new_work_deque<T>(capacity: usize) -> (Worker<T>, Stealer<T>) {
    let cap = capacity.max(2).next_power_of_two();
    let buf: Vec<UnsafeCell<MaybeUninit<T>>> = (0..cap).map(|_| UnsafeCell::new(MaybeUninit::uninit())).collect();
    let inner = Arc::new(Inner {
        top: AtomicIsize::new(0),
        bottom: AtomicIsize::new(0),
        mask: cap as isize - 1,
        buf: buf.into_boxed_slice(),
    });
    (Worker { inner: inner.clone(), _not_sync: std::marker::PhantomData }, Stealer { inner })
}

impl<T> Worker<T> {
    pub fn push(&self, item: T) -> Result<(), T> {
        let q = &*self.inner;
        let b = q.bottom.load(Ordering::Relaxed);
        let t = q.top.load(Ordering::Acquire);
        if b - t >= q.buf.len() as isize {
            return Err(item);
        }
        unsafe { (*q.slot(b)).write(item) };
        fence(Ordering::Release);
        q.bottom.store(b + 1, Ordering::Relaxed);
        Ok(())
    }

    pub fn pop(&self) -> Option<T> {
        let q = &*self.inner;
        let b = q.bottom.load(Ordering::Relaxed) - 1;
        q.bottom.store(b, Ordering::Relaxed);
        fence(Ordering::SeqCst);
        let t = q.top.load(Ordering::Relaxed);
        if t > b {
            q.bottom.store(b + 1, Ordering::Relaxed); // it was empty
            return None;
        }
        let item = unsafe { ptr::read(q.slot(b)).assume_init() };
        if t == b {
            // The last element: a stealer may be taking it right now. The top index decides.
            let won = q.top.compare_exchange(t, t + 1, Ordering::SeqCst, Ordering::Relaxed).is_ok();
            q.bottom.store(b + 1, Ordering::Relaxed);
            if !won {
                std::mem::forget(item); // the stealer owns it
                return None;
            }
        }
        Some(item)
    }
}

unsafe impl<T: Send> Send for Worker<T> {}

impl<T> Stealer<T> {
    pub fn steal(&self) -> Option<T> {
        let q = &*self.inner;
        loop {
            let t = q.top.load(Ordering::Acquire);
            fence(Ordering::SeqCst);
            let b = q.bottom.load(Ordering::Acquire);
            if t >= b {
                return None;
            }
            // The slot may be reused while we read it, but then the compare_exchange below fails
            // and the copy is forgotten, never used or dropped.
            let item = unsafe { ptr::read_volatile(q.slot(t)) };
            if q.top.compare_exchange(t, t + 1, Ordering::SeqCst, Ordering::Relaxed).is_ok() {
                return Some(unsafe { item.assume_init() });
            }
            std::mem::forget(item); // lost the race: another thread took it; try again
        }
    }
}
