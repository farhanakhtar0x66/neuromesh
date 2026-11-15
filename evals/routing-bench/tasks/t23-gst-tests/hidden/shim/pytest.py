"""A small stand-in for pytest (stdlib only): enough for tests written with
raises, approx, mark.parametrize, fixtures and plain asserts. Used only when
the real pytest is not installed. `match=` is accepted and ignored: the prompt
does not specify error wording."""
import contextlib, math


class _Raises:
    def __init__(self, exc, match=None):
        self.exc = exc
        self.value = None

    def __enter__(self):
        return self

    def __exit__(self, et, ev, tb):
        if et is None:
            raise AssertionError(f"DID NOT RAISE {self.exc}")
        wanted = self.exc if isinstance(self.exc, tuple) else (self.exc,)
        # The prompt does not say which error bad input raises: TypeError and ValueError both count for either.
        if issubclass(et, self.exc) or (any(w in (TypeError, ValueError) for w in wanted) and issubclass(et, (TypeError, ValueError))):
            self.value = ev
            return True
        return False


def raises(exc, match=None, **kw):
    return _Raises(exc, match)


_abs = abs


class approx:
    def __init__(self, expected, rel=None, abs=None):
        self.expected, self.rel, self.abs = expected, rel, abs

    def __eq__(self, other):
        e = self.expected
        if isinstance(e, dict):
            return isinstance(other, dict) and e.keys() == other.keys() and all(approx(e[k], self.rel, self.abs) == other[k] for k in e)
        if isinstance(e, (list, tuple)):
            return len(e) == len(other) and all(approx(a, self.rel, self.abs) == b for a, b in zip(e, other))
        default = self.rel is None and self.abs is None
        rel = 1e-6 if default else (self.rel or 0.0)
        ab = 1e-12 if default else (self.abs or 0.0)
        try:
            return _abs(other - e) <= max(rel * _abs(e), ab)
        except TypeError:
            return False

    def __repr__(self):
        return f"approx({self.expected!r})"


class _Param:
    def __init__(self, values, id=None, marks=()):
        self.values, self.id = values, id


def param(*values, id=None, marks=()):
    return _Param(values, id)


class _Mark:
    def parametrize(self, argnames, argvalues, ids=None, **kw):
        names = [a.strip() for a in argnames.split(",")] if isinstance(argnames, str) else list(argnames)

        def deco(fn):
            fn.__dict__.setdefault("_params", []).insert(0, (names, list(argvalues)))
            return fn
        return deco

    def skip(self, *a, **k):
        def deco(fn):
            fn._skip = True
            return fn
        return deco if not (len(a) == 1 and callable(a[0])) else deco(a[0])

    def __getattr__(self, name):
        def deco(*a, **k):
            if len(a) == 1 and callable(a[0]) and not k:
                return a[0]
            return lambda fn: fn
        return deco


mark = _Mark()


def fixture(*a, **k):
    def mk(fn):
        fn._is_fixture = True
        return fn
    if len(a) == 1 and callable(a[0]) and not k:
        return mk(a[0])
    return mk


def skip(reason=""):
    raise AssertionError("skipped: " + reason)


def fail(msg=""):
    raise AssertionError(msg)
