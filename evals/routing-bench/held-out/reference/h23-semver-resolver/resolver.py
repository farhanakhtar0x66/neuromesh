import operator

_OPS = [(">=", operator.ge), ("<=", operator.le), ("==", operator.eq), ("!=", operator.ne), (">", operator.gt), ("<", operator.lt)]


def _v(s):
    a, b, c = s.strip().split(".")
    return (int(a), int(b), int(c))


def _clauses(constraint):
    """Turn one constraint string into a list of (comparison, version) pairs."""
    out = []
    for part in constraint.split(","):
        part = part.strip()
        if not part:
            continue
        if part.startswith("^"):
            lo = _v(part[1:])
            if lo[0] > 0:
                hi = (lo[0] + 1, 0, 0)
            elif lo[1] > 0:
                hi = (0, lo[1] + 1, 0)
            else:
                out.append((operator.eq, lo))
                continue
            out += [(operator.ge, lo), (operator.lt, hi)]
            continue
        for sym, fn in _OPS:
            if part.startswith(sym):
                out.append((fn, _v(part[len(sym):])))
                break
        else:
            raise ValueError(f"bad constraint {part!r}")
    return out


def _ok(version, constraints):
    return all(fn(version, bound) for c in constraints for fn, bound in _clauses(c))


def resolve(root_reqs, registry):
    def constraints_for(assign):
        need = {p: [c] for p, c in root_reqs.items()}
        for p, ver in assign.items():
            for dep, c in registry[p][ver].items():
                need.setdefault(dep, []).append(c)
        return need

    def solve(assign):
        need = constraints_for(assign)
        for p, ver in assign.items():
            if not _ok(_v(ver), need.get(p, [])):
                return None
        open_ = sorted(p for p in need if p not in assign)
        if not open_:
            return dict(assign)
        pkg = open_[0]
        if pkg not in registry:
            return None
        for ver in sorted(registry[pkg], key=_v, reverse=True):
            if _ok(_v(ver), need[pkg]):
                assign[pkg] = ver
                found = solve(assign)
                if found is not None:
                    return found
                del assign[pkg]
        return None

    return solve({})
