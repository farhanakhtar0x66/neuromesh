import os, re, sys, json, ast, subprocess
ITEMS = []
def item(name, ok):
    ITEMS.append((name, bool(ok)))
def read(path):
    try:
        return open(path, encoding="utf-8").read()
    except Exception:
        return None
def done():
    passed = sum(1 for _, ok in ITEMS if ok)
    for name, ok in ITEMS:
        print(("PASS " if ok else "FAIL ") + name)
    print(f"SCORE {passed}/{len(ITEMS)}")
    sys.exit(0 if passed == len(ITEMS) else 1)
def answer_text():
    return read("ANSWER.md") or ""
def has(text, *patterns):
    return all(re.search(p, text or "", re.I | re.S) for p in patterns)
def anyof(text, *patterns):
    return any(re.search(p, text or "", re.I | re.S) for p in patterns)

t = answer_text(); item("ANSWER.md exists", bool(t.strip()))
item("separates idempotent/pure nodes from non-idempotent side effects", has(t, r"idempoten", r"non[- ]idempoten|side[- ]effect"))
item("fencing tokens (monotonic)", has(t, r"fenc"))
item("leases or quorum before a side effect commits", anyof(t, r"lease", r"quorum"))
item("optimistic / CRDT execution for pure nodes", anyof(t, r"CRDT", r"optimistic"))
item("state machine with transition rules", has(t, r"(state|transition)") and len(re.findall(r"(->|→|=>)", t)) >= 3)
item("wire message structs", len(re.findall(r"\b(struct|message|interface|type)\s+\w+\s*\{", t, re.I)) >= 2)
item("handles partition mid-execution", has(t, r"partition"))
item("no central coordinator", anyof(t, r"no central", r"without a (central )?coordinator", r"leaderless", r"decentrali"))

done()
