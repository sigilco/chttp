// JSON-RPC 2.0 envelope parsing and response shaping (~120 LoC, subset-clean).
// Batches are out of scope for v1: a top-level array is an Invalid Request.

import { INTERNAL_ERROR, INVALID_REQUEST, JsonRpcError, PARSE_ERROR } from "./errors.ts";
import type { JsonRpcErrorObject, JsonRpcRequest, JsonRpcResponse, RequestId } from "./types.ts";

function isRecord(v: unknown): boolean {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Validates the envelope shape of an already-parsed value. Notifications are
// requests without an `id` (id: null is treated as a notification; JSON-RPC
// discourages null ids and MCP never produces them).
export function parseRequest(raw: unknown): JsonRpcRequest {
  if (!isRecord(raw)) {
    throw new JsonRpcError(INVALID_REQUEST, "Invalid Request: not an object");
  }
  const o = raw as { [k: string]: unknown };
  if (o["jsonrpc"] !== "2.0") {
    throw new JsonRpcError(INVALID_REQUEST, 'Invalid Request: jsonrpc must be "2.0"');
  }
  if (typeof o["method"] !== "string" || (o["method"] as string).length === 0) {
    throw new JsonRpcError(INVALID_REQUEST, "Invalid Request: method must be a string");
  }
  const id = o["id"];
  if (id !== undefined && id !== null && typeof id !== "number" && typeof id !== "string") {
    throw new JsonRpcError(INVALID_REQUEST, "Invalid Request: id must be a string or number");
  }
  const params = o["params"];
  if (params !== undefined && params !== null && !isRecord(params)) {
    throw new JsonRpcError(INVALID_REQUEST, "Invalid Request: params must be an object");
  }
  return raw as JsonRpcRequest;
}

// Parses a wire body. Syntax errors map to -32700 Parse error per JSON-RPC;
// shape errors map to -32600 Invalid Request.
export function parseBody(text: string): JsonRpcRequest {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new JsonRpcError(PARSE_ERROR, "Parse error: body is not valid JSON");
  }
  return parseRequest(raw);
}

export function isNotification(req: JsonRpcRequest): boolean {
  return req.id === undefined || req.id === null;
}

export function requestId(req: JsonRpcRequest): RequestId | null {
  if (req.id === undefined || req.id === null) {
    return null;
  }
  return req.id;
}

export function resultResponse(id: RequestId, result: unknown): JsonRpcResponse {
  // Single literal: expanding writes on a non-empty literal (`r.result =`)
  // are dropped when scriptc lowers the packed dist JS — records built by a
  // published package must carry every key in the literal or start from {}.
  const r: JsonRpcResponse = {
    jsonrpc: "2.0",
    id: id,
    result: result === undefined ? null : result,
  };
  return r;
}

export function errorResponse(
  id: RequestId | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  // Two full literals for the optional `data` — same dropped-write rule.
  const e: JsonRpcErrorObject =
    data === undefined
      ? { code: code, message: message }
      : { code: code, message: message, data: data };
  // JSON-RPC answers parse/shape failures on `"id": null`; the cast keeps the
  // public id type at RequestId while emitting spec-correct null on the wire.
  const r = { jsonrpc: "2.0" as const, id: id, error: e } as JsonRpcResponse;
  return r;
}

// Best-effort id recovery for parse/shape failures: a syntactically valid
// envelope with a bad `id` still answers on id null (JSON-RPC convention),
// while a JsonRpcRequest that made it past parseRequest always carries a
// usable id.
export function errorFor(id: RequestId | null, err: unknown): JsonRpcResponse {
  if (err instanceof JsonRpcError) {
    return errorResponse(id, err.code, err.message);
  }
  // instanceof on builtins is subset-banned; read .message structurally.
  let msg = String(err);
  if (typeof err === "object" && err !== null) {
    const m = (err as { [k: string]: unknown })["message"];
    if (typeof m === "string") {
      msg = m;
    }
  }
  return errorResponse(id, INTERNAL_ERROR, msg);
}

export function notification(method: string, params: { [k: string]: unknown }): JsonRpcRequest {
  return { jsonrpc: "2.0", method: method, params: params };
}
