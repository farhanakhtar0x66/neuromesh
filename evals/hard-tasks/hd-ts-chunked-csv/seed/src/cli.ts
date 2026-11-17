// csvstream import <file|-> [--delimiter <c>] [--quote <c>] [--header] [--skip-empty] [--chunk-size <bytes>]
//
// Reads the file (or standard input for "-") as a stream and writes one JSON line per record to standard output.
// "imported N records" goes to standard error. Exit status: 0 done, 1 bad input (CsvError), 2 bad usage.

import { createReadStream } from "node:fs";
import { once } from "node:events";
import { CsvError } from "./errors.ts";
import { readCsv } from "./reader.ts";
import type { CsvOptions } from "./options.ts";

const USAGE = "usage: csvstream import <file|-> [--delimiter <c>] [--quote <c>] [--header] [--skip-empty] [--chunk-size <bytes>]";

interface Parsed {
  file: string;
  options: CsvOptions;
  chunkSize: number;
}

export function parseArgs(argv: string[]): Parsed | string {
  const [command, file, ...rest] = argv;
  if (command !== "import" || !file) return USAGE;
  const options: CsvOptions = {};
  let chunkSize = 64 * 1024;
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i]!;
    if (flag === "--header") options.header = true;
    else if (flag === "--skip-empty") options.skipEmptyLines = true;
    else if (flag === "--delimiter" || flag === "--quote" || flag === "--chunk-size") {
      const value = rest[++i];
      if (value === undefined) return `${flag} needs a value`;
      if (flag === "--delimiter") options.delimiter = value === "tab" ? "\t" : value;
      else if (flag === "--quote") options.quote = value;
      else {
        chunkSize = Number(value);
        if (!Number.isInteger(chunkSize) || chunkSize < 1) return "--chunk-size must be a positive integer";
      }
    } else return `unknown option ${flag}`;
  }
  return { file, options, chunkSize };
}

export async function run(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv);
  if (typeof parsed === "string") {
    process.stderr.write(`${parsed}\n`);
    return 2;
  }
  const source = parsed.file === "-" ? process.stdin : createReadStream(parsed.file, { highWaterMark: parsed.chunkSize });
  let count = 0;
  try {
    for await (const row of readCsv(source, parsed.options)) {
      count++;
      if (!process.stdout.write(`${JSON.stringify(row)}\n`)) await once(process.stdout, "drain");
    }
  } catch (e) {
    if (e instanceof CsvError) {
      process.stderr.write(`csvstream: ${e.message}\n`);
      return 1;
    }
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      process.stderr.write(`csvstream: cannot read ${parsed.file}\n`);
      return 2;
    }
    throw e;
  }
  process.stderr.write(`imported ${count} records\n`);
  return 0;
}

if (import.meta.main) process.exitCode = await run(process.argv.slice(2));
