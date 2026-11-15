in `resolver.py` (pure Python 3 stdlib), implement:
`def resolve(root_reqs: dict[str, str], registry: dict[str, dict[str, dict[str, str]]]) -> dict[str, str] | None`
`registry[pkg][version]` maps transitive dependency package names to constraint strings.
Constraint strings are comma-separated clauses supporting `>=`, `<=`, `>`, `<`, `==`, `!=`, and `^` (Cargo/npm caret rules: `^1.2.3` => `>=1.2.3,<2.0.0`; `^0.2.3` => `>=0.2.3,<0.3.0`; `^0.0.3` => `==0.0.3`). Versions are standard `MAJOR.MINOR.PATCH` integers.
Return a dict mapping every required package (root + transitive of the chosen versions) to a single resolved version string that satisfies all active constraints simultaneously.
When multiple versions of a package are valid, prefer higher SemVer versions first, exploring unresolved packages in lexicographical order of package name, and backtrack when a higher version leads to a transitive conflict. Return `None` if no valid assignment exists.
