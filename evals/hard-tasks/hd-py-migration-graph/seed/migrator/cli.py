"""python -m migrator [--db FILE] [--dir DIR] COMMAND"""

from __future__ import annotations

import argparse
import sys

from .errors import MigrationError
from .runner import Migrator


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="migrator")
    parser.add_argument("--db", default="app.db")
    parser.add_argument("--dir", default="migrations")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("migrate")
    sub.add_parser("status")
    return parser


def main(argv: list[str] | None = None, out=None, err=None) -> int:
    out = out or sys.stdout
    err = err or sys.stderr
    args = build_parser().parse_args(argv)
    migrator = Migrator(args.db, args.dir)
    try:
        if args.command == "migrate":
            applied = migrator.migrate()
            for migration_id in applied:
                print(f"applied {migration_id}", file=out)
            if not applied:
                print("nothing to apply", file=out)
        elif args.command == "status":
            rows = migrator.status()
            for migration_id, is_applied in rows:
                print(f"[{'x' if is_applied else ' '}] {migration_id}", file=out)
            if not rows:
                print("no migrations", file=out)
    except MigrationError as exc:
        print(f"error: {exc}", file=err)
        return 1
    return 0
