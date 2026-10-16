// StreamableHttpTransport — POST flow, SSE GET flow, error responses,
// content negotiation, session header. Exercised at the Request/Response
// level (undici globals on Node 22+) plus one real node:http roundtrip.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { Server, StreamableHttpTransport, tool } from "../dist/esm/index.js";
import { echoSchema, emit } from "./helpers.js";

function makeServer() {
  const s = new Server({ name: "http-test", version: "0.1.0", emitJsonSchema: emit });
  tool(s, "add", echoSchema(), async (input) => String(input.a + input.b));
  return s;
}

const REQ = (method, body, query) =>
  new Request("http://localhost/mcp" + (query ?? ""), {
    method,
    ...(body ? { headers: { "content-type": "application/json" }, body } : {}),
  });

test("POST initialize -> 200 JSON-RPC response + Mcp-Session-Id", async () => {
  const route = StreamableHttpTransport.route(makeServer());
  const res = await route(
    REQ("POST", JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })),
  );
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /application\/json/);
  assert.ok(res.headers.get("mcp-session-id"));
  const body = await res.json();
  assert.equal(body.result.serverInfo.name, "http-test");
});

test("POST tools/call -> wrapped result on the wire", async () => {
  const route = StreamableHttpTransport.route(makeServer());
  const res = await route(
    REQ(
      "POST",
      JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "add", arguments: { a: 1, b: 2 } },
      }),
    ),
  );
  const body = await res.json();
  assert.deepEqual(body.result, { content: [{ type: "text", text: "3" }] });
});

test("POST notification -> 202 Accepted, no body", async () => {
  const route = StreamableHttpTransport.route(makeServer());
  const res = await route(
    REQ("POST", JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })),
  );
  assert.equal(res.status, 202);
  assert.equal(await res.text(), "");
  assert.ok(res.headers.get("mcp-session-id"));
});

test("POST malformed JSON -> 400 with -32700 envelope on id null", async () => {
  const route = StreamableHttpTransport.route(makeServer());
  const res = await route(REQ("POST", "{definitely not json"));
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error.code, -32700);
  assert.equal(body.id, null);
});

test("POST array body (batch) -> 400 -32600", async () => {
  const route = StreamableHttpTransport.route(makeServer());
  const res = await route(REQ("POST", '[{"jsonrpc":"2.0","id":1,"method":"ping"}]'));
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error.code, -32600);
});

test("body over maxBodyBytes -> 413", async () => {
  const route = StreamableHttpTransport.route(makeServer(), { maxBodyBytes: 16 });
  const res = await route(REQ("POST", JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" })));
  assert.equal(res.status, 413);
});

test("GET ?stream=progress -> SSE response with session header", async () => {
  const route = StreamableHttpTransport.route(makeServer());
  const res = await route(REQ("GET", null, "?stream=progress"));
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /text\/event-stream/);
  assert.ok(res.headers.get("mcp-session-id"));
  await res.body.cancel();
});

test("GET without ?stream=progress -> 400", async () => {
  const route = StreamableHttpTransport.route(makeServer());
  const res = await route(REQ("GET"));
  assert.equal(res.status, 400);
});

test("GET with allowSseGet: false -> 405", async () => {
  const route = StreamableHttpTransport.route(makeServer(), { allowSseGet: false });
  const res = await route(REQ("GET", null, "?stream=progress"));
  assert.equal(res.status, 405);
});

test("DELETE and other methods -> 405 with Allow", async () => {
  const route = StreamableHttpTransport.route(makeServer());
  const del = await route(REQ("DELETE"));
  assert.equal(del.status, 405);
  assert.match(del.headers.get("allow"), /POST/);
  const put = await route(REQ("PUT", "{}"));
  assert.equal(put.status, 405);
});

test("progress events during tools/call reach an open SSE session", async () => {
  const server = makeServer();
  server.tool("slow", echoSchema(), async (_i, ctx) => {
    await ctx.progress(0.5, 1);
    return "done";
  });
  const transport = new StreamableHttpTransport(server);
  const route = StreamableHttpTransport.route(server);
  // Open an SSE session on a second transport (progress fans out through the
  // server-level sink registry, not a single transport instance).
  const sse = await route(REQ("GET", null, "?stream=progress"));
  const reader = sse.body.getReader();
  const call = transport.handleRequest({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "slow", arguments: {}, _meta: { progressToken: "tok-1" } },
  });
  const chunk = await reader.read();
  const text = new TextDecoder().decode(chunk.value);
  assert.match(text, /^data: /);
  const n = JSON.parse(text.slice(5).trim());
  assert.equal(n.method, "notifications/progress");
  assert.equal(n.params.progress, 0.5);
  assert.equal(n.params.total, 1);
  assert.equal(n.params.progressToken, "tok-1");
  const res = await call;
  assert.equal(res.result.content[0].text, "done");
  await reader.cancel();
});

test("pushProgress targets a session id or broadcasts", async () => {
  const transport = new StreamableHttpTransport(makeServer());
  // Bare session objects stand in for open streams.
  const a = { id: "a", push: null, end: null, open: true, frames: [] };
  const b = { id: "b", push: null, end: null, open: true, frames: [] };
  a.push = (f) => a.frames.push(f);
  b.push = (f) => b.frames.push(f);
  transport._sessions.push(a, b);
  await transport.pushProgress(null, {
    jsonrpc: "2.0",
    method: "notifications/progress",
    params: { progress: 1 },
  });
  assert.equal(a.frames.length, 1);
  assert.equal(b.frames.length, 1);
  await transport.pushProgress("a", {
    jsonrpc: "2.0",
    method: "notifications/progress",
    params: { progress: 2 },
  });
  assert.equal(a.frames.length, 2);
  assert.equal(b.frames.length, 1);
});

test("close() ends sessions and stops the fan-out", async () => {
  const server = makeServer();
  const transport = new StreamableHttpTransport(server);
  let ended = false;
  const s = { id: "x", push: () => {}, end: () => (ended = true), open: true };
  transport._sessions.push(s);
  await transport.close();
  assert.equal(ended, true);
  assert.equal(s.open, false);
  assert.equal(transport._sink.open, false);
});

test("end-to-end over a real node:http server", async () => {
  const route = StreamableHttpTransport.route(makeServer());
  const srv = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const web = new Request("http://x" + req.url, {
      method: req.method,
      headers: req.headers,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : Buffer.concat(chunks),
    });
    const out = await route(web);
    res.statusCode = out.status;
    out.headers.forEach((v, k) => res.setHeader(k, v));
    res.end(Buffer.from(await out.arrayBuffer()));
  });
  await new Promise((r) => srv.listen(0, r));
  const port = srv.address().port;
  try {
    const r = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.deepEqual(body.result, {});
  } finally {
    srv.close();
  }
});
