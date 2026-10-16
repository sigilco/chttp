// node --test suite for @chttp/mcp/client (tsc build output).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { Server, progressNotification } from "../dist/esm/index.js";
import {
  Client,
  ClientToolError,
  ClientValidationError,
  ClientTransport,
  FetchClientTransport,
  HttpClientTransport,
  StdioClientTransport,
  SseDecoder,
  decodeSseEvents,
  dechunk,
  parseHttpResponse,
  parseHttpTarget,
  toolDef,
  resourceDef,
  promptDef,
  JsonRpcError,
} from "../dist/esm/client/index.js";
import { echoSchema, objectSchema, emit } from "./helpers.js";

// In-memory transport: captures requests, answers from a queue.
class MemTransport extends ClientTransport {
  sent = [];
  queue = [];
  eventsOpened = 0;
  push(res) {
    this.queue.push(res);
  }
  request(req) {
    this.sent.push(req);
    const r = this.queue.shift() ?? { jsonrpc: "2.0", id: req.id ?? 0, result: {} };
    return Promise.resolve({ ...r, id: req.id ?? r.id });
  }
  openEvents() {
    this.eventsOpened += 1;
    return Promise.resolve();
  }
}

const initResult = {
  protocolVersion: "2025-06-18",
  capabilities: { tools: {}, resources: {}, prompts: {} },
  serverInfo: { name: "mem", version: "1.0" },
};

test("connect performs initialize + notifications/initialized", async () => {
  const t = new MemTransport();
  t.push({ jsonrpc: "2.0", id: 1, result: initResult });
  const c = new Client({ name: "t", version: "0", transport: t });
  const init = await c.connect();
  assert.equal(init.serverInfo.name, "mem");
  assert.equal(t.sent[0].method, "initialize");
  assert.equal(t.sent[1].method, "notifications/initialized");
  assert.equal(t.eventsOpened, 0);
  await c[Symbol.asyncDispose]();
});

test("call() validates args and result through the def's schemas", async () => {
  const t = new MemTransport();
  t.push({ jsonrpc: "2.0", id: 1, result: initResult });
  const c = new Client({ name: "t", version: "0", transport: t });
  await c.connect();

  const sum = toolDef("sum", objectSchema(["a"]), objectSchema(["total"]));
  t.push({ jsonrpc: "2.0", id: 2, result: { content: [], structuredContent: { total: 3 } } });
  const out = await c.call(sum, { a: 1 });
  assert.equal(out.total, 3);
  const params = t.sent[2].params;
  assert.equal(params.name, "sum");

  await assert.rejects(c.call(sum, {}), ClientValidationError);

  t.push({ jsonrpc: "2.0", id: 4, result: { content: [], structuredContent: {} } });
  await assert.rejects(c.call(sum, { a: 1 }), ClientValidationError);
});

test("callTool returns content/structuredContent/isError", async () => {
  const t = new MemTransport();
  t.push({ jsonrpc: "2.0", id: 1, result: initResult });
  const c = new Client({ name: "t", version: "0", transport: t });
  await c.connect();
  t.push({
    jsonrpc: "2.0",
    id: 2,
    result: { content: [{ type: "text", text: "hi" }], isError: true },
  });
  const res = await c.callTool("x", {});
  assert.equal(res.content[0].text, "hi");
  assert.equal(res.isError, true);
});

test("JSON-RPC errors pass through as JsonRpcError", async () => {
  const t = new MemTransport();
  t.push({ jsonrpc: "2.0", id: 1, result: initResult });
  const c = new Client({ name: "t", version: "0", transport: t });
  await c.connect();
  t.push({ jsonrpc: "2.0", id: 2, error: { code: -32601, message: "no such tool" } });
  await assert.rejects(
    c.callTool("missing", {}),
    (e) => e instanceof JsonRpcError && e.code === -32601,
  );
});

