import assert from "node:assert";
import test from "node:test";
import { createApp } from "../src/app.ts";

// Capture process.stdout.write so we can assert the log lines hono/logger
// emits. hono/logger's default printer is console.log, which writes to
// stdout. We monkey-patch process.stdout.write for the duration of the
// request and restore it in a finally block. This is the cleanest hook
// point: it catches both the "<--" inbound and the "-->" outbound log
// lines and works for any logger fn that ends up on stdout.
function captureStdout(): { read: () => string; restore: () => void } {
  const original = process.stdout.write.bind(process.stdout);
  let chunk = "";
  // process.stdout.write has overloads; the call signature we replace
  // accepts a string OR Uint8Array plus an optional encoding/cb. Cast
  // to the minimal signature to avoid TS overload mismatch.
  (process.stdout as { write: (s: string | Uint8Array) => boolean }).write = ((
    s: string | Uint8Array,
  ): boolean => {
    if (typeof s === "string") {
      chunk += s;
    } else if (s instanceof Uint8Array) {
      chunk += new TextDecoder().decode(s);
    }
    return true;
  }) as typeof process.stdout.write;
  return {
    read: () => chunk,
    restore: () => {
      (process.stdout as { write: typeof original }).write = original;
    },
  };
}

// `c.res` is the typed response view added for Hono compat (issue #57):
// `.status` reads through the sink on both surfaces, so hono/logger's
// outbound `-->` line prints the real status code after `await next()`.

test("hono/logger prints the inbound <-- line on a 200 response", async () => {
  const app = createApp();
  const cap = captureStdout();
  try {
    const res = await app.fetch(new Request("http://localhost/"));
    assert.equal(res.status, 200);
    await res.text();
  } finally {
    cap.restore();
  }
  const out = cap.read().replace(/\x1b\[\d+m/g, "");
  // The inbound line proves c.req.url is populated and that
  // app.use('*', mw) is honored by chttp's middleware chain. Both
  // landed in this PR.
  assert.match(out, /<-- GET \//, "expected inbound log line, got: " + out);
});

test("hono/logger outbound --> line (c.res.status on fetch path)", async () => {
  const app = createApp();
  const cap = captureStdout();
  try {
    const res = await app.fetch(new Request("http://localhost/"));
    assert.equal(res.status, 200);
    await res.text();
  } finally {
    cap.restore();
  }
  const out = cap.read();
  assert.match(out.replace(/\x1b\[\d+m/g, ""), /--> GET \/\s*200\b/, "expected outbound log line with 200, got: " + out);
});

test("hono/logger outbound --> line for 404 (c.res.status on fetch path)", async () => {
  const app = createApp();
  const cap = captureStdout();
  try {
    const res = await app.fetch(new Request("http://localhost/missing"));
    assert.equal(res.status, 404);
    await res.text();
  } finally {
    cap.restore();
  }
  const out = cap.read();
  assert.match(out.replace(/\x1b\[\d+m/g, ""), /--> GET \/missing\s*404\b/, "expected 404 in outbound log, got: " + out);
});