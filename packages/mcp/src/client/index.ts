// @chttp/mcp/client — typed MCP client (JSON-RPC 2.0) sharing the server's
// subset, schema seam, and protocol types.
//
//   import { Client, HttpClientTransport, toolDef } from "@chttp/mcp/client";
//
// Descriptors (ToolDef/ResourceDef/PromptDef) carry the Standard Schema
// validators; `client.call(def, args)` validates in both directions through
// `~standard.validate`. No Proxy — scriptc can't lower dynamic interception.

export { Client } from "./client.ts";
export { ClientToolError, ClientValidationError } from "./errors.ts";
export { FetchClientTransport } from "./fetch.ts";
export { HttpClientTransport, responseFromBody } from "./http.ts";
export { decodeSseEvents, SseDecoder } from "./sse.ts";
export {
  connectTarget,
  connectTcp,
  connectTls,
  dechunk,
  HttpTarget,
  parseHttpTarget,
  parseHttpResponse,
  SockReader,
} from "./sock.ts";
export type { HttpResponse } from "./sock.ts";
export { StdioClientTransport } from "./stdio.ts";
export { ClientTransport, promptDef, resourceDef, toolDef } from "./types.ts";

export type { HttpClientOpts } from "./http.ts";
export type { FetchClientOpts } from "./fetch.ts";
export type { StdioClientOpts } from "./stdio.ts";
export type { SseEvent } from "./sse.ts";
export type {
  ClientOpts,
  DefOut,
  GetPromptResult,
  InitializeResult,
  NotificationHandler,
  PromptDef,
  PromptInfo,
  ResourceDef,
  ResourceInfo,
  StdInput,
  StdOutput,
  ToolDef,
  ToolInfo,
} from "./types.ts";

// Protocol building blocks the client surface re-uses — callers writing
// handlers or custom transports get them without importing the server
// entry point.
export type {
  CallToolResult,
  JsonRpcRequest,
  JsonRpcResponse,
  ResourceContents,
  StandardSchemaV1,
} from "../types.ts";
export { JsonRpcError } from "../errors.ts";
