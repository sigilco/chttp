// scriptc coverage gate — gate.ts must lower 100% statically. Skipped when
// the scriptc CLI is not on PATH (e.g. packed-tarball smoke environments).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const pkg = dirname(dirname(fileURLToPath(import.meta.url)));
const root = join(pkg, "..", "..");

test("gate.ts compiles 100% statically under scriptc coverage", (t) => {
  let out;
  try {
    // The workspace scriptc binary directly — `pnpm exec` inside a recursive
    // `pnpm -r test` resolves unreliably.
    out = execFileSync(
      join(root, "node_modules", ".bin", "scriptc"),
      ["coverage", join(pkg, "gate.ts")],
      { cwd: root, encoding: "utf8" },
    );
  } catch (e) {
    t.skip("scriptc CLI unavailable: " + e.message.slice(0, 120));
    return;
  }
  const m = out.match(/compile statically\s+(\d+)\s+\((\d+)%\)/);
  assert.ok(m, "coverage output missing summary: " + out.slice(-400));
  assert.equal(m[2], "100", out.slice(-400));
});
