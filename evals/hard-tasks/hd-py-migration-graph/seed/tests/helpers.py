"""Writing migration files for the tests."""

from __future__ import annotations

from pathlib import Path


def write_migration(folder: Path, migration_id: str, up: str, down: str | None = None, depends_on=None) -> None:
    lines = []
    if depends_on is not None:
        lines.append(f"DEPENDS_ON = {list(depends_on)!r}")
    lines += ["", "def up(conn):", *[f"    {s}" for s in up.splitlines()]]
    if down is not None:
        lines += ["", "def down(conn):", *[f"    {s}" for s in down.splitlines()]]
    (folder / f"{migration_id}.py").write_text("\n".join(lines) + "\n")
