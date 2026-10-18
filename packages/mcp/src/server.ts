// The Server class: transport-agnostic JSON-RPC 2.0 MCP core.
//
// Server only knows JSON-RPC — transports (StreamableHttpTransport, a stdio
// shim) feed it parsed envelopes and carry back responses. Registration data
// lives in parallel arrays (function-bearing records can't be class fields);
// emitted JSON Schemas are stored as serialized JSON text for the same
// reason.

import {
  errorFor,
  errorResponse,
  isNotification,
  parseRequest,
  requestId,
  resultResponse,
} from "./jsonrpc.ts";
import { INVALID_PARAMS } from "./errors.ts";
import { isLogLevel, levelIndex, logNotification, progressNotification } from "./progress.ts";
import {
  emitSchemaJson,
  resolveEmitter,
  validatorFor,
  type StdOutcome,
  type ValidateFn,
} from "./validate.ts";
import { wrapToolError, wrapToolReturn } from "./dispatch.ts";
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  JsonSchemaEmitter,
  LogLevel,
  PromptContext,
  PromptHandler,
  PromptMessage,
  PromptOpts,
  RequestId,
  ResourceContext,
  ResourceContents,
  ResourceHandler,
  ResourceOpts,
  ServerOpts,
  StandardSchemaV1,
  ToolContext,
  ToolDef,
  ToolHandler,
  ToolOpts,
} from "./types.ts";

// The MCP spec revision this package implements (2025-06-18). Pinned; a spec
// revision bump is a v2 of this package.
export const PROTOCOL_VERSION = "2025-06-18";

// Handler slots erase to `=> unknown` on purpose: scriptc has no lowering for
// Promise<T> -> Promise<unknown> conversions at an erased call site, but any
// value (a Promise included) converts to `unknown` for free. The dispatch
// sites `await` the slot's unknown result to unwrap it.
type ToolFn = (input: unknown, ctx: ToolContext) => unknown;
type ResFn = (uri: string, ctx: ResourceContext) => unknown;
type PrmFn = (args: { [k: string]: string }, ctx: PromptContext) => unknown;

