// A scripted backend for tests. It makes no model calls and spends no quota.

import type { AgentBackend, AgentRequest, AgentResult } from "./types.ts";

export type FakeScript = (request: AgentRequest, callIndex: number) => Partial<AgentResult> | Promise<Partial<AgentResult>>;

export interface FakeBackend extends AgentBackend {
  /** Every request this backend has received, in order. */
  calls: AgentRequest[];
}

export function createFakeBackend(script: FakeScript, id = "fake"): FakeBackend {
  const calls: AgentRequest[] = [];
  return {
    id,
    displayName: "Fake",
    calls,
    version: async () => "fake-1",
    async run(request: AgentRequest): Promise<AgentResult> {
      const started = Date.now();
      const index = calls.length;
      calls.push(request);
      const base = (partial: Partial<AgentResult>): AgentResult => ({
        stop: "done",
        finalText: "",
        usage: {},
        exitCode: 0,
        sessionId: `fake-session-${index}`,
        model: request.model,
        ...partial,
        durationMs: Date.now() - started,
      });

      const cancelled = new Promise<Partial<AgentResult>>((resolve) => {
        if (request.signal?.aborted) resolve({ stop: "cancelled", exitCode: null });
        request.signal?.addEventListener("abort", () => resolve({ stop: "cancelled", exitCode: null }), {
          once: true,
        });
      });
      let timer: NodeJS.Timeout | undefined;
      const timedOut = new Promise<Partial<AgentResult>>((resolve) => {
        timer = setTimeout(() => resolve({ stop: "timeout", exitCode: null }), request.timeoutMs);
      });
      try {
        const outcome = await Promise.race([Promise.resolve(script(request, index)), cancelled, timedOut]);
        return base(outcome);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
