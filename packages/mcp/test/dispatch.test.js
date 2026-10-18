// Dispatcher behavior — every method on Server.handleRequest, every error path.
import { test } from "node:test";
import assert from "node:assert/strict";
import { prompt, resource, Server, tool } from "../dist/esm/index.js";
import { echoSchema, emit, objectSchema, rpc } from "./helpers.js";

function makeServer() {
  const s = new Server({
    name: "test-server",
    version: "1.2.3",
    instructions: "be helpful",
    emitJsonSchema: emit,
    capabilities: { logging: {} },
  });
  tool(s, "echo", echoSchema(), async (input) => input);
  s.tool("sum", objectSchema(["a", "b"]), async (input) => String(input.a + input.b), {
    description: "adds",
  });
  resource(
    s,
    "mcp://readme",
    async (uri) => ({
      contents: [{ uri, mimeType: "text/plain", text: "hello" }],
    }),
    { name: "readme", mimeType: "text/plain" },
  );
  prompt(
    s,
    "greet",
    async (args) => ({
      messages: [{ role: "assistant", content: { type: "text", text: "hi " + args.who } }],
    }),
    { description: "greeter", args: [{ name: "who", required: true }] },
  );
  return s;
}

test("initialize returns serverInfo, capabilities, instructions, protocolVersion", async () => {
  const s = makeServer();
  const res = await s.handleRequest(rpc("initialize", {}, 1));
  const r = res.result;
  assert.equal(r.protocolVersion, "2025-06-18");
  assert.deepEqual(r.serverInfo, { name: "test-server", version: "1.2.3" });
  assert.equal(r.instructions, "be helpful");
  assert.ok("tools" in r.capabilities);
  assert.ok("resources" in r.capabilities);
  assert.ok("prompts" in r.capabilities);
  assert.ok("logging" in r.capabilities);
});

test("initialize omits instructions and empty capability groups", async () => {
  const s = new Server({ name: "bare", version: "0.0.1" });
  const res = await s.handleRequest(rpc("initialize", {}, 1));
  const r = res.result;
  assert.equal(r.instructions, undefined);
  assert.deepEqual(r.capabilities, {});
});

test("ping returns {}", async () => {
  const res = await makeServer().handleRequest(rpc("ping", undefined, 2));
  assert.deepEqual(res.result, {});
});

test("notifications/initialized and other notifications return null", async () => {
  const s = makeServer();
  assert.equal(await s.handleRequest(rpc("notifications/initialized")), null);
  assert.equal(await s.handleRequest(rpc("notifications/cancelled", { requestId: 1 })), null);
  assert.equal(await s.handleRequest(rpc("notifications/progress", { progress: 1 })), null);
  // One-way methods with an id attached are never answered either.
  assert.equal(await s.handleRequest(rpc("notifications/initialized", {}, 5)), null);
  // Unknown notifications: still null (JSON-RPC never answers notifications).
  assert.equal(await s.handleRequest(rpc("notifications/bogus")), null);
});

test("tools/list returns registered tools with emitted schemas", async () => {
  const res = await makeServer().handleRequest(rpc("tools/list", {}, 3));
  const tools = res.result.tools;
  assert.equal(tools.length, 2);
  const echo = tools.find((t) => t.name === "echo");
  assert.equal(echo.inputSchema.type, "object");
  assert.equal(echo.inputSchema.$schema.includes("2020-12"), true);
  const sum = tools.find((t) => t.name === "sum");
  assert.equal(sum.description, "adds");
});

test("tools/call validates args and returns wrapped result", async () => {
  const s = makeServer();
  const ok = await s.handleRequest(
    rpc("tools/call", { name: "sum", arguments: { a: 1, b: 2 } }, 4),
  );
  assert.deepEqual(ok.result, { content: [{ type: "text", text: "3" }] });
  const bad = await s.handleRequest(rpc("tools/call", { name: "sum", arguments: { a: 1 } }, 5));
  assert.equal(bad.error.code, -32602);
  assert.ok(bad.error.data.issues.length >= 1);
  assert.equal(bad.error.data.issues[0].message, "missing b");
});

test("tools/call: unknown tool / missing name -> -32602", async () => {
  const s = makeServer();
  const unk = await s.handleRequest(rpc("tools/call", { name: "nope", arguments: {} }, 6));
  assert.equal(unk.error.code, -32602);
  assert.match(unk.error.message, /Unknown tool: nope/);
  const noname = await s.handleRequest(rpc("tools/call", { arguments: {} }, 7));
  assert.equal(noname.error.code, -32602);
});

