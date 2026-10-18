// unplugin-chttp — build-time route lowering for chttp.
//
// A routes module (default: any file matching `**\/*.chttp.{ts,js}`) is
// analyzed at build start; the plugin writes
// `<dir>/.chttp/<name>.gen.ts` satisfying contracts/route-contract.md:
//   - `export class CompiledRoutes extends GenDispatch` — registered
//     once via `app.withDispatch(new CompiledRoutes(app))` in the
//     app-owning entry, tried first on every request,
//   - `routeTable` — the literal route table.
// The app reaches the class through its constructor: a dependency
// module cannot import an app binding rooted at a package
// instantiation under `scriptc build` (SC1090).
//
// The generated module reaches handlers through the App._chains index
// array — the same table the internal dispatch calls — so it stays
// scriptc-subset-clean and never copies handler source.

import * as fs from "node:fs";
import * as path from "node:path";
import picomatch from "picomatch";
import { createUnplugin } from "unplugin";
import { emitGenModule, genFileName } from "./emit.ts";
import { emitFetchModule, genFetchFileName } from "./emitfetch.ts";
import { extractModule } from "./extract.ts";
import { emitOpenApiModule, openApiFileName } from "./openapi.ts";
import { emitClientModule, clientFileName } from "./client.ts";
import { tsgoAvailable } from "./parse/index.ts";

export interface OpenApiOptions {
  // Output file name under <routes dir>/.chttp/. Default 'routes.openapi.ts'.
  path?: string;
  // OpenAPI info.title. Default: the routes module basename.
  title?: string;
  // OpenAPI info.version. Default '1.0.0'.
  version?: string;
  // Extra module specifiers treated as '@chttp/val' (source-path imports,
  // vendored copies). The package name is always recognized.
  imports?: string[];
}

export interface ClientOptions {
  // Output file name under <routes dir>/.chttp/. Default 'routes.client.ts'.
  path?: string;
  // Default fetch implementation. The runtime typed client uses this when
  // a caller doesn't supply one to createClient(); a value here pre-bakes
  // it so a single-tree build can override globalThis.fetch (e.g. to a
  // mock for tests) without forcing every consumer to thread one through.
  // Mirrored in the generated createClient() default, never imported.
  fetch?: typeof fetch;
}

export interface ChttpPluginOptions {
  // Globs (relative to root) marking route-registration modules.
  // Default: ['**\/*.chttp.ts', '**\/*.chttp.js']
  include?: string[];
  // Project root to scan. Default: vite config.root, else process.cwd().
  root?: string;
  // Import specifier emitted in the gen file for `import type { App }`.
  // Default: '@chttp/router'
  importFrom?: string;
  // Exported binding carrying the router instance: a name, or 'default'.
  // Default: auto-detect.
  appExport?: string;
  // Extra module specifiers treated as chttp imports (in addition to
  // '@chttp/router').
  imports?: string[];
  // Parser backend: 'classic' (default, the tsc 5.x/6.x API) or 'tsgo'
  // (experimental; requires a typescript 7.x nightly providing the
  // 'typescript/unstable' subpath). Selecting 'tsgo' without the nightly
  // installed warns and falls back to classic.
  parser?: "classic" | "tsgo";
  // Emit `.chttp/routes.openapi.ts` beside routes.gen.ts: an OpenAPI 3.1
  // document assembled from the extracted route table plus statically
  // locatable '@chttp/val' schemas (see PLUGIN.md). Side channel: never
  // imported by runtime dispatch or scriptc. Default false (opt-in).
  openapi?: boolean | OpenApiOptions;
  // Emit `.chttp/routes.client.ts`: a typed fetch client exporting
  // `createClient`, `GetRoutes`, `PostRoutes`, etc., with per-route
  // response / body / params inference from literal send-chains (see
  // PLUGIN.md). Side channel: never imported by runtime dispatch or
  // scriptc. `client: true` requires `openapi` to be on (the client types
  // off the openapi sibling's `chttpRouteTable`). Default false (opt-in).
  client?: boolean | ClientOptions;
}

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".chttp", ".vite"]);

function walk(dir: string, out: string[]): void {
  let ents: fs.Dirent[];
  try {
    ents = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) {
        walk(p, out);
      }
    } else if (e.isFile()) {
      out.push(p);
    }
  }
}

