# mcp-stdio wiring

Reference wiring for a stdio MCP server on `@chttp/mcp`: newline-delimited JSON-RPC on stdin, one response per line on stdout.

```sh
node --experimental-strip-types examples/integrations/mcp-stdio/main.ts <<'EOF'
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"echo","arguments":{"text":"hi"}}}
EOF
```

The wiring is `StdioTransport` from `@chttp/mcp`; see [docs/transport.md](../../../packages/mcp/docs/transport.md). Responses can arrive out of order, so match on `id`.
