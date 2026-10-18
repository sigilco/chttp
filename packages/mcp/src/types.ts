// Public protocol types for @chttp/mcp.
//
// StandardSchemaV1 below is a structural twin of the interface published by
// @standard-schema/spec (Standard Schema v1). The npm package is types-only
// and scriptc refuses even `import type` of it in the compiled module graph
// (SC2013), so the twin is declared here. Structural identity means any real
// Standard Schema v1 validator (valibot, zod/v4 standard entry, @chttp/val)
// is assignable to this twin and vice versa; the emitted .d.ts accepts all
// of them. The spec text: https://standardschema.dev

export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly "~standard": StandardSchemaV1.Props<Input, Output>;
}

export namespace StandardSchemaV1 {
  export interface Props<Input = unknown, Output = Input> {
    readonly version: 1;
    readonly vendor: string;
    readonly types?: Types<Input, Output> | undefined;
    // `unknown` (not `Result | Promise<Result>`): a Promise union arm is
    // SC2009 in the subset, and every conforming validator — whose real
    // signature returns `Result<Output> | Promise<Result<Output>>` — is
    // still assignable to a function returning `unknown`. runStdValidate
    // awaits the value and reads the shape at runtime.
    readonly validate: (value: unknown) => unknown;
  }
  export interface Types<Input = unknown, Output = Input> {
    readonly input: Input;
    readonly output: Output;
  }
  export type Result<Output> = SuccessResult<Output> | FailureResult;
  export interface SuccessResult<Output> {
    readonly value: Output;
    readonly issues?: undefined;
  }
  export interface FailureResult {
    readonly issues: ReadonlyArray<Issue>;
  }
  export interface Issue {
    readonly message: string;
    readonly path?: ReadonlyArray<PropertyKey | PathSegment> | undefined;
  }
  export interface PathSegment {
    readonly key: PropertyKey;
  }
  export type InferInput<Schema extends StandardSchemaV1> = NonNullable<
    Schema["~standard"]["types"]
  >["input"];
  export type InferOutput<Schema extends StandardSchemaV1> = NonNullable<
    Schema["~standard"]["types"]
  >["output"];
}

export type InferOutput<S extends StandardSchemaV1> = StandardSchemaV1.InferOutput<S>;

// Draft 2020-12 JSON Schema, as an opaque record. The package never inspects
// the emitted schema — it is forwarded verbatim into tools/list output.
export interface JsonSchemaObject {
  [k: string]: unknown;
}

// Emission seam: Standard Schema v1 standardizes validation only, while MCP
// requires draft 2020-12 JSON Schema for inputSchema/outputSchema. Emission
// is injected per tool (`emit`) or per server (`emitJsonSchema`); the package
// ships zero emitters. Adapters (@chttp/val's toJsonSchema, valibot's
// toJSONSchema) live in docs/examples.
export type JsonSchemaEmitter = (schema: StandardSchemaV1) => JsonSchemaObject;

export type RequestId = number | string;

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: RequestId;
  method: string;
  params?: { [k: string]: unknown };
}

export interface JsonRpcErrorObject {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: RequestId;
  result?: unknown;
  error?: JsonRpcErrorObject;
}

export interface Annotations {
  audience?: ("user" | "assistant")[];
  priority?: number;
}

export type ContentBlock =
  | { type: "text"; text: string; annotations?: Annotations }
  | { type: "image"; data: string; mimeType: string; annotations?: Annotations }
  | { type: "audio"; data: string; mimeType: string; annotations?: Annotations }
  | {
      type: "resource_link";
      uri: string;
      name: string;
      mimeType?: string;
      description?: string;
      annotations?: Annotations;
    }
  | {
      type: "resource";
      resource: { uri: string; mimeType: string; text?: string; blob?: string };
      annotations?: Annotations;
    };

export interface CallToolResult {
  content: ContentBlock[];
  structuredContent?: { [k: string]: unknown };
  isError?: boolean;
}

// The auto-wrap ladder a tool handler may return. Plain objects are wrapped
// as { content: [text-of-json], structuredContent: v }; a full CallToolResult
// passes through unchanged (the raw-envelope escape hatch).
export type ToolReturn =
  | string
  | ContentBlock
  | ContentBlock[]
  | CallToolResult
  | { [k: string]: unknown }
  | null;

export interface ServerCapabilities {
  tools?: { listChanged?: boolean };
  resources?: { subscribe?: boolean; listChanged?: boolean };
  prompts?: { listChanged?: boolean };
  logging?: Record<string, never>;
}

export interface ServerOpts {
  name: string;
  version: string;
  // Returned verbatim in the initialize response.
  instructions?: string;
  // Server-level emission seam; a per-tool `emit` overrides it.
  emitJsonSchema?: JsonSchemaEmitter;
  capabilities?: ServerCapabilities;
}

export type LogLevel =
  | "debug"
  | "info"
  | "notice"
  | "warning"
  | "error"
  | "critical"
  | "alert"
  | "emergency";

