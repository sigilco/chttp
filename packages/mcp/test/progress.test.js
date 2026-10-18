// Progress + log notifications: envelope shaping, progressToken echo,
// severity filtering, sink fan-out.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isLogLevel,
  levelIndex,
  logNotification,
  progressNotification,
  Server,
} from "../dist/esm/index.js";
import { echoSchema, emit, rpc } from "./helpers.js";

test("progressNotification shape: token, progress, total, message", () => {
  const n = progressNotification("tok", 0.5, 1, "halfway");
  assert.equal(n.method, "notifications/progress");
  assert.equal(n.id, undefined);
  assert.deepEqual(n.params, {
    progressToken: "tok",
    progress: 0.5,
    total: 1,
    message: "halfway",
  });
});

test("progressNotification omits absent fields", () => {
  const n = progressNotification(null, 3, null, null);
  assert.deepEqual(n.params, { progress: 3 });
});

test("logNotification shape", () => {
  const n = logNotification("warning", { detail: 1 });
  assert.equal(n.method, "notifications/message");
  assert.deepEqual(n.params.level, "warning");
  assert.deepEqual(n.params.data, { detail: 1 });
});

test("levelIndex follows RFC 5424 order", () => {
  assert.equal(levelIndex("debug"), 0);
  assert.equal(levelIndex("info"), 1);
  assert.equal(levelIndex("emergency"), 7);
  assert.equal(levelIndex("bogus"), 1); // unknown compares as info
});

test("isLogLevel gates the set", () => {
  assert.equal(isLogLevel("critical"), true);
  assert.equal(isLogLevel("chatty"), false);
});

test("ctx.progress emits notifications/progress through the sink registry", async () => {
  const s = new Server({ name: "t", version: "1", emitJsonSchema: emit });
  s.tool("work", echoSchema(), async (_i, ctx) => {
    await ctx.progress(0.25, 0.5, "quarter");
    await ctx.progress(0.5, 1);
    return "ok";
  });
  const pushed = [];
  s.registerSink((json) => pushed.push(JSON.parse(json)));
  await s.handleRequest(
    rpc("tools/call", { name: "work", arguments: {}, _meta: { progressToken: "p1" } }, 1),
  );
  assert.equal(pushed.length, 2);
  assert.equal(pushed[0].method, "notifications/progress");
  assert.equal(pushed[0].params.progressToken, "p1");
  assert.equal(pushed[0].params.progress, 0.25);
  assert.equal(pushed[0].params.total, 0.5);
  assert.equal(pushed[0].params.message, "quarter");
  assert.equal(pushed[1].params.progressToken, "p1");
});

test("no progressToken when the client did not send one", async () => {
  const s = new Server({ name: "t", version: "1", emitJsonSchema: emit });
  s.tool("work", echoSchema(), async (_i, ctx) => {
    await ctx.progress(1);
    return null;
  });
  const pushed = [];
  s.registerSink((json) => pushed.push(JSON.parse(json)));
  await s.handleRequest(rpc("tools/call", { name: "work", arguments: {} }, 2));
  assert.equal(pushed.length, 1);
  assert.equal(pushed[0].params.progressToken, undefined);
});

test("ctx.log emits notifications/message and respects setLevel", async () => {
  const s = new Server({ name: "t", version: "1", emitJsonSchema: emit });
  s.tool("lg", echoSchema(), async (_i, ctx) => {
    await ctx.log("debug", "fine");
    await ctx.log("error", "loud");
    return "ok";
  });
  const pushed = [];
  s.registerSink((json) => pushed.push(JSON.parse(json)));
  // Default level is debug — both arrive.
  await s.handleRequest(rpc("tools/call", { name: "lg", arguments: {} }, 3));
  assert.equal(pushed.length, 2);
  assert.equal(pushed[0].params.level, "debug");
  assert.equal(pushed[1].params.level, "error");
  // After setLevel warning, only error survives.
  pushed.length = 0;
  await s.handleRequest(rpc("logging/setLevel", { level: "warning" }, 4));
  await s.handleRequest(rpc("tools/call", { name: "lg", arguments: {} }, 5));
  assert.equal(pushed.length, 1);
  assert.equal(pushed[0].params.level, "error");
});

test("closed sinks are skipped", async () => {
  const s = new Server({ name: "t", version: "1", emitJsonSchema: emit });
  const pushed = [];
  const entry = s.registerSink((json) => pushed.push(json));
  entry.open = false;
  s._broadcast(logNotification("info", "x"));
  assert.equal(pushed.length, 0);
});

test("resource and prompt contexts emit log notifications", async () => {
  const s = new Server({ name: "t", version: "1", emitJsonSchema: emit });
  s.resource("mcp://r", async (_u, ctx) => {
    await ctx.log("info", "read");
    return { contents: [] };
  });
  s.prompt("p", async (_a, ctx) => {
    await ctx.log("info", "got");
    return { messages: [] };
  });
  const pushed = [];
  s.registerSink((json) => pushed.push(JSON.parse(json)));
  await s.handleRequest(rpc("resources/read", { uri: "mcp://r" }, 6));
  await s.handleRequest(rpc("prompts/get", { name: "p", arguments: {} }, 7));
  assert.equal(pushed.length, 2);
  assert.equal(pushed[0].params.data, "read");
  assert.equal(pushed[1].params.data, "got");
});
