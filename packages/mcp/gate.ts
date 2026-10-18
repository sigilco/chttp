// Static coverage gate for @chttp/mcp. Exercises every public surface so
// `scriptc coverage gate.ts` must report 100%. Run via scripts/scriptc-gate.sh
// after `pnpm -r build`.

import {
  encodeSseComment,
  encodeSseEvent,
  encodeSseRetry,
  errorFor,
  errorResponse,
  isLogLevel,
  isNotification,
  levelIndex,
  logNotification,
  NoEmitterError,
  notification,
  parseBody,
  parseRequest,
  progressNotification,
  prompt,
  requestId,
  resource,
  resultResponse,
  runStdValidate,
  Server,
  SseSession,
  StreamableHttpTransport,
  tool,
  validatorFor,
  wrapToolError,
  wrapToolReturn,
} from "./src/index.ts";
import type { ContentBlock, JsonSchemaObject, StandardSchemaV1 } from "./src/index.ts";
import {
  Client,
  ClientToolError,
  ClientTransport,
  ClientValidationError,
  connectTarget,
  decodeSseEvents,
  dechunk,
  FetchClientTransport,
  HttpClientTransport,
  HttpResponse,
  parseHttpResponse,
  parseHttpTarget,
  promptDef,
  resourceDef,
  SockReader,
  SseDecoder,
  StdioClientTransport,
  toolDef,
} from "./src/client/index.ts";
import type { JsonRpcRequest, JsonRpcResponse } from "./src/index.ts";
import type { ToolDef } from "./src/client/index.ts";

// A transport stub for the gate: records requests, answers canned
// envelopes — the socket/fetch transports get their own coverage below.
class GateTransport extends ClientTransport {
  sent: JsonRpcRequest[] = [];
  response: JsonRpcResponse = { jsonrpc: "2.0", id: 0, result: {} };
  eventsOpened = 0;
  // Signatures must match the base exactly (SC1090); field writes from
  // outside the class are also refused, hence setResponse.
  setResponse(r: JsonRpcResponse): void {
    this.response = r;
  }
  request(req: JsonRpcRequest, timeoutMs: number): Promise<JsonRpcResponse> {
    void timeoutMs;
    this.sent.push(req);
    const r = this.response;
    r.id = req.id === undefined ? 0 : req.id;
    return Promise.resolve(r);
  }
  openEvents(timeoutMs: number): Promise<void> {
    void timeoutMs;
    this.eventsOpened += 1;
    return Promise.resolve();
  }
}

// A minimal conforming validator for gate purposes (the seam is structural).
function fakeSchema(): StandardSchemaV1 {
  const schema: StandardSchemaV1 = {
    "~standard": {
      version: 1,
      vendor: "gate",
      validate: function (v: unknown): StandardSchemaV1.Result<unknown> {
        return { value: v };
      },
    },
  };
  return schema;
}

function emit(s: StandardSchemaV1): JsonSchemaObject {
  void s;
  return { type: "object" };
}

