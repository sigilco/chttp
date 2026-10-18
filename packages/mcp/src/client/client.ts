// Client — the typed MCP client behind `@chttp/mcp/client`.
//
//   import { Client, HttpClientTransport, toolDef } from "@chttp/mcp/client";
//   const client = new Client({
//     name: "my-agent", version: "0.1.0",
//     transport: new HttpClientTransport({ url: "http://localhost:8080/mcp" }),
//   });
//   await client.connect();
//   const out = await client.call(addTool, { a: 1, b: 2 }); // typed in/out
//
// `call` validates args against def.input and the result against
// def.output through the same `~standard.validate` seam the server uses —
// no Proxy, no codegen, no runtime deps.

import { JsonRpcError } from "../errors.ts";
import { PROTOCOL_VERSION } from "../server.ts";
import type {
  CallToolResult,
  ContentBlock,
  JsonRpcRequest,
  JsonRpcResponse,
  LogLevel,
  RequestId,
  ResourceContents,
  StandardSchemaV1,
} from "../types.ts";
import { runStdValidate } from "../validate.ts";
import { ClientToolError, ClientValidationError } from "./errors.ts";
import {
  ClientTransport,
  type ClientOpts,
  type GetPromptResult,
  type InitializeResult,
  type NotificationHandler,
  type PromptDef,
  type PromptInfo,
  type ResourceDef,
  type ResourceInfo,
  type ToolDef,
  type ToolInfo,
} from "./types.ts";

