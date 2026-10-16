// JSON-RPC 2.0 error codes plus the package's own registration-time codes.

export const PARSE_ERROR = -32700;
export const INVALID_REQUEST = -32600;
export const METHOD_NOT_FOUND = -32601;
export const INVALID_PARAMS = -32602;
export const INTERNAL_ERROR = -32603;

// Raised by tool() when no JSON-Schema emitter is configured at either level
// (per-tool `emit`, server `emitJsonSchema`). Exported so tests and callers
// can match on `err.code` instead of the message.
export const E_NO_JSON_SCHEMA_EMITTER = "E_NO_JSON_SCHEMA_EMITTER";

export class NoEmitterError extends Error {
  code: string;
  constructor(toolName: string) {
    super(
      E_NO_JSON_SCHEMA_EMITTER +
        ': tool "' +
        toolName +
        '" registered without a JSON-Schema emitter. Pass `emit` to tool() or ' +
        "`emitJsonSchema` to new Server() — e.g. the @chttp/val adapter " +
        "`(s) => toJsonSchema(s)` or the valibot adapter `(s) => v.toJSONSchema(s)` " +
        "(see packages/mcp/docs/schema.md).",
    );
    this.name = "NoEmitterError";
    this.code = E_NO_JSON_SCHEMA_EMITTER;
  }
}

// Wire-level error: thrown by the JSON-RPC parser with a protocol code.
export class JsonRpcError extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.name = "JsonRpcError";
    this.code = code;
  }
}
