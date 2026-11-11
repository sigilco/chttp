// Child-process fixture for stdio.test.js: a Server over StdioTransport.
import { Server, StdioTransport, tool } from "../dist/esm/index.js";
import { echoSchema, emit } from "./helpers.js";

const s = new Server({ name: "stdio-test", version: "0.1.0", emitJsonSchema: emit });
tool(s, "add", echoSchema(), async (input) => String(input.a + input.b));
tool(s, "slow", echoSchema(), async (input, ctx) => {
  await ctx.progress(1, 2, "half");
  await new Promise((r) => setTimeout(r, 50));
  return "done";
});
tool(s, "boom", echoSchema(), async () => {
  throw new Error("kaput");
});
await new StdioTransport(s).serve();
process.stderr.write("serve resolved\n");
