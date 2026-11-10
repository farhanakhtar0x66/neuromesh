#!/usr/bin/env node
import { load, nextId, save } from "./store.js";

export function run(args, out = console.log, err = console.error) {
  const [command, ...rest] = args;
  const todos = load();
  switch (command) {
    case "add": {
      const todo = { id: nextId(todos), text: rest.join(" "), done: false };
      todos.push(todo);
      save(todos);
      out(`Added ${todo.id}: ${todo.text}`);
      return 0;
    }
    case "list":
      for (const t of todos) out(`${t.done ? "[x]" : "[ ]"} ${t.id} ${t.text}`);
      return 0;
    case "done": {
      const todo = todos.find((t) => t.id === Number(rest[0]));
      if (!todo) {
        err(`No todo with id ${rest[0]}`);
        return 1;
      }
      todo.done = true;
      save(todos);
      out(`Done ${todo.id}`);
      return 0;
    }
    default:
      err("usage: todo add <text> | list | done <id>");
      return 2;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = run(process.argv.slice(2));
}
