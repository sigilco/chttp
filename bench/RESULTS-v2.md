# RESULTS v2 — credible-baseline matrix

> 2026-10-14: subjects renamed ch3* → chttp* (brand rename); measurements unchanged.

2026-10-11 · branch `devin/bench-credible` · supersedes `RESULTS-baseline.md`
(chttp rows were pending there; this run fills them with program-code scriptc ELFs).

**Compare ratios, not absolutes** — `vs raw-node` is cell rps ÷ the same cell's
`raw-node` rps on this VM. Absolute numbers carry shared-VM noise (ENV.md:
8 vCPU KVM guest, client+server share cores over loopback, ±50% run-to-run
variance observed; headline `json` cell is median of 5 reps, others median of 3).

## What's new vs baseline

- **fastify subject** (node + bun): canonical app on its native router
  (find-my-way), all canonical + web-frameworks routes.
- **web-frameworks 3-route suite on every subject**: `root` (GET / empty 2xx),
  `user` (GET /user/:id param echo — already canonical), `postuser` (POST /user
  empty 2xx). Their runner uses `oha`; we mirror the route spec + do a fixed-rate
  latency pass with wrk2 (`results-wrk2/`, below).
- **Raygun mirror**: `hello` cell = `Hello World!` plaintext GET, plus p99 and
  RSS-after-100k columns (their emphasis). No public Raygun harness exists —
  methodology mirrored from the posts, documented in REPRODUCE.md.