function isRecord(v: unknown): boolean {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Structured-cast helper: narrows a record's field to string, else null.
function strField(o: { [k: string]: unknown }, k: string): string | null {
  const v = o[k];
  return typeof v === "string" ? v : null;
}

function strOr(v: string | null, d: string): string {
  return v === null ? d : v;
}

async function validateOrThrow(
  std: StandardSchemaV1.Props<unknown, unknown>,
  value: unknown,
  what: string,
): Promise<unknown> {
  const out = await runStdValidate(std, value);
  if (out.issues !== null) {
    throw new ClientValidationError("invalid " + what, out.issues);
  }
  return out.value;
}

export class Client implements AsyncDisposable {
  _name: string;
  _version: string;
  _transport: ClientTransport;
  _capsJson: string;
  _timeoutMs: number;
  _nextId: number;
  _connected: boolean;
  _init: InitializeResult | null;
  _notifHandlers: NotificationHandler[];
  _progressHandlers: NotificationHandler[];

  constructor(opts: ClientOpts) {
    this._name = String(opts.name);
    this._version = String(opts.version);
    this._transport = opts.transport;
    this._capsJson = JSON.stringify(opts.capabilities === undefined ? {} : opts.capabilities);
    this._timeoutMs = opts.timeoutMs === undefined ? 30000 : opts.timeoutMs;
    this._nextId = 1;
    this._connected = false;
    this._init = null;
    this._notifHandlers = [];
    this._progressHandlers = [];
    this._transport.setOnNotification((n: JsonRpcRequest): void => {
      this._routeNotification(n);
    });
  }

  _routeNotification(n: JsonRpcRequest): void {
    const handlers =
      n.method === "notifications/progress" ? this._progressHandlers : this._notifHandlers;
    for (let i = 0; i < handlers.length; i++) {
      handlers[i](n);
    }
  }

  // ---------- handshake ----------

  // initialize + notifications/initialized + optional events stream.
  async connect(): Promise<InitializeResult> {
    const res = await this._request("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: JSON.parse(this._capsJson),
      clientInfo: { name: this._name, version: this._version },
    });
    this._init = this._readInit(res);
    this._connected = true;
    this._notify("notifications/initialized", {});
    if (this._progressHandlers.length > 0 || this._notifHandlers.length > 0) {
      await this._transport.openEvents(this._timeoutMs);
    }
    return this._init;
  }

  _readInit(res: unknown): InitializeResult {
    const o = isRecord(res) ? (res as { [k: string]: unknown }) : {};
    const si = isRecord(o["serverInfo"]) ? (o["serverInfo"] as { [k: string]: unknown }) : {};
    const caps = isRecord(o["capabilities"]) ? (o["capabilities"] as { [k: string]: unknown }) : {};
    const init: InitializeResult = {
      protocolVersion: strOr(strField(o, "protocolVersion"), ""),
      capabilities: caps,
      serverInfo: {
        name: strOr(strField(si, "name"), ""),
        version: strOr(strField(si, "version"), ""),
      },
    };
    const ins = strField(o, "instructions");
    if (ins !== null) {
      init.instructions = ins;
    }
    return init;
  }

  initializeResult(): InitializeResult | null {
    return this._init;
  }

  // ---------- wire ----------

  _newId(): RequestId {
    const id = this._nextId;
    this._nextId += 1;
    return id;
  }

  // One request/response. Error envelopes surface as JsonRpcError — a
  // passthrough, not a translation.
  async _request(method: string, params: { [k: string]: unknown }): Promise<unknown> {
    const req: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: this._newId(),
      method: method,
      params: params,
    };
    const res = await this._transport.request(req, this._timeoutMs);
    this._throwIfError(res);
    return res.result === undefined ? null : res.result;
  }

  _throwIfError(res: JsonRpcResponse): void {
    const e = res.error;
    if (e !== undefined && e !== null) {
      throw new JsonRpcError(e.code, e.message);
    }
  }

  _notify(method: string, params: { [k: string]: unknown }): void {
    const req: JsonRpcRequest = { jsonrpc: "2.0", method: method, params: params };
    void this._transport.request(req, this._timeoutMs);
  }

  // ---------- typed calls ----------

  // Raw tools/call: returns the envelope's CallToolResult untouched
  // (isError included). `call` is the validating variant.
  async callTool(name: string, args?: { [k: string]: unknown }): Promise<CallToolResult> {
    const res = await this._request("tools/call", {
      name: name,
      arguments: args === undefined ? {} : args,
    });
    // Rebuild the record field-by-field — a width-coerce cast of an
    // index-signature record into CallToolResult is outside the copy rules
    // (SC2002).
    const o = isRecord(res) ? (res as { [k: string]: unknown }) : {};
    const out: CallToolResult = { content: [] };
    const c = o["content"];
    if (Array.isArray(c)) {
      out.content = c as ContentBlock[];
    }
    const sc = o["structuredContent"];
    if (isRecord(sc)) {
      out.structuredContent = sc as { [k: string]: unknown };
    }
    if (o["isError"] === true) {
      out.isError = true;
    }
    return out;
  }

  // The typed path: validates args through def.input, sends tools/call,
  // validates the result through def.output (its structuredContent when
  // present, the whole result otherwise).
  async call<I, O>(def: ToolDef<I, O>, args: I): Promise<O> {
    const input: StandardSchemaV1 | null =
      def.input === undefined || def.input === null ? null : def.input;
    const output: StandardSchemaV1 | null =
      def.output === undefined || def.output === null ? null : def.output;
    let sendArgs: unknown = args;
    if (input !== null) {
      sendArgs = await validateOrThrow(
        input["~standard"],
        args,
        'arguments for tool "' + def.name + '"',
      );
    }
    const res = await this.callTool(
      def.name,
      isRecord(sendArgs) ? (sendArgs as { [k: string]: unknown }) : {},
    );
    if (res.isError === true) {
      throw new ClientToolError(firstText(res), res);
    }
    if (output === null) {
      // Route through an `unknown` local so the cast is a single `as`
      // (`as unknown as` is the subset's banned double-cast).
      const u: unknown = res;
      return u as O;
    }
    const target = res.structuredContent === undefined ? res : res.structuredContent;
    const v = await validateOrThrow(
      output["~standard"],
      target,
      'result of tool "' + def.name + '"',
    );
    return v as O;
  }

  async listTools(): Promise<ToolInfo[]> {
    const res = await this._request("tools/list", {});
    const o = isRecord(res) ? (res as { [k: string]: unknown }) : {};
    const arr = Array.isArray(o["tools"]) ? (o["tools"] as unknown[]) : [];
    const out: ToolInfo[] = [];
    for (let i = 0; i < arr.length; i++) {
      const t = isRecord(arr[i]) ? (arr[i] as { [k: string]: unknown }) : {};
      const info: ToolInfo = {
        name: strOr(strField(t, "name"), ""),
        inputSchema: isRecord(t["inputSchema"])
          ? (t["inputSchema"] as { [k: string]: unknown })
          : {},
      };
      const d = strField(t, "description");
      if (d !== null) {
        info.description = d;
      }
      if (isRecord(t["outputSchema"])) {
        info.outputSchema = t["outputSchema"] as { [k: string]: unknown };
      }
      out.push(info);
    }
    return out;
  }

  async listResources(): Promise<ResourceInfo[]> {
    const res = await this._request("resources/list", {});
    const o = isRecord(res) ? (res as { [k: string]: unknown }) : {};
    const arr = Array.isArray(o["resources"]) ? (o["resources"] as unknown[]) : [];
    const out: ResourceInfo[] = [];
    for (let i = 0; i < arr.length; i++) {
      const r = isRecord(arr[i]) ? (arr[i] as { [k: string]: unknown }) : {};
      const info: ResourceInfo = {
        uri: strOr(strField(r, "uri"), ""),
        name: strOr(strField(r, "name"), ""),
      };
      const d = strField(r, "description");
      if (d !== null) {
        info.description = d;
      }
      const m = strField(r, "mimeType");
      if (m !== null) {
        info.mimeType = m;
      }
      out.push(info);
    }
    return out;
  }

  async listPrompts(): Promise<PromptInfo[]> {
    const res = await this._request("prompts/list", {});
    const o = isRecord(res) ? (res as { [k: string]: unknown }) : {};
    const arr = Array.isArray(o["prompts"]) ? (o["prompts"] as unknown[]) : [];
    const out: PromptInfo[] = [];
    for (let i = 0; i < arr.length; i++) {
      const p = isRecord(arr[i]) ? (arr[i] as { [k: string]: unknown }) : {};
      out.push({ name: strOr(strField(p, "name"), "") });
    }
    return out;
  }

  async readResource(uri: string): Promise<ResourceContents[]>;
  async readResource<O>(def: ResourceDef<O>): Promise<O>;
  async readResource(uriOrDef: string | ResourceDef<unknown>): Promise<unknown> {
    const isDef = typeof uriOrDef !== "string";
    const uri = isDef ? (uriOrDef as ResourceDef<unknown>).uri : (uriOrDef as string);
    const res = await this._request("resources/read", { uri: uri });
    const o = isRecord(res) ? (res as { [k: string]: unknown }) : {};
    const contents = Array.isArray(o["contents"]) ? (o["contents"] as ResourceContents[]) : [];
    if (!isDef) {
      return contents;
    }
    const def = uriOrDef as ResourceDef<unknown>;
    if (def.output === undefined || def.output === null) {
      return contents;
    }
    return validateOrThrow(def.output["~standard"], contents, 'resource "' + uri + '"');
  }

  async getPrompt(name: string, args?: { [k: string]: string }): Promise<GetPromptResult>;
  async getPrompt<O>(def: PromptDef<O>, args?: { [k: string]: string }): Promise<O>;
  async getPrompt(
    nameOrDef: string | PromptDef<unknown>,
    args?: { [k: string]: string },
  ): Promise<unknown> {
    const isDef = typeof nameOrDef !== "string";
    const name = isDef ? (nameOrDef as PromptDef<unknown>).name : (nameOrDef as string);
    const res = await this._request("prompts/get", {
      name: name,
      arguments: args === undefined ? {} : args,
    });
    const o = isRecord(res) ? (res as { [k: string]: unknown }) : {};
    const messages = Array.isArray(o["messages"])
      ? (o["messages"] as { role: string; content: { [k: string]: unknown } }[])
      : [];
    const out: GetPromptResult = { messages: messages };
    const d = strField(o, "description");
    if (d !== null) {
      out.description = d;
    }
    if (!isDef) {
      return out;
    }
    const def = nameOrDef as PromptDef<unknown>;
    if (def.output === undefined || def.output === null) {
      return out;
    }
    return validateOrThrow(def.output["~standard"], out, 'prompt "' + name + '"');
  }

  async ping(): Promise<void> {
    await this._request("ping", {});
  }

  async setLogLevel(level: LogLevel): Promise<void> {
    await this._request("logging/setLevel", { level: level });
  }

  // ---------- notification hooks ----------

  // Every inbound notification (any method).
  onNotification(h: NotificationHandler): this {
    this._notifHandlers.push(h);
    return this;
  }

  // Only notifications/progress.
  onProgress(h: NotificationHandler): this {
    this._progressHandlers.push(h);
    return this;
  }

  // ---------- lifecycle ----------

  async close(): Promise<void> {
    if (!this._connected) {
      await this._transport.close();
      return;
    }
    this._connected = false;
    await this._transport.close();
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }
}

function firstText(res: CallToolResult): string {
  for (let i = 0; i < res.content.length; i++) {
    const b = res.content[i];
    if (b.type === "text") {
      return b.text;
    }
  }
  return "tool reported isError";
}
