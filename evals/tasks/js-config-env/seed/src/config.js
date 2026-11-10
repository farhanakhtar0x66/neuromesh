import { existsSync, readFileSync } from "node:fs";

export const DEFAULTS = {
  port: 3000,
  host: "localhost",
  logLevel: "info",
  maxRetries: 3,
  verbose: false,
};

/** Defaults, overridden by a JSON file when it exists. */
export function loadConfig(path = "config.json") {
  const fromFile = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
  return { ...DEFAULTS, ...fromFile };
}