test("listTools/listResources/listPrompts map result arrays", async () => {
  const t = new MemTransport();
  t.push({ jsonrpc: "2.0", id: 1, result: initResult });
  const c = new Client({ name: "t", version: "0", transport: t });
  await c.connect();
  t.push({
    jsonrpc: "2.0",
    id: 2,
    result: { tools: [{ name: "a", inputSchema: { type: "object" } }] },
  });
  assert.deepEqual(
    (await c.listTools()).map((x) => x.name),
    ["a"],
  );
  t.push({ jsonrpc: "2.0", id: 3, result: { resources: [{ uri: "u://1" }] } });
  assert.equal((await c.listResources())[0].uri, "u://1");
  t.push({ jsonrpc: "2.0", id: 4, result: { prompts: [{ name: "p", arguments: [] }] } });
  assert.equal((await c.listPrompts())[0].name, "p");
});

test("notification + progress handlers route, openEvents runs when subscribed", async () => {
  const t = new MemTransport();
  t.push({ jsonrpc: "2.0", id: 1, result: initResult });
  const c = new Client({ name: "t", version: "0", transport: t });
  const seen = [];
  const prog = [];
  c.onNotification((n) => seen.push(n.method));
  c.onProgress((n) => prog.push(n));
  await c.connect();
  assert.equal(t.eventsOpened, 1);
  t.emitNote({ jsonrpc: "2.0", method: "notifications/progress", params: { progress: 1 } });
  t.emitNote({ jsonrpc: "2.0", method: "notifications/message", params: {} });
  assert.equal(prog.length, 1);
  assert.deepEqual(seen, ["notifications/message"]);
  await c.close();
});

test("resource/prompt defs validate output through def.output", async () => {
  const t = new MemTransport();
  t.push({ jsonrpc: "2.0", id: 1, result: initResult });
  const c = new Client({ name: "t", version: "0", transport: t });
  await c.connect();
  const rd = resourceDef("mcp://r", echoSchema());
  t.push({ jsonrpc: "2.0", id: 2, result: { contents: [{ uri: "mcp://r", data: 1 }] } });
  const contents = await c.readResource(rd);
  assert.equal(contents[0].data, 1);
  const badRd = resourceDef("mcp://r", {
    "~standard": {
      version: 1,
      vendor: "t",
      validate: (v) => (Array.isArray(v) ? { issues: [{ message: "want object" }] } : { value: v }),
    },
  });
  t.push({ jsonrpc: "2.0", id: 3, result: { contents: [] } });
  await assert.rejects(c.readResource(badRd), ClientValidationError);
  const pd = promptDef("g", [], objectSchema(["messages"]));
  t.push({ jsonrpc: "2.0", id: 4, result: { messages: [{ role: "user", content: {} }] } });
  const pr = await c.getPrompt(pd, {});
  assert.equal(pr.messages[0].role, "user");
});

test("tool isError surfaces ClientToolError from call()", async () => {
  const t = new MemTransport();
  t.push({ jsonrpc: "2.0", id: 1, result: initResult });
  const c = new Client({ name: "t", version: "0", transport: t });
  await c.connect();
  t.push({
    jsonrpc: "2.0",
    id: 2,
    result: { content: [{ type: "text", text: "tool blew up" }], isError: true },
  });
  await assert.rejects(
    c.call(toolDef("boom", echoSchema(), echoSchema()), {}),
    (e) => e instanceof ClientToolError && e.message.includes("tool blew up"),
  );
});

// ---------- pure helpers ----------

test("SseDecoder parses frames incrementally", () => {
  const d = new SseDecoder();
  const ev = d.feed("data: a\ndata: b\n\n: comment\nevent: e\nid: 9\ndata: x\n\n");
  assert.equal(ev.length, 2);
  assert.equal(ev[0].data, "a\nb");
  assert.equal(ev[1].event, "e");
  assert.equal(ev[1].id, "9");
  assert.equal(decodeSseEvents("data: z\n\n").length, 1);
});

test("parseHttpResponse reads status/headers/body + dechunk", () => {
  const raw = new TextEncoder().encode(
    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nx-a: b\r\n\r\n{}",
  );
  const res = parseHttpResponse(raw);
  assert.equal(res.status, 200);
  assert.equal(res.headers["content-type"], "application/json");
  assert.equal(res.body, "{}");
  const chunked = parseHttpResponse(
    new TextEncoder().encode(
      "HTTP/1.1 200 OK\r\ntransfer-encoding: chunked\r\n\r\n4\r\nabcd\r\n0\r\n\r\n",
    ),
  );
  assert.equal(chunked.body, "abcd");
  assert.equal(
    new TextDecoder().decode(dechunk(new TextEncoder().encode("2\r\nhi\r\n0\r\n\r\n"))),
    "hi",
  );
});

