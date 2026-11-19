# Contributing

Contributions are welcome: fixes, presets measured on real work, backends,
improvements to the engine and the TUI.

## Before you start

- Read `CLAUDE.md`. It holds the working rules, and they apply to people too.
- Engine tests use the fake backend (`npm test`); `npx tsc --noEmit` must pass.
- Every new feature or change of behaviour gets an id in `src/features.ts`.
- Live model calls spend real subscription quota. Say so in your pull request
  if your change needs them to be checked.

## Your contribution's terms

Neuromesh is licensed under the MIT License (`LICENSE`). By opening a pull
request you agree that your contribution is licensed under the same MIT terms,
that you wrote it or have the right to submit it, and that it is given as it is,
with no warranty.
