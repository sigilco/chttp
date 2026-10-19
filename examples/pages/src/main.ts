import { buildApp } from "./app.ts";

buildApp(30).serve({ port: Number(process.argv[2] || 3000) });
