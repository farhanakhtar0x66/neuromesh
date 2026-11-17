"""Reading a log file."""

from __future__ import annotations


def read_lines(path: str) -> list[str]:
    """Every line of the file, decoded as UTF-8 (bad bytes become U+FFFD)."""
    with open(path, encoding="utf-8", errors="replace", newline="\n") as fh:
        return fh.readlines()
