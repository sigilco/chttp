// SSE frame encoding — event/data/id/comment/retry formats.
import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeSseComment, encodeSseEvent, encodeSseRetry } from "../dist/esm/index.js";

test("data-only frame", () => {
  assert.equal(encodeSseEvent("hello", null, null), "data: hello\n\n");
});

test("event + id lines precede data", () => {
  assert.equal(encodeSseEvent("x", "progress", "9"), "id: 9\nevent: progress\ndata: x\n\n");
});

test("multi-line data becomes several data: lines", () => {
  assert.equal(encodeSseEvent("a\nb\nc", null, null), "data: a\ndata: b\ndata: c\n\n");
});

test("CRLF and lone CR split lines too", () => {
  assert.equal(encodeSseEvent("a\r\nb\rc", null, null), "data: a\ndata: b\ndata: c\n\n");
});

test("empty data emits a bare data: line", () => {
  assert.equal(encodeSseEvent("", null, null), "data: \n\n");
});

test("event and id fields cannot inject newlines", () => {
  const f = encodeSseEvent("d", "ev\nent", "i\rd");
  assert.equal(f, "id: id\nevent: event\ndata: d\n\n");
});

test("JSON payloads serialize into one data line set", () => {
  const n = { jsonrpc: "2.0", method: "notifications/progress", params: { progress: 1 } };
  const f = encodeSseEvent(JSON.stringify(n), null, null);
  assert.match(f, /^data: \{"jsonrpc":"2\.0"/);
  assert.ok(f.endsWith("\n\n"));
});

test("comment frames", () => {
  assert.equal(encodeSseComment("ka"), ": ka\n\n");
  assert.equal(encodeSseComment("multi\nline"), ": multi\n: line\n\n");
});

test("retry frames and clamping", () => {
  assert.equal(encodeSseRetry(1500), "retry: 1500\n\n");
  assert.equal(encodeSseRetry(-5), "retry: 0\n\n");
  assert.equal(encodeSseRetry(NaN), "retry: 0\n\n");
});
