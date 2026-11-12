// [F27 tui-diff-numbers] A unified diff as display rows: a header per file and
// each line with its old and new line numbers, for the stream and the diff view.

export interface DiffRow {
  kind: "file" | "hunk" | "add" | "del" | "ctx" | "meta";
  text: string;
  old?: number;
  new?: number;
}

export function diffRows(lines: string[]): DiffRow[] {
  const rows: DiffRow[] = [];
  let oldNo = 0;
  let newNo = 0;
  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      const m = / b\/(.+)$/.exec(line);
      rows.push({ kind: "file", text: m ? m[1]! : line.slice(11) });
      continue;
    }
    if (line.startsWith("@@")) {
      const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(line);
      if (m) {
        oldNo = Number(m[1]);
        newNo = Number(m[2]);
        rows.push({ kind: "hunk", text: m[3]!.trim() });
      } else rows.push({ kind: "hunk", text: line });
      continue;
    }
    if (/^(index |--- |\+\+\+ |new file mode|deleted file mode|similarity |rename |old mode|new mode|Binary files)/.test(line)) {
      if (line.startsWith("new file mode")) rows.push({ kind: "meta", text: "new file" });
      else if (line.startsWith("deleted file mode")) rows.push({ kind: "meta", text: "deleted" });
      else if (line.startsWith("Binary files")) rows.push({ kind: "meta", text: "binary file" });
      continue;
    }
    if (line.startsWith("+")) rows.push({ kind: "add", text: line.slice(1), new: newNo++ });
    else if (line.startsWith("-")) rows.push({ kind: "del", text: line.slice(1), old: oldNo++ });
    else if (line.startsWith("\\")) rows.push({ kind: "meta", text: line.slice(2) });
    else if (line !== "" || oldNo > 0) rows.push({ kind: "ctx", text: line.slice(1), old: oldNo++, new: newNo++ });
  }
  return rows;
}

/** Width of the line-number gutter for these rows. */
export function gutterWidth(rows: DiffRow[]): number {
  let max = 1;
  for (const r of rows) max = Math.max(max, r.old ?? 0, r.new ?? 0);
  return String(max).length;
}
