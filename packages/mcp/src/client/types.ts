// Public client types for @chttp/mcp/client.
//
// Descriptors are the type-safety story in place of a typed RPC proxy
// (scriptc can't lower dynamic interception): a ToolDef carries the
// schemas, `call` infers I/O through StandardSchemaV1's type-level
// InferInput/InferOutput, and the same descriptors can drive server-side
// registration (`tool(server, def, handler)`).

import type {
  CallToolResult,
  GetPromptResult,
  JsonRpcRequest,
  JsonRpcResponse,
  PromptArgument,
  PromptDef,
  ResourceContents,
  ResourceDef,
  StandardSchemaV1,
  ToolDef,
} from "../types.ts";

export type { GetPromptResult, PromptDef, ResourceDef, ToolDef } from "../types.ts";

// Infers a descriptor's runtime types from the schemas it carries.
// Schemas absent from the def degrade to the untyped arm (unknown input,
// raw CallToolResult output).
export type StdInput<S> = S extends StandardSchemaV1 ? StandardSchemaV1.InferInput<S> : unknown;
export type StdOutput<S> = S extends StandardSchemaV1
  ? StandardSchemaV1.InferOutput<S>
  : CallToolResult;
// Descriptor output: schema-driven when present, the raw result shape when
// the def carries no output schema.
export type DefOut<S, Fallback> = S extends StandardSchemaV1
  ? StandardSchemaV1.InferOutput<S>
  : Fallback;

// Builds a ToolDef inferring I/O from the given Standard Schema validators.
// `toolDef("add", v.object({...}), v.object({...}))` gives `call` a fully
// typed signature; `toolDef("ping")` stays unknown -> CallToolResult.
export function toolDef<
  I extends StandardSchemaV1 | null = null,
  O extends StandardSchemaV1 | null = null,
>(name: string, input?: I, output?: O): ToolDef<StdInput<I>, DefOut<O, CallToolResult>> {
  const d: ToolDef<StdInput<I>, DefOut<O, CallToolResult>> = { name: name };
  if (input !== undefined && input !== null) {
    d.input = input;
  }
  if (output !== undefined && output !== null) {
    d.output = output;
  }
  return d;
}

export function resourceDef<O extends StandardSchemaV1 | null = null>(
  uri: string,
  output?: O,
  opts?: { name?: string; mimeType?: string },
): ResourceDef<DefOut<O, ResourceContents[]>> {
  const d: ResourceDef<DefOut<O, ResourceContents[]>> = { uri: uri };
  if (output !== undefined && output !== null) {
    d.output = output;
  }
  if (opts !== undefined && opts.name !== undefined) {
    d.name = opts.name;
  }
  if (opts !== undefined && opts.mimeType !== undefined) {
    d.mimeType = opts.mimeType;
  }
  return d;
}

export function promptDef<O extends StandardSchemaV1 | null = null>(
  name: string,
  args?: PromptArgument[],
  output?: O,
): PromptDef<DefOut<O, GetPromptResult>> {
  const d: PromptDef<DefOut<O, GetPromptResult>> = { name: name };
  if (args !== undefined) {
    d.args = args;
  }
  if (output !== undefined && output !== null) {
    d.output = output;
  }
  return d;
}

// The result of a successful initialize handshake, stored on the client.
export interface InitializeResult {
  protocolVersion: string;
  capabilities: { [k: string]: unknown };
  serverInfo: { name: string; version: string };
  instructions?: string;
}

// List-result element shapes (parsed shallowly — schema fields pass
// through as opaque records).
export interface ToolInfo {
  name: string;
  description?: string;
  inputSchema: { [k: string]: unknown };
  outputSchema?: { [k: string]: unknown };
}

export interface ResourceInfo {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface PromptInfo {
  name: string;
  description?: string;
  arguments?: PromptArgument[];
}

export interface ClientOpts {
  name: string;
  version: string;
  transport: ClientTransport;
  // Sent verbatim in initialize.params.capabilities.
  capabilities?: { [k: string]: unknown };
  // Request timeout in ms applied where the transport supports it
  // (socket connect/read; stdio reads). Default 30000.
  timeoutMs?: number;
}

// Notification handler: receives parsed server -> client requests without
// an id (notifications/progress, notifications/message, ...).
export type NotificationHandler = (n: JsonRpcRequest) => void;

// Transport contract. Declared as a base CLASS (not an interface): the
// client stores one as a field, and a function-bearing record can't live
// in a class field under the subset — a class member always can.
export class ClientTransport {
  _note: NotificationHandler | null = null;

  // Sends one request and resolves its matching response envelope.
  // Transports deliver notifications through the handler installed by
  // setOnNotification (inline in the response stream, or the GET stream).
  request(req: JsonRpcRequest, timeoutMs: number): Promise<JsonRpcResponse> {
    void req;
    void timeoutMs;
    return Promise.reject(new Error("ClientTransport.request not implemented"));
  }

  // Opens a long-lived notification channel (HTTP transports: the
  // ?stream=progress SSE feed). No-op by default; stdio has no separate
  // channel — notifications arrive on the same stream.
  openEvents(timeoutMs: number): Promise<void> {
    void timeoutMs;
    return Promise.resolve();
  }

  // Installed by Client.connect; every inbound notification lands here.
  setOnNotification(h: NotificationHandler): void {
    this._note = h;
  }

  // Delivers a notification to the installed handler (no-op before one
  // is set — the Client wires it in its constructor).
  emitNote(n: JsonRpcRequest): void {
    if (this._note !== null) {
      this._note(n);
    }
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}
