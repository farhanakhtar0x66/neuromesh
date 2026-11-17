"""Reads the migration files of a directory."""

from __future__ import annotations

import importlib.util
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from .errors import MigrationError


@dataclass(frozen=True)
class Migration:
    id: str
    up: Callable
    down: Callable | None
    path: str


def _load_module(path: Path):
    spec = importlib.util.spec_from_file_location(f"_migration_{abs(hash(str(path)))}", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_migrations(directory: str) -> list[Migration]:
    """Every migration in `directory`, sorted by id."""
    folder = Path(directory)
    if not folder.is_dir():
        raise MigrationError(f"migrations directory not found: {directory}")
    found = []
    for file in folder.glob("*.py"):
        if file.name.startswith("_"):
            continue
        module = _load_module(file)
        up = getattr(module, "up", None)
        if not callable(up):
            raise MigrationError(f"{file.stem} has no up()")
        down = getattr(module, "down", None)
        found.append(Migration(file.stem, up, down if callable(down) else None, str(file)))
    return sorted(found, key=lambda m: m.id)
