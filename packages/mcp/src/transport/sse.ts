// SSE frame encoding. Pure string shaping — no async generators, no stream
// primitives; the transport decides how frames reach the wire. Modeled on
// @chttp/stream's encoder (same oneLine/prefixLines rules).

// Drops CR and LF so a field value (event, id) can never inject a new line.
function oneLine(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const cc = s.charCodeAt(i);
    if (cc !== 10 && cc !== 13) {
      out += s.charAt(i);
    }
  }
  return out;
}

// Prefixes every line of s (split on LF, CRLF or CR) with `prefix` and ends
// each with LF. The tail after the last separator is always emitted, so an
// empty s yields a trailing empty line, as the SSE spec's line splitting does.
function prefixLines(prefix: string, s: string): string {
  let out = "";
  let start = 0;
  const n = s.length;
  let i = 0;
  while (i < n) {
    const cc = s.charCodeAt(i);
    if (cc === 10 || cc === 13) {
      out += prefix + s.slice(start, i) + "\n";
      if (cc === 13 && i + 1 < n && s.charCodeAt(i + 1) === 10) {
        i++;
      }
      start = i + 1;
    }
    i++;
  }
  out += prefix + s.slice(start, n) + "\n";
  return out;
}

// One event frame: optional id/event lines, then multi-line data, then the
// blank terminator. v1 emits no `id:` (no resumability — see
// docs/streamable-http-coverage.md); the parameter exists for completeness.
export function encodeSseEvent(data: string, event: string | null, id: string | null): string {
  let frame = "";
  if (id !== null) {
    frame += "id: " + oneLine(id) + "\n";
  }
  if (event !== null) {
    frame += "event: " + oneLine(event) + "\n";
  }
  frame += prefixLines("data: ", data) + "\n";
  return frame;
}

// A comment line (": text"), commonly used as a keep-alive ping.
export function encodeSseComment(text: string): string {
  return prefixLines(": ", text) + "\n";
}

// Asks the client to wait ms before reconnecting. Non-numeric and negative
// values clamp to 0 so the field can never carry garbage.
export function encodeSseRetry(ms: number): string {
  const v = Math.max(0, Math.floor(Number(ms) || 0));
  return "retry: " + String(v) + "\n\n";
}
