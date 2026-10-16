// JSON-RPC 2.0 envelope parsing — runs on the tsc build (node --test).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  errorFor,
  errorResponse,
  isNotification,
  notification,
  parseBody,
  parseRequest,
  requestId,
  resultResponse,
} from "../dist/esm/index.js";

test("parseBody accepts a well-formed request", () => {
  const r = parseBody('{"jsonrpc":"2.0","id":1,"method":"ping"}');
  assert.equal(r.jsonrpc, "2.0");
  assert.equal(r.id, 1);
  assert.equal(r.method, "ping");
});

test("parseBody keeps string ids and params", () => {
  const r = parseBody(
    '{"jsonrpc":"2.0","id":"abc-1","method":"tools/call","params":{"name":"x","arguments":{}}}',
  );
  assert.equal(r.id, "abc-1");
  assert.deepEqual(r.params, { name: "x", arguments: {} });
});

test("notification: no id", () => {
  const r = parseBody('{"jsonrpc":"2.0","method":"notifications/initialized"}');
  assert.equal(isNotification(r), true);
  assert.equal(requestId(r), null);
});

test("id: null is treated as a notification", () => {
  const r = parseBody('{"jsonrpc":"2.0","id":null,"method":"ping"}');
  assert.equal(isNotification(r), true);
});

test("parseBody rejects malformed JSON with -32700", () => {
  try {
    parseBody("{not json");
    assert.fail("should throw");
  } catch (e) {
    assert.equal(e.code, -32700);
  }
});

test("parseRequest rejects non-2.0, missing method, bad id, non-object params", () => {
  const bad = [
    '{"jsonrpc":"1.0","id":1,"method":"ping"}',
    '{"jsonrpc":"2.0","id":1}',
    '{"jsonrpc":"2.0","id":1,"method":""}',
    '{"jsonrpc":"2.0","id":1,"method":42}',
    '{"jsonrpc":"2.0","id":true,"method":"ping"}',
    '{"jsonrpc":"2.0","id":[1],"method":"ping"}',
    '{"jsonrpc":"2.0","id":1,"method":"ping","params":[1,2]}',
    '{"jsonrpc":"2.0","id":1,"method":"ping","params":5}',
  ];
  for (const b of bad) {
    try {
      parseBody(b);
      assert.fail("should throw: " + b);
    } catch (e) {
      assert.equal(e.code, -32600, b);
    }
  }
});

test("batch requests are out of scope: top-level array is -32600", () => {
  try {
    parseBody('[{"jsonrpc":"2.0","id":1,"method":"ping"}]');
    assert.fail("should throw");
  } catch (e) {
    assert.equal(e.code, -32600);
  }
});

test("scalar bodies are -32600", () => {
  for (const b of ["42", '"x"', "null", "true"]) {
    try {
      parseBody(b);
      assert.fail("should throw: " + b);
    } catch (e) {
      assert.equal(e.code, -32600);
    }
  }
});

test("resultResponse / errorResponse shape", () => {
  assert.deepEqual(resultResponse(3, { ok: true }), {
    jsonrpc: "2.0",
    id: 3,
    result: { ok: true },
  });
  const e = errorResponse(4, -32602, "bad", { issues: ["x"] });
  assert.deepEqual(e, {
    jsonrpc: "2.0",
    id: 4,
    error: { code: -32602, message: "bad", data: { issues: ["x"] } },
  });
});

test("errorResponse emits id null for unparseable requests", () => {
  const e = errorResponse(null, -32700, "Parse error");
  assert.equal(e.id, null);
  assert.equal(JSON.parse(JSON.stringify(e)).id, null);
});

test("errorFor unwraps JsonRpcError code and message", () => {
  try {
    parseBody("{oops");
    assert.fail();
  } catch (e) {
    const r = errorFor(null, e);
    assert.equal(r.error.code, -32700);
  }
  const r2 = errorFor(9, new Error("boom"));
  assert.equal(r2.error.code, -32603);
  assert.equal(r2.error.message, "boom");
  const r3 = errorFor(9, "stringy");
  assert.equal(r3.error.message, "stringy");
});

test("notification() builds a one-way envelope", () => {
  const n = notification("notifications/progress", { progress: 1 });
  assert.equal(n.jsonrpc, "2.0");
  assert.equal(n.method, "notifications/progress");
  assert.equal(n.id, undefined);
});

test("parseRequest is idempotent on typed inputs", () => {
  const r = parseRequest({ jsonrpc: "2.0", id: 8, method: "ping", params: {} });
  assert.equal(requestId(r), 8);
});
