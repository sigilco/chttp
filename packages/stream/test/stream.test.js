// Unit tests for @chttp/stream: real HTTP round-trips against the tsc build.
// The same src compiles to a native binary; see bench/apps/chttp-stream.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createRouter } from "@chttp/router";
import { streamSSE, streamText, SSEStream } from "../dist/esm/index.js";

async function serve(setup) {
  const app = createRouter();
  setup(app);
  const srv = app.serve({ port: 0 });
  await new Promise((r) => srv.on("listening", r));
  return { srv, base: "http://127.0.0.1:" + srv.address().port };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test("streamSSE: headers and event framing", async () => {
  const { srv, base } = await serve((app) =>
    app.get("/e", (c) =>
      streamSSE(c, (s) => {
        s.retry(1500);
        s.comment("hi");
        s.send("plain");
        s.send("named", "tick");
        s.send("full", "tick", "7");
        s.close();
      }),
    ),
  );
  const r = await fetch(base + "/e");
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /^text\/event-stream/);
  assert.equal(r.headers.get("cache-control"), "no-cache, no-transform");
  assert.equal(
    await r.text(),
    "retry: 1500\n\n: hi\n\ndata: plain\n\nevent: tick\ndata: named\n\nid: 7\nevent: tick\ndata: full\n\n",
  );
  srv.close();
});

test("send: multi-line data is split and CR/LF cannot inject fields", async () => {
  const { srv, base } = await serve((app) =>
    app.get("/e", (c) =>
      streamSSE(c, (s) => {
        s.send("a\nb\r\nc\rd");
        s.send("x\n");
        s.send("", "e\nid: evil", "1\r2");
        s.comment("m1\nm2");
        s.close();
      }),
    ),
  );
  const t = await (await fetch(base + "/e")).text();
  assert.equal(
    t,
    "data: a\ndata: b\ndata: c\ndata: d\n\n" +
      "data: x\ndata: \n\n" +
      "id: 12\nevent: eid: evil\ndata: \n\n" +
      ": m1\n: m2\n\n",
  );
  srv.close();
});

test("a streaming handler is never answered with a 500", async () => {
  const { srv, base } = await serve((app) => app.get("/e", (c) => streamSSE(c, () => undefined)));
  const ac = new AbortController();
  const r = await fetch(base + "/e", { signal: ac.signal });
  assert.equal(r.status, 200);
  ac.abort();
  srv.close();
  srv.closeAllConnections();
});

test("async callback: events written after awaits reach the client", async () => {
  const { srv, base } = await serve((app) =>
    app.get("/e", (c) =>
      streamSSE(c, async (s) => {
        s.send("one");
        await wait(20);
        s.send("two");
        s.close();
      }),
    ),
  );
  assert.equal(await (await fetch(base + "/e")).text(), "data: one\n\ndata: two\n\n");
  srv.close();
});

test("onAbort fires when the client disconnects and the timer stops", async () => {
  let aborted = 0;
  let ticks = 0;
  const { srv, base } = await serve((app) =>
    app.get("/e", (c) =>
      streamSSE(c, (s) => {
        const t = setInterval(() => {
          ticks++;
          s.send("t");
        }, 10);
        s.onAbort(() => {
          aborted++;
          clearInterval(t);
        });
      }),
    ),
  );
  await new Promise((resolve) => {
    const req = http.get(base + "/e", (res) => {
      res.once("data", () => {
        req.destroy();
        resolve();
      });
    });
  });
  await wait(80);
  assert.equal(aborted, 1);
  const after = ticks;
  await wait(60);
  assert.equal(ticks, after, "interval cleared");
  srv.close();
});