test("tools/call: thrown handler error -> isError envelope (not a JSON-RPC error)", async () => {
  const s = new Server({ name: "t", version: "1", emitJsonSchema: emit });
  s.tool("boom", echoSchema(), async () => {
    throw new Error("kaboom");
  });
  const res = await s.handleRequest(rpc("tools/call", { name: "boom", arguments: {} }, 8));
  assert.equal(res.result.isError, true);
  assert.equal(res.result.content[0].text, "kaboom");
});

test("resources/list + resources/read", async () => {
  const s = makeServer();
  const list = await s.handleRequest(rpc("resources/list", {}, 9));
  assert.equal(list.result.resources.length, 1);
  assert.equal(list.result.resources[0].name, "readme");
  assert.equal(list.result.resources[0].mimeType, "text/plain");
  const read = await s.handleRequest(rpc("resources/read", { uri: "mcp://readme" }, 10));
  assert.deepEqual(read.result.contents, [
    { uri: "mcp://readme", mimeType: "text/plain", text: "hello" },
  ]);
  const miss = await s.handleRequest(rpc("resources/read", { uri: "mcp://nope" }, 11));
  assert.equal(miss.error.code, -32602);
});

test("resources/templates/list is an honest empty in v1", async () => {
  const res = await makeServer().handleRequest(rpc("resources/templates/list", {}, 12));
  assert.deepEqual(res.result, { resourceTemplates: [] });
});

test("prompts/list + prompts/get (args forwarded, description echoed)", async () => {
  const s = makeServer();
  const list = await s.handleRequest(rpc("prompts/list", {}, 13));
  assert.equal(list.result.prompts[0].name, "greet");
  assert.deepEqual(list.result.prompts[0].arguments, [{ name: "who", required: true }]);
  const got = await s.handleRequest(
    rpc("prompts/get", { name: "greet", arguments: { who: "quim" } }, 14),
  );
  assert.equal(got.result.description, "greeter");
  assert.deepEqual(got.result.messages, [
    { role: "assistant", content: { type: "text", text: "hi quim" } },
  ]);
  const miss = await s.handleRequest(rpc("prompts/get", { name: "nope" }, 15));
  assert.equal(miss.error.code, -32602);
});

test("logging/setLevel stores the level; bad level -> -32602", async () => {
  const s = makeServer();
  const ok = await s.handleRequest(rpc("logging/setLevel", { level: "warning" }, 16));
  assert.deepEqual(ok.result, {});
  const bad = await s.handleRequest(rpc("logging/setLevel", { level: "chatty" }, 17));
  assert.equal(bad.error.code, -32602);
});

test("completion/complete returns empty completion in v1", async () => {
  const res = await makeServer().handleRequest(
    rpc("completion/complete", { ref: { type: "ref/prompt", name: "greet" } }, 18),
  );
  assert.deepEqual(res.result, { completion: { values: [], total: 0, hasMore: false } });
});

test("unknown method -> -32601 Method not found", async () => {
  const res = await makeServer().handleRequest(rpc("bogus/method", {}, 19));
  assert.equal(res.error.code, -32601);
  assert.match(res.error.message, /bogus\/method/);
});

test("malformed envelope through handleRequest -> error response, not a throw", async () => {
  const res = await makeServer().handleRequest({ jsonrpc: "1.0", id: 1, method: "ping" });
  assert.equal(res.error.code, -32600);
  assert.equal(res.id, null);
});

test("ctx.log respects logging/setLevel severity filter", async () => {
  const s = new Server({ name: "t", version: "1", emitJsonSchema: emit });
  s.tool("lg", echoSchema(), async (_i, ctx) => {
    await ctx.log("debug", "low");
    await ctx.log("error", "high");
    return "ok";
  });
  const pushed = [];
  s.registerSink((json) => pushed.push(JSON.parse(json)));
  await s.handleRequest(rpc("logging/setLevel", { level: "warning" }, 20));
  await s.handleRequest(rpc("tools/call", { name: "lg", arguments: {} }, 21));
  assert.equal(pushed.length, 1);
  assert.equal(pushed[0].params.level, "error");
});
