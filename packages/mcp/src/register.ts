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
  ToolContext,
  ToolDef,
  ToolHandler,
  ToolOpts,
} from "./types.ts";

export function tool<Schema extends StandardSchemaV1, Out extends StandardSchemaV1 | null = null>(
  server: Server,
  name: string,
  schema: Schema,
  handler: ToolHandler<Schema>,
  opts?: ToolOpts<Out>,
): Server;
// Descriptor-driven overload: one ToolDef can feed both this registration
// and `client.call(def, args)` on the other end of the wire.
export function tool<I, O>(
  server: Server,
  def: ToolDef<I, O> & { input: StandardSchemaV1 },
  handler: (input: I, ctx: ToolContext) => unknown,
  opts?: ToolOpts,
): Server;
export function tool(
  server: Server,
  nameOrDef: string | (ToolDef<unknown, unknown> & { input: StandardSchemaV1 }),
  schemaOrHandler: unknown,
  handlerOrOpts: unknown,
  opts?: ToolOpts<StandardSchemaV1 | null>,
): Server {
  if (typeof nameOrDef === "string") {
    server.tool(nameOrDef, schemaOrHandler as StandardSchemaV1, handlerOrOpts as ToolHandler, opts);
    return server;
  }
  server.toolDef(
    nameOrDef,
    schemaOrHandler as (input: unknown, ctx: ToolContext) => unknown,
    handlerOrOpts === undefined ? undefined : (handlerOrOpts as ToolOpts<StandardSchemaV1 | null>),
  );
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
