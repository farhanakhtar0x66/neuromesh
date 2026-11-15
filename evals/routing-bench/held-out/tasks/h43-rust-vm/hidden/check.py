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

manifest = read("Cargo.toml")
files = ["src/lib.rs", "src/value.rs", "src/vm.rs", "src/gc.rs", "src/compiler.rs"]
have = {f: bool((read(f) or "").strip()) for f in files}
item("the five source files exist and are not empty", all(have.values()) and bool(manifest))
if not (manifest and all(have.values())):
    done()
m = re.search(r'^\s*name\s*=\s*"([^"]+)"', manifest, re.M)
crate = (m.group(1) if m else "x").replace("-", "_")
item("no external dependencies", not re.search(r"\[dependencies\]\s*\n\s*[A-Za-z_]", manifest))

HEAD = '''
use {crate}::Vm;
fn out(vm: &mut Vm, src: &str) -> String { vm.eval(src).unwrap_or_else(|e| panic!("eval failed on {:?}: {}", src, e)).trim().to_string() }
fn num(vm: &mut Vm, src: &str) -> f64 { let s = out(vm, src); s.parse::<f64>().unwrap_or_else(|_| panic!("{:?} gave {:?}, not a number", src, s)) }
'''

T1 = HEAD + '''
#[test]
fn value_is_eight_bytes() {
    assert_eq!(std::mem::size_of::<{crate}::value::Value>(), 8);
}
#[test]
fn arithmetic_and_branching() {
    let mut vm = Vm::new(1 << 20);
    assert_eq!(num(&mut vm, "1 + 2 * 3;"), 7.0);
    assert_eq!(num(&mut vm, "(1 + 2) * 3 - 4 / 2;"), 7.0);
    let q = num(&mut vm, "10 / 4;");
    assert!(q == 2.5 || q == 2.0, "10 / 4 gave {}", q); // true or integer division: the prompt does not say
    assert_eq!(num(&mut vm, "10 / 2;"), 5.0);
    assert_eq!(out(&mut vm, "1 == 1;"), "true");
    assert_eq!(out(&mut vm, "2 < 1;"), "false");
    assert_eq!(out(&mut vm, "2 > 1;"), "true");
    assert_eq!(out(&mut vm, "\\"ab\\" + \\"cd\\";").trim_matches('"'), "abcd");
    assert_eq!(num(&mut vm, "let x = 5; if (x > 3) { x = x * 2; } else { x = 0; } x;"), 10.0);
    assert_eq!(num(&mut vm, "let y = 1; if (y > 3) { y = 99; } else { y = y + 1; } y;"), 2.0);
    assert_eq!(num(&mut vm, "let i = 0; let s = 0; while (i < 5) { s = s + i; i = i + 1; } s;"), 10.0);
    assert_eq!(num(&mut vm, "[1, 2, 3][1] + 40;"), 42.0);
    assert_eq!(num(&mut vm, "let a = [10, 20, 30]; a[0] + a[2];"), 40.0);
    assert_eq!(num(&mut vm, "fn fib(n) { if (n < 2) { return n; } return fib(n - 1) + fib(n - 2); } fib(15);"), 610.0);
    assert!(vm.eval("undefined_name;").is_err());
    assert!(vm.eval("let = ;").is_err());
    assert_eq!(num(&mut vm, "1 + 1;"), 2.0); // still usable after errors
}
'''

