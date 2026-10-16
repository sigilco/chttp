// @chttp/mcp — Model Context Protocol server (JSON-RPC 2.0) for chttp apps,
// authored inside the scriptc compilable subset.
//
//   import { Server, tool, resource, prompt, StreamableHttpTransport } from "@chttp/mcp";
//
// The Server is transport-agnostic: it dispatches parsed JsonRpcRequests and
// hands back envelopes. StreamableHttpTransport mounts it as a chttp route
// over HTTP POST + SSE progress. The dual schema seam — ~standard.validate
// for args, an injected JsonSchemaEmitter for protocol-required draft
// 2020-12 output — means the package ships zero validator dependencies.

export { PROTOCOL_VERSION, Server, SinkEntry, ToolCtx, ResCtx, PromptCtx } from "./server.ts";

export { tool, resource, prompt } from "./register.ts";

export {
  E_NO_JSON_SCHEMA_EMITTER,
  INTERNAL_ERROR,
  INVALID_PARAMS,
  INVALID_REQUEST,
  JsonRpcError,
  METHOD_NOT_FOUND,
  NoEmitterError,
  PARSE_ERROR,
} from "./errors.ts";

export {
  errorFor,
  errorResponse,
  isNotification,
  notification,
  parseBody,
  parseRequest,
  requestId,
  resultResponse,
} from "./jsonrpc.ts";

export { wrapToolError, wrapToolReturn } from "./dispatch.ts";

export {
  isLogLevel,
  levelIndex,
  LOG_LEVELS,
  logNotification,
  progressNotification,
} from "./progress.ts";

export { runStdValidate, validatorFor } from "./validate.ts";

export { encodeSseComment, encodeSseEvent, encodeSseRetry } from "./transport/sse.ts";

export { SseSession, StreamableHttpTransport } from "./transport/http.ts";

export type { Transport } from "./transport/stdio.ts";

export type {
  Annotations,
  CallToolResult,
  ContentBlock,
  InferOutput,
  JsonRpcErrorObject,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonSchemaEmitter,
  JsonSchemaObject,
  LogLevel,
  PromptArgument,
  PromptContext,
  PromptHandler,
  PromptMessage,
  PromptOpts,
  RequestId,
  ResourceContents,
  ResourceContext,
  ResourceHandler,
  ResourceOpts,
  ServerCapabilities,
  ServerOpts,
  StandardSchemaV1,
  StreamableHttpOpts,
  ToolContext,
  ToolHandler,
  ToolOpts,
  ToolReturn,
} from "./types.ts";
