import pathlib
from csvline import split_line

cases = [
    ("a,b,c", ["a", "b", "c"]),
    ('a,"b,c",d', ["a", "b,c", "d"]),
    ('"he said ""hi""",x', ['he said "hi"', "x"]),
    ("", [""]),
    ("a,,b", ["a", "", "b"]),
    ('"",x', ["", "x"]),
    ('one,"two, three, four"', ["one", "two, three, four"]),
    ("trailing,", ["trailing", ""]),
]
for line, want in cases:
    got = split_line(line)
    assert got == want, (line, got, want)
assert "import csv" not in pathlib.Path("csvline.py").read_text()
print("hidden check passed")