T2 = HEAD + '''
#[test]
fn shared_mutable_upvalues() {
    let mut vm = Vm::new(1 << 20);
    let prog = "
        fn make_counter(start) {
            let n = start;
            fn inc() { n = n + 1; return n; }
            fn get() { return n; }
            return [inc, get];
        }
        let c1 = make_counter(10);
        let c2 = make_counter(100);
        let inc1 = c1[0]; let get1 = c1[1];
        let inc2 = c2[0]; let get2 = c2[1];
        inc1(); inc1(); inc1(); inc2();
        get1() * 1000 + get2();
    ";
    assert_eq!(num(&mut vm, prog), 13.0 * 1000.0 + 101.0);
}
#[test]
fn open_upvalue_while_outer_is_running() {
    let mut vm = Vm::new(1 << 20);
    let prog = "
        fn outer() {
            let x = 1;
            fn bump() { x = x + 1; return x; }
            bump(); bump();
            return x;
        }
        outer();
    ";
    assert_eq!(num(&mut vm, prog), 3.0);
}
#[test]
fn two_levels_and_block_scopes() {
    let mut vm = Vm::new(1 << 20);
    let prog = "
        fn a(x) {
            fn b(y) {
                fn c(z) { return x + y + z; }
                return c;
            }
            return b(10);
        }
        let f = a(1);
        f(100);
    ";
    assert_eq!(num(&mut vm, prog), 111.0);
    let prog2 = "
        let fns = [];
        fn adder(n) { fn add(m) { return n + m; } return add; }
        let p = adder(1); let q = adder(2);
        p(10) + q(10);
    ";
    assert_eq!(num(&mut vm, prog2), 23.0);
}
'''

T3 = HEAD + '''
#[test]
fn collects_and_stays_small() {
    let mut vm = Vm::new(1024);
    let setup = "
        fn fib(n) { if (n < 2) { return n; } return fib(n - 1) + fib(n - 2); }
        fn make_adder(a) { fn add(b) { return a + b; } return add; }
        let add5 = make_adder(5);
        let i = 0;
        while (i < 500) {
            let s = \\"ab\\" + \\"cd\\";
            let arr = [i, s, [i]];
            i = i + 1;
        }
        fib(15) + add5(10);
    ";
    assert_eq!(num(&mut vm, setup), 625.0);
    assert!(vm.gc_runs() >= 10, "only {} collections", vm.gc_runs());
    assert_eq!(num(&mut vm, "add5(100);"), 105.0); // the live closure survived every sweep
    assert_eq!(num(&mut vm, "fib(10);"), 55.0);
    // The prompt does not say how bytes are counted, so there is no absolute bound: the heap must not grow
    // with the amount of garbage made. Three times as much garbage, and the heap stays where it was.
    let after_500 = vm.heap_bytes();
    out(&mut vm, "let j = 0; while (j < 1500) { let s2 = \\"ab\\" + \\"cd\\"; let arr2 = [j, s2, [j]]; j = j + 1; } j;");
    assert!(vm.heap_bytes() <= after_500 + 2048, "heap grew from {} to {} bytes under more garbage", after_500, vm.heap_bytes());
    assert!(vm.heap_bytes() < 1 << 20, "heap is {} bytes", vm.heap_bytes());
}
#[test]
fn garbage_is_really_freed() {
    let mut vm = Vm::new(512);
    let before = vm.heap_bytes();
    out(&mut vm, "let i = 0; while (i < 2000) { let t = [i, i, i, i]; i = i + 1; } i;");
    assert!(vm.gc_runs() >= 10);
    assert!(vm.heap_bytes() < before + 2048, "temporaries were not freed: {} bytes", vm.heap_bytes());
}
'''

os.makedirs("tests", exist_ok=True)
def run(name, body):
    open(f"tests/{name}.rs", "w").write(body.replace("{crate}", crate))
    r = subprocess.run(["cargo", "test", "--release", "--offline", "--quiet", "--test", name], capture_output=True, text=True, timeout=900)
    if r.returncode != 0:
        print(f"--- {name}\n" + (r.stdout + r.stderr)[-1800:])
    return r.returncode == 0

b = subprocess.run(["cargo", "build", "--release", "--offline", "--quiet"], capture_output=True, text=True, timeout=900)
item("cargo build --release passes", b.returncode == 0)
if b.returncode == 0:
    item("Value is 8 bytes; arithmetic, strings, arrays, if/else, while, recursion and errors", run("h43_basic", T1))
    item("closures: shared mutable upvalues survive the outer function returning", run("h43_closures", T2))
    item("GC under a 1 KB threshold: 10+ collections, live closure intact, heap does not grow with garbage", run("h43_gc", T3))
else:
    print((b.stdout + b.stderr)[-1800:])
shutil.rmtree("tests", ignore_errors=True)
done()