test("close() ends the response, fires onAbort once, later writes are no-ops", async () => {
  let aborted = 0;
  let late = true;
  const { srv, base } = await serve((app) =>
    app.get("/e", (c) =>
      streamSSE(c, (s) => {
        s.onAbort(() => aborted++);
        s.send("x");
        s.close();
        s.close();
        late = s.send("y");
      }),
    ),
  );
  assert.equal(await (await fetch(base + "/e")).text(), "data: x\n\n");
  await wait(30);
  assert.equal(aborted, 1);
  assert.equal(late, false);
  srv.close();
});

test("onAbort registered after the connection closed runs immediately", async () => {
  let s0;
  const { srv, base } = await serve((app) =>
    app.get("/e", (c) =>
      streamSSE(c, (s) => {
        s0 = s;
        s.close();
      }),
    ),
  );
  await (await fetch(base + "/e")).text();
  await wait(30);
  let ran = false;
  s0.onAbort(() => (ran = true));
  assert.equal(ran, true);
  srv.close();
});

test("pending-bytes cap closes slow consumers", async () => {
  let wrote = [];
  let aborted = 0;
  const { srv, base } = await serve((app) =>
    app.get("/e", (c) =>
      streamSSE(c, (s) => {
        s.maxPending = 100;
        s.onAbort(() => aborted++);
        wrote.push(s.send("a".repeat(40)));
        wrote.push(s.send("b".repeat(40)));
        wrote.push(s.send("c".repeat(40)));
        wrote.push(s.send("d"));
      }),
    ),
  );
  const t = await (await fetch(base + "/e")).text();
  assert.deepEqual(wrote, [true, true, false, false]);
  assert.equal(t, "data: " + "a".repeat(40) + "\n\ndata: " + "b".repeat(40) + "\n\n");
  await wait(30);
  assert.equal(aborted, 1);
  srv.close();
});

test("drain callback resumes write after kernel drains", async () => {
  // A burst bigger than the Writable highWaterMark (64 KiB) with a pending
  // window above it: chunks past the mark queue and "drain" re-issues them,
  // so the client receives every byte and the stream is never closed.
  let stream;
  const { srv, base } = await serve((app) =>
    app.get("/e", (c) =>
      streamText(c, (s) => {
        stream = s;
        const chunk = "x".repeat(32768);
        for (let i = 0; i < 8; i++) {
          s.writeln(chunk);
        }
      }),
    ),
  );
  const r = await fetch(base + "/e");
  const reader = r.body.getReader();
  let got = 0;
  while (got < 8 * (32768 + 1)) {
    const { done, value } = await reader.read();
    if (done) break;
    got += value.length;
  }
  await reader.cancel();
  assert.equal(got, 8 * (32768 + 1));
  assert.equal(stream.closed, false);
  srv.close();
  srv.closeAllConnections();
});

test("pending window resets so steady streams are not closed", async () => {
  const { srv, base } = await serve((app) =>
    app.get("/e", (c) =>
      streamSSE(c, async (s) => {
        s.maxPending = 30;
        s.windowMs = 20;
        for (let i = 0; i < 4; i++) {
          assert.equal(s.send("0123456789"), true);
          await wait(30);
        }
        s.close();
      }),
    ),
  );
  const t = await (await fetch(base + "/e")).text();
  assert.equal(t.split("data: ").length - 1, 4);
  srv.close();
});

test("utf8 payloads count by bytes toward the cap", async () => {
  const { srv, base } = await serve((app) =>
    app.get("/e", (c) =>
      streamSSE(c, (s) => {
        s.maxPending = 20;
        // "data: " is not counted twice: frame is 6 + 4*3 + 2 = 20 bytes (3-byte chars), at the cap
        assert.equal(s.send("€€€€"), true);
        assert.equal(s.send("x"), false);
      }),
    ),
  );
  await (await fetch(base + "/e")).text();
  srv.close();
});

test("streamText: chunked text with writeln", async () => {
  const { srv, base } = await serve((app) =>
    app.get("/t", (c) =>
      streamText(c, async (s) => {
        s.write("a");
        await wait(10);
        s.writeln("b");
        s.close();
      }),
    ),
  );
  const r = await fetch(base + "/t");
  assert.match(r.headers.get("content-type"), /^text\/plain/);
  assert.equal(r.headers.get("content-length"), null);
  assert.equal(await r.text(), "ab\n");
  srv.close();
});

