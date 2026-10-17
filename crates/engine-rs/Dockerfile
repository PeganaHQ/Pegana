FROM rust:1.98-slim@sha256:4cd829461bd5c4d511c32e269da9cb8929223b666519d8004e35fc8d1d771ab7 AS builder
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

FROM debian:bookworm-slim@sha256:7c7b2c966bc9ee8cedfeef67e0e279108992c77681fa595db4a9d65c06ccc587
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates libssl3 curl && rm -rf /var/lib/apt/lists/*
RUN useradd -r -u 10001 pegana
WORKDIR /app
COPY --from=builder /build/target/release/engine-rs /usr/local/bin/engine-rs
USER pegana
ENTRYPOINT ["engine-rs"]
