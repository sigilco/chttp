// todo-mcp: the canonical small @chttp/mcp server — three tools, one
// resource, one prompt — mounted as a Streamable HTTP route. Compile-checks
// under scriptc; run it under node with any Request -> Response host.
//
//   pnpm exec tsx main.ts          (or compile into your chttp app)
//   curl -X POST localhost:8787/mcp -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

import { Server, StreamableHttpTransport, tool } from "@chttp/mcp";
import * as v from "@chttp/val";

// In-memory store — the point is the registration/dispatch shape, not the data.
const todos: string[] = [];

export const server = new Server({
  name: "todo-mcp",
  version: "0.1.0",
  instructions: "A tiny todo list exposed over MCP.",
  emitJsonSchema: (s) => v.toJsonSchema(s),
  capabilities: { logging: {} },
});

tool(
  server,
  "add_todo",
  v.object({ text: v.pipe(v.string(), v.minLength(1)) }),
  async (input) => {
    todos.push(input.text);
    return `added #${todos.length}: ${input.text}`;
  },
  { description: "Append a todo item" },
);

tool(
  server,
  "list_todos",
  v.object({}),
  async (_input, ctx) => {
    await ctx.log("info", `listing ${todos.length} todos`);
    return todos.map((t, i) => `${i + 1}. ${t}`).join("\n") || "(empty)";
  },
  { description: "List all todo items" },
);

tool(
  server,
  "slow_task",
  v.object({ steps: v.pipe(v.number(), v.integer(), v.minValue(1)) }),
  async (input, ctx) => {
    for (let i = 0; i < input.steps; i++) {
      // Emits notifications/progress to open SSE sessions; the progressToken
      // echoes the caller's params._meta.progressToken.
      await ctx.progress(i + 1, input.steps, `step ${i + 1}`);
    }
    return `did ${input.steps} steps`;
  },
  { description: "Demonstrates progress notifications" },
);

server.resource(
  "todo:///summary",
  async (uri, ctx) => {
    await ctx.log("info", "summary read");
    return {
      contents: [{ uri, mimeType: "text/plain", text: `${todos.length} items` }],
    };
  },
  { name: "todo-summary", mimeType: "text/plain" },
);

server.prompt(
  "prioritize",
  async (args) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `Prioritize this list for ${args.who || "me"}:\n${todos.join("\n")}`,
        },
      },
    ],
  }),
  {
    description: "Draft a prioritization request",
    args: [{ name: "who", description: "whom the list is for" }],
  },
);

// The route is host-agnostic: mount it on chttp, a fetch export, or an
// undici/node server. Progress over SSE: GET /mcp?stream=progress.
export const route = StreamableHttpTransport.route(server, { endpoint: "/mcp" });

// Node host for local play (not part of the package surface):
//   import { createServer } from "node:http";
//   createServer(async (req, res) => { ... }).listen(8787);