test("headers set before streamSSE are preserved", async () => {
  const { srv, base } = await serve((app) =>
    app.get("/e", (c) => {
      c.header("x-custom", "1");
      return streamSSE(c, (s) => s.close());
    }),
  );
  const r = await fetch(base + "/e");
  assert.equal(r.headers.get("x-custom"), "1");
  await r.text();
  srv.close();
});

test("async callback rejection fires onError and destroys the connection", async () => {
  let seen = null;
  const { srv, base } = await serve((app) => {
    app.onError((err) => {
      seen = err;
    });
    return app.get("/e", (c) =>
      streamSSE(c, async () => {
        await wait(10);
        throw new Error("boom-after-flush");
      }),
    );
  });
  const r = await fetch(base + "/e");
  assert.equal(r.status, 200); // headers were flushed before the rejection...
  await r.text().catch(() => undefined); // ...body cut short by the destroy
  await wait(30);
  assert.ok(seen instanceof Error, "onError fired despite sent headers");
  assert.equal(seen.message, "boom-after-flush");
  srv.close();
  srv.closeAllConnections();
});

test("async callback rejection without onError destroys and the server keeps serving", async () => {
  const { srv, base } = await serve((app) => {
    app.get("/ok", (c) => c.text("ok"));
    return app.get("/e", (c) =>
      streamSSE(c, async () => {
        await wait(10);
        throw new Error("unobserved");
      }),
    );
  });
  const r = await fetch(base + "/e");
  assert.equal(r.status, 200);
  await r.text().catch(() => undefined);
  await wait(30);
  // No crash, no unhandled rejection: the router answers the next request.
  const ok = await fetch(base + "/ok")
    .then((x) => x.status)
    .catch(() => 0);
  assert.equal(ok, 200);
  srv.close();
  srv.closeAllConnections();
});

test("exports SSEStream class", () => {
  assert.equal(typeof SSEStream, "function");
});

test("async callback rejection fires onError and destroys the connection", async () => {
  let seen = null;
  const { srv, base } = await serve((app) => {
    app.onError((err) => {
      seen = err;
    });
    return app.get("/e", (c) =>
      streamSSE(c, async () => {
        await wait(10);
        throw new Error("boom-after-flush");
      }),
    );
  });
  const r = await fetch(base + "/e");
  assert.equal(r.status, 200); // headers were flushed before the rejection...
  await r.text().catch(() => undefined); // ...body cut short by the destroy
  await wait(30);
  assert.ok(seen instanceof Error, "onError fired despite sent headers");
  assert.equal(seen.message, "boom-after-flush");
  srv.close();
  srv.closeAllConnections();
});

test("async callback rejection without onError destroys and the server keeps serving", async () => {
  const { srv, base } = await serve((app) => {
    app.get("/ok", (c) => c.text("ok"));
    return app.get("/e", (c) =>
      streamSSE(c, async () => {
        await wait(10);
        throw new Error("unobserved");
      }),
    );
  });
  const r = await fetch(base + "/e");
  assert.equal(r.status, 200);
  await r.text().catch(() => undefined);
  await wait(30);
  // No crash, no unhandled rejection: the router answers the next request.
  const ok = await fetch(base + "/ok")
    .then((x) => x.status)
    .catch(() => 0);
  assert.equal(ok, 200);
  srv.close();
  srv.closeAllConnections();
});

test("write after client disconnect returns false instead of throwing", async () => {
  let late = null;
  let aborted = 0;
  const { srv, base } = await serve((app) =>
    app.get("/e", (c) =>
      streamSSE(c, (s) => {
        s.onAbort(() => {
          aborted++;
          late = s.send("after");
        });
        s.send("first");
      }),
    ),
  );
  await new Promise((resolve) => {
    const req = http.get(base + "/e", (res) => {
      res.once("data", () => {
        req.destroy();
        resolve();
      });
    });
  });
  await wait(60);
  assert.equal(aborted, 1);
  assert.equal(late, false);
  srv.close();
  srv.closeAllConnections();
});

