// Route-contract version shared with the runtime check.
//
// ROUTE_CONTRACT_VERSION must equal chttp's exported ROUTE_CONTRACT_VERSION
// (packages/router/src/gen.ts, re-exported from src/index.ts); the equality
// test asserts it against the real workspace chttp export. Bump both
// together on any contract change (contracts/route-contract.md, Contract
// versioning) — never let them drift.

export const ROUTE_CONTRACT_VERSION = 4;
