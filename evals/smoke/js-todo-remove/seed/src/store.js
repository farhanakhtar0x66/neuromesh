// Todos are kept in a JSON file. TODO_FILE overrides the location.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

export function storePath() {
  return process.env.TODO_FILE ?? "todos.json";
}

export function load() {
  const path = storePath();
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : [];
}

export function save(todos) {
  writeFileSync(storePath(), JSON.stringify(todos, null, 2) + "\n");
}

export function nextId(todos) {
  return todos.reduce((max, t) => Math.max(max, t.id), 0) + 1;
}
