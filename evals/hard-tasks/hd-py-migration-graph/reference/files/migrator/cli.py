"""python -m migrator [--db FILE] [--dir DIR] [--lock-max-age SECONDS] COMMAND"""

from __future__ import annotations

import argparse
import sys

from .errors import MigrationError
from .runner import Migrator


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="migrator")
    parser.add_argument("--db", default="app.db")
    parser.add_argument("--dir", default="migrations")
    parser.add_argument("--lock-max-age", type=float, default=600.0, metavar="SECONDS")
    sub = parser.add_subparsers(dest="command", required=True)
    p_migrate = sub.add_parser("migrate")
    p_migrate.add_argument("--to", metavar="ID")
    sub.add_parser("status")
    p_rollback = sub.add_parser("rollback")
    p_rollback.add_argument("id")
    p_plan = sub.add_parser("plan")
    group = p_plan.add_mutually_exclusive_group()
    group.add_argument("--to", metavar="ID")
    group.add_argument("--rollback", metavar="ID")
    return parser


def main(argv: list[str] | None = None, out=None, err=None) -> int:
    out = out or sys.stdout
    err = err or sys.stderr
    args = build_parser().parse_args(argv)
    migrator = Migrator(args.db, args.dir, lock_max_age=args.lock_max_age)
    try:
        if args.command == "migrate":
            applied = migrator.migrate(to=args.to)
            for migration_id in applied:
                print(f"applied {migration_id}", file=out)
            if not applied:
                print("nothing to apply", file=out)
        elif args.command == "rollback":
            for migration_id in migrator.rollback(args.id):
                print(f"reverted {migration_id}", file=out)
        elif args.command == "plan":
            print(migrator.plan(to=args.to, rollback=args.rollback), file=out)
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
