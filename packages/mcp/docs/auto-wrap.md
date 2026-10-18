# Auto-wrap ladder

What `tools/call` does with whatever the handler returns — same ladder FastMCP and mcp-use use. `wrapToolReturn`/`wrapToolError` are exported for transport authors.

| Handler returns                                          | Wire result                                                                                    |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `string`                                                 | `{ content: [{ type: "text", text }] }`                                                        |
| `ContentBlock` (text/image/audio/resource_link/resource) | `{ content: [block] }`                                                                         |
| `ContentBlock[]`                                         | `{ content: [...] }`                                                                           |
| `CallToolResult` (`{ content: [...], ... }`)             | passthrough unchanged — the raw-envelope escape hatch                                          |
| plain object                                             | dual content: `{ content: [{ type: "text", text: JSON.stringify(v) }], structuredContent: v }` |
| `null` / `undefined`                                     | `{ content: [] }`                                                                              |
| other primitives (number, boolean)                       | `{ content: [{ type: "text", text: String(v) }] }`                                             |
| throws                                                   | `{ content: [{ type: "text", text: msg }], isError: true }` — a _result_, not a JSON-RPC error |

Two rules worth remembering:

- An object with `type: "<block-type>"` is a `ContentBlock` — `{ type: "text", text }` etc. An object with a `type` that is not a block type is treated as a plain object (dual content).
- Handler throws never produce `-32603`. The tool ran and failed — that is a tool-level error, reported as `isError: true` in the result per the spec. Protocol-level failures (unknown tool, bad args) are JSON-RPC errors.
