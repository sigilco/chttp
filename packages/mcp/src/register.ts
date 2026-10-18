// Functional registration helpers — thin delegates to the Server methods for
// users who prefer a function style over method chaining:
//
//   const server = new Server({ name, version, emitJsonSchema });
//   tool(server, "add", schema, async ({ a, b }) => `${a + b}`);
//   resource(server, "file:///readme", readHandler);
//   prompt(server, "summarize", promptHandler);

import type { Server } from "./server.ts";
import type {
  PromptHandler,
  PromptOpts,
  ResourceHandler,
  ResourceOpts,
  StandardSchemaV1,
  ToolHandler,
  ToolOpts,
} from "./types.ts";

export function tool<Schema extends StandardSchemaV1, Out extends StandardSchemaV1 | null = null>(
  server: Server,
  name: string,
  schema: Schema,
  handler: ToolHandler<Schema>,
  opts?: ToolOpts<Out>,
): Server {
  server.tool(name, schema, handler, opts);
  return server;
}

export function resource(
  server: Server,
  uri: string,
  handler: ResourceHandler,
  opts?: ResourceOpts,
): Server {
  server.resource(uri, handler, opts);
  return server;
}

export function prompt(
  server: Server,
  name: string,
  handler: PromptHandler,
  opts?: PromptOpts,
): Server {
  server.prompt(name, handler, opts);
  return server;
}
