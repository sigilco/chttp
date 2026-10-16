// The auto-wrap ladder — every branch of wrapToolReturn / wrapToolError.
import { test } from "node:test";
import assert from "node:assert/strict";
import { wrapToolError, wrapToolReturn } from "../dist/esm/index.js";

test("string -> single text block", () => {
  assert.deepEqual(wrapToolReturn("42"), {
    content: [{ type: "text", text: "42" }],
  });
});

test("empty string still wraps", () => {
  assert.deepEqual(wrapToolReturn(""), { content: [{ type: "text", text: "" }] });
});

test("null and undefined -> empty content", () => {
  assert.deepEqual(wrapToolReturn(null), { content: [] });
  assert.deepEqual(wrapToolReturn(undefined), { content: [] });
});

test("single ContentBlock -> one-element array", () => {
  const b = { type: "text", text: "hi" };
  assert.deepEqual(wrapToolReturn(b), { content: [b] });
  const img = { type: "image", data: "aGk=", mimeType: "image/gif" };
  assert.deepEqual(wrapToolReturn(img), { content: [img] });
});

test("every ContentBlock type is recognized", () => {
  const blocks = [
    { type: "text", text: "t" },
    { type: "image", data: "d", mimeType: "image/png" },
    { type: "audio", data: "d", mimeType: "audio/wav" },
    { type: "resource_link", uri: "u", name: "n" },
    { type: "resource", resource: { uri: "u", mimeType: "text/plain", text: "x" } },
  ];
  for (const b of blocks) {
    const out = wrapToolReturn(b);
    assert.equal(out.content.length, 1);
    assert.equal(out.content[0], b);
  }
});

test("ContentBlock[] passes through", () => {
  const arr = [
    { type: "text", text: "a" },
    { type: "text", text: "b" },
  ];
  const out = wrapToolReturn(arr);
  assert.deepEqual(out, { content: arr });
});

test("CallToolResult passes through unchanged (raw-envelope escape hatch)", () => {
  const full = {
    content: [{ type: "text", text: "x" }],
    structuredContent: { a: 1 },
    isError: false,
  };
  const out = wrapToolReturn(full);
  assert.equal(out, full);
});

test("isError envelopes pass through", () => {
  const err = { content: [{ type: "text", text: "nope" }], isError: true };
  assert.equal(wrapToolReturn(err).isError, true);
});

test("plain object -> dual content (text JSON + structuredContent)", () => {
  const v = { sum: 42, nested: { a: [1] } };
  const out = wrapToolReturn(v);
  assert.deepEqual(out.structuredContent, v);
  assert.equal(out.content.length, 1);
  assert.equal(out.content[0].type, "text");
  assert.deepEqual(JSON.parse(out.content[0].text), v);
});

test("empty array is a ContentBlock[] (empty content), not dual content", () => {
  assert.deepEqual(wrapToolReturn([]), { content: [] });
});

test("numbers and booleans stringify into a text block", () => {
  assert.deepEqual(wrapToolReturn(42), { content: [{ type: "text", text: "42" }] });
  assert.deepEqual(wrapToolReturn(true), { content: [{ type: "text", text: "true" }] });
});

test("an object whose type is not a block type is dual-wrapped", () => {
  const v = { type: "unknown-block-kind", x: 1 };
  const out = wrapToolReturn(v);
  assert.deepEqual(out.structuredContent, v);
});

test("wrapToolError: Error -> isError with message", () => {
  const out = wrapToolError(new Error("kaboom"));
  assert.equal(out.isError, true);
  assert.deepEqual(out.content, [{ type: "text", text: "kaboom" }]);
});

test("wrapToolError: string / object-with-message / unknown", () => {
  assert.deepEqual(wrapToolError("plain").content, [{ type: "text", text: "plain" }]);
  assert.deepEqual(wrapToolError({ message: "m" }).content, [{ type: "text", text: "m" }]);
  const fallback = wrapToolError(42);
  assert.equal(fallback.isError, true);
  assert.equal(typeof fallback.content[0].text, "string");
});
