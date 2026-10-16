// Client-side error classes. Wire errors pass through as JsonRpcError
// (../errors.ts); these cover the two client-owned failure modes.

export const E_CLIENT_VALIDATION = "E_CLIENT_VALIDATION";
export const E_CLIENT_TOOL_ERROR = "E_CLIENT_TOOL_ERROR";

// args rejected by def.input, or a result rejected by def.output. The
// issues payload is kept serialized: `unknown` can't sit in a class field
// under the subset — parse it back at the edge that needs it.
export class ClientValidationError extends Error {
  code: string;
  issuesJson: string;
  constructor(message: string, issues: unknown) {
    super(message);
    this.name = "ClientValidationError";
    this.code = E_CLIENT_VALIDATION;
    this.issuesJson = JSON.stringify(issues === undefined ? null : issues);
  }
}

// A tools/call that came back `isError: true` — the tool ran and reported
// failure. message carries the first text content block; resultJson keeps
// the whole CallToolResult for callers that want it.
export class ClientToolError extends Error {
  code: string;
  resultJson: string;
  constructor(message: string, result: unknown) {
    super(message);
    this.name = "ClientToolError";
    this.code = E_CLIENT_TOOL_ERROR;
    this.resultJson = JSON.stringify(result === undefined ? null : result);
  }
}
