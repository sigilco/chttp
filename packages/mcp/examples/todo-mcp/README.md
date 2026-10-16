# todo-mcp

A complete `@chttp/mcp` server in ~80 lines: three tools (`add_todo`, `list_todos`, `slow_task` with progress), one resource (`todo:///summary`), one prompt (`prioritize`), mounted on `StreamableHttpTransport`.

```sh
curl -X POST :8787/mcp -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'

curl -X POST :8787/mcp -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"add_todo","arguments":{"text":"ship mcp"}}}'

# progress stream while slow_task runs
curl -N ':8787/mcp?stream=progress'
```

`main.ts` exports `server` and `route` — wire `route` into any host that accepts `(Request) => Promise<Response>` (chttp route, `export default { fetch }`, undici adapter, scriptc `fetchShim` app). A stdio variant lives at [`examples/integrations/mcp-stdio/`](../../../examples/integrations/mcp-stdio/).
