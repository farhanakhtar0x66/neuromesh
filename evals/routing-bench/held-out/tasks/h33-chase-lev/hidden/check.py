import os, re, subprocess, sys, shutil

ITEMS = []
def item(name, ok):
    ITEMS.append((name, bool(ok)))
def done():
    passed = sum(1 for _, ok in ITEMS if ok)
    for name, ok in ITEMS:
        print(("PASS " if ok else "FAIL ") + name)
    print(f"SCORE {passed}/{len(ITEMS)}")
    sys.exit(0 if passed == len(ITEMS) else 1)

def read(p):
    try:
        return open(p, encoding="utf-8").read()
    except Exception:
        return None

manifest, src = read("Cargo.toml"), read("src/lib.rs")
item("Cargo.toml and src/lib.rs exist", bool(manifest) and bool(src))
if not (manifest and src):
    done()
m = re.search(r'^\s*name\s*=\s*"([^"]+)"', manifest, re.M)
crate = (m.group(1) if m else "x").replace("-", "_")
item("no external dependencies", not re.search(r"\[dependencies\]\s*\n\s*[A-Za-z_]", manifest))
item("uses std::sync::atomic, UnsafeCell and MaybeUninit", all(w in src for w in ("atomic", "UnsafeCell", "MaybeUninit")))

T1 = '''
use {crate}::new_work_deque;
#[test]
fn order_and_capacity() {
    let (w, s) = new_work_deque::<u32>(3); // rounds up to 4
    assert!(w.pop().is_none() && s.steal().is_none());
    for i in 0..4 { assert!(w.push(i).is_ok()); }
    assert_eq!(w.push(99), Err(99));
    assert_eq!(s.steal(), Some(0)); // FIFO from the top
    assert_eq!(s.steal(), Some(1));
    assert_eq!(w.pop(), Some(3)); // LIFO from the bottom
    assert!(w.push(7).is_ok());
    assert_eq!(w.pop(), Some(7));
    assert_eq!(w.pop(), Some(2));
    assert!(w.pop().is_none() && s.steal().is_none());
    let (w2, _s2) = new_work_deque::<u8>(0);
    assert!(w2.push(1).is_ok() && w2.push(2).is_ok() && w2.push(3) == Err(3)); // at least 2, a power of two
}
'''

T2 = '''
use {crate}::new_work_deque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
#[test]
fn last_element_race() {
    const N: usize = 250_000;
    let (w, s) = new_work_deque::<usize>(1024);
    let done = Arc::new(AtomicBool::new(false));
    let stealers: Vec<_> = (0..6).map(|_| {
        let s = s.clone();
        let done = done.clone();
        thread::spawn(move || {
            let mut got = Vec::new();
            loop {
                match s.steal() {
                    Some(x) => got.push(x),
                    None => { if done.load(Ordering::Acquire) { break; } std::hint::spin_loop(); }
                }
            }
            while let Some(x) = s.steal() { got.push(x); }
            got
        })
    }).collect();
    let owner = thread::spawn(move || {
        let mut got = Vec::new();
        for i in 0..N {
            let mut x = i;
            loop {
                match w.push(x) {
                    Ok(()) => break,
                    Err(back) => { x = back; if let Some(p) = w.pop() { got.push(p); } }
                }
            }
            if i % 3 != 0 { if let Some(p) = w.pop() { got.push(p); } }
        }
        while let Some(p) = w.pop() { got.push(p); }
        done.store(true, Ordering::Release);
        got
    });
    let mut all = owner.join().unwrap();
    for h in stealers { all.extend(h.join().unwrap()); }
    assert_eq!(all.len(), N, "an item was lost or duplicated");
    let mut seen = vec![false; N];
    for x in all { assert!(!seen[x], "item {} seen twice", x); seen[x] = true; }
    assert!(seen.iter().all(|b| *b), "an item is missing");
}
'''

T3 = '''
use {crate}::new_work_deque;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
struct Tracked(Arc<AtomicUsize>);
impl Drop for Tracked { fn drop(&mut self) { self.0.fetch_add(1, Ordering::SeqCst); } }
#[test]
fn drops_exactly_once() {
    let drops = Arc::new(AtomicUsize::new(0));
    {
        let (w, s) = new_work_deque::<Tracked>(1024);
        for _ in 0..1000 { assert!(w.push(Tracked(drops.clone())).is_ok()); }
        for _ in 0..200 { assert!(w.pop().is_some()); }
        for _ in 0..300 { assert!(s.steal().is_some()); }
        assert_eq!(drops.load(Ordering::SeqCst), 500); // popped and stolen items dropped by the caller
        drop(s);
        drop(w);
    }
    assert_eq!(drops.load(Ordering::SeqCst), 1000, "every item dropped exactly once");
}
'''

os.makedirs("tests", exist_ok=True)
def run(name, body):
    open(f"tests/{name}.rs", "w").write(body.replace("{crate}", crate))
    r = subprocess.run(["cargo", "test", "--release", "--offline", "--quiet", "--test", name], capture_output=True, text=True, timeout=900)
    if r.returncode != 0:
        print(f"--- {name}\n" + (r.stdout + r.stderr)[-1500:])
    return r.returncode == 0

b = subprocess.run(["cargo", "build", "--release", "--offline", "--quiet"], capture_output=True, text=True, timeout=900)
item("cargo build --release passes", b.returncode == 0)
if b.returncode == 0:
    item("FIFO steal, LIFO pop and full-capacity Err(item)", run("h33_order", T1))
    item("owner push+pop against 6 stealers over 250,000 items: none lost, none duplicated", run("h33_race", T2))
    item("1,000 Arc items are each dropped exactly once", run("h33_drop", T3))
else:
    print((b.stdout + b.stderr)[-1500:])
shutil.rmtree("tests", ignore_errors=True)
done()
