// Generated-dispatch contract — the stable seam between chttp and
// build-time code generators (the Vite/unplugin transform). Spec:
// contracts/route-contract.md (Node arm) and
// contracts/route-contract-fetch.md (Web Standards arm).
//
// Emitters generate `class X extends GenDispatch { dispatch(req,res){…} }`
// and register `app.withDispatch(new X())`. Subclass method override is
// verified to dispatch correctly under both node and scriptc ELF builds.
//
// The Web Standards twin emits `class X extends GenFetch` registered via
// `app.withFetchDispatch(new X(app))`: same normalized primitives
// _dispatchPrim takes (method, url, headers, the optional Web Request,
// seeded body, sink) so app.fetch and app.fetchShim share the one entry.
import type { IncomingMessage, ServerResponse } from "node:http";
import type { FetchResponseSink } from "./sink.ts";
import type { WebReqView } from "./index.ts";

export type DispatchFn = (req: IncomingMessage, res: ServerResponse) => boolean;

// Fetch-arm dispatch closure: the same normalized primitives
// _dispatchPrim consumes. Always Promise — a single async return shape
// lowers cleanly where a Promise|boolean union would fence (SC2009).
export type DispatchFetchFn = (
  method: string,
  url: string,
  headers: Record<string, string> | null,
  webReq: WebReqView | null,
  body: string,
  bodyU8: Uint8Array | null,
  sink: FetchResponseSink,
) => Promise<boolean>;

// Contract version (contracts/route-contract.md, Contract versioning). Bumped
// when the emit contract changes shape. Emitters stamp the same number
// into generated modules and App.withDispatch refuses a mismatch. v4 adds
// the GenFetch arm — Node-shaped modules generated at v3 must regenerate.
export const ROUTE_CONTRACT_VERSION = 4;

export class GenDispatch {
  // Stamp carried by every dispatch instance. GenDispatch subclasses that
  // predate stamping inherit the current version (accepted, backward
  // compat within this cycle); emitted modules assign their own stamped
  // value right after super(), and that value is what gets validated.
  ROUTE_CONTRACT_VERSION: number;

  constructor() {
    this.ROUTE_CONTRACT_VERSION = ROUTE_CONTRACT_VERSION;
  }

  dispatch(_req: IncomingMessage, _res: ServerResponse): boolean {
    return false;
  }
}

// Web Standards-shaped generated dispatch (contracts/route-contract-fetch.md).
// The emitter lowers routes to an async matcher over the same primitives
// _dispatchPrim consumes — no IncomingMessage/ServerResponse anywhere, so
// the module runs identically under app.fetch (a real Request through the
// WebReqView view) and app.fetchShim (plain primitives, webReq === null).
// `true` means the request was answered through `sink`; `false` declines
// to the runtime fallback (_dispatchPrim handles 405/404/notFound).
export class GenFetch {
  ROUTE_CONTRACT_VERSION: number;

  constructor() {
    this.ROUTE_CONTRACT_VERSION = ROUTE_CONTRACT_VERSION;
  }

  dispatchFetch(
    _method: string,
    _url: string,
    _headers: Record<string, string> | null,
    _webReq: WebReqView | null,
    _body: string,
    _bodyU8: Uint8Array | null,
    _sink: FetchResponseSink,
  ): Promise<boolean> {
    return new Promise<boolean>(function (resolve): void {
      resolve(false);
    });
  }
}
