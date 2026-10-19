// Single-binary entry: assets were baked by `pnpm bake` into
// src/assets.gen.ts and `pnpm vendor` staged one program-code graph under
// .vendor/ (BakedAssets subclasses the package's EmbeddedAssets, which
// scriptc only lowers when the whole graph is program code). Build with
// `pnpm build` — bake, vendor, then `scriptc build`.
import { buildApp } from "../.vendor/app/app.ts";
import { BakedAssets } from "../.vendor/app/assets.gen.ts";

buildApp(new BakedAssets()).serve({ port: 3000 });
