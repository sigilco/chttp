import { createRouter } from "@chttp/router";
import type { App } from "@chttp/router";
import { serveStatic } from "@chttp/static";
import type { AssetSource } from "@chttp/static";

// The app is identical for disk and baked sources — the AssetSource port
// is the only difference between "serve ./dist" and "serve bytes compiled
// into the binary".
export function buildApp(src: AssetSource): App {
  const app = createRouter();
  app.get("/api/hello", (c) => c.json({ message: "hello from chttp" }));
  serveStatic(app, "/", src, { spa: true });
  return app;
}