export const chttpPlugin = createUnplugin((options?: ChttpPluginOptions) => {
  const include = options?.include ?? ["**/*.chttp.ts", "**/*.chttp.js"];
  const importFrom = options?.importFrom ?? "@chttp/router";
  let root = options?.root ?? process.cwd();

  let parserName = options?.parser ?? "classic";
  if (parserName === "tsgo") {
    console.warn(
      "[unplugin-chttp] parser 'tsgo' is experimental: it requires a typescript 7.x nightly " +
        "(typescript@next) whose sync API breaks between nightlies, so pin the exact version " +
        "you tested. " +
        (tsgoAvailable()
          ? "Nightly detected."
          : "No 'typescript/sync' resolvable here: falling back to classic."),
    );
    if (!tsgoAvailable()) {
      parserName = "classic";
    }
  }

  const matches = (id: string): boolean => {
    const rel = path.isAbsolute(id) ? path.relative(root, id) : id;
    return picomatch.isMatch(rel, include, { dot: true });
  };

  const openapi = options?.openapi === undefined ? false : options.openapi;
  const openapiOn = openapi !== false;
  const openapiOpts = openapi === false ? null : openapi === true ? {} : openapi;
  const openapiValSpecifiers = ["@chttp/val"].concat(openapiOpts?.imports ?? []);

  // `client: true` (or a ClientOptions object) forces `openapi` on: the
  // typed-client module imports the openapi sibling's `chttpRouteTable`.
  // If the user set client explicitly and openapi explicitly to false,
  // surface that as a startup warning; emit nothing for the client.
  const clientOpts = options?.client;
  const clientRequested = clientOpts !== undefined && clientOpts !== false;
  const clientOn = clientRequested && openapiOn;
  if (clientRequested && !openapiOn) {
    console.warn(
      "[unplugin-chttp] client: true requested but openapi is off — emit skipped. " +
        "Enable openapi (true or { ... }) to ship the typed client.",
    );
  }

  const generate = (id: string, warn: (m: string) => void): void => {
    const code = fs.readFileSync(id, "utf8");
    const model = extractModule(id, code, {
      appExport: options?.appExport,
      imports: options?.imports,
      parser: parserName,
      openapiValSpecifiers: openapiOn ? openapiValSpecifiers : undefined,
    });
    const gen = emitGenModule(model, { importFrom: importFrom, modulePath: id });
    const out = path.join(path.dirname(id), ".chttp", genFileName(id));
    let prev = "";
    try {
      prev = fs.readFileSync(out, "utf8");
    } catch {
      prev = "";
    }
    if (prev !== gen) {
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, gen);
    }
    // Web Standards arm (contracts/route-contract-fetch.md): the
    // .gen.fetch.ts sibling the app.fetch/app.fetchShim path registers
    // through withFetchDispatch. Emitted unconditionally — an app that
    // never imports it pays nothing.
    const genFetch = emitFetchModule(model, { importFrom: importFrom });
    const outFetch = path.join(path.dirname(id), ".chttp", genFetchFileName(id));
    let prevFetch = "";
    try {
      prevFetch = fs.readFileSync(outFetch, "utf8");
    } catch {
      prevFetch = "";
    }
    if (prevFetch !== genFetch) {
      fs.mkdirSync(path.dirname(outFetch), { recursive: true });
      fs.writeFileSync(outFetch, genFetch);
    }
    if (openapiOn) {
      const stem = path
        .basename(id)
        .replace(/\.chttp\.(ts|js|mts|mjs|cts|cjs)$/i, "")
        .replace(/\.(ts|js|mts|mjs|cts|cjs)$/i, "");
      const title =
        openapiOpts !== null && openapiOpts.title !== undefined ? openapiOpts.title : stem;
      const version =
        openapiOpts !== null && openapiOpts.version !== undefined ? openapiOpts.version : "1.0.0";
      const oaName =
        openapiOpts !== null && openapiOpts.path !== undefined
          ? openapiOpts.path
          : openApiFileName();
      const oa = emitOpenApiModule(model, { title: title, version: version });
      const oaOut = path.join(path.dirname(id), ".chttp", oaName);
      let oaPrev = "";
      try {
        oaPrev = fs.readFileSync(oaOut, "utf8");
      } catch {
        oaPrev = "";
      }
      if (oaPrev !== oa) {
        fs.mkdirSync(path.dirname(oaOut), { recursive: true });
        fs.writeFileSync(oaOut, oa);
      }
      for (const w of model.openapiWarnings) {
        warn(w);
      }
    }
    if (clientOn) {
      const cliName =
        clientOpts !== true && clientOpts !== undefined && clientOpts.path !== undefined
          ? clientOpts.path
          : clientFileName();
      const cli = emitClientModule(model);
      const cliOut = path.join(path.dirname(id), ".chttp", cliName);
      let cliPrev = "";
      try {
        cliPrev = fs.readFileSync(cliOut, "utf8");
      } catch {
        cliPrev = "";
      }
      if (cliPrev !== cli) {
        fs.mkdirSync(path.dirname(cliOut), { recursive: true });
        fs.writeFileSync(cliOut, cli);
      }
    }
    for (const w of model.warnings) {
      warn(w);
    }
  };

  return {
    name: "unplugin-chttp",
    enforce: "pre",
    vite: {
      configResolved(config: { root: string }): void {
        root = options?.root ?? config.root;
      },
    },
    buildStart(): void {
      // UnpluginContext.warn only exists on transform/load — outside those
      // hooks, console.warn is the honest channel.
      const files: string[] = [];
      walk(root, files);
      for (const f of files) {
        if (matches(f)) {
          generate(f, (m) => console.warn("[unplugin-chttp] " + m));
        }
      }
    },
    transform(code: string, id: string): null {
      // Regenerate from the freshest source whenever the bundler touches a
      // routes module — covers watch mode on bundlers without watchChange.
      if (matches(id)) {
        try {
          generate(id, (m) => this.warn(m));
        } catch (e) {
          this.warn("unplugin-chttp: failed to generate for " + id + ": " + String(e));
        }
      }
      return null;
    },
    watchChange(id: string): void {
      if (matches(id)) {
        try {
          generate(id, (m) => console.warn("[unplugin-chttp] " + m));
        } catch {
          // leave the previous gen file in place
        }
      }
    },
  };
});

export default chttpPlugin;