test("parseHttpTarget splits url into host/port/path/tls", () => {
  const t = parseHttpTarget("http://example.com:8080/mcp?x=1");
  assert.deepEqual([t.host, t.port, t.path, t.tls], ["example.com", 8080, "/mcp?x=1", false]);
  assert.equal(parseHttpTarget("https://e.com/").port, 443);
  assert.throws(() => parseHttpTarget("ftp://e.com/"));
});

// ---------- real transports against a real MCP server ----------

async function withHttpServer(server, fn) {
  const srv = createServer(async (req, res) => {
    if (req.method === "GET") {
      const body = ["data: " + JSON.stringify(progressNotification("t", 1, 2, null)), "", ""].join(
        "\n",
      );
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(body);
      return;
    }
    let buf = "";
    req.on("data", (c) => (buf += c));
    req.on("end", async () => {
      const parsed = JSON.parse(buf);
      const out = await server.handleRequest(parsed);
      if (out === null) {
        res.writeHead(202);
        res.end();
        return;
      }
      res.writeHead(200, {
        "content-type": "application/json",
        "mcp-session-id": "sid-9",
      });
      res.end(JSON.stringify(out));
    });
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${srv.address().port}/mcp`;
  try {
    await fn(url);
  } finally {
    srv.close();
  }
}

function echoServer() {
  const s = new Server({ name: "http-e2e", version: "1", emitJsonSchema: emit });
  s.tool("echo", echoSchema(), async (input) => ({ echoed: input }));
  s.resource("mcp://hi", async (uri) => ({
    contents: [{ uri, mimeType: "text/plain", text: "hi" }],
  }));
  return s;
}

for (const [label, make] of [
  ["fetch", (url) => new FetchClientTransport({ url })],
  ["net/tls http", (url) => new HttpClientTransport({ url })],
]) {
  test(`e2e over ${label}: initialize, call, resource, progress stream`, async () => {
    await withHttpServer(echoServer(), async (url) => {
      const tr = make(url);
      const c = new Client({ name: "e2e", version: "0", transport: tr });
      let progress = 0;
      c.onProgress(() => progress++);
      const init = await c.connect();
      assert.equal(init.serverInfo.name, "http-e2e");
      assert.equal(tr.sessionId(), "sid-9");
      const out = await c.callTool("echo", { n: 5 });
      assert.deepEqual(out.structuredContent, { echoed: { n: 5 } });
      const contents = await c.readResource("mcp://hi");
      assert.equal(contents[0].text, "hi");
      await tr.openEvents(5000);
      await new Promise((r) => setTimeout(r, 100));
      assert.equal(progress, 1);
      await c.close();
    });
  });
}

test("stdio transport round-trips through a spawned node server", async () => {
  const script = `
import { createInterface } from "node:readline";
const rl = createInterface({ input: process.stdin });
rl.on("line", (l) => {
  const req = JSON.parse(l);
  if (req.method === "initialize") {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: req.id, result: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      serverInfo: { name: "stdio-srv", version: "1" } } }) + "\\n");
  } else if (req.method === "tools/call") {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: req.id, result: {
      content: [{ type: "text", text: "ok" }], structuredContent: { pong: req.params.arguments.x } } }) + "\\n");
  } else {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: req.id, result: {} }) + "\\n");
  }
});`;
  const tr = new StdioClientTransport({
    command: process.execPath,
    args: ["--input-type=module", "-e", script],
  });
  const c = new Client({ name: "stdio-c", version: "0", transport: tr });
  try {
    const init = await c.connect();
    assert.equal(init.serverInfo.name, "stdio-srv");
    const out = await c.callTool("p", { x: 42 });
    assert.deepEqual(out.structuredContent, { pong: 42 });
  } finally {
    await c.close();
  }
});

test("stdio request timeout rejects pending calls", async () => {
  const tr = new StdioClientTransport({
    command: process.execPath,
    args: ["-e", "setInterval(()=>{},1e9)"],
    timeoutMs: 200,
  });
  const c = new Client({ name: "t", version: "0", transport: tr, timeoutMs: 200 });
  await assert.rejects(c.connect(), /timed out|timeout/i);
  await c.close();
});
