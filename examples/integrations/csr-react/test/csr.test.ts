import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import http from "node:http";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { build } from "vite";
import { buildApp } from "../src/app.ts";
import { DiskAssets } from "@chttp/static";

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

const DIST = new URL("../dist/", import.meta.url).pathname;

// Build the React app once for the whole file — the assertions below are
// meaningless without real hashed assets on disk.
await build({ root: "web", build: { outDir: "../dist", emptyOutDir: true }, logLevel: "silent" });
assert.ok(existsSync(join(DIST, "index.html")), "vite build produced dist/index.html");

function boot(src: import("@chttp/static").AssetSource) {
  const app = buildApp(src);
  return new Promise<{ s: http.Server; port: number }>((resolve) => {
    const s = http.createServer(app.handler());
    s.listen(0, "127.0.0.1", () => {
      const a = s.address();
      resolve({ s, port: typeof a === "object" && a !== null ? a.port : 0 });
    });
  });
}

function req(port: number, path: string, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }>(
    (resolve, reject) => {
      const r = http.request(
        { host: "127.0.0.1", port, path, headers: { accept: "*/*", ...headers } },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (d) => chunks.push(d));
          res.on("end", () =>
            resolve({
              status: res.statusCode ?? 0,
              headers: res.headers,
              body: Buffer.concat(chunks),
            }),
          );
        },
      );
      r.on("error", reject);
      r.end();
    },
  );
}

const hashedAsset = readdirSync(join(DIST, "assets")).find((f) => f.endsWith(".js"));
assert.ok(hashedAsset, "vite emitted a hashed js asset");

const ctx = await boot(new DiskAssets(DIST));
const port = ctx.port;
test.after(() => ctx.s.close());

test("GET / serves the SPA index", async () => {
  const r = await req(port, "/");
  assert.equal(r.status, 200);
  assert.match(r.headers["content-type"] ?? "", /text\/html/);
  assert.match(r.body.toString(), /<div id="root">/);
});

test("hashed asset is byte-identical to dist and cached immutable", async () => {
  const fileBytes = readFileSync(join(DIST, "assets", hashedAsset));
  const r = await req(port, "/assets/" + hashedAsset);
  assert.equal(r.status, 200);
  assert.equal(sha256(r.body), sha256(fileBytes));
  assert.match(r.headers["cache-control"] ?? "", /immutable/);
});

test("ETag round trip answers 304 with no body", async () => {
  const a = await req(port, "/assets/" + hashedAsset);
  const tag = a.headers.etag;
  assert.ok(tag);
  const b = await req(port, "/assets/" + hashedAsset, { "if-none-match": tag });
  assert.equal(b.status, 304);
  assert.equal(b.body.length, 0);
  assert.equal(b.headers.etag, tag);
});

test("extensionless navigation gets the SPA fallback, asset misses stay 404", async () => {
  const nav = await req(port, "/dashboard/settings", { accept: "text/html" });
  assert.equal(nav.status, 200);
  assert.match(nav.body.toString(), /<div id="root">/);
  const miss = await req(port, "/nope.js");
  assert.equal(miss.status, 404);
});

test("/api prefix is owned by the router, misses answer JSON 404", async () => {
  const ok = await req(port, "/api/hello");
  assert.equal(ok.status, 200);
  assert.deepEqual(JSON.parse(ok.body.toString()), { message: "hello from chttp" });
  const miss = await req(port, "/api/nope");
  assert.equal(miss.status, 404);
  assert.equal(JSON.parse(miss.body.toString()).error, "not_found");
});

test("baked assets serve the same bytes and validators", async () => {
  const bake = spawnSync(process.execPath, ["scripts/bake.mjs"], { stdio: "pipe" });
  assert.equal(bake.status, 0, bake.stderr.toString());
  const { BakedAssets } = await import("../src/assets.gen.ts");
  const b = await boot(new BakedAssets());
  try {
    const r = await req(b.port, "/assets/" + hashedAsset);
    assert.equal(r.status, 200);
    assert.equal(sha256(r.body), sha256(readFileSync(join(DIST, "assets", hashedAsset))));
    const again = await req(b.port, "/assets/" + hashedAsset, {
      "if-none-match": r.headers.etag as string,
    });
    assert.equal(again.status, 304);
    const index = await req(b.port, "/", { accept: "text/html" });
    assert.match(index.body.toString(), /<div id="root">/);
  } finally {
    b.s.close();
  }
});
