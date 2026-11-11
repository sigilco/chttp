// StdioTransport: pure handleLine cases plus a real child-process roundtrip.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { Server, StdioTransport, tool } from "../dist/esm/index.js";
import { echoSchema, emit } from "./helpers.js";

function makeTransport() {
  const s = new Server({ name: "stdio-test", version: "0.1.0", emitJsonSchema: emit });
  tool(s, "add", echoSchema(), async (input) => String(input.a + input.b));
  return new StdioTransport(s);
}

test("handleLine: request -> one JSON line", async () => {
  const t = makeTransport();
  const out = await t.handleLine('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}');
  const res = JSON.parse(out);
  assert.equal(res.id, 1);
  assert.equal(res.result.serverInfo.name, "stdio-test");
  assert.ok(!out.includes("\n"));
});

test("handleLine: blank lines and notifications produce no output", async () => {
  const t = makeTransport();
  assert.equal(await t.handleLine("   "), null);
  assert.equal(await t.handleLine('{"jsonrpc":"2.0","method":"notifications/initialized"}'), null);
});

test("handleLine: malformed JSON -> -32700 on id null, bad envelope -> -32600", async () => {
  const t = makeTransport();
  const parse = JSON.parse(await t.handleLine("{nope"));
  assert.equal(parse.error.code, -32700);
  assert.equal(parse.id, null);
  const shape = JSON.parse(await t.handleLine('{"id":1,"method":"x"}'));
  assert.equal(shape.error.code, -32600);
});

test("handleLine: unknown method -> -32601 on the request id", async () => {
  const t = makeTransport();
  const res = JSON.parse(await t.handleLine('{"jsonrpc":"2.0","id":9,"method":"nope"}'));
  assert.equal(res.id, 9);
  assert.equal(res.error.code, -32601);
});

test("child process: pipelined requests, progress frames, tool errors, clean exit", async () => {
  const child = spawn(process.execPath, [new URL("./stdio-fixture.js", import.meta.url).pathname]);
  let out = "";
  let err = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (err += d));
  const send = (o) => child.stdin.write(JSON.stringify(o) + "\n");
  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "add", arguments: { a: 2, b: 3 } } });
  send({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "slow", arguments: {}, _meta: { progressToken: "p1" } },
  });
  send({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "boom", arguments: {} } });
  child.stdin.end();
  const code = await new Promise((r) => child.on("close", r));
  assert.equal(code, 0, err);
  assert.match(err, /serve resolved/);
  const msgs = out.trim().split("\n").map((l) => JSON.parse(l));
  const byId = (id) => msgs.find((m) => m.id === id);
  assert.equal(byId(1).result.serverInfo.name, "stdio-test");
  assert.equal(byId(2).result.content[0].text, "5");
  assert.equal(byId(3).result.content[0].text, "done");
  assert.equal(byId(4).result.isError, true);
  assert.ok(msgs.some((m) => m.method === "notifications/progress"), "progress frame on stdout");
  assert.equal(msgs.filter((m) => m.id !== undefined).length, 4);
});
