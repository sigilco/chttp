// ELF client smoke — the mirror of elf-smoke.ts for @chttp/mcp/client.
// A node:net loopback HTTP/1.1 server fronts Server.handleRequest (plus an
// SSE progress frame), and the real HttpClientTransport drives the socket
// client against it inside the compiled binary: initialize, tools/call,
// resources/read, a JSON-RPC error passthrough, and the events stream.

import { createServer, Socket } from "node:net";
import { Server, parseBody, encodeSseEvent, progressNotification } from "../src/index.ts";
import type { JsonRpcRequest, StandardSchemaV1 } from "../src/index.ts";
import { Client, HttpClientTransport, toolDef } from "../src/client/index.ts";

function echoSchema(): StandardSchemaV1 {
  return {
    "~standard": {
      version: 1,
      vendor: "elf-smoke",
      validate: function (v: unknown): unknown {
        const o = v as { [k: string]: unknown };
        if (o !== null && typeof o === "object" && o["bad"] === true) {
          return { issues: [{ message: "bad is set" }] };
        }
        return { value: v };
      },
    },
  };
}

const server: Server = new Server({
  name: "elf-client-smoke",
  version: "0.1.0",
  emitJsonSchema: function (): { [k: string]: unknown } {
    return { type: "object" };
  },
});

const echoDef = toolDef("echo", echoSchema(), echoSchema());
server.toolDef(
  echoDef as typeof echoDef & { input: StandardSchemaV1 },
  async function (input: unknown): Promise<unknown> {
    return { structured: input };
  },
);
server.resource("mcp://readme", async function (uri: string): Promise<unknown> {
  return { contents: [{ uri: uri, mimeType: "text/plain", text: "readme body" }] };
});

// One HTTP/1.1 request in, one JSON-RPC dispatch out. GET ?stream=progress
// answers a single SSE frame then closes — enough to prove the incremental
// SSE decode path on the client.
const dec = new TextDecoder();
const srv = createServer((s: Socket) => {
  let buf = "";
  s.on("data", (chunk: Uint8Array) => {
    buf += dec.decode(chunk);
    const headEnd = buf.indexOf("\r\n\r\n");
    if (headEnd < 0) {
      return;
    }
    const head = buf.slice(0, headEnd);
    const first = head.split("\r\n")[0];
    if (first.indexOf("GET ") === 0) {
      const frame = encodeSseEvent(
        JSON.stringify(progressNotification("t1", 0.5, 1, null)),
        null,
        null,
      );
      const body = frame;
      s.write(
        "HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\ncontent-length: " +
          String(body.length) +
          "\r\nconnection: close\r\n\r\n" +
          body,
      );
      s.end();
      return;
    }
    const clStart = head.toLowerCase().indexOf("content-length:");
    let len = 0;
    if (clStart >= 0) {
      const rest = head.slice(clStart + 15);
      const eol = rest.indexOf("\r\n");
      len = Number(eol < 0 ? rest : rest.slice(0, eol).trim());
    }
    const body = buf.slice(headEnd + 4);
    if (body.length < len) {
      return;
    }
    const payload = body.slice(0, len);
    void (async function (): Promise<void> {
      let status = 200;
      let out = "";
      try {
        const req: JsonRpcRequest = parseBody(payload);
        const res = await server.handleRequest(req);
        if (res === null) {
          status = 202;
        } else {
          out = JSON.stringify(res);
        }
      } catch (e) {
        status = 400;
        out = JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: String(e) },
        });
      }
      s.write(
        "HTTP/1.1 " +
          String(status) +
          " OK\r\ncontent-type: application/json\r\nmcp-session-id: sess-1\r\ncontent-length: " +
          String(out.length) +
          "\r\nconnection: close\r\n\r\n" +
          out,
      );
      s.end();
    })();
  });
});

// net.Server#address() has no lowering (its result union defeats the
// record check), so bind a fixed port and walk forward on EADDRINUSE.
let bound = false;
function tryListen(port: number): void {
  srv.once("error", function (): void {
    if (bound || port >= 18340) {
      console.log("FAIL: no free port");
      return;
    }
    tryListen(port + 1);
  });
  srv.listen(port, "127.0.0.1", function (): void {
    bound = true;
    runClient(port);
  });
}

function runClient(port: number): void {
  void (async function (): Promise<void> {
    const transport = new HttpClientTransport({
      url: "http://127.0.0.1:" + String(port) + "/mcp",
    });
    const client = new Client({ name: "elf-client", version: "0.1.0", transport: transport });
    let sawProgress = "";
    client.onProgress((n) => {
      sawProgress = n.method;
    });
    const init = await client.connect();
    console.log("server:", init.serverInfo.name);
    console.log("session:", transport.sessionId());

    const out = await client.call(echoDef, { hi: 7 });
    console.log("call:", JSON.stringify(out));

    const contents = await client.readResource("mcp://readme");
    console.log("resource:", contents.length > 0 ? "contents" : "empty");

    const tools = await client.listTools();
    console.log("tools:", tools.length);

    let badArgs = "";
    try {
      await client.call(echoDef, { bad: true });
    } catch (e) {
      badArgs = String(e).slice(0, 40);
    }
    console.log("validation:", badArgs.length > 0 ? "rejected" : "MISSED");

    let rpcErr = "";
    try {
      await client.callTool("missing-tool", {});
    } catch (e) {
      rpcErr = String(e);
    }
    console.log("rpcErr:", rpcErr.indexOf("JsonRpcError") >= 0 ? "passthrough" : rpcErr);

    await transport.openEvents(5000);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 200);
    });
    console.log("progress:", sawProgress);
    await client.close();
    srv.close();
    console.log("elf-client-smoke OK");
  })().catch((e: unknown) => {
    console.log("FAIL:", String(e));
    srv.close();
  });
}

tryListen(18310);
