# mcp-stdio wiring

Reference wiring for a stdio MCP server on `@chttp/mcp`: newline-delimited JSON-RPC on stdin, one response per line on stdout.

```sh
node --experimental-strip-types examples/integrations/mcp-stdio/main.ts <<'EOF'
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"echo","arguments":{"text":"hi"}}}
EOF
```

v1 intentionally does not ship a `StdioTransport` class — the `Transport` interface is the contract; this file shows the ~40 lines of glue a stdio app needs. A packaged stdio transport (buffered progress, binary-safe framing) is a v2 candidate.
