// ELF smoke for StdioTransport — built by `scriptc build` in test/elf.test.sh.
// A Server over stdin/stdout: pipe line-delimited JSON-RPC in, read lines out.

import { Server, StdioTransport } from "../src/index.ts";
import type { StandardSchemaV1 } from "../src/index.ts";

function echoSchema(): StandardSchemaV1 {
  return {
    "~standard": {
      version: 1,
      vendor: "elf-stdio",
      validate: function (v: unknown): unknown {
        return { value: v };
      },
    },
  };
}

const server: Server = new Server({
  name: "elf-stdio",
  version: "0.1.0",
  emitJsonSchema: function (): { [k: string]: unknown } {
    return { type: "object" };
  },
});

server.tool(
  "echo",
  echoSchema(),
  async function (input: unknown): Promise<string> {
    return "echo:" + JSON.stringify(input);
  },
  { description: "echoes arguments" },
);

const transport = new StdioTransport(server);
await transport.serve();
