import { createServer } from "node:http";

export const DEFAULT_PORT = 3000;

export function start(port = Number(process.env.PORT) || DEFAULT_PORT) {
  const server = createServer((req, res) => res.end("ok\n"));
  server.listen(port);
  return server;
}
