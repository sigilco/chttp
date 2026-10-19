# @chttp/ws

Minimal WebSocket router for [@chttp/router](https://github.com/sigilco/chttp), authored inside the scriptc compilable subset so the same source compiles to a native binary.

```ts
import { createRouter } from "@chttp/router";
import { WsConn, WsHandler, WsRouter } from "@chttp/ws";

class Echo extends WsHandler {
  message(c: WsConn, data: string): void {
    c.send(data);
  }
}

const app = createRouter();
app.withUpgrade(new WsRouter().ws("/echo", new Echo()).ws("/room/:name", new Echo()));
const server = app.serve({ port: 3000 });
// serve() never attaches "upgrade": wire it in your own program.
server.on("upgrade", app.upgradeHandler());
```

Handlers subclass `WsHandler` and override `open`, `message`, `binary` and `close`. `WsConn` exposes `send`, `sendBinary`, `ping`, `close` and `param`. Messages above `maxPayload` (1 MiB by default) close the connection with 1009. No permessage-deflate.

See the [WebSocket guide](https://github.com/sigilco/chttp/blob/main/docs/websocket.md).
