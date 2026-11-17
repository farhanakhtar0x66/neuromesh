"""python -m logstats FILE"""

from __future__ import annotations

import argparse
import sys

from .analysis import analyze
from .reader import read_lines
from .render import render


def main(argv: list[str] | None = None, stdout=None, stderr=None) -> int:
    stdout = stdout or sys.stdout
    stderr = stderr or sys.stderr
    parser = argparse.ArgumentParser(prog="logstats")
    parser.add_argument("file", help="the access log")
    args = parser.parse_args(argv)
    try:
        lines = read_lines(args.file)
    except OSError as exc:
        print(f"logstats: cannot open {args.file}: {exc.strerror}", file=stderr)
        return 2
    stdout.write(render(analyze(lines)))
    return 0
