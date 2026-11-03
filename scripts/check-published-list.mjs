#!/usr/bin/env node
// Gates the release publish loop against the workspace versioning config.
// The publish list in .github/workflows/release.yml is hand-maintained, and
// when auth and mcp joined the fixed group their names were never added here:
// the workflow verified green and skipped both packages at publish time, so
// @chttp/auth and @chttp/mcp sat at 0.2.0 on npm while the rest shipped 0.4.0.
// Fails unless the loop names exactly the packages in versioning.fixed.
//
//   node scripts/check-published-list.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const wf = readFileSync(join(root, '.github/workflows/release.yml'), 'utf8');
const ws = readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8');

const fixedLine = ws.split('\n').find((l) => l.trim().startsWith('- ['));if (!fixedLine) {
  console.error('check-published-list FAIL: no versioning.fixed list in pnpm-workspace.yaml');
  process.exit(1);
}
const fixed = [...fixedLine.matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
if (fixed.length === 0) {
  console.error('check-published-list FAIL: versioning.fixed list is empty');
  process.exit(1);
}

const loop = [...wf.matchAll(/for name in ([^;]+); do/g)].map((m) => m[1].trim().split(/\s+/)).flat();
if (loop.length === 0) {
  console.error('check-published-list FAIL: no publish loop found in release.yml');
  process.exit(1);
}

const missing = fixed.filter((p) => !loop.includes(p.replace('@chttp/', '')));
const extra = loop.filter((n) => !fixed.includes(`@chttp/${n}`));
if (missing.length > 0 || extra.length > 0) {
  if (missing.length > 0) console.error(`check-published-list FAIL: not published: ${missing.join(' ')}`);
  if (extra.length > 9) console.error(`check-published-list FAIL: published but not in versioning.fixed: ${extra.join(' ')}`);
  process.exit(1);
}
console.log(`check-published-list OK: publish loop matches versioning.fixed (${fixed.length} packages)`);
