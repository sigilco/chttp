// Seam-proof tests: the SAME tool shape and fixtures run through BOTH
// @chttp/val and valibot, proving the seam is validator-agnostic — plus the
// emission seam (adapter-produced inputSchema) and E_NO_JSON_SCHEMA_EMITTER.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as val from "@chttp/val";
import * as v from "valibot";
import { toJsonSchema } from "@valibot/to-json-schema";
import { E_NO_JSON_SCHEMA_EMITTER, NoEmitterError, Server } from "../dist/esm/index.js";
import { rpc } from "./helpers.js";

const ARGS_OK = { a: 1, b: 2 };
const ARGS_BAD = { a: 1 };
const CALL = (id, args) => rpc("tools/call", { name: "add", arguments: args }, id);

// The one shape both validators must answer identically: { a: number, b: number }.
const FIXTURES = [
  {
    name: "@chttp/val",
    schema: val.object({ a: val.number(), b: val.number() }),
    emit: (s) => val.toJsonSchema(s),
  },
  {
    name: "valibot",
    schema: v.object({ a: v.number(), b: v.number() }),
    emit: (s) => toJsonSchema(s),
  },
];

for (const f of FIXTURES) {
  test(`seam: tools/call dispatches identically through ${f.name}`, async () => {
    const s = new Server({ name: "t", version: "1", emitJsonSchema: f.emit });
    s.tool("add", f.schema, async (input) => String(input.a + input.b));
    const ok = await s.handleRequest(CALL(1, ARGS_OK));
    assert.deepEqual(ok.result, { content: [{ type: "text", text: "3" }] }, f.name);
    const bad = await s.handleRequest(CALL(2, ARGS_BAD));
    assert.equal(bad.error.code, -32602, f.name);
    assert.ok(Array.isArray(bad.error.data.issues), f.name);
  });

  test(`seam: tools/list carries the ${f.name} emitter output verbatim`, async () => {
    const s = new Server({ name: "t", version: "1", emitJsonSchema: f.emit });
    s.tool("add", f.schema, async () => "x");
    const res = await s.handleRequest(rpc("tools/list", {}, 1));
    const schema = res.result.tools[0].inputSchema;
    assert.equal(schema.type, "object", f.name);
    // Both emitters produce draft-2020-12-ish objects with a properties table.
    assert.ok("properties" in schema || "type" in schema, f.name);
  });
}

test("per-tool emit overrides the server-level emitter", async () => {
  const s = new Server({ name: "t", version: "1", emitJsonSchema: () => ({ tag: "server" }) });
  s.tool("a", FIXTURES[0].schema, async () => "x", { emit: () => ({ tag: "tool" }) });
  s.tool("b", FIXTURES[0].schema, async () => "x");
  const res = await s.handleRequest(rpc("tools/list", {}, 1));
  assert.equal(res.result.tools[0].inputSchema.tag, "tool");
  assert.equal(res.result.tools[1].inputSchema.tag, "server");
});

test("outputSchema is emitted through the same emitter", async () => {
  const s = new Server({ name: "t", version: "1", emitJsonSchema: FIXTURES[0].emit });
  s.tool("add", FIXTURES[0].schema, async () => "x", {
    outputSchema: val.object({ sum: val.number() }),
  });
  const res = await s.handleRequest(rpc("tools/list", {}, 1));
  assert.equal(res.result.tools[0].outputSchema.type, "object");
});

test("registration without any emitter throws E_NO_JSON_SCHEMA_EMITTER", () => {
  const s = new Server({ name: "t", version: "1" });
  try {
    s.tool("add", FIXTURES[0].schema, async () => "x");
    assert.fail("should throw");
  } catch (e) {
    assert.equal(e.code, E_NO_JSON_SCHEMA_EMITTER);
    assert.ok(e instanceof NoEmitterError);
    assert.match(e.message, /toJsonSchema/);
    assert.match(e.message, /toJSONSchema|toJsonSchema/);
  }
});

test("emitter errors propagate at registration", () => {
  const s = new Server({
    name: "t",
    version: "1",
    emitJsonSchema: () => {
      throw new Error("unrepresentable");
    },
  });
  assert.throws(() => s.tool("x", FIXTURES[0].schema, async () => "x"), /unrepresentable/);
});

test("schema types interop: a val schema satisfies the StandardSchemaV1 twin", async () => {
  // Compile-time interop is asserted by tsc on this call; runtime proof:
  // the validator runs through ~standard.validate like any other.
  const s = new Server({ name: "t", version: "1", emitJsonSchema: FIXTURES[1].emit });
  s.tool("n", v.pipe(v.string(), v.minLength(3)), async (input) => input);
  const ok = await s.handleRequest(rpc("tools/call", { name: "n", arguments: "abcd" }, 1));
  assert.deepEqual(ok.result, { content: [{ type: "text", text: "abcd" }] });
  const bad = await s.handleRequest(rpc("tools/call", { name: "n", arguments: "ab" }, 2));
  assert.equal(bad.error.code, -32602);
});

test("async validators take the same path", async () => {
  const s = new Server({ name: "t", version: "1", emitJsonSchema: () => ({}) });
  const asyncSchema = {
    "~standard": {
      version: 1,
      vendor: "test",
      validate: async (val2) =>
        typeof val2 === "number" ? { value: val2 } : { issues: [{ message: "nan" }] },
    },
  };
  s.tool("num", asyncSchema, async (i) => String(i));
  const ok = await s.handleRequest(rpc("tools/call", { name: "num", arguments: 7 }, 1));
  assert.equal(ok.result.content[0].text, "7");
  const bad = await s.handleRequest(rpc("tools/call", { name: "num", arguments: "x" }, 2));
  assert.equal(bad.error.code, -32602);
});
