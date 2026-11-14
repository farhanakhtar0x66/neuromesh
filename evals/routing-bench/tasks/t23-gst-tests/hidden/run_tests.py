"""Run a pytest-style test file against one implementation. Usage:
    python3 run_tests.py <dir holding the test file and the answer's helper files> <variant> <mutant|->
Prints one JSON object on the last line."""
import ast, contextlib, importlib.abc, importlib.util, io, itertools, json, os, sys, traceback, types

HERE = os.path.dirname(os.path.abspath(__file__))
work, variant, mutant = sys.argv[1], sys.argv[2], (None if sys.argv[3] == "-" else sys.argv[3])
sys.path.insert(0, os.path.join(HERE, "shim"))
sys.path.insert(0, work)
sys.path.insert(1, HERE)
import gst_impl  # noqa: E402

fn = gst_impl.make(variant, mutant)


class Serve(importlib.abc.MetaPathFinder, importlib.abc.Loader):
    """Serve the implementation under whatever module name the tests import it from."""
    def __init__(self, names):
        self.names = names

    def find_spec(self, name, path=None, target=None):
        # last in sys.meta_path: reached only for a module nothing else provides
        if name in self.names or "." not in name:
            return importlib.util.spec_from_loader(name, self)

    def create_module(self, spec):
        m = types.ModuleType(spec.name)
        m.calculate_gst_split = fn
        return m

    def exec_module(self, module):
        pass


provided = set()
for f in os.listdir(work):
    if f.endswith(".py") and not f.startswith("test_"):
        try:
            tree = ast.parse(open(os.path.join(work, f)).read())
        except Exception:
            continue
        if any(isinstance(n, ast.FunctionDef) and n.name == "calculate_gst_split" for n in tree.body):
            provided.add(f[:-3])
            os.rename(os.path.join(work, f), os.path.join(work, f + ".answer-impl"))
# modules the tests import that do not exist: assume they are the implementation's home
sys.meta_path.append(Serve(provided))


result = {"collected": 0, "passed": 0, "failed": [], "failed_ids": [], "error": None}
try:
    spec = importlib.util.spec_from_file_location("answer_tests", os.path.join(work, "test_gst.py"))
    mod = importlib.util.module_from_spec(spec)
    sys.modules["answer_tests"] = mod
    spec.loader.exec_module(mod)
except BaseException as e:
    result["error"] = "".join(traceback.format_exception_only(type(e), e)).strip()[:300]
    print(json.dumps(result)); sys.exit(0)


class _Cap:
    def __init__(self):
        self.out = io.StringIO()
    def readouterr(self):
        v = self.out.getvalue(); self.out.seek(0); self.out.truncate()
        return types.SimpleNamespace(out=v, err="")


def build_args(f, bound, fixtures):
    import inspect
    args = dict(bound)
    cleanup = []
    for p in inspect.signature(f).parameters:
        if p in args or p == "self":
            continue
        if p == "capsys":
            c = _Cap(); cm = contextlib.redirect_stdout(c.out); cm.__enter__(); cleanup.append(lambda cm=cm: cm.__exit__(None, None, None)); args[p] = c
        elif p == "tmp_path":
            import pathlib, tempfile; args[p] = pathlib.Path(tempfile.mkdtemp())
        elif p in fixtures:
            args[p] = fixtures[p]()
        else:
            raise AssertionError(f"unsupported fixture {p!r}")
    return args, cleanup


fixtures = {n: v for n, v in vars(mod).items() if getattr(v, "_is_fixture", False)}
cases = []
for name, obj in vars(mod).items():
    if name.startswith("test_") and callable(obj):
        cases.append((name, obj, None))
    elif name.startswith("Test") and isinstance(obj, type):
        for m in dir(obj):
            if m.startswith("test_"):
                cases.append((f"{name}.{m}", getattr(obj(), m), None))


def expand(f):
    groups = getattr(f, "_params", [])
    if not groups:
        yield {}
        return
    per = []
    for names, values in groups:
        opts = []
        for v in values:
            vals = v.values if hasattr(v, "values") else v
            if len(names) == 1 and not hasattr(v, "values"):
                vals = (v,)
            opts.append(dict(zip(names, vals)))
        per.append(opts)
    for combo in itertools.product(*per):
        merged = {}
        for c in combo:
            merged.update(c)
        yield merged


for name, f, _ in cases:
    if getattr(f, "_skip", False):
        continue
    for bound in expand(f):
        result["collected"] += 1
        cleanup = []
        try:
            args, cleanup = build_args(f, bound, fixtures)
            f(**args)
            result["passed"] += 1
        except BaseException as e:
            result["failed"].append(f"{name}: {type(e).__name__}: {str(e)[:80]}")
            result["failed_ids"].append(f"{name}[{sorted(bound.items())!r}]")
        finally:
            for c in cleanup:
                c()
result["failed"] = result["failed"][:5]
print(json.dumps(result))
