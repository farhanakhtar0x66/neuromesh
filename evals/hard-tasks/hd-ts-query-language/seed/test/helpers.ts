import { readFileSync } from "node:fs";
import { Store } from "../src/index.ts";
import type { Issue } from "../src/index.ts";

export const sample: Issue[] = JSON.parse(readFileSync(new URL("../data/issues.json", import.meta.url), "utf8")) as Issue[];

export const store = new Store(sample);

export const ids = (issues: Issue[]): number[] => issues.map((i) => i.id);
