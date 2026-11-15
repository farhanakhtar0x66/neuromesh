A run on a Python project applied two `.pyc` files to the user's project. An agent's own `python` runs, and the project's checks, leave bytecode in `__pycache__` inside the task's work folder, and nothing keeps it out of the change that is handed back.

Expected:
- Everything Neuromesh starts for a Python task (agent turns, the project's checks, acceptance runs) gets `PYTHONDONTWRITEBYTECODE=1` in its environment: an agent request's `env.PYTHONDONTWRITEBYTECODE` is "1".
- Bytecode never enters a task's diff or the run's outcome files, even when a turn leaves some behind: no file ending in `.pyc` is among `state.outcome.files`.
- `ensureEnv(dir)` (src/engine/env.ts), which makes a Python work folder's own `.venv`, reports the paths to keep out of the diff in `outcome.folders`; it now lists `[".venv", "*.pyc"]`.

Tests are in test/python-bot-fixes.test.ts; the engine is in src/engine/run.ts.
