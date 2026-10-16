// The auto-wrap ladder for tool handler return values (fastmcp/mcp-framework
// style). Every branch maps to a concrete CallToolResult shape:
//
//   string          -> { content: [{ type: "text", text }] }
//   ContentBlock    -> { content: [block] }
//   ContentBlock[]  -> { content: arr }
//   { content:[] }  -> pass through unchanged (raw-envelope escape hatch)
//   plain object    -> { content: [text-of-json], structuredContent: v }
//   null/undefined  -> { content: [] }
//   other primitive -> { content: [text-of-json] }
//   thrown error    -> { content: [text-of-message], isError: true }

import type { CallToolResult, ContentBlock } from "./types.ts";

const BLOCK_TYPES = ["text", "image", "audio", "resource_link", "resource"];

function isRecord(v: unknown): boolean {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isBlockType(t: unknown): boolean {
  for (let i = 0; i < BLOCK_TYPES.length; i++) {
    if (t === BLOCK_TYPES[i]) {
      return true;
    }
  }
  return false;
}

function textBlock(text: string): ContentBlock {
  return { type: "text", text: text };
}

export function wrapToolReturn(v: unknown): CallToolResult {
  if (v === null || v === undefined) {
    return { content: [] };
  }
  if (typeof v === "string") {
    return { content: [textBlock(v)] };
  }
  if (Array.isArray(v)) {
    return { content: v as ContentBlock[] };
  }
  if (isRecord(v)) {
    const o = v as { [k: string]: unknown };
    if (Array.isArray(o["content"])) {
      // Already a CallToolResult — passthrough so isError/structuredContent/
      // extra fields survive verbatim.
      return v as CallToolResult;
    }
    if (isBlockType(o["type"])) {
      return { content: [v as ContentBlock] };
    }
    // Plain object: dual content — a text block carrying the JSON plus the
    // value itself as structuredContent (mcp-use's pattern).
    return {
      content: [textBlock(JSON.stringify(v))],
      structuredContent: o,
    };
  }
  // number/boolean/etc: stringify into a text block.
  return { content: [textBlock(String(v))] };
}

export function wrapToolError(err: unknown): CallToolResult {
  let msg = "Tool execution failed";
  if (typeof err === "string") {
    msg = err;
  } else if (typeof err === "object" && err !== null) {
    const m = (err as { [k: string]: unknown })["message"];
    if (typeof m === "string" && m.length > 0) {
      msg = m;
    }
  }
  return { content: [textBlock(msg)], isError: true };
}
