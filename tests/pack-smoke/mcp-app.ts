// Pack smoke fixture: consumes @chttp/mcp + @chttp/val from their packed npm
// tarballs — the pairing from cutils#27. `tsc -p tsconfig.mcp.json` must
// type-check it (val schema into tool(), emitJsonSchema arrow, inferred
// handler input), and `scriptc build` must lower it to a native ELF that
// serves tools/list + tools/call via Server.handleRequest on argv.
import { parseBody, Server, tool } from "@chttp/mcp";
import * as v from "@chttp/val";

const server = new Server({
  name: "pack-smoke-mcp",
  version: "0.1.0",
  emitJsonSchema: (s) => v.toJsonSchema(s),
});

tool(
  server,
  "add_todo",
  v.object({ text: v.pipe(v.string(), v.minLength(1)) }),
  async function (input): Promise<string> {
    const text: unknown = input.text;
    return "added: " + (typeof text === "string" ? text : "?");
  },
);

const raw: string = process.argv.length > 2 ? process.argv[2] : "";
const req = parseBody(raw);
const res = await server.handleRequest(req);
console.log(res === null ? "NOTIFY" : JSON.stringify(res));
