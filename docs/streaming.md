# Streaming

`@chttp/stream` adds Server-Sent Events and chunked text responses to `@chttp/router`. It is authored in the scriptc subset, so it compiles into the same native binary as your app.

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
```

## How it works

`streamSSE(c, fn)` sends the status line and headers, flushes them, marks the response as sent (`c.sent = true`), then returns `fn(stream)`. Marking it sent matters: the router answers 500 when a handler settles without writing anything, and a stream callback usually returns before the first byte. Because the helper returns whatever `fn` returns, an `async` callback is awaited by the router like any async handler.

The response is `200 text/event-stream` with `cache-control: no-cache, no-transform` and `x-accel-buffering: no`. Headers set with `c.header(...)` before the call are kept.

## SSEStream

| Method | Writes |
|---|---|
| `send(data)` | `data: ...` lines |
| `send(data, event)` | adds `event: ...` |
| `send(data, event, id)` | adds `id: ...` |
| `comment(text)` | `: text`, useful as a keep-alive ping |
| `retry(ms)` | `retry: ms`, the client reconnect delay |
| `close()` | ends the response |
| `onAbort(fn)` | runs `fn` once when the connection closes |

Multi-line data is split on LF, CRLF or CR into one `data:` line each, as the SSE spec requires. CR and LF are stripped from `event` and `id`, so a value cannot inject extra fields. Every write returns `true` while the stream is open and `false` once it is closed.

`onAbort` is wired to the response `close` event. It fires when the client leaves and also after your own `close()`, so it is the one place to clear timers and drop subscriptions. Registering after the connection closed runs the callback immediately.

## streamText

`streamText(c, fn)` is the same shape for `text/plain` chunked output. The stream has `write(s)`, `writeln(s)`, `close()` and `onAbort(fn)`.

```ts
app.get("/log", (c: CtxCore) =>
  streamText(c, (s) => {
    s.writeln("starting");
    s.writeln("done");
    s.close();
  }),
);
```

## Slow consumers

scriptc < 0.3.2 could not observe backpressure: the result of `write()`, the `drain` event and `writableLength` were all refused at compile time. A client that stops reading would otherwise make the server buffer without bound.

As a stand-in, every stream has a pending-bytes cap. If more than `maxPending` bytes (default 1 MiB) are written inside one `windowMs` window (default 1000 ms), the stream is closed and the write returns `false`. Both are plain fields, so tune them per stream:

```ts
streamSSE(c, (s) => {
  s.maxPending = 64 * 1024;
  s.windowMs = 1000;
});
```

This is a rate window, not true queue depth. On scriptc 0.3.2+, the cap is augmented by real backpressure via a compiled `Writable` wrapper; see `docs/native.md`. Real backpressure only engages when the wrapper compiles as program code (the app or sources vendored into it): inside a statically compiled npm package the `Writable` pump is dead on 0.3.2, so `@chttp/stream` detects that and writes to `res` directly, leaving the window cap as the only policy.

## Compiling and testing

`examples/sse-clock` is a complete app. Build it with `scriptc build src/main.ts -o app`, run it, then watch events arrive:

```sh
curl -N http://localhost:3000/clock
```

Stop `curl` and the interval is cleared by the `onAbort` handler. Always register that handler when your callback starts a timer.