export interface ToolContext {
  // Emits a notifications/progress event. progressToken echoes the client's
  // params._meta.progressToken when one was sent with the tools/call.
  progress(progress: number, total?: number, message?: string): Promise<void>;
  // Emits a notifications/message event when level >= the level set by
  // logging/setLevel (default "info").
  log(level: LogLevel, data: unknown): Promise<void>;
}

export interface ResourceContext {
  log(level: LogLevel, data: unknown): Promise<void>;
}

export interface PromptContext {
  log(level: LogLevel, data: unknown): Promise<void>;
}

export type ResourceContents =
  | { uri: string; mimeType: string; text: string }
  | { uri: string; mimeType: string; blob: string };

export type PromptMessage = {
  role: "user" | "assistant";
  content: ContentBlock;
};

export interface PromptArgument {
  name: string;
  description?: string;
  required?: boolean;
}

export interface ToolOpts<Out extends StandardSchemaV1 | null = null> {
  description?: string;
  outputSchema?: Out;
  // Per-tool emission seam; overrides the server-level emitJsonSchema.
  emit?: JsonSchemaEmitter;
}

// ---------- shared descriptors (client calls + server registration) ----------
//
// The typed-RPC story: scriptc can't lower a Proxy, so a descriptor carries
// the schemas and both sides consume it — `client.call(def, args)` validates
// args/result, `server.toolDef(def, handler)` registers the same name/schema
// pair. `I`/`O` are phantom markers the `toolDef`/`resourceDef`/`promptDef`
// helpers fill from the schemas' InferInput/InferOutput.
export interface ToolDef<I = unknown, O = CallToolResult> {
  name: string;
  input?: StandardSchemaV1 | null;
  output?: StandardSchemaV1 | null;
}

export interface ResourceDef<O = ResourceContents[]> {
  uri: string;
  name?: string;
  mimeType?: string;
  output?: StandardSchemaV1 | null;
}

export interface GetPromptResult {
  description?: string;
  messages: { role: string; content: { [k: string]: unknown } }[];
}

export interface PromptDef<O = GetPromptResult> {
  name: string;
  args?: PromptArgument[];
  output?: StandardSchemaV1 | null;
}

export interface ResourceOpts {
  name?: string;
  description?: string;
  mimeType?: string;
}

export interface PromptOpts {
  description?: string;
  args?: PromptArgument[];
}

// Handlers erase to `=> unknown` on purpose. Two subset constraints meet
// here: a declared `Promise<T>` return records `(u, u) => Promise<erased T>`
// on the stored function, and a user handler returning `Promise<string>`
// has no lowering into `Promise<unknown>` at the erased call site
// (Promise<T> -> Promise<unknown> doesn't convert). Declaring the return
// `unknown` makes every async handler's value convert by identity — the
// dispatcher awaits the unknown result and runs it through the auto-wrap
// ladder. Write `async` and return ToolReturn shapes; the tsc surface keeps
// `input` typed via InferOutput but the return is verified by the wrap
// ladder at runtime, not the type system.
export type ToolHandler<Schema extends StandardSchemaV1 = StandardSchemaV1> = (
  input: StandardSchemaV1.InferOutput<Schema>,
  ctx: ToolContext,
) => unknown;

export type ResourceHandler = (uri: string, ctx: ResourceContext) => unknown;

export type PromptHandler = (args: { [k: string]: string }, ctx: PromptContext) => unknown;

// Transport seam. The shipped StreamableHttpTransport is the production impl;
// the interface is the contract a stdio transport (v2, wiring example in
// examples/integrations/mcp-stdio/) implements.
export interface Transport {
  // Handle a single JSON-RPC request. Returns the response envelope, or null
  // for notifications (no `id` field on the request).
  handleRequest(req: JsonRpcRequest): Promise<JsonRpcResponse | null>;
  // SSE progress sink: called when a tool wants to emit progress. The
  // transport decides whether to actually push (HTTP+SSE), buffer, or no-op
  // (stdio in v1 — no async feedback channel).
  pushProgress?(sessionId: string | null, notification: JsonRpcRequest): Promise<void>;
  // Optional: shut down the transport (HTTP server close, stdio flush).
  close?(): Promise<void>;
}

export interface StreamableHttpOpts {
  // SSE endpoint base path, matched against the request path. Default "/mcp".
  endpoint?: string;
  // Whether to accept SSE GET (?stream=progress) for progress-only clients.
  // Default true. When false the transport only supports POST + progress
  // delivered to sessions opened on other connections.
  allowSseGet?: boolean;
  // Session ID generator. Default: crypto.randomUUID(). v1 sets the
  // Mcp-Session-Id header but does not track sessions (set-but-unused; see
  // docs/streamable-http-coverage.md).
  sessionId?: () => string;
  // Maximum request body size in bytes. Default 1048576 (1MB).
  maxBodyBytes?: number;
}