export async function main(): Promise<string> {
  const server = new Server({
    name: "gate",
    version: "0.1.0",
    instructions: "gate server",
    emitJsonSchema: emit,
    capabilities: { tools: {}, logging: {} },
  });

  tool(server, "echo", fakeSchema(), async function (input, ctx) {
    await ctx.progress(0.5, 1);
    await ctx.log("info", { note: "ran" });
    return JSON.stringify(input);
  });
  server.tool(
    "sum",
    fakeSchema(),
    async function (input) {
      return { result: input };
    },
    {
      description: "sum",
      outputSchema: fakeSchema(),
      emit: emit,
    },
  );
  resource(server, "mcp://readme", async function (uri, ctx) {
    await ctx.log("debug", uri);
    return { contents: [{ uri: uri, mimeType: "text/plain", text: "hi" }] };
  });
  prompt(
    server,
    "greet",
    async function (args, ctx) {
      await ctx.log("notice", args["who"]);
      const block: ContentBlock = { type: "text", text: "hello " + args["who"] };
      return { messages: [{ role: "assistant", content: block }] };
    },
    { description: "greeting", args: [{ name: "who", required: true }] },
  );

  const reqs: string[] = [
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"c","version":"1"}}}',
    '{"jsonrpc":"2.0","method":"notifications/initialized"}',
    '{"jsonrpc":"2.0","id":2,"method":"ping"}',
    '{"jsonrpc":"2.0","id":3,"method":"tools/list"}',
    '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"echo","arguments":{"a":1},"_meta":{"progressToken":"tok"}}}',
    '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"missing","arguments":{}}}',
    '{"jsonrpc":"2.0","id":6,"method":"resources/list"}',
    '{"jsonrpc":"2.0","id":7,"method":"resources/read","params":{"uri":"mcp://readme"}}',
    '{"jsonrpc":"2.0","id":8,"method":"resources/templates/list"}',
    '{"jsonrpc":"2.0","id":9,"method":"prompts/list"}',
    '{"jsonrpc":"2.0","id":10,"method":"prompts/get","params":{"name":"greet","arguments":{"who":"x"}}}',
    '{"jsonrpc":"2.0","id":11,"method":"logging/setLevel","params":{"level":"warning"}}',
    '{"jsonrpc":"2.0","id":12,"method":"completion/complete","params":{}}',
    '{"jsonrpc":"2.0","id":13,"method":"bogus/method"}',
    '{"jsonrpc":"2.0","id":14,"method":"notifications/progress","params":{}}',
    '{"jsonrpc":"2.0","id":15,"method":"tools/call","params":{"name":"echo","arguments":{"z":9}}}',
  ];
  const out: string[] = [];
  for (let i = 0; i < reqs.length; i++) {
    const req = parseBody(reqs[i]);
    const res = await server.handleRequest(req);
    out.push(res === null ? "null" : JSON.stringify(res));
  }

  // Transport surfaces (Request consumption only — constructing one is a
  // Node-side concern; the ELF smoke drives handleRequest + SSE directly).
  const t = new StreamableHttpTransport(server, {
    endpoint: "/mcp",
    allowSseGet: true,
    maxBodyBytes: 1024,
  });
  const routeHandler = StreamableHttpTransport.route(server);
  const rpcRes = await t.handleRequest(parseBody(reqs[1]));
  void rpcRes;
  const webReq = new Request("http://localhost/mcp?stream=progress", { method: "GET" });
  const sseRes = await routeHandler(webReq);
  void sseRes;
  const postReq = new Request("http://localhost/mcp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: reqs[2],
  });
  const postRes = await routeHandler(postReq);
  void postRes;
  await t.pushProgress(null, notification("notifications/progress", { progress: 1 }));
  const sess = new SseSession("s1");
  void sess;
  await t.close();
  await t[Symbol.asyncDispose]();

  // Helpers.
  const parsed = parseRequest({ jsonrpc: "2.0", id: 7, method: "ping" });
  const idv = requestId(parsed);
  void idv;
  const notif = isNotification({ jsonrpc: "2.0", method: "notifications/initialized" });
  const e1 = errorResponse(idv, -32601, "nf", { hint: "x" });
  const e2 = errorFor(idv, new NoEmitterError("t"));
  const r1 = resultResponse(1, { ok: true });
  const w1 = wrapToolReturn("s");
  const w2 = wrapToolReturn({ type: "text", text: "b" } as ContentBlock);
  const w3 = wrapToolReturn(null);
  const w4 = wrapToolError(new Error("boom"));
  const n1 = notification("notifications/progress", { progress: 0.5 });
  const n2 = progressNotification("tok", 0.5, 1, "half");
  const n3 = logNotification("info", { d: 1 });
  const lv = levelIndex("warning") + (isLogLevel("error") ? 1 : 0);
  const s1 = encodeSseEvent("line1\nline2", "evt", "9");
  const s2 = encodeSseComment("ka");
  const s3 = encodeSseRetry(1500);
  const v = await runStdValidate(fakeSchema()["~standard"], { x: 1 });
  const vf = validatorFor(fakeSchema());
  const v2 = await vf({ y: 2 });

  // ---------- client coverage ----------
  const gate = new GateTransport();
  const client = new Client({ name: "gate-client", version: "0.1.0", transport: gate });
  client.onProgress((n) => {
    void n.method;
  });
  client.onNotification((n) => {
    void n.method;
  });
  gate.setResponse({
    jsonrpc: "2.0",
    id: 1,
    result: {
      protocolVersion: "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "gate-server", version: "0.1.0" },
    },
  });
  const init = await client.connect();
  gate.setResponse({
    jsonrpc: "2.0",
    id: 2,
    result: { tools: [{ name: "sum", inputSchema: {} }] },
  });
  const tools = await client.listTools();
  gate.setResponse({
    jsonrpc: "2.0",
    id: 3,
    result: { content: [{ type: "text", text: "3" }], structuredContent: { sum: 3 } },
  });
  const sumDef = toolDef("sum", fakeSchema(), fakeSchema());
  const sumOut = await client.call(sumDef, { a: 1 });
  const rawOut = await client.callTool("sum", { a: 1 });
  gate.setResponse({
    jsonrpc: "2.0",
    id: 4,
    result: { resources: [{ uri: "mcp://x", name: "x" }] },
  });
  const resList = await client.listResources();
  const prmList = await client.listPrompts();
  gate.setResponse({
    jsonrpc: "2.0",
    id: 5,
    result: { contents: [{ uri: "mcp://x", mimeType: "text/plain", text: "hi" }] },
  });
  const contents = await client.readResource("mcp://x");
  const resDef = resourceDef("mcp://x", fakeSchema());
  gate.setResponse({
    jsonrpc: "2.0",
    id: 6,
    result: { messages: [{ role: "user", content: {} }] },
  });
  const prm = await client.getPrompt("greet", { who: "x" });
  const prmDef = promptDef("greet", undefined, fakeSchema());
  await client.ping();
  await client.setLogLevel("warning");
  gate.setResponse({ jsonrpc: "2.0", id: 7, error: { code: -32601, message: "nope" } });
  let rpcErr = "";
  try {
    await client.callTool("missing", {});
  } catch (e) {
    rpcErr = String(e);
  }
  // Descriptor-driven server registration shares the same ToolDef.
  const regServer = new Server({ name: "reg", version: "0.1.0", emitJsonSchema: emit });
  regServer.toolDef(
    sumDef as ToolDef<unknown, unknown> & { input: StandardSchemaV1 },
    async (i) => i,
  );
  tool(
    regServer,
    sumDef as ToolDef<unknown, unknown> & { input: StandardSchemaV1 },
    async (i) => i,
  );
  // Transport constructors + pure helpers.
  const tgt = parseHttpTarget("http://localhost:9/mcp?x=1");
  const tgtTls = parseHttpTarget("https://example.com/");
  const httpT = new HttpClientTransport({ url: "http://localhost:9/mcp" });
  httpT.setOnNotification((n) => {
    void n.method;
  });
  const fetchT = new FetchClientTransport({ url: "http://localhost:9/mcp" });
  const stdioT = new StdioClientTransport({ command: "echo", args: ["x"] });
  const dec1 = new SseDecoder();
  const evs = dec1.feed('data: {"a":1}\n\nevent: ping\ndata: x\ndata: y\n\n');
  const evs2 = dec1.end();
  const evs3 = decodeSseEvents(": ka\ndata: z\n\n");
  const resp = parseHttpResponse(
    new TextEncoder().encode(
      "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\nx-a: b\r\n\r\n{}",
    ),
  );
  const dech = dechunk(new TextEncoder().encode("4\r\nabcd\r\n0\r\n\r\n"));
  const hr: HttpResponse = { status: 200, headers: {}, body: "b" };
  const sr = new SockReader();
  void sr;
  void connectTarget;
  await client.close();
  await stdioT.close();
  await httpT.close();
  void fetchT;
  const cve = new ClientValidationError("bad args", [{ m: 1 }]);
  const cte = new ClientToolError("tool failed", { isError: true });

  return (
    out.join("\n") +
    String(notif) +
    JSON.stringify(e1) +
    JSON.stringify(e2) +
    JSON.stringify(r1) +
    JSON.stringify(w1) +
    JSON.stringify(w2) +
    JSON.stringify(w3) +
    JSON.stringify(w4) +
    JSON.stringify(n1) +
    JSON.stringify(n2) +
    JSON.stringify(n3) +
    String(lv) +
    s1 +
    s2 +
    s3 +
    JSON.stringify(v) +
    JSON.stringify(v2) +
    JSON.stringify(init) +
    JSON.stringify(tools) +
    JSON.stringify(sumOut) +
    JSON.stringify(rawOut) +
    JSON.stringify(resList) +
    JSON.stringify(prmList) +
    JSON.stringify(contents) +
    JSON.stringify(prm) +
    rpcErr +
    String(resDef.uri) +
    String(prmDef.name) +
    String(tgt.port) +
    String(tgtTls.port) +
    String(evs.length) +
    String(evs2.length) +
    String(evs3.length) +
    JSON.stringify(resp.headers) +
    String(dech.length) +
    String(hr.status) +
    String(cve.issuesJson) +
    String(cte.code) +
    String(gate.eventsOpened)
  );
}
