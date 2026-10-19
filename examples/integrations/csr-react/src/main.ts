import { DiskAssets } from "@chttp/static";
import { buildApp } from "./app.ts";

// Dev / plain-node entry: reads dist/ on every request (mtime + size
// revalidation), so `vite build` output is picked up without a restart.
buildApp(new DiskAssets("./dist")).serve({ port: 3000 });
