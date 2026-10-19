# @chttp/stream

Server-Sent Events and chunked text streaming for [@chttp/router](https://github.com/sigilco/chttp), authored inside the scriptc compilable subset so it compiles into the same native binary.

```ts
import { CtxCore, createRouter } from "@chttp/router";
import { streamSSE } from "@chttp/stream";

const app = createRouter();

app.get("/clock", (c: CtxCore) =>
  streamSSE(c, (s) => {
    const t = setInterval(() => s.send(new Date().toISOString(), "tick"), 1000);
    s.onAbort(() => clearInterval(t));
  }),
);

app.serve({ port: 3000 });
```

See the [streaming guide](https://github.com/sigilco/chttp/blob/main/docs/streaming.md) for the full API and the slow-consumer policy (a compiled `Writable` backpressure wrapper on scriptc 0.3.2+, plus a pending-bytes cap as the fail-safe).
