// [F95 stub-gate] A free, deterministic check on the lines a developer added:
// code that stands in for an implementation instead of being one. Cheaper
// models pass syntax checks and thin tests this way (`unimplemented!()`,
// `raise NotImplementedError`, a `TODO: implement` over an empty body).
//
// Only unambiguous markers count. A plain `TODO`, a `mock_` name or an empty
// arrow callback is often legitimate, so none of them is a stub here; nor is
// anything in a test file, or an abstract method that is meant to be empty.

export interface Stub {
  file: string;
  line: number;
  text: string;
}

const CODE = /\.(?:[cm]?[jt]sx?|py|rs|go|java|kt|rb|php|c|cc|cpp|h|hpp|cs|swift)$/i;
const TEST = /(^|\/)(tests?|__tests__|spec|specs|fixtures?|examples?)\/|[._-](test|spec)s?\.[^/]+$|(^|\/)test_[^/]+$|_test\.go$/i;

const MARKERS: RegExp[] = [
  /\bunimplemented!\s*\(/, // Rust
  /\btodo!\s*\(/, // Rust
  /\braise\s+NotImplementedError\b/, // Python
  /\bthrow\s+new\s+\w*Error\s*\(\s*["'`]\s*not\s+(yet\s+)?implemented\b/i, // JS, TS, Java, C#
  /\bpanic\s*\(\s*["'`]\s*(not\s+(yet\s+)?implemented|todo|unimplemented)\b/i, // Go
  /\b(TODO|FIXME|XXX)\b[:\s-]*\(?\s*(implement|fill (this )?in|write (the )?(real )?(logic|implementation))\b/i,
  /\b(implement(ation)?|real logic) (goes )?here\b/i,
  /\bplaceholder implementation\b/i,
];
/** Decorators and markers that mean an empty body is the design (an abstract method, an overload, an interface). */
const MEANT_EMPTY = /@(abc\.)?abstract\w*|@overload|@typing\.overload|\bProtocol\b|\bABC\b|\binterface\b|\babstract\b/;

/** Stubs in the added lines of a unified diff (git's patch format). */
export function findStubs(patch: string): Stub[] {
  const found: Stub[] = [];
  let file: string | undefined;
  let line = 0;
  // Recent lines of the new file (added or context), for the "meant to be empty" look-back.
  let recent: string[] = [];
  for (const raw of patch.split("\n")) {
    if (raw.startsWith("+++ ")) {
      const path = raw.slice(4).replace(/^b\//, "").trim();
      file = path === "/dev/null" || !CODE.test(path) || TEST.test(path) ? undefined : path;
      recent = [];
      continue;
    }
    const hunk = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
    if (hunk) {
      line = Number(hunk[1]);
      recent = [];
      continue;
    }
    if (raw.startsWith("-") || raw.startsWith("\\")) continue;
    if (!raw.startsWith("+") && !raw.startsWith(" ")) continue;
    const text = raw.slice(1);
    const added = raw.startsWith("+");
    if (file && added && !MEANT_EMPTY.test(recent.slice(-4).join("\n"))) {
      if (MARKERS.some((re) => re.test(text))) found.push({ file, line, text: text.trim().slice(0, 160) });
      // A Python function whose whole body is `pass` or `...`.
      else if (/^\s*(pass|\.\.\.)\s*(#.*)?$/.test(text) && /^\s*(async\s+)?def\s.+:\s*(#.*)?$/.test(recent.at(-1) ?? "")) {
        found.push({ file, line, text: `${(recent.at(-1) ?? "").trim()} ${text.trim()}`.slice(0, 160) });
      }
    }
    recent.push(text);
    if (recent.length > 8) recent.shift();
    line++;
  }
  return found;
}

/** What the developer is told when the gate fails. */
export function describeStubs(stubs: Stub[]): string {
  const shown = stubs.slice(0, 12).map((s) => `${s.file}:${s.line}: ${s.text}`);
  const more = stubs.length > shown.length ? `\n(and ${stubs.length - shown.length} more)` : "";
  return `The work leaves stand-ins where the implementation should be:\n${shown.join("\n")}${more}\nWrite the real implementation in each place (or remove the code if it is not needed). If a part is beyond you, say so in your report rather than leaving a stand-in.`;
}
