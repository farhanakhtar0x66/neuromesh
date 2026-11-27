# v0.4 build rules

Prepended to every v0.4 stage prompt. Work happens in a worktree branched from
`neuromesh-research`; live-model testing comes in a later phase.

## Role and working contract

You are building NeuroMesh v0.4 inside a git worktree branched from
`neuromesh-research`. Your goal: implement the requested stage cleanly,
atomically, and fail-safely WITHOUT running any live LLM API/CLI evals
(testing against live models happens in a later phase).

## Hard invariants (never violate)

1. **Branch and defaults.** Never touch `neuromesh-testing`. Keep
   `cascade-claude` as the unchanged default preset; all new orchestration
   lives behind new feature IDs (starting at F136) and a new opt-in preset
   (`temporal-claude`).
2. **Zero live quota burn.** Never invoke real `claude` or `agy` CLIs.
   Validate exclusively with `npx tsc --noEmit`, `npm test`, fake/mock
   adapters (`--fake`), and the chaos fault harness.
3. **Preserve hard-won empirical laws.**
   - F109: any request-level inspection MUST read `state.request` (user text),
     NEVER `state.prompt` (which includes brief wrappers).
   - F131: handoffs between models carry FACTS ONLY (verified test command,
     raw output, exact `file:line` pointers). NEVER pass a cheaper model's
     diagnosis, hypothesis, plan, or transcript to a stronger model.
   - F132: NEVER inject defensive rules like "behaviour the request does not
     mention must stay as it is" into solver prompts.
   - Telemetry guard: respect `NODE_TEST_CONTEXT` so tests never hit the
     Cloudflare telemetry worker (`src/telemetry/telemetry.ts`).
   - License hygiene (MIT): never add noncommercial packages (e.g.
     `vegaml-learn`) to `package.json` or require them at runtime. Laya
     integration is a zero-dependency TypeScript HTTP client to a local
     optional sidecar.
4. **Read before writing.** Inspect existing files (`src/features.ts`,
   `docs/10-features.md`, `src/routing/router.ts`, K6 dossier code, fault
   harness rules in `test/support/chaos.ts`) before modifying anything. Do not
   invent file paths or helper names.
5. **Exit gate required before finishing.** Run and report exact outputs of:
   - `npx tsc --noEmit`
   - `npm test` (all existing 373+ tests plus new unit tests must pass)
   - `node evals/chaos.ts --seeds 1000`
   - `node evals/chaos.ts --kill 1 --seeds 400`

   Update `src/features.ts` and `docs/10-features.md` with the exact new
   feature IDs. Commit atomically.
