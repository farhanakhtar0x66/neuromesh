// RFC 4180 streaming CSV parser: a character state machine that keeps its state between chunks.
const START = 0; // at the start of a field
const PLAIN = 1; // inside an unquoted field
const QUOTED = 2; // inside a quoted field
const QUOTE_IN_QUOTED = 3; // just saw a quote inside a quoted field: an escape or the closing quote
const AFTER_CLOSE = 4; // after a closing quote: only a comma or a line end may follow

export async function* parseCsvStream(chunks) {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let state = START;
  let field = "";
  let row = [];
  let sawCR = false; // the previous character was a CR that ended a record
  const endField = () => { row.push(field); field = ""; };

  for await (const chunk of chunks) {
    const text = typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
    for (const ch of text) {
      if (sawCR) {
        sawCR = false;
        if (ch === "\n") continue;
      }
      switch (state) {
        case START:
        case PLAIN:
        case AFTER_CLOSE:
          if (ch === ",") { endField(); state = START; }
          else if (ch === "\n" || ch === "\r") {
            endField(); const r = row; row = []; state = START; sawCR = ch === "\r"; yield r;
          } else if (ch === '"') {
            if (state !== START) throw new SyntaxError("unescaped quote in a field");
            state = QUOTED;
          } else {
            if (state === AFTER_CLOSE) throw new SyntaxError("text after a closing quote");
            field += ch; state = PLAIN;
          }
          break;
        case QUOTED:
          if (ch === '"') state = QUOTE_IN_QUOTED; else field += ch;
          break;
        case QUOTE_IN_QUOTED:
          if (ch === '"') { field += '"'; state = QUOTED; }
          else {
            state = AFTER_CLOSE;
            if (ch === ",") { endField(); state = START; }
            else if (ch === "\n" || ch === "\r") {
              endField(); const r = row; row = []; state = START; sawCR = ch === "\r"; yield r;
            } else throw new SyntaxError("text after a closing quote");
          }
          break;
      }
    }
  }
  const tail = decoder.decode();
  if (tail) throw new SyntaxError("incomplete UTF-8 at end of input");
  if (state === QUOTED) throw new SyntaxError("unclosed quoted field at end of input");
  if (state !== START || field !== "" || row.length > 0) { endField(); yield row; }
}