function isRecord(v: unknown): boolean {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// One progress/log feed a transport registered on this server. `push` gets
// the serialized notification; `open` goes false when the transport tears it
// down (broadcasts skip closed entries — splice would shift live indexes).
export class SinkEntry {
  push: (json: string) => void;
  open: boolean;
  constructor(push: (json: string) => void) {
    this.push = push;
    this.open = true;
  }
}

export class ToolCtx implements ToolContext {
  _server: Server;
  _progressToken: RequestId | null;
  constructor(server: Server, progressToken: RequestId | null) {
    this._server = server;
    this._progressToken = progressToken;
  }
  async progress(progress: number, total?: number, message?: string): Promise<void> {
    const t = total === undefined ? null : total;
    const m = message === undefined ? null : message;
    this._server._broadcast(progressNotification(this._progressToken, progress, t, m));
  }
  async log(level: LogLevel, data: unknown): Promise<void> {
    this._server._emitLog(level, data);
  }
}

export class ResCtx implements ResourceContext {
  _server: Server;
  constructor(server: Server) {
    this._server = server;
  }
  async log(level: LogLevel, data: unknown): Promise<void> {
    this._server._emitLog(level, data);
  }
}

export class PromptCtx implements PromptContext {
  _server: Server;
  constructor(server: Server) {
    this._server = server;
  }
  async log(level: LogLevel, data: unknown): Promise<void> {
    this._server._emitLog(level, data);
  }
}

export class Server {
  _name: string;
  _version: string;
  _instructions: string | null;
  _emit: JsonSchemaEmitter | null;
  // Declared capabilities, JSON-encoded (plain records can't nest in class
  // fields under the subset; a string always can).
  _capsJson: string;
  _logLevel: string;
  _initialized: boolean;

  _toolNames: string[];
  _toolDescs: (string | null)[];
  _toolInputJson: string[];
  _toolOutputJson: (string | null)[];
  _toolValidate: ValidateFn[];
  _toolHandlers: ToolFn[];

  _resUris: string[];
  _resNames: (string | null)[];
  _resDescs: (string | null)[];
  _resMimes: (string | null)[];
  _resHandlers: ResFn[];

  _prNames: string[];
  _prDescs: (string | null)[];
  _prArgsJson: (string | null)[];
  _prHandlers: PrmFn[];

  _sinks: SinkEntry[];

  constructor(opts: ServerOpts) {
    this._name = String(opts.name);
    this._version = String(opts.version);
    this._instructions =
      opts.instructions === undefined || opts.instructions === null
        ? null
        : String(opts.instructions);
    this._emit =
      opts.emitJsonSchema === undefined || opts.emitJsonSchema === null
        ? null
        : opts.emitJsonSchema;
    this._capsJson = JSON.stringify(
      opts.capabilities === undefined || opts.capabilities === null ? {} : opts.capabilities,
    );
    this._logLevel = "debug";
    this._initialized = false;

    this._toolNames = [];
    this._toolDescs = [];
    this._toolInputJson = [];
    this._toolOutputJson = [];
    this._toolValidate = [];
    this._toolHandlers = [];

    this._resUris = [];
    this._resNames = [];
    this._resDescs = [];
    this._resMimes = [];
    this._resHandlers = [];

    this._prNames = [];
    this._prDescs = [];
    this._prArgsJson = [];
    this._prHandlers = [];

    this._sinks = [];
  }

  // ---------- registration ----------

  tool<Schema extends StandardSchemaV1, Out extends StandardSchemaV1 | null = null>(
    name: string,
    schema: Schema,
    handler: ToolHandler<Schema>,
    opts?: ToolOpts<Out>,
  ): this {
    const toolEmit =
      opts !== undefined && opts.emit !== undefined && opts.emit !== null ? opts.emit : null;
    const emit = resolveEmitter(toolEmit, this._emit, name);
    this._toolInputJson.push(emitSchemaJson(emit, schema));
    // Declared at StandardSchemaV1 — not `Out` — so the narrow stays in the
    // compilable union set (generic narrowing degrades to `Out & {}`, SC2009).
    const outSchema: StandardSchemaV1 | null =
      opts !== undefined && opts.outputSchema !== undefined && opts.outputSchema !== null
        ? opts.outputSchema
        : null;
    if (outSchema !== null) {
      this._toolOutputJson.push(emitSchemaJson(emit, outSchema));
    } else {
      this._toolOutputJson.push(null);
    }
    this._toolNames.push(name);
    this._toolDescs.push(
      opts !== undefined && opts.description !== undefined ? opts.description : null,
    );
    this._toolValidate.push(validatorFor(schema));
    // Inside a generic instantiation `handler` keeps its declared erased
    // signature (`(u, u) => Promise<unknown>`) no matter how it's cast —
    // a user handler returning Promise<string> then fails to convert at the
    // erased call. Re-admitting through a non-generic param records the
    // erased `=> unknown` shape the slot actually invokes.
    this._pushToolHandler(handler as unknown as ToolFn);
    return this;
  }

  // Descriptor-driven registration: the same ToolDef the client calls
  // through can register the tool here, keeping name/schemas consistent
  // across the wire. `def.input` is required (a no-args tool's def simply
  // omits it — give the descriptor an empty-object schema to register).
  // `def.output` fills opts.outputSchema unless already set.
  toolDef<I, O>(
    def: ToolDef<I, O> & { input: StandardSchemaV1 },
    handler: (input: I, ctx: ToolContext) => unknown,
    opts?: ToolOpts<StandardSchemaV1 | null>,
  ): this {
    const o: ToolOpts<StandardSchemaV1 | null> = {};
    if (opts !== undefined && opts.description !== undefined) {
      o.description = opts.description;
    }
    if (opts !== undefined && opts.emit !== undefined && opts.emit !== null) {
      o.emit = opts.emit;
    }
    const optOut: StandardSchemaV1 | null =
      opts !== undefined && opts.outputSchema !== undefined && opts.outputSchema !== null
        ? opts.outputSchema
        : null;
    const outSchema: StandardSchemaV1 | null =
      def.output !== undefined && def.output !== null ? def.output : optOut;
    if (outSchema !== null) {
      o.outputSchema = outSchema;
    }
    // Passing `handler` to the non-generic _toolDefSlot param records the
    // erased `=> unknown` signature; a cast alone would not (see tool()).
    this._toolDefSlot(def.name, def.input, handler as unknown as ToolFn, o);
    return this;
  }

  _toolDefSlot(
    name: string,
    schema: StandardSchemaV1,
    handler: ToolFn,
    o: ToolOpts<StandardSchemaV1 | null>,
  ): this {
    return this.tool(name, schema, handler, o);
  }

  _pushToolHandler(h: ToolFn): void {
    this._toolHandlers.push(h);
  }

  resource(uri: string, handler: ResourceHandler, opts?: ResourceOpts): this {
    this._resUris.push(uri);
    this._resNames.push(opts !== undefined && opts.name !== undefined ? opts.name : null);
    this._resDescs.push(
      opts !== undefined && opts.description !== undefined ? opts.description : null,
    );
    this._resMimes.push(opts !== undefined && opts.mimeType !== undefined ? opts.mimeType : null);
    this._pushResHandler(handler as unknown as ResFn);
    return this;
  }

  _pushResHandler(h: ResFn): void {
    this._resHandlers.push(h);
  }

  prompt(name: string, handler: PromptHandler, opts?: PromptOpts): this {
    this._prNames.push(name);
    this._prDescs.push(
      opts !== undefined && opts.description !== undefined ? opts.description : null,
    );
    this._prArgsJson.push(
      opts !== undefined && opts.args !== undefined ? JSON.stringify(opts.args) : null,
    );
    this._pushPrmHandler(handler as unknown as PrmFn);
    return this;
  }

  _pushPrmHandler(h: PrmFn): void {
    this._prHandlers.push(h);
  }

  // ---------- sink registry (progress/log feed for transports) ----------

  // Registers a feed; the transport gets the entry back so close() can mark
  // it dead. Every serialized notification is fanned out to open sinks.
  registerSink(push: (json: string) => void): SinkEntry {
    const e = new SinkEntry(push);
    this._sinks.push(e);
    return e;
  }

  _broadcast(n: JsonRpcRequest): void {
    const json = JSON.stringify(n);
    for (let i = 0; i < this._sinks.length; i++) {
      const s = this._sinks[i];
      if (s.open) {
        s.push(json);
      }
    }
  }

  _emitLog(level: LogLevel, data: unknown): void {
    if (levelIndex(level) < levelIndex(this._logLevel)) {
      return;
    }
    this._broadcast(logNotification(level, data));
  }

  // ---------- dispatch ----------

  async handleRequest(req: JsonRpcRequest): Promise<JsonRpcResponse | null> {
    let checked: JsonRpcRequest;
    try {
      checked = parseRequest(req);
    } catch (e) {
      return errorFor(null, e);
    }
    if (isNotification(checked)) {
      // JSON-RPC: notifications are never answered — including unknown ones.
      return null;
    }
    const id = requestId(checked) as RequestId;
    const method = checked.method;
    try {
      if (method === "initialize") {
        return resultResponse(id, this._initializeResult());
      }
      if (method === "ping") {
        return resultResponse(id, {});
      }
      if (method === "tools/list") {
        return resultResponse(id, this._toolsList());
      }
      if (method === "tools/call") {
        return await this._toolsCall(id, checked);
      }
      if (method === "resources/list") {
        return resultResponse(id, this._resourcesList());
      }
      if (method === "resources/read") {
        return await this._resourcesRead(id, checked);
      }
      if (method === "resources/templates/list") {
        return resultResponse(id, { resourceTemplates: [] });
      }
      if (method === "prompts/list") {
        return resultResponse(id, this._promptsList());
      }
      if (method === "prompts/get") {
        return await this._promptsGet(id, checked);
      }
      if (method === "logging/setLevel") {
        return this._setLevel(id, checked);
      }
      if (method === "completion/complete") {
        // v1 has no completion providers; honest empty result.
        return resultResponse(id, { completion: { values: [], total: 0, hasMore: false } });
      }
      if (method.indexOf("notifications/") === 0) {
        // One-way methods carrying an id are client noise; never answered.
        return null;
      }
      return errorResponse(id, -32601, "Method not found: " + method);
    } catch (e) {
      return errorFor(id, e);
    }
  }

  _initializeResult(): { [k: string]: unknown } {
    this._initialized = true;
    const caps: { [k: string]: unknown } = {};
    const opt = JSON.parse(this._capsJson) as { [k: string]: unknown };
    if (this._toolNames.length > 0 || opt["tools"] !== undefined) {
      caps["tools"] = opt["tools"] === undefined ? {} : opt["tools"];
    }
    if (this._resUris.length > 0 || opt["resources"] !== undefined) {
      caps["resources"] = opt["resources"] === undefined ? {} : opt["resources"];
    }
    if (this._prNames.length > 0 || opt["prompts"] !== undefined) {
      caps["prompts"] = opt["prompts"] === undefined ? {} : opt["prompts"];
    }
    if (opt["logging"] !== undefined) {
      caps["logging"] = opt["logging"];
    }
    // Open record: expanding writes on a non-empty literal are dropped when
    // scriptc lowers the packed dist JS (see jsonrpc.ts resultResponse).
    const r: { [k: string]: unknown } = {};
    r["protocolVersion"] = PROTOCOL_VERSION;
    r["capabilities"] = caps;
    r["serverInfo"] = { name: this._name, version: this._version };
    if (this._instructions !== null) {
      r["instructions"] = this._instructions;
    }
    return r;
  }

  _toolsList(): { [k: string]: unknown } {
    const tools: { [k: string]: unknown }[] = [];
    for (let i = 0; i < this._toolNames.length; i++) {
      const t: { [k: string]: unknown } = {};
      t["name"] = this._toolNames[i];
      t["inputSchema"] = JSON.parse(this._toolInputJson[i]);
      const d = this._toolDescs[i];
      if (d !== null) {
        t["description"] = d;
      }
      const o = this._toolOutputJson[i];
      if (o !== null) {
        t["outputSchema"] = JSON.parse(o);
      }
      tools.push(t);
    }
    return { tools: tools };
  }

  _progressTokenOf(req: JsonRpcRequest): RequestId | null {
    const params = req.params;
    if (params === undefined || params === null) {
      return null;
    }
    const meta = params["_meta"];
    if (!isRecord(meta)) {
      return null;
    }
    const tok = (meta as { [k: string]: unknown })["progressToken"];
    if (typeof tok === "string" || typeof tok === "number") {
      return tok;
    }
    return null;
  }

  async _toolsCall(id: RequestId, req: JsonRpcRequest): Promise<JsonRpcResponse> {
    const params = req.params === undefined || req.params === null ? {} : req.params;
    const name = params["name"];
    if (typeof name !== "string" || name.length === 0) {
      return errorResponse(id, INVALID_PARAMS, "Invalid params: tools/call needs a name string");
    }
    let idx = -1;
    for (let i = 0; i < this._toolNames.length; i++) {
      if (this._toolNames[i] === name) {
        idx = i;
      }
    }
    if (idx < 0) {
      return errorResponse(id, INVALID_PARAMS, "Unknown tool: " + name);
    }
    let args = params["arguments"];
    if (args === undefined || args === null) {
      args = {};
    }
    const checked: StdOutcome = await this._toolValidate[idx](args);
    if (checked.issues !== null) {
      return errorResponse(id, INVALID_PARAMS, 'Invalid arguments for tool "' + name + '"', {
        issues: checked.issues,
      });
    }
    const ctx = new ToolCtx(this, this._progressTokenOf(req));
    try {
      const raw = this._toolHandlers[idx](checked.value, ctx);
      const v = await (raw as Promise<unknown>);
      return resultResponse(id, wrapToolReturn(v));
    } catch (e) {
      return resultResponse(id, wrapToolError(e));
    }
  }

  _resourcesList(): { [k: string]: unknown } {
    const resources: { [k: string]: unknown }[] = [];
    for (let i = 0; i < this._resUris.length; i++) {
      const r: { [k: string]: unknown } = {};
      r["uri"] = this._resUris[i];
      const n = this._resNames[i];
      r["name"] = n === null ? this._resUris[i] : n;
      const d = this._resDescs[i];
      if (d !== null) {
        r["description"] = d;
      }
      const m = this._resMimes[i];
      if (m !== null) {
        r["mimeType"] = m;
      }
      resources.push(r);
    }
    return { resources: resources };
  }

  async _resourcesRead(id: RequestId, req: JsonRpcRequest): Promise<JsonRpcResponse> {
    const params = req.params === undefined || req.params === null ? {} : req.params;
    const uri = params["uri"];
    if (typeof uri !== "string" || uri.length === 0) {
      return errorResponse(id, INVALID_PARAMS, "Invalid params: resources/read needs a uri string");
    }
    let idx = -1;
    for (let i = 0; i < this._resUris.length; i++) {
      if (this._resUris[i] === uri) {
        idx = i;
      }
    }
    if (idx < 0) {
      return errorResponse(id, INVALID_PARAMS, "Unknown resource: " + uri);
    }
    const ctx = new ResCtx(this);
    const raw = this._resHandlers[idx](uri, ctx);
    const out = (await (raw as Promise<unknown>)) as { contents: ResourceContents[] };
    return resultResponse(id, out);
  }

  _promptsList(): { [k: string]: unknown } {
    const prompts: { [k: string]: unknown }[] = [];
    for (let i = 0; i < this._prNames.length; i++) {
      const p: { [k: string]: unknown } = {};
      p["name"] = this._prNames[i];
      const d = this._prDescs[i];
      if (d !== null) {
        p["description"] = d;
      }
      const a = this._prArgsJson[i];
      if (a !== null) {
        p["arguments"] = JSON.parse(a);
      }
      prompts.push(p);
    }
    return { prompts: prompts };
  }

  async _promptsGet(id: RequestId, req: JsonRpcRequest): Promise<JsonRpcResponse> {
    const params = req.params === undefined || req.params === null ? {} : req.params;
    const name = params["name"];
    if (typeof name !== "string" || name.length === 0) {
      return errorResponse(id, INVALID_PARAMS, "Invalid params: prompts/get needs a name string");
    }
    let idx = -1;
    for (let i = 0; i < this._prNames.length; i++) {
      if (this._prNames[i] === name) {
        idx = i;
      }
    }
    if (idx < 0) {
      return errorResponse(id, INVALID_PARAMS, "Unknown prompt: " + name);
    }
    const rawArgs = params["arguments"];
    const args: { [k: string]: string } = {};
    if (isRecord(rawArgs)) {
      const o = rawArgs as { [k: string]: unknown };
      for (const k in o) {
        const v = o[k];
        if (typeof v === "string") {
          args[k] = v;
        }
      }
    }
    const ctx = new PromptCtx(this);
    const raw = this._prHandlers[idx](args, ctx);
    const out = (await (raw as Promise<unknown>)) as { messages: PromptMessage[] };
    const result: { [k: string]: unknown } = {};
    result["messages"] = out.messages;
    const d = this._prDescs[idx];
    if (d !== null) {
      result["description"] = d;
    }
    return resultResponse(id, result);
  }

  _setLevel(id: RequestId, req: JsonRpcRequest): JsonRpcResponse {
    const params = req.params === undefined || req.params === null ? {} : req.params;
    const level = params["level"];
    if (typeof level !== "string" || !isLogLevel(level)) {
      return errorResponse(
        id,
        INVALID_PARAMS,
        "Invalid params: logging/setLevel needs a level string",
      );
    }
    this._logLevel = level;
    return resultResponse(id, {});
  }
}