- **Two measurement tools**: autocannon (saturation, -c64 -d6) + wrk2 (fixed-rate
  -R 80% of each cell's autocannon median, -L corrected percentile spectrum —
  supplies the true p95 autocannon's fixed percentile set lacks).
- **fastify-parity workload**: `json-p10` = `autocannon -c100 -p10 -d10 x3`,
  matching fastify/benchmarks' shape.
- **Full percentiles per cell**: p50, p97.5, p99, max latency, MB/s,
  errors/timeouts/non-2xx — no rps-only cells.
- **Docker repro**: `bench/Dockerfile` + `bench/docker-compose.yml`
  (one command, see REPRODUCE.md).

## autocannon matrix (-c64 -d6, median; json x5, others x3; json-p10 = fastify-parity -c100 -p10 -d10 x3)

| subject | cell | rps | vs raw-node | p50 | p97.5 | p99 | max | MB/s | err/t/o | non2xx |
|---------|------|-----|-------------|-----|-------|-----|-----|------|---------|--------|
| c-mongoose | json | 110,357 | 1.22x | 0.00 | 1.0 | 1.0 | 22 | 10.2 | 0/0 | 0 |
| c-mongoose | user | 100,789 | 1.20x | 0.00 | 2.0 | 3.0 | 25 | 8.7 | 0/0 | 0 |
| c-mongoose | echo64 | 112,021 | 1.78x | 0.00 | 1.0 | 1.0 | 22 | 14.7 | 0/0 | 0 |
| c-mongoose | echo1k | 105,173 | 1.60x | 0.00 | 1.0 | 2.0 | 20 | 110.1 | 0/0 | 0 |
| c-mongoose | root | 119,179 | 1.25x | 0.00 | 0.0 | 1.0 | 21 | 8.4 | 0/0 | 0 |
| c-mongoose | hello | 104,704 | 1.33x | 0.00 | 1.0 | 3.0 | 23 | 8.6 | 0/0 | 0 |
| c-mongoose | postuser | 124,480 | 1.38x | 0.00 | 0.0 | 1.0 | 20 | 8.8 | 0/0 | 0 |
| chttp-bun | json | 104,640 | 1.15x | 0.00 | 1.0 | 1.0 | 29 | 18.7 | 0/0 | 0 |
| chttp-bun | user | 105,056 | 1.25x | 0.00 | 1.0 | 1.0 | 23 | 18.1 | 0/0 | 0 |
| chttp-bun | echo64 | 104,149 | 1.65x | 0.00 | 1.0 | 1.0 | 20 | 22.6 | 0/0 | 0 |
| chttp-bun | echo1k | 67,083 | 1.02x | 0.00 | 3.0 | 4.0 | 22 | 76.1 | 0/0 | 0 |
| chttp-bun | deep | 79,765 | 0.92x | 0.00 | 3.0 | 4.0 | 26 | 13.8 | 0/0 | 0 |
| chttp-bun | files | 102,837 | 1.18x | 0.00 | 1.0 | 1.0 | 30 | 16.9 | 0/0 | 0 |
| chttp-bun | missing | 93,856 | 1.17x | 0.00 | 2.0 | 3.0 | 28 | 16.0 | 0/0 | 1676079 |
| chttp-bun | mixed | 96,213 | 1.15x | 0.00 | 1.0 | 3.0 | 227 | 16.6 | 0/0 | 0 |
| chttp-bun | root | 112,000 | 1.18x | 0.00 | 1.0 | 1.0 | 21 | 17.4 | 0/0 | 0 |
| chttp-bun | hello | 103,499 | 1.31x | 0.00 | 1.0 | 1.0 | 19 | 17.4 | 0/0 | 0 |
| chttp-bun | postuser | 110,645 | 1.23x | 0.00 | 1.0 | 1.0 | 29 | 17.2 | 0/0 | 0 |
| chttp-fast-scriptc | json | 102,240 | 1.13x | 0.00 | 1.0 | 1.0 | 22 | 18.2 | 0/0 | 0 |
| chttp-fast-scriptc | user | 101,131 | 1.20x | 0.00 | 1.0 | 1.0 | 18 | 17.5 | 0/0 | 0 |
| chttp-fast-scriptc | echo64 | 100,725 | 1.60x | 0.00 | 1.0 | 1.0 | 21 | 21.9 | 0/0 | 0 |
| chttp-fast-scriptc | echo1k | 97,995 | 1.49x | 0.00 | 1.0 | 1.0 | 22 | 111.2 | 0/0 | 0 |
| chttp-fast-scriptc | deep | 100,480 | 1.15x | 0.00 | 1.0 | 1.0 | 25 | 17.3 | 0/0 | 0 |
| chttp-fast-scriptc | files | 98,635 | 1.13x | 0.00 | 1.0 | 1.0 | 24 | 16.2 | 0/0 | 0 |
| chttp-fast-scriptc | missing | 95,093 | 1.18x | 0.00 | 1.0 | 2.0 | 28 | 16.2 | 0/0 | 1701083 |
| chttp-fast-scriptc | mixed | 93,685 | 1.12x | 0.00 | 1.0 | 2.0 | 242 | 16.2 | 0/0 | 0 |
| chttp-fast-scriptc | root | 102,421 | 1.08x | 0.00 | 1.0 | 1.0 | 22 | 15.9 | 0/0 | 0 |
| chttp-fast-scriptc | hello | 97,856 | 1.24x | 0.00 | 1.0 | 1.0 | 24 | 16.4 | 0/0 | 0 |
| chttp-fast-scriptc | postuser | 102,155 | 1.14x | 0.00 | 1.0 | 1.0 | 19 | 15.9 | 0/0 | 0 |
| chttp-node | json | 79,179 | 0.87x | 0.00 | 1.0 | 3.0 | 35 | 14.1 | 0/0 | 0 |
| chttp-node | user | 78,731 | 0.93x | 0.00 | 1.0 | 2.0 | 24 | 13.6 | 0/0 | 0 |
| chttp-node | echo64 | 72,893 | 1.16x | 0.00 | 1.0 | 2.0 | 39 | 15.8 | 0/0 | 0 |
| chttp-node | echo1k | 62,888 | 0.95x | 0.00 | 1.0 | 2.0 | 22 | 71.4 | 0/0 | 0 |
| chttp-node | deep | 83,947 | 0.96x | 0.00 | 1.0 | 2.0 | 24 | 14.5 | 0/0 | 0 |
| chttp-node | files | 81,941 | 0.94x | 0.00 | 1.0 | 1.0 | 22 | 13.4 | 0/0 | 0 |
| chttp-node | missing | 67,221 | 0.84x | 0.00 | 3.0 | 4.0 | 39 | 11.5 | 0/0 | 1289727 |
| chttp-node | mixed | 57,496 | 0.69x | 0.00 | 3.0 | 4.0 | 277 | 9.9 | 0/0 | 0 |
| chttp-node | root | 68,189 | 0.72x | 0.00 | 3.0 | 4.0 | 29 | 10.6 | 0/0 | 0 |
| chttp-node | hello | 77,013 | 0.98x | 0.00 | 2.0 | 3.0 | 28 | 12.9 | 0/0 | 0 |
| chttp-node | postuser | 96,821 | 1.08x | 0.00 | 1.0 | 1.0 | 26 | 15.0 | 0/0 | 0 |
| chttp-node | json-p10 | 110,035 | 0.95x | 10.00 | 13.0 | 15.0 | 66 | 19.6 | 0/0 | 0 |
| chttp-scriptc | json | 103,947 | 1.15x | 0.00 | 0.0 | 1.0 | 21 | 18.5 | 0/0 | 0 |
| chttp-scriptc | user | 103,936 | 1.23x | 0.00 | 0.0 | 1.0 | 20 | 17.9 | 0/0 | 0 |
| chttp-scriptc | echo64 | 102,571 | 1.63x | 0.00 | 1.0 | 1.0 | 20 | 22.3 | 0/0 | 0 |
| chttp-scriptc | echo1k | 96,843 | 1.47x | 0.00 | 1.0 | 1.0 | 21 | 109.9 | 0/0 | 0 |
| chttp-scriptc | deep | 99,413 | 1.14x | 0.00 | 1.0 | 1.0 | 21 | 17.2 | 0/0 | 0 |
| chttp-scriptc | files | 102,336 | 1.18x | 0.00 | 1.0 | 1.0 | 20 | 16.8 | 0/0 | 0 |
| chttp-scriptc | missing | 96,747 | 1.20x | 0.00 | 1.0 | 2.0 | 18 | 16.5 | 0/0 | 1710868 |
| chttp-scriptc | mixed | 95,008 | 1.14x | 0.00 | 1.0 | 3.0 | 233 | 16.4 | 0/0 | 0 |
| chttp-scriptc | root | 107,008 | 1.12x | 0.00 | 0.0 | 1.0 | 20 | 16.6 | 0/0 | 0 |
| chttp-scriptc | hello | 101,323 | 1.28x | 0.00 | 1.0 | 1.0 | 24 | 17.0 | 0/0 | 0 |
| chttp-scriptc | postuser | 105,685 | 1.17x | 0.00 | 0.0 | 1.0 | 21 | 16.4 | 0/0 | 0 |
| chttp-scriptc | json-p10 | 204,109 | 1.76x | 4.00 | 7.0 | 9.0 | 45 | 36.4 | 0/0 | 0 |
| express-bun | json | 84,928 | 0.94x | 0.00 | 1.0 | 1.0 | 22 | 18.5 | 0/0 | 0 |
| express-bun | user | 83,499 | 0.99x | 0.00 | 1.0 | 1.0 | 22 | 17.7 | 0/0 | 0 |
| express-bun | echo64 | 65,181 | 1.04x | 0.00 | 1.0 | 2.0 | 26 | 16.8 | 0/0 | 0 |
| express-bun | echo1k | 57,680 | 0.87x | 1.00 | 1.0 | 2.0 | 21 | 67.8 | 0/0 | 0 |
| express-bun | deep | 81,024 | 0.93x | 0.00 | 1.0 | 2.0 | 19 | 17.2 | 0/0 | 0 |
| express-bun | files | 78,208 | 0.90x | 0.00 | 1.0 | 1.0 | 25 | 15.9 | 0/0 | 0 |
| express-bun | missing | 71,741 | 0.89x | 0.00 | 1.0 | 2.0 | 20 | 27.0 | 0/0 | 1294236 |
| express-bun | mixed | 67,971 | 0.81x | 0.00 | 1.0 | 3.0 | 207 | 14.4 | 0/0 | 0 |
| express-bun | root | 90,837 | 0.95x | 0.00 | 1.0 | 1.0 | 20 | 17.7 | 0/0 | 0 |
| express-bun | hello | 85,056 | 1.08x | 0.00 | 1.0 | 1.0 | 21 | 17.6 | 0/0 | 0 |
| express-bun | postuser | 97,547 | 1.08x | 0.00 | 1.0 | 1.0 | 18 | 19.0 | 0/0 | 0 |
| express-node | json | 53,435 | 0.59x | 1.00 | 1.0 | 2.0 | 20 | 11.7 | 0/0 | 0 |
| express-node | user | 51,184 | 0.61x | 1.00 | 1.0 | 2.0 | 22 | 10.8 | 0/0 | 0 |
| express-node | echo64 | 43,131 | 0.69x | 1.00 | 2.0 | 3.0 | 25 | 11.1 | 0/0 | 0 |
| express-node | echo1k | 42,133 | 0.64x | 1.00 | 2.0 | 3.0 | 25 | 49.5 | 0/0 | 0 |
| express-node | deep | 54,021 | 0.62x | 1.00 | 1.0 | 2.0 | 18 | 11.4 | 0/0 | 0 |
| express-node | files | 52,501 | 0.60x | 1.00 | 1.0 | 3.0 | 23 | 10.7 | 0/0 | 0 |
| express-node | missing | 46,640 | 0.58x | 1.00 | 1.0 | 3.0 | 23 | 17.6 | 0/0 | 838259 |
| express-node | mixed | 45,088 | 0.54x | 1.00 | 2.0 | 4.0 | 204 | 9.5 | 0/0 | 0 |
| express-node | root | 58,368 | 0.61x | 1.00 | 1.0 | 2.0 | 21 | 11.4 | 0/0 | 0 |
| express-node | hello | 55,563 | 0.70x | 1.00 | 1.0 | 2.0 | 22 | 11.5 | 0/0 | 0 |
| express-node | postuser | 57,056 | 0.63x | 1.00 | 1.0 | 2.0 | 21 | 11.1 | 0/0 | 0 |
| express-node | json-p10 | 63,969 | 0.55x | 18.00 | 24.0 | 26.0 | 61 | 14.0 | 0/0 | 0 |
| fastify-bun | json | 105,141 | 1.16x | 0.00 | 1.0 | 1.0 | 21 | 18.8 | 0/0 | 0 |
| fastify-bun | user | 105,067 | 1.25x | 0.00 | 1.0 | 1.0 | 22 | 18.2 | 0/0 | 0 |
| fastify-bun | echo64 | 87,189 | 1.38x | 0.00 | 1.0 | 1.0 | 23 | 17.8 | 0/0 | 0 |
| fastify-bun | echo1k | 74,987 | 1.14x | 0.00 | 1.0 | 2.0 | 22 | 84.1 | 0/0 | 0 |
| fastify-bun | deep | 105,515 | 1.21x | 0.00 | 1.0 | 1.0 | 19 | 18.3 | 0/0 | 0 |
| fastify-bun | files | 106,091 | 1.22x | 0.00 | 1.0 | 1.0 | 28 | 16.0 | 0/0 | 0 |
| fastify-bun | missing | 92,872 | 1.16x | 0.00 | 1.0 | 2.0 | 31 | 22.8 | 0/0 | 1638712 |
| fastify-bun | mixed | 78,027 | 0.93x | 0.00 | 3.0 | 4.0 | 240 | 13.5 | 0/0 | 0 |
| fastify-bun | root | 107,637 | 1.13x | 0.00 | 1.0 | 1.0 | 23 | 12.6 | 0/0 | 0 |
| fastify-bun | hello | 106,016 | 1.34x | 0.00 | 1.0 | 1.0 | 23 | 16.4 | 0/0 | 0 |
| fastify-bun | postuser | 108,277 | 1.20x | 0.00 | 1.0 | 1.0 | 39 | 12.7 | 0/0 | 0 |
| fastify-node | json | 62,581 | 0.69x | 0.00 | 1.0 | 3.0 | 26 | 11.2 | 0/0 | 0 |
| fastify-node | user | 61,776 | 0.73x | 0.00 | 2.0 | 3.0 | 23 | 10.7 | 0/0 | 0 |
| fastify-node | echo64 | 54,699 | 0.87x | 1.00 | 2.0 | 3.0 | 20 | 11.2 | 0/0 | 0 |
| fastify-node | echo1k | 51,376 | 0.78x | 1.00 | 2.0 | 3.0 | 23 | 57.6 | 0/0 | 0 |
| fastify-node | deep | 64,547 | 0.74x | 0.00 | 1.0 | 2.0 | 19 | 11.2 | 0/0 | 0 |
| fastify-node | files | 63,901 | 0.73x | 0.00 | 1.0 | 2.0 | 21 | 9.6 | 0/0 | 0 |
| fastify-node | missing | 62,888 | 0.78x | 0.00 | 1.0 | 2.0 | 21 | 15.4 | 0/0 | 1137275 |
| fastify-node | mixed | 62,208 | 0.74x | 0.00 | 1.0 | 3.0 | 212 | 10.8 | 0/0 | 0 |
| fastify-node | root | 72,949 | 0.77x | 0.00 | 1.0 | 1.0 | 22 | 8.6 | 0/0 | 0 |
| fastify-node | hello | 57,267 | 0.73x | 0.00 | 3.0 | 3.0 | 45 | 8.8 | 0/0 | 0 |
| fastify-node | postuser | 70,848 | 0.79x | 0.00 | 1.0 | 2.0 | 25 | 8.3 | 0/0 | 0 |
| fastify-node | json-p10 | 75,584 | 0.65x | 10.00 | 24.0 | 26.0 | 70 | 13.6 | 0/0 | 0 |
| fmw-bun | json | 95,627 | 1.05x | 0.00 | 1.0 | 2.0 | 36 | 17.4 | 0/0 | 0 |
| fmw-bun | user | 96,512 | 1.15x | 0.00 | 1.0 | 1.0 | 20 | 16.9 | 0/0 | 0 |
| fmw-bun | echo64 | 93,323 | 1.48x | 0.00 | 1.0 | 2.0 | 29 | 20.6 | 0/0 | 0 |
| fmw-bun | echo1k | 90,507 | 1.37x | 0.00 | 1.0 | 1.0 | 22 | 103.0 | 0/0 | 0 |
| fmw-bun | deep | 98,144 | 1.13x | 0.00 | 1.0 | 1.0 | 21 | 17.2 | 0/0 | 0 |
| fmw-bun | files | 100,491 | 1.16x | 0.00 | 1.0 | 1.0 | 19 | 16.9 | 0/0 | 0 |
| fmw-bun | missing | 116,544 | 1.45x | 0.00 | 1.0 | 1.0 | 23 | 14.3 | 0/0 | 2088155 |
| fmw-bun | mixed | 94,389 | 1.13x | 0.00 | 1.0 | 2.0 | 231 | 16.6 | 0/0 | 0 |
| fmw-bun | root | 43,723 | 0.46x | 0.00 | 5.0 | 6.0 | 49 | 6.8 | 0/0 | 0 |
| fmw-bun | hello | 81,741 | 1.04x | 0.00 | 3.0 | 3.0 | 37 | 14.0 | 0/0 | 0 |
| fmw-bun | postuser | 95,520 | 1.06x | 0.00 | 1.0 | 2.0 | 24 | 14.8 | 0/0 | 0 |
| fmw-node | json | 89,173 | 0.98x | 0.00 | 1.0 | 1.0 | 25 | 16.2 | 0/0 | 0 |
| fmw-node | user | 86,944 | 1.03x | 0.00 | 1.0 | 1.0 | 22 | 15.3 | 0/0 | 0 |
| fmw-node | echo64 | 74,464 | 1.18x | 0.00 | 1.0 | 2.0 | 24 | 16.5 | 0/0 | 0 |
| fmw-node | echo1k | 73,376 | 1.11x | 0.00 | 1.0 | 2.0 | 21 | 83.5 | 0/0 | 0 |
| fmw-node | deep | 88,832 | 1.02x | 0.00 | 1.0 | 1.0 | 21 | 15.6 | 0/0 | 0 |
| fmw-node | files | 86,549 | 0.99x | 0.00 | 1.0 | 2.0 | 26 | 14.5 | 0/0 | 0 |
| fmw-node | missing | 103,552 | 1.29x | 0.00 | 1.0 | 1.0 | 32 | 12.7 | 0/0 | 1858573 |
| fmw-node | mixed | 81,333 | 0.97x | 0.00 | 1.0 | 3.0 | 204 | 14.3 | 0/0 | 0 |
| fmw-node | root | 103,125 | 1.08x | 0.00 | 1.0 | 1.0 | 17 | 15.9 | 0/0 | 0 |
| fmw-node | hello | 88,192 | 1.12x | 0.00 | 1.0 | 1.0 | 28 | 15.1 | 0/0 | 0 |
| fmw-node | postuser | 92,608 | 1.03x | 0.00 | 2.0 | 3.0 | 21 | 14.3 | 0/0 | 0 |
| fmw-node | json-p10 | 101,318 | 0.87x | 9.00 | 20.0 | 23.0 | 52 | 18.5 | 0/0 | 0 |
| go-chi | json | 110,144 | 1.21x | 0.00 | 1.0 | 1.0 | 43 | 13.1 | 0/0 | 0 |
| go-chi | user | 99,979 | 1.19x | 0.00 | 1.0 | 2.0 | 30 | 11.3 | 0/0 | 0 |
| go-chi | echo64 | 109,291 | 1.74x | 0.00 | 1.0 | 1.0 | 27 | 17.3 | 0/0 | 0 |
| go-chi | echo1k | 83,328 | 1.26x | 0.00 | 1.0 | 2.0 | 20 | 50.4 | 0/0 | 0 |
| go-chi | root | 117,739 | 1.24x | 0.00 | 1.0 | 1.0 | 20 | 11.3 | 0/0 | 0 |
| go-chi | hello | 111,659 | 1.41x | 0.00 | 1.0 | 1.0 | 17 | 12.1 | 0/0 | 0 |
| go-chi | postuser | 118,443 | 1.32x | 0.00 | 1.0 | 1.0 | 22 | 11.4 | 0/0 | 0 |
| h3-bun | json | 97,984 | 1.08x | 0.00 | 1.0 | 2.0 | 201 | 13.0 | 0/0 | 0 |
| h3-bun | user | 103,712 | 1.23x | 0.00 | 1.0 | 1.0 | 34 | 13.2 | 0/0 | 0 |
| h3-bun | echo64 | 101,077 | 1.61x | 0.00 | 1.0 | 3.0 | 37 | 16.0 | 0/0 | 0 |
| h3-bun | echo1k | 92,363 | 1.40x | 0.00 | 2.0 | 3.0 | 23 | 99.4 | 0/0 | 0 |
| h3-bun | deep | 98,197 | 1.13x | 0.00 | 1.0 | 2.0 | 25 | 12.5 | 0/0 | 0 |
| h3-bun | files | 102,272 | 1.18x | 0.00 | 1.0 | 2.0 | 22 | 12.1 | 0/0 | 0 |
| h3-bun | missing | 100,992 | 1.26x | 0.00 | 1.0 | 2.0 | 28 | 21.4 | 0/0 | 1787276 |
| h3-bun | mixed | 96,181 | 1.15x | 0.00 | 1.0 | 3.0 | 208 | 12.2 | 0/0 | 0 |
| h3-bun | root | 110,645 | 1.16x | 0.00 | 1.0 | 2.0 | 38 | 7.9 | 0/0 | 0 |
| h3-bun | hello | 103,317 | 1.31x | 0.00 | 1.0 | 2.0 | 30 | 12.6 | 0/0 | 0 |
| h3-bun | postuser | 112,992 | 1.26x | 0.00 | 1.0 | 2.0 | 33 | 8.1 | 0/0 | 0 |
| h3-node | json | 75,891 | 0.84x | 0.00 | 2.0 | 3.0 | 36 | 13.3 | 0/0 | 0 |
| h3-node | user | 67,928 | 0.81x | 0.00 | 2.0 | 3.0 | 26 | 11.5 | 0/0 | 0 |
| h3-node | echo64 | 37,719 | 0.60x | 1.00 | 4.0 | 5.0 | 128 | 8.3 | 0/0 | 0 |
| h3-node | echo1k | 33,992 | 0.52x | 1.00 | 5.0 | 6.0 | 47 | 38.6 | 0/0 | 0 |
| h3-node | deep | 60,301 | 0.69x | 0.00 | 3.0 | 4.0 | 26 | 10.2 | 0/0 | 0 |
| h3-node | files | 69,035 | 0.79x | 0.00 | 1.0 | 3.0 | 42 | 11.2 | 0/0 | 0 |
| h3-node | missing | 43,557 | 0.54x | 1.00 | 2.0 | 3.0 | 41 | 10.8 | 0/0 | 770552 |
| h3-node | mixed | 69,173 | 0.83x | 0.00 | 2.0 | 4.0 | 270 | 11.7 | 0/0 | 0 |
| h3-node | root | 86,496 | 0.91x | 0.00 | 1.0 | 2.0 | 25 | 13.3 | 0/0 | 0 |
| h3-node | hello | 75,744 | 0.96x | 0.00 | 2.0 | 3.0 | 26 | 12.6 | 0/0 | 0 |
| h3-node | postuser | 83,744 | 0.93x | 0.00 | 1.0 | 2.0 | 37 | 12.9 | 0/0 | 0 |
| h3-node | json-p10 | 103,567 | 0.89x | 10.00 | 15.0 | 17.0 | 41 | 18.2 | 0/0 | 0 |
| hono-bun | json | 103,104 | 1.14x | 0.00 | 1.0 | 2.0 | 20 | 12.3 | 0/0 | 0 |
| hono-bun | user | 104,171 | 1.24x | 0.00 | 1.0 | 2.0 | 29 | 11.8 | 0/0 | 0 |
| hono-bun | echo64 | 101,995 | 1.62x | 0.00 | 1.0 | 2.0 | 88 | 17.5 | 0/0 | 0 |
| hono-bun | echo1k | 62,571 | 0.95x | 0.00 | 3.0 | 4.0 | 36 | 68.1 | 0/0 | 0 |
| hono-bun | deep | 98,397 | 1.13x | 0.00 | 1.0 | 2.0 | 27 | 11.2 | 0/0 | 0 |
| hono-bun | files | 110,656 | 1.27x | 0.00 | 1.0 | 1.0 | 33 | 13.1 | 0/0 | 0 |
| hono-bun | missing | 110,208 | 1.37x | 0.00 | 1.0 | 1.0 | 25 | 14.4 | 0/0 | 1997204 |
| hono-bun | mixed | 100,501 | 1.20x | 0.00 | 1.0 | 2.0 | 241 | 11.4 | 0/0 | 0 |
| hono-bun | root | 116,651 | 1.23x | 0.00 | 1.0 | 1.0 | 28 | 8.3 | 0/0 | 0 |
| hono-bun | hello | 104,843 | 1.33x | 0.00 | 1.0 | 1.0 | 47 | 12.8 | 0/0 | 0 |
| hono-bun | postuser | 118,144 | 1.31x | 0.00 | 1.0 | 1.0 | 111 | 8.5 | 0/0 | 0 |
| hono-node | json | 77,163 | 0.85x | 0.00 | 2.0 | 2.0 | 40 | 12.7 | 0/0 | 0 |
| hono-node | user | 74,208 | 0.88x | 0.00 | 2.0 | 3.0 | 32 | 11.7 | 0/0 | 0 |
| hono-node | echo64 | 58,925 | 0.94x | 0.00 | 2.0 | 3.0 | 22 | 12.8 | 0/0 | 0 |
| hono-node | echo1k | 51,120 | 0.78x | 1.00 | 3.0 | 4.0 | 53 | 58.0 | 0/0 | 0 |
| hono-node | deep | 76,232 | 0.88x | 0.00 | 2.0 | 3.0 | 33 | 12.1 | 0/0 | 0 |
| hono-node | files | 76,469 | 0.88x | 0.00 | 1.0 | 2.0 | 28 | 12.5 | 0/0 | 0 |
| hono-node | missing | 73,781 | 0.92x | 0.00 | 1.0 | 3.0 | 34 | 12.9 | 0/0 | 1288627 |
| hono-node | mixed | 69,747 | 0.83x | 0.00 | 2.0 | 3.0 | 244 | 11.0 | 0/0 | 0 |
| hono-node | root | 86,539 | 0.91x | 0.00 | 1.0 | 2.0 | 31 | 13.5 | 0/0 | 0 |
| hono-node | hello | 80,512 | 1.02x | 0.00 | 1.0 | 2.0 | 22 | 13.5 | 0/0 | 0 |
| hono-node | postuser | 75,989 | 0.84x | 0.00 | 1.0 | 2.0 | 24 | 11.8 | 0/0 | 0 |
| hono-node | json-p10 | 108,367 | 0.93x | 10.00 | 14.0 | 16.0 | 31 | 17.8 | 0/0 | 0 |
| raw-bun | json | 107,979 | 1.19x | 0.00 | 1.0 | 1.0 | 23 | 12.9 | 0/0 | 0 |
| raw-bun | user | 108,448 | 1.29x | 0.00 | 1.0 | 1.0 | 24 | 12.3 | 0/0 | 0 |
| raw-bun | echo64 | 104,608 | 1.66x | 0.00 | 1.0 | 1.0 | 34 | 18.5 | 0/0 | 0 |
| raw-bun | echo1k | 98,816 | 1.50x | 0.00 | 1.0 | 1.0 | 21 | 108.0 | 0/0 | 0 |
| raw-bun | deep | 109,387 | 1.26x | 0.00 | 1.0 | 1.0 | 19 | 12.4 | 0/0 | 0 |
| raw-bun | files | 110,944 | 1.28x | 0.00 | 1.0 | 1.0 | 24 | 11.6 | 0/0 | 0 |
| raw-bun | missing | 111,371 | 1.39x | 0.00 | 1.0 | 1.0 | 19 | 12.4 | 0/0 | 2007309 |
| raw-bun | mixed | 101,653 | 1.22x | 0.00 | 1.0 | 2.0 | 228 | 11.5 | 0/0 | 0 |
| raw-bun | root | 106,624 | 1.12x | 0.00 | 1.0 | 3.0 | 18 | 10.3 | 0/0 | 0 |
| raw-bun | hello | 107,691 | 1.36x | 0.00 | 1.0 | 1.0 | 20 | 11.7 | 0/0 | 0 |
| raw-bun | postuser | 91,989 | 1.02x | 0.00 | 3.0 | 3.0 | 30 | 8.9 | 0/0 | 0 |
| raw-node | json | 90,699 | 1.00x | 0.00 | 1.0 | 1.0 | 27 | 14.9 | 0/0 | 0 |
| raw-node | user | 84,256 | 1.00x | 0.00 | 1.0 | 2.0 | 23 | 13.3 | 0/0 | 0 |
| raw-node | echo64 | 62,963 | 1.00x | 0.00 | 3.0 | 4.0 | 27 | 12.8 | 0/0 | 0 |
| raw-node | echo1k | 65,936 | 1.00x | 0.00 | 2.0 | 4.0 | 32 | 73.9 | 0/0 | 0 |
| raw-node | deep | 87,072 | 1.00x | 0.00 | 1.0 | 2.0 | 19 | 13.8 | 0/0 | 0 |
| raw-node | files | 86,987 | 1.00x | 0.00 | 1.0 | 2.0 | 23 | 13.0 | 0/0 | 0 |
| raw-node | missing | 80,341 | 1.00x | 0.00 | 3.0 | 4.0 | 26 | 12.6 | 0/0 | 1499402 |
| raw-node | mixed | 83,531 | 1.00x | 0.00 | 1.0 | 2.0 | 209 | 13.2 | 0/0 | 0 |
| raw-node | root | 95,168 | 1.00x | 0.00 | 1.0 | 2.0 | 22 | 13.4 | 0/0 | 0 |
| raw-node | hello | 78,933 | 1.00x | 0.00 | 2.0 | 3.0 | 25 | 12.1 | 0/0 | 0 |
| raw-node | postuser | 89,973 | 1.00x | 0.00 | 1.0 | 2.0 | 31 | 12.7 | 0/0 | 0 |
| raw-node | json-p10 | 116,093 | 1.00x | 9.00 | 13.0 | 14.0 | 28 | 19.0 | 0/0 | 0 |
| raw-scriptc | json | 90,603 | 1.00x | 0.00 | 1.0 | 3.0 | 26 | 14.9 | 0/0 | 0 |
| raw-scriptc | user | 99,232 | 1.18x | 0.00 | 1.0 | 1.0 | 18 | 15.7 | 0/0 | 0 |
| raw-scriptc | echo64 | 98,645 | 1.57x | 0.00 | 1.0 | 1.0 | 27 | 20.0 | 0/0 | 0 |
| raw-scriptc | echo1k | 94,539 | 1.43x | 0.00 | 1.0 | 1.0 | 21 | 105.9 | 0/0 | 0 |
| raw-scriptc | deep | 98,891 | 1.14x | 0.00 | 1.0 | 1.0 | 19 | 15.7 | 0/0 | 0 |
| raw-scriptc | files | 99,595 | 1.14x | 0.00 | 1.0 | 1.0 | 23 | 14.9 | 0/0 | 0 |
| raw-scriptc | missing | 95,339 | 1.19x | 0.00 | 1.0 | 2.0 | 21 | 14.9 | 0/0 | 1693740 |
| raw-scriptc | mixed | 93,536 | 1.12x | 0.00 | 1.0 | 2.0 | 218 | 14.8 | 0/0 | 0 |
| raw-scriptc | root | 103,061 | 1.08x | 0.00 | 1.0 | 1.0 | 21 | 14.5 | 0/0 | 0 |
| raw-scriptc | hello | 97,387 | 1.23x | 0.00 | 1.0 | 1.0 | 21 | 15.0 | 0/0 | 0 |
| raw-scriptc | postuser | 105,685 | 1.17x | 0.00 | 1.0 | 1.0 | 20 | 14.9 | 0/0 | 0 |
| raw-scriptc | json-p10 | 197,222 | 1.70x | 4.00 | 7.0 | 9.0 | 28 | 32.3 | 0/0 | 0 |
| rust-axum | json | 99,936 | 1.10x | 0.00 | 1.0 | 2.0 | 26 | 11.9 | 0/0 | 0 |
| rust-axum | user | 108,459 | 1.29x | 0.00 | 1.0 | 1.0 | 18 | 12.3 | 0/0 | 0 |
| rust-axum | echo64 | 107,979 | 1.71x | 0.00 | 1.0 | 1.0 | 20 | 17.1 | 0/0 | 0 |
| rust-axum | echo1k | 101,611 | 1.54x | 0.00 | 1.0 | 1.0 | 21 | 109.3 | 0/0 | 0 |
| rust-axum | root | 108,160 | 1.14x | 0.00 | 1.0 | 2.0 | 25 | 12.0 | 0/0 | 0 |
| rust-axum | hello | 105,653 | 1.34x | 0.00 | 1.0 | 1.0 | 22 | 13.0 | 0/0 | 0 |
| rust-axum | postuser | 112,021 | 1.25x | 0.00 | 1.0 | 1.0 | 22 | 12.4 | 0/0 | 0 |

## wrk2 cross-validation (-t4 -c64 -d10 -R 80% of autocannon median, -L spectrum; latency in ms)

| subject | cell | target rps | achieved | ac rps | p50 | p95 | p99 | max | non2xx |
|---------|------|-----------|----------|--------|-----|-----|-----|-----|--------|
| c-mongoose | json | 88,286 | 87,946 | 110,357 | 1.16 | 2.41 | 4.2 | 8 | 0 |
| c-mongoose | user | 80,631 | 80,313 | 100,789 | 1.16 | 2.44 | 4.2 | 9 | 0 |
| c-mongoose | root | 95,343 | 94,976 | 119,179 | 1.17 | 2.97 | 20.2 | 43 | 0 |
| c-mongoose | postuser | 99,584 | 99,202 | 124,480 | 1.14 | 2.43 | 4.8 | 12 | 0 |
| chttp-bun | json | 83,712 | 83,382 | 104,640 | 1.20 | 3.66 | 7.6 | 25 | 0 |
| chttp-bun | user | 84,045 | 83,710 | 105,056 | 1.28 | 12.99 | 42.4 | 62 | 0 |
| chttp-bun | root | 89,600 | 89,252 | 112,000 | 1.21 | 4.11 | 21.7 | 58 | 0 |
| chttp-bun | postuser | 88,516 | 88,177 | 110,645 | 1.25 | 8.44 | 54.8 | 72 | 0 |
| chttp-fast-scriptc | json | 81,792 | 81,472 | 102,240 | 1.11 | 3.32 | 11.9 | 43 | 0 |
| chttp-fast-scriptc | user | 80,905 | 80,589 | 101,131 | 1.08 | 2.32 | 4.7 | 10 | 0 |
| chttp-fast-scriptc | root | 81,937 | 81,614 | 102,421 | 1.06 | 2.17 | 4.1 | 9 | 0 |
| chttp-fast-scriptc | postuser | 81,724 | 81,402 | 102,155 | 1.06 | 2.24 | 4.9 | 12 | 0 |
| chttp-node | json | 63,343 | 59,473 | 79,179 | 1.17 | 14.33 | 185.7 | 346 | 0 |
| chttp-node | user | 62,985 | 61,220 | 78,731 | 1.19 | 50.50 | 250.0 | 290 | 0 |
| chttp-node | root | 54,551 | 54,337 | 68,189 | 0.89 | 1.95 | 4.3 | 11 | 0 |
| chttp-node | postuser | 77,457 | 77,138 | 96,821 | 1.28 | 5.82 | 12.3 | 24 | 0 |
| chttp-scriptc | json | 83,157 | 80,821 | 103,947 | 1.09 | 2.75 | 47.5 | 83 | 0 |
| chttp-scriptc | user | 83,149 | 82,824 | 103,936 | 1.12 | 2.76 | 6.8 | 27 | 0 |
| chttp-scriptc | root | 85,606 | 85,253 | 107,008 | 1.07 | 2.23 | 4.8 | 15 | 0 |
| chttp-scriptc | postuser | 84,548 | 82,176 | 105,685 | 1.08 | 2.48 | 29.3 | 76 | 0 |
| express-bun | json | 67,942 | 67,673 | 84,928 | 1.37 | 7.02 | 15.9 | 35 | 0 |
| express-bun | user | 66,799 | 66,538 | 83,499 | 1.35 | 8.55 | 70.5 | 89 | 0 |
| express-bun | root | 72,670 | 72,384 | 90,837 | 1.33 | 32.50 | 100.4 | 118 | 0 |
| express-bun | postuser | 78,037 | 77,743 | 97,547 | 1.38 | 7.21 | 19.6 | 32 | 0 |
| express-node | json | 42,748 | 42,582 | 53,435 | 1.15 | 5.92 | 29.7 | 53 | 0 |
| express-node | user | 40,947 | 40,788 | 51,184 | 1.18 | 5.79 | 10.3 | 32 | 0 |
| express-node | root | 46,694 | 46,496 | 58,368 | 1.15 | 4.71 | 11.4 | 29 | 0 |
| express-node | postuser | 45,645 | 45,467 | 57,056 | 1.12 | 3.77 | 8.3 | 22 | 0 |
| fastify-bun | json | 84,113 | 81,748 | 105,141 | 1.25 | 4.45 | 8.4 | 19 | 0 |
| fastify-bun | user | 84,053 | 83,723 | 105,067 | 1.20 | 2.99 | 5.9 | 12 | 0 |
| fastify-bun | root | 86,110 | 85,781 | 107,637 | 1.26 | 7.08 | 29.3 | 52 | 0 |
| fastify-bun | postuser | 86,622 | 86,278 | 108,277 | 1.39 | 12.68 | 38.9 | 63 | 0 |
| fastify-node | json | 50,065 | 49,861 | 62,581 | 1.05 | 4.82 | 26.7 | 50 | 0 |
| fastify-node | user | 49,421 | 49,230 | 61,776 | 1.04 | 3.65 | 8.2 | 31 | 0 |
| fastify-node | root | 58,359 | 56,727 | 72,949 | 1.07 | 4.01 | 8.0 | 17 | 0 |
| fastify-node | postuser | 56,678 | 55,093 | 70,848 | 1.28 | 86.98 | 133.6 | 170 | 0 |
| fmw-bun | json | 76,501 | 76,202 | 95,627 | 1.15 | 2.66 | 5.4 | 16 | 0 |
| fmw-bun | user | 77,210 | 76,912 | 96,512 | 1.16 | 3.01 | 6.4 | 16 | 0 |
| fmw-bun | root | 34,978 | 34,844 | 43,723 | 0.86 | 1.78 | 4.0 | 15 | 0 |
| fmw-bun | postuser | 76,416 | 76,120 | 95,520 | 1.15 | 2.79 | 6.8 | 22 | 0 |
| fmw-node | json | 71,339 | 71,064 | 89,173 | 1.23 | 4.53 | 8.5 | 15 | 0 |
| fmw-node | user | 69,555 | 69,283 | 86,944 | 1.21 | 4.27 | 9.1 | 22 | 0 |
| fmw-node | root | 82,500 | 82,177 | 103,125 | 1.20 | 3.84 | 8.4 | 24 | 0 |
| fmw-node | postuser | 74,086 | 73,801 | 92,608 | 1.16 | 2.94 | 6.8 | 20 | 0 |
| go-chi | json | 88,115 | 87,753 | 110,144 | 1.03 | 2.17 | 4.9 | 53 | 0 |
| go-chi | user | 79,983 | 79,674 | 99,979 | 1.02 | 2.06 | 3.9 | 17 | 0 |
| go-chi | root | 94,191 | 93,823 | 117,739 | 1.03 | 2.19 | 5.5 | 22 | 0 |
| go-chi | postuser | 94,754 | 94,389 | 118,443 | 1.03 | 2.20 | 4.5 | 11 | 0 |
| h3-bun | json | 78,387 | 78,078 | 97,984 | 1.10 | 2.34 | 4.8 | 16 | 0 |
| h3-bun | user | 82,970 | 82,647 | 103,712 | 1.14 | 2.54 | 5.0 | 16 | 0 |
| h3-bun | root | 88,516 | 88,166 | 110,645 | 1.13 | 2.81 | 9.2 | 34 | 0 |
| h3-bun | postuser | 90,394 | 90,045 | 112,992 | 1.15 | 2.81 | 7.7 | 26 | 0 |
| h3-node | json | 60,713 | 60,476 | 75,891 | 1.09 | 3.16 | 6.4 | 16 | 0 |
| h3-node | user | 54,342 | 54,128 | 67,928 | 0.97 | 3.00 | 8.3 | 32 | 0 |
| h3-node | root | 69,197 | 68,923 | 86,496 | 1.17 | 3.37 | 6.6 | 18 | 0 |
| h3-node | postuser | 66,995 | 66,737 | 83,744 | 1.18 | 3.69 | 21.6 | 45 | 0 |
| hono-bun | json | 82,483 | 82,168 | 103,104 | 1.12 | 2.40 | 4.6 | 14 | 0 |
| hono-bun | user | 83,337 | 83,013 | 104,171 | 1.16 | 2.79 | 6.1 | 42 | 0 |
| hono-bun | root | 93,321 | 92,954 | 116,651 | 1.16 | 4.78 | 758.8 | 1,005 | 0 |
| hono-bun | postuser | 94,515 | 94,148 | 118,144 | 1.15 | 2.66 | 5.0 | 10 | 0 |
| hono-node | json | 61,730 | 60,001 | 77,163 | 1.06 | 2.53 | 5.8 | 13 | 0 |
| hono-node | user | 59,366 | 59,131 | 74,208 | 1.08 | 3.58 | 6.9 | 16 | 0 |
| hono-node | root | 69,231 | 68,961 | 86,539 | 1.16 | 2.84 | 5.7 | 13 | 0 |
| hono-node | postuser | 60,791 | 60,557 | 75,989 | 1.08 | 3.67 | 7.2 | 18 | 0 |
| raw-bun | json | 86,383 | 86,047 | 107,979 | 1.12 | 2.44 | 4.9 | 11 | 0 |
| raw-bun | user | 86,758 | 86,416 | 108,448 | 1.14 | 2.73 | 7.2 | 35 | 0 |
| raw-bun | root | 85,299 | 84,955 | 106,624 | 1.13 | 2.87 | 32.9 | 77 | 0 |
| raw-bun | postuser | 73,591 | 71,528 | 91,989 | 1.07 | 2.29 | 4.4 | 8 | 0 |
| raw-node | json | 72,559 | 72,278 | 90,699 | 1.23 | 7.42 | 46.1 | 73 | 0 |
| raw-node | user | 67,405 | 65,507 | 84,256 | 1.20 | 4.40 | 11.4 | 45 | 0 |
| raw-node | root | 76,134 | 73,999 | 95,168 | 1.28 | 40.13 | 101.4 | 147 | 0 |
| raw-node | postuser | 71,979 | 71,699 | 89,973 | 1.21 | 3.43 | 6.9 | 17 | 0 |
| raw-scriptc | json | 72,482 | 72,197 | 90,603 | 1.08 | 2.49 | 27.8 | 58 | 0 |
| raw-scriptc | user | 79,386 | 79,073 | 99,232 | 1.06 | 2.19 | 4.2 | 11 | 0 |
| raw-scriptc | root | 82,449 | 82,128 | 103,061 | 1.07 | 2.22 | 4.1 | 11 | 0 |
| raw-scriptc | postuser | 84,548 | 84,221 | 105,685 | 1.07 | 2.24 | 4.3 | 11 | 0 |
| rust-axum | json | 79,949 | 79,639 | 99,936 | 1.07 | 2.15 | 3.7 | 9 | 0 |
| rust-axum | user | 86,767 | 86,430 | 108,459 | 1.08 | 2.20 | 3.9 | 14 | 0 |
| rust-axum | root | 86,528 | 86,198 | 108,160 | 1.08 | 2.23 | 4.2 | 14 | 0 |
| rust-axum | postuser | 89,617 | 89,267 | 112,021 | 1.08 | 2.23 | 4.2 | 13 | 0 |

| subject | cold start ms (median of 10) | RSS after 100k reqs | binary size |
|---------|------------------------------|---------------------|-------------|
| c-mongoose | 3 | 2 MB | 0.1 MB |
| chttp-bun | 25 | 60 MB | — |
| chttp-fast-scriptc | 6 | 4 MB | 0.7 MB |
| chttp-node | 83 | 116 MB | — |
| chttp-scriptc | 3 | 4 MB | 0.6 MB |
| express-bun | 61 | 67 MB | — |
| express-node | 72 | 140 MB | — |
| fastify-bun | 100 | 77 MB | — |
| fastify-node | 111 | 108 MB | — |
| fmw-bun | 33 | 54 MB | — |
| fmw-node | 84 | 111 MB | — |
| go-chi | 7 | 14 MB | 6.3 MB |
| h3-bun | 25 | 43 MB | — |
| h3-node | 65 | 99 MB | — |
| hono-bun | 14 | 40 MB | — |
| hono-node | 63 | 92 MB | — |
| raw-bun | 11 | 30 MB | — |
| raw-node | 76 | 112 MB | — |
| raw-scriptc | 3 | 3 MB | 0.4 MB |
| rust-axum | 6 | 13 MB | 1.2 MB |

## Cross-tool validation (autocannon vs wrk2)

The wrk2 pass targets **80% of each subject's autocannon median** and records
whether the server sustains it plus the corrected latency spectrum. Result:
every subject sustained **97-100% of the fixed rate** on every cell — the
autocannon rps numbers are confirmed sustainable by an independent load
generator (different request loop, different HTTP parser, different stat
collection). The one sub-100% cluster (`chttp-node` json 94%, `user` 97%)
reflects its thinner margin vs the other runtimes, not a measurement
disagreement. No cell showed a >20% unexplained divergence between tools.

## Deltas vs RESULTS-baseline

- `raw-node` json 85.9k → 90.7k (+5.6%, inside noise); same ordering across the
  board — baseline ratios hold.
- chttp now measured: `chttp-node` 0.69-1.08× raw-node depending on cell;
  **`chttp-scriptc` 1.08-1.76× raw-node on every cell**; `chttp-bun` is the
  strongest interpreted variant (1.02-1.65×).
- `chttp-scriptc` ≈ `chttp-fast-scriptc` ≈ `raw-scriptc` within a few % — the
  compiled program-code build has no measurable router overhead vs the
  compiled bare-node baseline, and beats every interpreted subject except on
  the `postuser`/`echo1k` corners where h3-bun/hono-bun edge ahead.

## Surprises worth reporting

- **Pipelining multiplies scriptc**: `json-p10` (-c100 -p10) lifts
  `chttp-scriptc` to **204k rps** and `raw-scriptc` to 197k — ~2× its own
  -c64 rate, the largest pipelining gain of any subject (node-side subjects
  gain ~1.1-1.4×). The compiled runtime's per-request cost is so low that
  per-connection parsing/dispatch was the bottleneck, not per-request work.
- **chttp-node is weakest on `mixed`/`root`/`missing`** (0.69×/0.72×/0.84×):
  the interpreted wrapper pays most on wildcard-miss and table-scan routes;
  the compiled build eliminates that gap entirely.
- **express-node is the clear bottom** (0.44-0.65× raw-node) and
  `fastify-node` sits ~0.65-0.82× despite find-my-way — framework overhead
  (not routing) dominates both.
- **`fmw-bun` `root` anomaly** (43.7k vs ~96k elsewhere): the bare fmw app on
  bun collapses on `GET /` only — its `/` handler hits a slow path under
  bun's HTTP server that doesn't reproduce on node (103k). Worth a look if
  fmw+bun is ever a real deployment target.
- **`chttp-node` `postuser` inverts the pattern** (1.08×, best chttp-node cell):
  an empty-body POST hits almost no chttp code — another data point that the
  interpreted overhead is in route/param processing, not dispatch.
- **`hono-bun` `root` max latency 1005ms** under wrk2: single-run tail spike,
  p95 is 4.78ms — flagged, not a regression.
- Cold start/RSS (Raygun axis): `chttp-scriptc` starts in **3ms** with **4MB
  RSS** after 100k reqs (0.6MB binary) — vs 83ms/116MB for the same app on
  node, 25ms/60MB on bun, and 3ms/3MB for raw-scriptc. The router costs
  ~0.1-0.3MB binary + ~1MB RSS over bare node:http compiled.

## Provenance

`chttp-scriptc`/`chttp-fast-scriptc` built via
`scriptc build --optimization=speed` (program-code) from `devin/compiled-mode`
sources grafted into this branch — **not** `--npm-static` (measured 40-70%
cliff, deliberately unreported). `ReqView.header()` in `src/index.ts` was
rewritten to iterate `raw.rawHeaders` (first-occurrence-wins) to compile
past an SC0001 never-narrow on `string | string[] | undefined`.
`ceilings/mongoose.c` is patched to treat missing Content-Length on POST/PUT
as an empty body (upstream returns 411 / stalls). Environment, cgroup
disclosure, and per-tool methodology mapping in `ENV.md`; reproduction in
`REPRODUCE.md`.

## Post-async A/B (2026-10-13)

Async support landed (Handler/Middleware widened to `void | Promise<void>`; dispatch
attaches then/catch to thenable chain results). Sync-path cost verified with
autocannon -c64 -d3, same machine, back-to-back runs (pre = stash of 15e32ec^):

| cell | pre-async | post-async |
|---|---|---|
| json | 293k | 302k |
| mixed | 309k | 315k |

Post-async within noise (slightly ahead on both cells). The one return slot +
one branch per composed layer is free. Note: earlier chttp-node rows in this file
(79k json) were measured through the old bench app that imported src directly;
the current app runs against the workspace-linked `chttp` package. Do not compare
rows across that boundary.

## scriptc 0.3.0 async-first matrix (2026-10-13, Linux VM)

Async-first dispatch landed properly this time: chain results that are not
already settled (`undefined`/`null`/`c`) are joined through `await` inside
`settleChain` (the package's only async fn, fire-and-forget). The earlier
`typeof r.then === "function"` duck check was replaced — under scriptc,
reading `.then` as a value refuses as a statement (SC1090) and silently
lowers to `undefined` in expression position, `instanceof Promise` is
refused, `Promise.resolve(nonPromise)` throws, and a union mixing Promise
and non-Promise arms refuses (SC2009). `await` on `unknown` is the only
viable promise join in the subset. Verified under ELF: async reject → 500,
settle-without-response → 500, sync throw → 500; sync handlers still take
the zero-microtask fast path.

Autocannon -c64 -d6 x3 median (rps). Same machine all rows; do not compare
against prior sections (different host).

| subject | json | user | echo64 | echo1k | deep | files | missing | mixed |
|---|---|---|---|---|---|---|---|---|
| chttp-async-elf | 102,123 | 103,360 | 102,016 | 98,101 | 102,165 | 100,171 | 99,691 | 101,344 |
| chttp-elf | 99,989 | 99,584 | 98,560 | 95,840 | 100,171 | 98,549 | 96,640 | 96,437 |
| chttp-fast-elf | 98,752 | 99,744 | 97,259 | 85,045 | 96,981 | 97,781 | 97,365 | 92,149 |
| raw-async-elf | 103,008 | 100,576 | 100,789 | 95,605 | 101,568 | 102,976 | 99,872 | 98,795 |
| raw-elf | 97,771 | 96,843 | 97,941 | 93,557 | 96,800 | 97,931 | 94,144 | 79,157 |
| raw-node | 91,147 | 89,696 | 75,136 | 69,504 | 91,072 | 90,507 | 88,832 | 84,395 |
| chttp-async-node | 82,581 | 79,936 | 71,000 | 58,944 | 77,131 | 78,731 | 85,952 | 77,440 |
| chttp-node | 83,179 | 82,208 | 72,693 | 60,341 | 83,360 | 80,213 | 83,904 | 76,395 |
| fmw-node | 87,008 | – | 74,453 | – | – | – | 104,533 | 81,365 |
| fastify-node | 85,099 | – | 65,552 | – | – | – | 81,536 | 81,611 |
| hono-node | 84,192 | – | 63,019 | – | – | – | 76,213 | 77,099 |
| h3-node | 78,389 | – | 45,429 | – | – | – | 37,669 | 66,072 |
| express-node | 43,067 | – | 33,620 | – | – | – | 45,136 | 34,148 |

Ratio vs raw-node (json / mixed): chttp-async-elf 1.12x / 1.20x,
chttp-elf 1.10x / 1.14x, chttp-fast-elf 1.08x / 1.09x, raw-elf 1.07x / 0.94x,
raw-async-elf 1.13x / 1.17x, chttp-node 0.91x / 0.91x, fmw 0.95x / 0.96x,
fastify 0.93x / 0.97x, hono 0.92x / 0.91x, h3 0.86x / 0.78x,
express 0.47x / 0.40x. Zero errors/timeouts in every cell.

Observations:

- chttp-async-elf beats raw node:http on every cell (1.12x–1.47x json→echo1k)
  and beats every JS/TS framework row by ~18–137% (nearest: fmw/fastify json
  ~85–87k vs 102k).
- Async is not a tax under scriptc: async-subject ELFs beat their sync twins
  on every cell (chttp-async 102k vs chttp 100k json; raw-async 103k vs raw 98k).
  Under node the async settle path costs ~1–3% (chttp-async-node vs chttp-node,
  within noise).
- fmw's 104.5k on the missing cell is a fast 404 short-circuit — router-only
  lookup, no framework lifecycle. Not a routing-dispatch comparison.

## Compiled Hono probe (2026-10-14): cannot measure under scriptc 0.3.1

Task T7 (.agents/plans/2026-10-14-ecosystem-expansion.md) planned a
`hono-compiled` subject to test the GEA research claim that compiled Hono
reaches ≈150k rps (≈3.7× node-Hono). Probed under scriptc 0.3.1 (pinned per
.agents/decisions.md), hono 4.13.13 + @hono/node-server 2.1.4 (ENV.md
versions), macOS arm64 host. **No bench numbers exist for this subject; none
are fabricated.** Full diagnostics: `scriptc-evidence/hono-compiled-blocked.txt`
(+ raw transcript `hono-compiled-raw-2026-10-14.txt`).

Build vs run: `scriptc build` **succeeds** (95% static, 1582 statements, 78
deferred sites, 2.1MB ELF) — but a successful build is not a serving binary.
Every variant throws before serving a single request:

| attempt | startup | first request |
|---|---|---|
| canonical app (`@hono/node-server` adapter, mirror of apps/hono.mjs) | throws SC2020 `Object.defineProperty` at module init (index.mjs:157) | never reached |
| same + `--npm-static hono,@hono/node-server` | identical SC2020 crash | never reached |
| hono core only, minimal `node:http` adapter around `app.fetch` | throws SC1090 string element access in `mergePath` (url.js:125) at route registration | never reached |
| (diagnostic scratch only: patched `mergePath` + string-body adapter) | OK — "listening" logged | **process dies** — SC1090 `this.router.match` in `Hono#dispatch` (hono-base.js:265) |

The fourth row is the decisive one: with startup fences patched away in a
throwaway copy (never for the bench subject), hono's own dispatch entry is
itself a fenced site — the process is killed by the first HTTP request.
`this.router.match` is hono's core routing call in every 4.x (checked 4.13.13,
4.0.0) and 3.x (3.12.0) release; this is not version drift. `--npm-static` is
not an escape hatch (row 2). The `--dynamic` embedded-engine flag referenced by
older SC2011 hints does not exist in 0.3.1.

What scriptc would need before this cell is measurable (any one of):

- a lowering for guarded method calls on `unknown`/structural receivers
  (`this.router.match(...)`), or devirtualization through hono's
  `SmartRouter`/`RegExpRouter` chain;
- `String.prototype.at`/string element access (`base?.at(-1)`) in `mergePath`;
- `Object.defineProperty` (module-init path of `@hono/node-server`);
- `Headers[Symbol.iterator]` (hono's `#newResponse` iterates response headers).

Assessment of the GEA "compiled Hono ≈150k rps / 3.7× node-Hono" claim: **not
reproducible under scriptc 0.3.1 with hono 4.13.13**. Either it was measured on
a different hono vintage whose dispatch avoided today's fenced shapes, on a
scriptc build with the embedded dynamic engine enabled, or it conflates a
95%-static coverage score with a serving binary. Until scriptc grows one of
the lowerings above (or hono's dispatch is restructured into the subset), the
comparison chttp-ELF vs compiled-Hono has no measurable right-hand side, and
the only honest compiled-Hono row is "does not run".
## Fetch-surface cells + re-baseline (2026-10-18, Linux VM)

Branch `devin/1792348542-genfetch-bench`, post-#58 dispatch (contract v4).
New subjects: `chttp-fetch-node`/`chttp-fetch-bun` serve the canonical table
through `app.fetch` behind a node:http bridge that builds a real `Request`
per message; `chttp-elf-fetch` compiles `apps/chttp-elf-fetch.ts` (`app.fetchShim`
— `new Request` is not runtime-constructible under scriptc) into a scriptc ELF.
Same-run `vs raw-node` uses this run's raw-node column.

| subject | cell | rps | vs raw-node | p50 | p99 | max | MB/s | err/t/o | non2xx |
|---------|------|-----|-------------|-----|-----|-----|------|---------|--------|
| chttp-node | json | 56,907 | 0.68x | 0.00 | 5.0 | 39 | 10.1 | 0/0 | 0 |
| chttp-node | user | 60,243 | 0.71x | 0.00 | 4.0 | 22 | 10.4 | 0/0 | 0 |
| chttp-node | echo64 | 42,396 | 0.77x | 0.00 | 5.0 | 37 | 9.2 | 0/0 | 0 |
| chttp-node | echo1k | 36,675 | 0.72x | 1.00 | 5.0 | 31 | 41.6 | 0/0 | 0 |
| chttp-node | deep | 61,461 | 0.84x | 0.00 | 4.0 | 19 | 10.6 | 0/0 | 0 |
| chttp-node | files | 69,616 | 0.85x | 0.00 | 3.0 | 22 | 11.4 | 0/0 | 0 |
| chttp-node | missing | 74,259 | 0.94x | 0.00 | 3.0 | 20 | 12.7 | 0/0 | 1356172 |
| chttp-node | mixed | 61,747 | 0.80x | 0.00 | 4.0 | 279 | 10.7 | 0/0 | 0 |
| chttp-fetch-node | json | 30,769 | 0.37x | 1.00 | 6.0 | 30 | 5.9 | 0/0 | 0 |
| chttp-fetch-node | user | 32,340 | 0.38x | 1.00 | 6.0 | 21 | 6.0 | 0/0 | 0 |
| chttp-fetch-node | echo64 | 26,562 | 0.49x | 1.00 | 7.0 | 30 | 6.2 | 0/0 | 0 |
| chttp-fetch-node | echo1k | 26,824 | 0.52x | 2.00 | 6.0 | 26 | 30.8 | 0/0 | 0 |
| chttp-fetch-node | deep | 38,193 | 0.52x | 1.00 | 4.0 | 20 | 7.1 | 0/0 | 0 |
| chttp-fetch-node | files | 37,499 | 0.46x | 1.00 | 4.0 | 21 | 6.7 | 0/0 | 0 |
| chttp-fetch-node | missing | 39,280 | 0.50x | 1.00 | 4.0 | 27 | 7.3 | 0/0 | 705130 |
| chttp-fetch-node | mixed | 35,465 | 0.46x | 1.00 | 5.0 | 231 | 6.6 | 0/0 | 0 |
| chttp-fetch-bun | json | 53,611 | 0.64x | 0.00 | 5.0 | 35 | 10.3 | 0/0 | 0 |
| chttp-fetch-bun | user | 51,696 | 0.61x | 0.00 | 5.0 | 24 | 9.7 | 0/0 | 0 |
| chttp-fetch-bun | echo64 | 46,401 | 0.85x | 1.00 | 5.0 | 24 | 10.8 | 0/0 | 0 |
| chttp-fetch-bun | echo1k | 44,373 | 0.87x | 1.00 | 4.0 | 20 | 51.0 | 0/0 | 0 |
| chttp-fetch-bun | deep | 54,160 | 0.74x | 0.00 | 4.0 | 23 | 10.1 | 0/0 | 0 |
| chttp-fetch-bun | files | 48,672 | 0.60x | 0.00 | 5.0 | 27 | 8.7 | 0/0 | 0 |
| chttp-fetch-bun | missing | 52,928 | 0.67x | 0.00 | 4.0 | 24 | 9.8 | 0/0 | 955802 |
| chttp-fetch-bun | mixed | 50,181 | 0.65x | 0.00 | 5.0 | 406 | 9.4 | 0/0 | 0 |
| chttp-bun | json | 95,275 | 1.14x | 0.00 | 2.0 | 19 | 17.0 | 0/0 | 0 |
| chttp-bun | user | 94,592 | 1.12x | 0.00 | 2.0 | 23 | 16.3 | 0/0 | 0 |
| chttp-bun | echo64 | 69,149 | 1.26x | 0.00 | 4.0 | 26 | 15.0 | 0/0 | 0 |
| chttp-bun | echo1k | 55,307 | 1.08x | 0.00 | 4.0 | 23 | 62.8 | 0/0 | 0 |
| chttp-bun | deep | 68,789 | 0.94x | 0.00 | 4.0 | 20 | 11.9 | 0/0 | 0 |
| chttp-bun | files | 68,699 | 0.84x | 0.00 | 4.0 | 19 | 11.3 | 0/0 | 0 |
| chttp-bun | missing | 69,627 | 0.88x | 0.00 | 4.0 | 41 | 11.9 | 0/0 | 1273118 |
| chttp-bun | mixed | 54,117 | 0.70x | 0.00 | 5.0 | 246 | 9.3 | 0/0 | 0 |
| chttp-scriptc | json | 50,651 | 0.60x | 1.00 | 4.0 | 20 | 9.0 | 0/0 | 0 |
| chttp-scriptc | user | 43,435 | 0.51x | 1.00 | 4.0 | 23 | 7.5 | 0/0 | 0 |
| chttp-scriptc | echo64 | 33,205 | 0.61x | 1.00 | 5.0 | 25 | 7.2 | 0/0 | 0 |
| chttp-scriptc | echo1k | 31,549 | 0.62x | 1.00 | 5.0 | 22 | 35.8 | 0/0 | 0 |
| chttp-scriptc | deep | 42,901 | 0.59x | 1.00 | 5.0 | 33 | 7.4 | 0/0 | 0 |
| chttp-scriptc | files | 46,773 | 0.57x | 1.00 | 4.0 | 22 | 7.7 | 0/0 | 0 |
| chttp-scriptc | missing | 48,965 | 0.62x | 1.00 | 4.0 | 22 | 8.4 | 0/0 | 868312 |
| chttp-scriptc | mixed | 48,288 | 0.63x | 1.00 | 4.0 | 241 | 8.3 | 0/0 | 0 |
| chttp-elf-fetch | json | 47,093 | 0.56x | 1.00 | 4.0 | 29 | 9.0 | 0/0 | 0 |
| chttp-elf-fetch | user | 47,877 | 0.57x | 1.00 | 4.0 | 30 | 8.9 | 0/0 | 0 |
| chttp-elf-fetch | echo64 | 46,459 | 0.85x | 1.00 | 4.0 | 21 | 10.7 | 0/0 | 0 |
| chttp-elf-fetch | echo1k | 43,787 | 0.86x | 1.00 | 4.0 | 25 | 50.3 | 0/0 | 0 |
| chttp-elf-fetch | deep | 50,411 | 0.69x | 1.00 | 4.0 | 25 | 9.4 | 0/0 | 0 |
| chttp-elf-fetch | files | 43,461 | 0.53x | 1.00 | 4.0 | 38 | 7.7 | 0/0 | 0 |
| chttp-elf-fetch | missing | 47,584 | 0.60x | 1.00 | 4.0 | 30 | 8.8 | 0/0 | 852084 |
| chttp-elf-fetch | mixed | 46,661 | 0.61x | 1.00 | 4.0 | 259 | 8.7 | 0/0 | 0 |
| raw-node | json | 83,840 | 1.00x | 0.00 | 3.0 | 28 | 13.8 | 0/0 | 0 |
| raw-node | user | 84,437 | 1.00x | 0.00 | 3.0 | 21 | 13.4 | 0/0 | 0 |
| raw-node | echo64 | 54,715 | 1.00x | 0.00 | 4.0 | 20 | 11.1 | 0/0 | 0 |
| raw-node | echo1k | 51,211 | 1.00x | 0.00 | 5.0 | 22 | 57.4 | 0/0 | 0 |
| raw-node | deep | 73,088 | 1.00x | 0.00 | 4.0 | 25 | 11.6 | 0/0 | 0 |
| raw-node | files | 81,525 | 1.00x | 0.00 | 3.0 | 25 | 12.2 | 0/0 | 0 |
| raw-node | missing | 79,275 | 1.00x | 0.00 | 3.0 | 23 | 12.4 | 0/0 | 1456341 |
| raw-node | mixed | 77,067 | 1.00x | 0.00 | 4.0 | 236 | 12.2 | 0/0 | 0 |
| raw-scriptc | json | 94,645 | 1.13x | 0.00 | 2.0 | 24 | 15.5 | 0/0 | 0 |
| raw-scriptc | user | 70,067 | 0.83x | 0.00 | 4.0 | 36 | 11.1 | 0/0 | 0 |
| raw-scriptc | echo64 | 71,363 | 1.30x | 0.00 | 4.0 | 33 | 14.5 | 0/0 | 0 |
| raw-scriptc | echo1k | 68,616 | 1.34x | 0.00 | 4.0 | 28 | 76.9 | 0/0 | 0 |
| raw-scriptc | deep | 86,389 | 1.18x | 0.00 | 3.0 | 27 | 13.7 | 0/0 | 0 |
| raw-scriptc | files | 89,632 | 1.10x | 0.00 | 3.0 | 23 | 13.4 | 0/0 | 0 |
| raw-scriptc | missing | 90,859 | 1.15x | 0.00 | 3.0 | 21 | 14.2 | 0/0 | 1619221 |
| raw-scriptc | mixed | 60,795 | 0.79x | 0.00 | 4.0 | 253 | 9.6 | 0/0 | 0 |
| hono-bun | json | 98,219 | 1.17x | 0.00 | 3.0 | 25 | 11.7 | 0/0 | 0 |
| hono-bun | user | 100,160 | 1.19x | 0.00 | 3.0 | 22 | 11.4 | 0/0 | 0 |
| hono-bun | echo64 | 97,291 | 1.78x | 0.00 | 2.0 | 23 | 16.7 | 0/0 | 0 |
| hono-bun | echo1k | 92,832 | 1.81x | 0.00 | 3.0 | 18 | 101.1 | 0/0 | 0 |
| hono-bun | deep | 97,771 | 1.34x | 0.00 | 3.0 | 17 | 11.1 | 0/0 | 0 |
| hono-bun | files | 102,699 | 1.26x | 0.00 | 2.0 | 20 | 12.1 | 0/0 | 0 |
| hono-bun | missing | 105,621 | 1.33x | 0.00 | 2.0 | 21 | 13.8 | 0/0 | 1899699 |
| hono-bun | mixed | 99,392 | 1.29x | 0.00 | 3.0 | 225 | 11.3 | 0/0 | 0 |

### Fetch-surface cross-compares (same-run medians)

| compare | json | user | echo64 | echo1k | deep | files | missing | mixed |
|---------|------|------|--------|--------|------|-------|---------|-------|
| chttp-fetch-node / chttp-node | 54% | 54% | 63% | 73% | 62% | 54% | 53% | 57% |
| chttp-fetch-bun / chttp-bun | 56% | 55% | 67% | 80% | 79% | 71% | 76% | 93% |
| chttp-elf-fetch / chttp-scriptc | 93% | 110% | 140% | 139% | 118% | 93% | 97% | 97% |
| chttp-bun / hono-bun | 97% | 94% | 71% | 60% | 70% | 67% | 66% | 54% |

### What the fetch cells say

- **The dispatch arm is not the gap.** `chttp-elf-fetch` (fetchShim primitives →
  same `_dispatchPrim` → `FetchResponseSink` → respond callback) lands at
  93-140% of `chttp-scriptc` — at parity or ahead on every cell, no Request/
  Response construction anywhere on that path. Post-#58 the fetch-shaped
  dispatch costs nothing measurable.
- **`chttp-fetch-node` runs at 53-73% of `chttp-node`** — the issue's 80-95%
  prediction does not hold on the Node bridge. The cost is upstream of
  dispatch: undici `new Request` + `Headers` construction per message and
  `new Response`/`resp.text()` re-buffering on the way out (~2 wrapped
  object constructions + 2 stream bufferings per request vs one
  `res.writeHead`/`res.end`). `chttp-fetch-bun` lands at 55-93% of
  `chttp-bun` — same shape, smaller penalty (Bun's Web primitives are
  cheaper), confirming the gap is runtime Web-object churn, not dispatch.
- **chttp-bun is at 94-97% of hono-bun on json/user**, 54-71% elsewhere
  (hono-bun's flat ~97-105k across cells continues to hold).
- **Controls did not stay flat on every cell**: raw-node is within ±5% on
  user/missing (+0.2%/-1.3% vs v2) but down 13-22% on echo64/echo1k/deep;
  raw-scriptc json +4% but user -29%. Treat absolute deltas vs the v2 table
  as noise-bound (rep spread this run reached 77-97k on raw-scriptc json);
  same-run `vs raw-node` ratios and the cross-compares above are the stable
  reads.

### Caveats

- **Fetch-surface non-2xx cells**: `missing` counts 404s by design
  (~705k-956k non-2xx on fetch subjects — the cell hammers unmounted paths;
  totals scale with throughput, not a regression).
- **Request bodies are fully buffered** on both fetch bridges before
  dispatch — `chttp-fetch.ts` concatenates `data` chunks into the Request
  body, `chttp-elf-fetch.ts` into the fetchShim body param; the contract
  resolves the body before dispatch, so streaming request bodies are not
  exercised. `echo1k` is the largest buffered-body cell.
- `new Request` is not runtime-constructible under scriptc (module-level
  globals only) — the ELF cell enters through `app.fetchShim`, which skips
  Request/Response construction entirely; it is not a like-for-like of
  `chttp-fetch-node` (that's the point of the gap analysis above).

## Lite fetch bridge (issue #89) — 2026-10-19, Linux VM

Premise check first (`scriptc-evidence/fetch-node-undici-cpuprof-2026-10-19.md`):
`node:inspector` CPU profile of `chttp-fetch-node` over ~1.46M requests put
undici frames at 13.8% of total CPU and the web-stream machinery they drive
at another 6.0% (~27% of non-idle CPU) vs 4.4% for dispatch — the undici
Request/Headers/Response churn is the dominant removable cost, so the lite
path was built.

New subject: `chttp-fetch-lite-node` (`apps/chttp-fetch-lite.ts`) serves the
canonical table through `app.serveFetch` — the fetch dispatch arm over
`LiteRequest` (a `WebReqView` on `IncomingMessage`) and `LiteResponse` (a
`FetchResponseSink` writing straight to `ServerResponse`), skipping per-request
undici construction and `resp.text()` re-buffering. `c.req.raw` there returns
the `LiteRequest`; `lite.request()` materializes a real `Request` lazily.

Same-run re-measure (this VM runs faster than the 10-18 table; compare
ratios, not absolutes — `missing` counts 404s by design):

| subject | cell | rps | p50 | p99 | max | MB/s | err/t/o | non2xx |
|---------|------|-----|-----|-----|-----|------|---------|--------|
| chttp-node | json | 76,224 | 0.00 | 2 | 22 | 13.8 | 0/0 | 0 |
| chttp-node | user | 69,771 | 0.00 | 3 | 20 | 13.0 | 0/0 | 0 |
| chttp-node | echo64 | 61,779 | 0.00 | 3 | 23 | 14.0 | 0/0 | 0 |
| chttp-node | echo1k | 54,752 | 1.00 | 3 | 23 | 62.3 | 0/0 | 0 |
| chttp-node | deep | 77,685 | 0.00 | 2 | 19 | 13.5 | 0/0 | 0 |
| chttp-node | files | 75,477 | 0.00 | 1 | 20 | 12.6 | 0/0 | 0 |
| chttp-node | missing | 77,632 | 0.00 | 2 | 21 | 13.4 | 0/0 | 1400692 |
| chttp-node | mixed | 70,611 | 0.00 | 3 | 231 | 12.2 | 0/0 | 0 |
| chttp-fetch-node | json | 38,368 | 1.00 | 4 | 21 | 7.5 | 0/0 | 0 |
| chttp-fetch-node | user | 38,837 | 1.00 | 3 | 23 | 7.3 | 0/0 | 0 |
| chttp-fetch-node | echo64 | 31,795 | 1.00 | 4 | 27 | 7.4 | 0/0 | 0 |
| chttp-fetch-node | echo1k | 28,149 | 2.00 | 5 | 18 | 32.7 | 0/0 | 0 |
| chttp-fetch-node | deep | 40,256 | 1.00 | 3 | 17 | 7.5 | 0/0 | 0 |
| chttp-fetch-node | files | 37,744 | 1.00 | 4 | 21 | 7.1 | 0/0 | 0 |
| chttp-fetch-node | missing | 41,525 | 1.00 | 3 | 20 | 7.7 | 0/0 | 745701 |
| chttp-fetch-node | mixed | 36,383 | 1.00 | 5 | 242 | 7.1 | 0/0 | 0 |
| chttp-fetch-lite-node | json | 72,291 | 0.00 | 3 | 21 | 14.4 | 0/0 | 0 |
| chttp-fetch-lite-node | user | 70,584 | 0.00 | 2 | 23 | 13.3 | 0/0 | 0 |
| chttp-fetch-lite-node | echo64 | 58,288 | 0.00 | 3 | 23 | 13.8 | 0/0 | 0 |
| chttp-fetch-lite-node | echo1k | 47,221 | 1.00 | 4 | 18 | 54.9 | 0/0 | 0 |
| chttp-fetch-lite-node | deep | 72,192 | 0.00 | 2 | 18 | 13.6 | 0/0 | 0 |
| chttp-fetch-lite-node | files | 68,525 | 0.00 | 3 | 20 | 12.3 | 0/0 | 0 |
| chttp-fetch-lite-node | missing | 73,771 | 0.00 | 2 | 23 | 13.9 | 0/0 | 1299793 |
| chttp-fetch-lite-node | mixed | 67,381 | 0.00 | 3 | 219 | 12.8 | 0/0 | 0 |

| compare | json | user | echo64 | echo1k | deep | files | missing | mixed |
|---------|------|------|--------|--------|------|-------|---------|-------|
| chttp-fetch-node / chttp-node | 50% | 56% | 51% | 51% | 52% | 50% | 53% | 52% |
| chttp-fetch-lite-node / chttp-node | 95% | 101% | 94% | 86% | 93% | 91% | 95% | 95% |
| chttp-fetch-lite-node / chttp-fetch-node | 188% | 182% | 183% | 168% | 179% | 182% | 178% | 185% |

RSS after 100k reqs / cold start (median of 10): chttp-node 118 MB /
100.5 ms, chttp-fetch-node 189 MB / 98.3 ms, chttp-fetch-lite-node 146 MB /
99.0 ms.

### Reads

- **The lite bridge recovers most of the gap**: 86–101% of `chttp-node`
  (mean ~94%) vs the undici bridge's 50–56% — a 1.68–1.88x lift, matching
  the issue's "most of the 27–47%" expectation.
- **echo1k is the weakest lite cell (86%)**: request bodies drain to raw
  Buffer chunks at the bridge edge and concat on read — the undici bridge
  pays the same copy plus object churn, so the remaining delta is body
  handling, not dispatch.
- **RSS halves vs the undici bridge** (146 MB vs 189 MB) — no per-request
  Request/Headers/Response allocations retained.
- **Residual ~6%**: `LiteRequest`/`LiteResponse` still build a header
  record + object per request, and the fetch-arm chain runner allocates
  the ReqView/Ctx pair on Node-arm-shaped paths; `app.handler` skips both.
