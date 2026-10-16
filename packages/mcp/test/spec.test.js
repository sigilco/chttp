// MCP spec golden vectors (spec revision 2025-06-18): the published request
// and response shapes for each method, run through the dispatcher verbatim.
// Reference: https://modelcontextprotocol.io/specification/2025-06-18/
import { test } from "node:test";
import assert from "node:assert/strict";
import { Server, tool } from "../dist/esm/index.js";
import { echoSchema, emit, rpc } from "./helpers.js";

test("golden: initialize request/response", async () => {
  const s = new Server({
    name: "ExampleServer",
    version: "1.0.0",
    emitJsonSchema: emit,
    capabilities: { tools: { listChanged: true }, logging: {} },
  });
  const req = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: { roots: { listChanged: true }, sampling: {} },
      clientInfo: { name: "ExampleClient", version: "1.0.0" },
    },
  };
  const res = await s.handleRequest(req);
  assert.equal(res.jsonrpc, "2.0");
  assert.equal(res.id, 1);
  assert.equal(res.result.protocolVersion, "2025-06-18");
  assert.deepEqual(res.result.serverInfo, { name: "ExampleServer", version: "1.0.0" });
  assert.deepEqual(res.result.capabilities.tools, { listChanged: true });
  assert.deepEqual(res.result.capabilities.logging, {});
});

test("golden: tools/list response shape", async () => {
  const s = new Server({ name: "t", version: "1", emitJsonSchema: emit });
  tool(s, "get_weather", echoSchema(), async () => "sunny", {
    description: "Get current weather",
  });
  const res = await s.handleRequest(rpc("tools/list", {}, 2));
  const t = res.result.tools[0];
  assert.equal(t.name, "get_weather");
  assert.equal(t.description, "Get current weather");
  assert.equal(typeof t.inputSchema, "object");
  assert.equal(t.inputSchema.type, "object");
});

test("golden: tools/call text content result", async () => {
  const s = new Server({ name: "t", version: "1", emitJsonSchema: emit });
  tool(s, "get_weather", echoSchema(), async () => ({
    content: [{ type: "text", text: "Current weather: sunny" }],
  }));
  const res = await s.handleRequest(
    rpc("tools/call", { name: "get_weather", arguments: { location: "Bcn" } }, 3),
  );
  assert.deepEqual(res.result, {
    content: [{ type: "text", text: "Current weather: sunny" }],
  });
});

test("golden: tools/call structured result", async () => {
  const s = new Server({ name: "t", version: "1", emitJsonSchema: emit });
  tool(s, "get_data", echoSchema(), async () => ({
    content: [{ type: "text", text: '{"temperature":22.5}' }],
    structuredContent: { temperature: 22.5 },
  }));
  const res = await s.handleRequest(rpc("tools/call", { name: "get_data", arguments: {} }, 4));
  assert.equal(res.result.structuredContent.temperature, 22.5);
});

test("golden: tools/call error result is a result, not a JSON-RPC error", async () => {
  const s = new Server({ name: "t", version: "1", emitJsonSchema: emit });
  tool(s, "fail", echoSchema(), async () => {
    throw new Error("tool broke");
  });
  const res = await s.handleRequest(rpc("tools/call", { name: "fail", arguments: {} }, 5));
  assert.equal(res.error, undefined);
  assert.equal(res.result.isError, true);
});

test("golden: resources/read response contents", async () => {
  const s = new Server({ name: "t", version: "1", emitJsonSchema: emit });
  s.resource("file:///logs/app.log", async (uri) => ({
    contents: [{ uri, mimeType: "text/plain", text: "log line" }],
  }));
  const res = await s.handleRequest(rpc("resources/read", { uri: "file:///logs/app.log" }, 6));
  assert.equal(res.result.contents[0].uri, "file:///logs/app.log");
  assert.equal(res.result.contents[0].text, "log line");
});

test("golden: prompts/get response messages", async () => {
  const s = new Server({ name: "t", version: "1", emitJsonSchema: emit });
  s.prompt("code_review", async (args) => ({
    messages: [
      {
        role: "user",
        content: { type: "text", text: "Review this code: " + args.code },
      },
    ],
  }));
  const res = await s.handleRequest(
    rpc("prompts/get", { name: "code_review", arguments: { code: "print(1)" } }, 7),
  );
  assert.equal(res.result.messages[0].role, "user");
  assert.match(res.result.messages[0].content.text, /print\(1\)/);
});

test("golden: ping / notifications never produce responses", async () => {
  const s = new Server({ name: "t", version: "1", emitJsonSchema: emit });
  assert.deepEqual((await s.handleRequest(rpc("ping", {}, 8))).result, {});
  assert.equal(await s.handleRequest(rpc("notifications/initialized")), null);
  assert.equal(await s.handleRequest(rpc("notifications/cancelled", { requestId: 9 })), null);
});
