// Real-workerd smoke: this is the no-bluff gate for every "runs on
// Cloudflare Workers" claim in docs and READMEs. The in-process
// smoke.test.ts proves app.fetch(Request) → Promise<Response> under
// Node; this file proves the same app boots and serves inside the
// actual WinterCG runtime (workerd — the engine Cloudflare Workers
// runs on), where the HOST supplies the Request object.
//
// Pipeline (mirrors what `wrangler deploy` does, without Wrangler's
// own machinery): esbuild bundles src/main.ts keeping node:* imports
// external → a .capnp config turns on nodejs_compat +
// enable_nodejs_fs_module (multipart.ts imports node:fs statically
// for DiskStorage; nodejs_compat alone does not provide it) →
// `workerd serve` binds a real socket → plain HTTP requests assert
// the routes.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const esbuild = require("esbuild");

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const outDir = join(root, ".workerd-smoke");
const bundlePath = join(outDir, "bundle.mjs");
const configPath = join(outDir, "workerd.capnp");

// The workerd npm package's bin/workerd is the platform binary itself
// (installed via the @cloudflare/workerd-<platform> optional dep).
const workerdBin = join(dirname(require.resolve("workerd/package.json")), "bin", "workerd");

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

async function waitReady(url, proc, log) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) {
      throw new Error(`workerd exited early (${proc.exitCode}):\n${log()}`);
    }
    try {
      const res = await fetch(url);
      if (res.status === 200) {
        await res.arrayBuffer();
        return;
      }
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`workerd did not become ready in 15s:\n${log()}`);
}

test("workerd serves the chttp app over HTTP (WinterCG transport)", async (t) => {
  mkdirSync(outDir, { recursive: true });
  await esbuild.build({
    entryPoints: [join(root, "src", "main.ts")],
    bundle: true,
    format: "esm",
    target: "esnext",
    // node:* stays external: workerd resolves builtins at runtime via
    // nodejs_compat. Everything else (@chttp/router dist) is inlined.
    external: ["node:*"],
    outfile: bundlePath,
    logLevel: "silent",
  });

  const port = await freePort();
  writeFileSync(
    configPath,
    `using Workerd = import "/workerd/workerd.capnp";
const config :Workerd.Config = (
  services = [
    ( name = "main",
      worker = (
        modules = [ ( name = "entry", esModule = embed "bundle.mjs" ) ],
        compatibilityDate = "2025-09-01",
        compatibilityFlags = [ "nodejs_compat", "enable_nodejs_fs_module" ]
      )
    )
  ],
  sockets = [
    ( name = "http", address = "127.0.0.1:${port}", http = (), service = "main" )
  ]
);
`,
  );

  const proc = spawn(workerdBin, ["serve", configPath], { cwd: outDir, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  proc.stdout.on("data", (d) => (out += d));
  proc.stderr.on("data", (d) => (out += d));
  const log = () => out;
  t.after(() => {
    if (proc.exitCode === null) proc.kill("SIGKILL");
    rmSync(outDir, { recursive: true, force: true });
  });

  const base = `http://127.0.0.1:${port}`;
  await waitReady(`${base}/`, proc, log);

  {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "hello from chttp on Cloudflare Workers");
  }
  {
    const res = await fetch(`${base}/user/42`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.id, "42");
    assert.equal(body.source, "cloudflare-workers");
  }
  {
    const res = await fetch(`${base}/echo`, { method: "POST", body: "ping" });
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "got: ping");
  }
  {
    const res = await fetch(`${base}/missing`);
    assert.equal(res.status, 404);
  }
});
