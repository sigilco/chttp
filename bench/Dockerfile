# chttp bench suite — one-command repro image.
# Build context must be the REPO ROOT (needs src/ for program-code scriptc):
#   docker build -f bench/Dockerfile -t chttp-bench .
#   docker run --rm -v "$PWD/bench/results:/work/bench/results" \
#                    -v "$PWD/bench/results-wrk2:/work/bench/results-wrk2" chttp-bench
# or: docker compose -f bench/docker-compose.yml up --build
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl git make gcc g++ clang libssl-dev zlib1g-dev \
    golang-go cargo rustc python3 unzip \
 && rm -rf /var/lib/apt/lists/*

# node 24 (matches ENV.md; nvm-free install for reproducibility)
RUN curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/*

# bun (stable channel, same installer used in ENV)
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

# scriptc (the compiler under test)
RUN npm i -g scriptc@0.3.1

# wrk2 — second measurement tool (giltene/wrk2, built from source)
RUN git clone --depth 1 https://github.com/giltene/wrk2 /opt/wrk2 \
 && make -C /opt/wrk2 -j"$(nproc)" && cp /opt/wrk2/wrk /usr/local/bin/wrk2
ENV WRK2=/usr/local/bin/wrk2

WORKDIR /work
COPY . /work

WORKDIR /work/bench
RUN npm ci \
 && mkdir -p bin ceilings/bin \
 && (cd ceilings/go-chi && go build -o ../bin/go-chi .) \
 && (cd ceilings/rust-axum && cargo build --release -q && cp target/release/bench-axum ../bin/rust-axum) \
 && gcc -O2 -o ceilings/bin/c-mongoose ceilings/c-mongoose.c ceilings/mongoose.c -DMG_ENABLE_LOG=0 \
 && scriptc build apps/raw.ts -o bin/raw-scriptc --optimization=speed \
 && scriptc build apps/chttp.ts -o bin/chttp-scriptc --optimization=speed \
 && scriptc build apps/chttp-elf-fetch.ts -o bin/chttp-elf-fetch --optimization=speed \
 && scriptc build apps/chttp-fast.ts -o bin/chttp-fast-scriptc --optimization=speed

# Full run: autocannon matrix -> wrk2 cross-validation -> aggregates.
CMD ["bash", "-c", "bash run.sh && bash run-latency.sh"]
