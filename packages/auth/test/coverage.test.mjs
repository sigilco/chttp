// Subset gate: `scriptc coverage gate.ts` must report 100% static.
// Uses the workspace-root .bin/scriptc (scriptc is a root devDependency);
// falls back to PATH.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import path from "node:path";

const pkgDir = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const rootBin = path.resolve(pkgDir, "../../node_modules/.bin/scriptc");
const scriptc = existsSync(rootBin) ? rootBin : "scriptc";

test("gate.ts compiles statically (100%)", () => {
  const out = execFileSync(scriptc, ["coverage", "gate.ts"], {
    cwd: pkgDir,
    encoding: "utf8",
  });
  const line = out.split("\n").find((l) => l.includes("compile statically"));
  assert.ok(line, `no coverage line in output:\n${out}`);
  assert.match(line, /\(100%\)/);
});
