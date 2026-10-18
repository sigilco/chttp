// ELF smoke entry for @chttp/mcp — built by `scriptc build` in
// test/elf.test.sh (not by tsc). Parses one JSON-RPC request from argv[2],
// dispatches it through Server.handleRequest, prints the response envelope,
// then prints an SSE progress frame — end-to-end proof that dispatch,
// validation, wrapping, and the SSE encoder all lower and run natively.

import { encodeSseEvent, parseBody, progressNotification, Server } from "../src/index.ts";
import type { StandardSchemaV1 } from "../src/index.ts";

function echoSchema(): StandardSchemaV1 {
  return {
    "~standard": {
      version: 1,
      vendor: "elf-smoke",
      validate: function (v: unknown): unknown {
        return { value: v };
      },
    },
  };
}

const server: Server = new Server({
  name: "elf-smoke",
  version: "0.1.0",
  emitJsonSchema: function (): { [k: string]: unknown } {
    return { type: "object" };
  },
});

server.tool(
  "echo",
  echoSchema(),
  async function (input: unknown): Promise<string> {
    return JSON.stringify(input);
  },
  { description: "echoes arguments" },
);

const raw: string = process.argv.length > 2 ? process.argv[2] : "";
const req = parseBody(raw);
const res = await server.handleRequest(req);
if (res === null) {
  console.log("NOTIFY");
} else {
  console.log(JSON.stringify(res));
}
console.log(encodeSseEvent(JSON.stringify(progressNotification("t", 1, 2, null)), null, null));
