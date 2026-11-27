// [F139 laya-gate] An in-process stand-in for laya-serve, for tests: a real HTTP server on a free local
// port whose answer each test sets (JSON, a status code, a delay, or raw text). No Laya, no network.

import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export interface MockReply {
  status?: number;
  /** Sent as JSON. */
  json?: unknown;
  /** Sent as is, instead of json. */
  raw?: string;
  /** Wait this long before answering. */
  delayMs?: number;
}

export interface MockLaya {
  url: string;
  /** Requests received: method, path, headers and parsed body. */
  requests: { method: string; path: string; headers: IncomingMessage["headers"]; body?: unknown }[];
  /** The reply to the ask path; health always answers 200 unless `health` is set. */
  reply: MockReply;
  health: MockReply;
  close(): Promise<void>;
}

/** A Laya 0.5 conformal answer for one question. */
export function conformal(id: string, value: boolean, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, type: "noul", noul: value ? "yes" : "no", route: "auto", abstain: false, prediction_set: [value ? "yes" : "no"], unbound: false, ...extra };
}

export async function startMockLaya(): Promise<MockLaya> {
  const timers = new Set<NodeJS.Timeout>();
  const mock = { requests: [], reply: { json: { answers: [] } }, health: { json: { ok: true } } } as unknown as MockLaya;
  const send = (res: ServerResponse, r: MockReply): void => {
    const go = (): void => {
      if (res.destroyed) return;
      res.writeHead(r.status ?? 200, { "content-type": "application/json" });
      res.end(r.raw ?? JSON.stringify(r.json ?? {}));
    };
    if (r.delayMs) {
      const t = setTimeout(() => {
        timers.delete(t);
        go();
      }, r.delayMs);
      timers.add(t);
    } else go();
  };
  const server: Server = createServer((req, res) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      let body: unknown;
      try {
        body = data ? JSON.parse(data) : undefined;
      } catch {
        body = data;
      }
      mock.requests.push({ method: req.method ?? "", path: req.url ?? "", headers: req.headers, body });
      send(res, req.url === "/health" ? mock.health : mock.reply);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  mock.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  mock.close = () =>
    new Promise<void>((resolve) => {
      for (const t of timers) clearTimeout(t);
      server.closeAllConnections();
      server.close(() => resolve());
    });
  return mock;
}
