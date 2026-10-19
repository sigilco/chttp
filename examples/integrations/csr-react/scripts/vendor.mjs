// scriptc lowers subclasses of package classes only when the whole graph
// is program code (see ws-echo/scripts/vendor.mjs, docs/websocket.md).
// BakedAssets extends EmbeddedAssets, so the router and static sources
// are copied into .vendor/ and the app files' "@chttp/*" imports are
// pointed at the vendored copies — `scriptc build src/main.baked.ts`
// then sees one source graph.
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const out = join(root, ".vendor");

function srcOf(name) {
  const mono = resolve(root, "../../packages", name, "src");
  if (existsSync(mono)) return mono;
  return join(root, "node_modules/@chttp", name, "src");
}

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "app"), { recursive: true });
cpSync(srcOf("router"), join(out, "router"), { recursive: true });
cpSync(srcOf("static"), join(out, "static"), { recursive: true });

for (const f of readdirSync(join(out, "static"))) {
  if (!f.endsWith(".ts")) continue;
  const p = join(out, "static", f);
  writeFileSync(p, readFileSync(p, "utf8").replaceAll('"@chttp/router"', '"../router/index.ts"'));
}

// The app modules keep their "@chttp/*" imports for the node path; the
// vendored copies get rewritten imports instead.
for (const f of ["app.ts", "assets.gen.ts"]) {
  writeFileSync(
    join(out, "app", f),
    readFileSync(join(root, "src", f), "utf8")
      .replaceAll('"@chttp/router"', '"../router/index.ts"')
      .replaceAll('"@chttp/static"', '"../static/index.ts"'),
  );
}
