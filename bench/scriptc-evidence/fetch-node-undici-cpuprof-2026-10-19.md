# Assessment log — issue #89 premise check

Date: 2026-10-19. Subject: `chttp-fetch-node` (bench/apps/chttp-fetch.ts,
undici Request→app.fetch→Response→ServerResponse bridge).

## Method

`node:inspector` CPU profile (100µs sampling interval) on the bench app
while autocannon drove ~1.46M requests across the canonical cells:

    node /tmp/prof-launch.mjs 3000   # Profiler.start → import app → SIGUSR2 stops+writes
    ac-run /json -c64 -d10      → 289,538 reqs
    ac-run /user/42 -c64 -d10   → 318,531
    ac-run /deep/a/b/c/d/e      → 393,305
    ac-run /echo POST 64B       → 282,140
    ac-run /missing             → 180,609

56.6 s of profiled CPU on the server thread. Self-time attribution by
callFrame URL:

    25.8%   (idle)                     — event-loop headroom
    17.2%   writev                     — socket IO
    13.8%   undici (all frames)        — Request/Headers/Response machinery
     6.0%   web-streams/encoding       — ReadableStream state + enqueue
            │  (ReadableStream internals driven by undici bodies —
            │   createReadableStreamState, byteStreamControllerEnqueue)
     6.1%   node:http server internals
     4.4%   router src (index.ts/sink.ts dispatch + sinks)
     3.0%   GC
     2.0%   bridge code (chttp-fetch.ts anon fns)
    ~rest   misc node internals

Undici self-time breakdown (top):

    1.6% anon @undici:5127             1.4% __name @undici:3
    1.0% _Request ctor                 0.9% extractBody
    0.8% Headers forEach               0.6% HeadersList fill
    0.6% webidl HeadersInit            0.6% readAllBytes (resp.text())
    0.4% _HeadersList                  0.3% makeRequest
    0.3% _Response ctor                plus webidl converters,
                                       isValidHeader*, toSortedArray, …

## Verdict

Premise CONFIRMED. undici frames alone are 13.8% of total CPU; adding the
web-streams machinery they drive takes it to ~19.8% (~27% of non-idle CPU).
Dispatch itself (router src) is only 4.4%. Removing the undici
construction/destruction per request is the largest single removable cost
in the cell — enough to recover most of the 27–47% gap vs chttp-node.

Phase 2 proceeded: LiteRequest/LiteResponse bridge (packages/router/src/
lite.ts) + app.fetchBridge()/app.serveFetch().