test("a res 'error' emission routes into _onClose (timer cleaned, onAbort fired)", async () => {
  let aborted = 0;
  let ticks = 0;
  const { srv, base } = await serve((app) =>
    app.get("/e", (c) =>
      streamSSE(c, (s) => {
        const t = setInterval(() => {
          ticks++;
          s.send("t");
        }, 10);
        s.onAbort(() => {
          aborted++;
          clearInterval(t);
        });
      }),
    ),
  );
  // Destroy the raw socket mid-stream so the socket-level error/abrupt close
  // path fires while the response is still writable from the server's view.
  await new Promise((resolve) => {
    http.get(base + "/e", (res) => {
      res.once("data", () => {
        res.socket.destroy();
        resolve();
      });
    });
  });
  await wait(80);
  assert.equal(aborted, 1, "onAbort fired via the close path");
  const after = ticks;
  await wait(60);
  assert.equal(ticks, after, "timer stopped");
  srv.close();
  srv.closeAllConnections();
});

test("retry clamps non-numeric and negative values to 0", () => {
  const seen = [];
  const fake = Object.create(SSEStream.prototype);
  fake.closed = false;
  fake.maxPending = 1048576;
  fake.windowMs = 1000;
  fake._pending = 0;
  fake._windowStart = Date.now();
  fake._abortFns = [];
  fake._fired = false;
  fake.write = (chunk) => {
    seen.push(chunk);
    return true;
  };
  fake.retry(NaN);
  fake.retry(-5);
  fake.retry(1500);
  assert.deepEqual(seen, ["retry: 0\n\n", "retry: 0\n\n", "retry: 1500\n\n"]);
});

test("onAbort fires exactly once whether registered before or after close", async () => {
  const runs = [];
  const fake = Object.create(SSEStream.prototype);
  fake.closed = false;
  fake.maxPending = 1048576;
  fake.windowMs = 1000;
  fake._pending = 0;
  fake._windowStart = Date.now();
  fake._abortFns = [];
  fake._fired = false;
  fake.onAbort((() => runs.push("before")).bind(null));
  fake._onClose();
  fake.onAbort((() => runs.push("after")).bind(null));
  fake._onClose(); // second close event must not re-run anything
  assert.deepEqual(runs, ["before", "after"]);
});

// app.fetch arm: the same streamSSE/streamText handlers must emit chunked
// ReadableStream bodies (not a buffered single-string body) when the host is
// Web Standards — contracts/route-contract-fetch.md "streaming" section.
test("streamSSE on app.fetch emits a chunked ReadableStream", async () => {
  const app = createRouter();
  app.get("/e", (c) =>
    streamSSE(c, (s) => {
      s.send("one");
      s.close();
    }),
  );
  const res = await app.fetch(new Request("http://x/e"));
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /^text\/event-stream/);
  assert.ok(res.body instanceof ReadableStream, "fetch body is a ReadableStream");
  assert.equal(await res.text(), "data: one\n\n");
});

test("streamText on app.fetch chunks through the ReadableStream", async () => {
  const app = createRouter();
  app.get("/t", (c) =>
    streamText(c, (s) => {
      s.writeln("line1");
      s.write("tail");
      s.close();
    }),
  );
  const res = await app.fetch(new Request("http://x/t"));
  assert.equal(res.status, 200);
  assert.ok(res.body instanceof ReadableStream);
  const chunks = [];
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  for (;;) {
    const r = await reader.read();
    if (r.done) break;
    chunks.push(dec.decode(r.value));
  }
  assert.deepEqual(chunks, ["line1\n", "tail"]);
});
