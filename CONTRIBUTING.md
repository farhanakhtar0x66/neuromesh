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

Neuromesh is source-available under the PolyForm Shield License 1.0.0 (`LICENSE`).
So that the project can keep one license, and change it later if that becomes
right, every contribution is made on these terms. Opening a pull request means
you agree to them.

1. You wrote the contribution, or have the right to submit it, and it is not
   under terms that conflict with these.
2. You keep the copyright in your contribution.
3. You give Farhan Akhtar a perpetual, worldwide, non-exclusive, royalty-free,
   irrevocable license to use, copy, change, distribute and sublicense your
   contribution, and to license it under other terms, as part of Neuromesh or
   otherwise.
4. Your contribution is given as it is, with no warranty.

Add this line to your first commit message, or say it in the pull request:

    I agree to the contribution terms in CONTRIBUTING.md.

This is a plain agreement, not legal advice. If your employer has rights in
your work, make sure you may contribute it.
