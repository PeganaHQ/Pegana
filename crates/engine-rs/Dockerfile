FROM rust:1.90-slim@sha256:7fa728f3678acf5980d5db70960cf8491aff9411976789086676bdf0c19db39e AS builder
WORKDIR /build
RUN apt-get update && apt-get install -y --no-install-recommends pkg-config libssl-dev ca-certificates && rm -rf /var/lib/apt/lists/*

# Bake the deploy commit into the binary so the methodology crate's
# option_env!("PEGANA_GIT_SHA") resolves to a real value at compile time.
# scripts/deploy.sh passes the full SHA via --build-arg PEGANA_GIT_SHA=$GIT_SHA;
# without ARG+ENV here the value is invisible to cargo and every receipt's
# methodology_git_sha field shows as "(dev build)" in the UI.
ARG PEGANA_GIT_SHA=""
ENV PEGANA_GIT_SHA=${PEGANA_GIT_SHA}

COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
RUN cargo build --release -p engine-rs --locked

FROM debian:bookworm-slim@sha256:7ff6ba31527b9e336162fa061746c366c4b2032f4d2cff2078bea43f78efe3f8
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates libssl3 curl && rm -rf /var/lib/apt/lists/*
RUN useradd -r -u 10001 pegana
WORKDIR /app
COPY --from=builder /build/target/release/engine-rs /usr/local/bin/engine-rs
USER pegana
ENTRYPOINT ["engine-rs"]
