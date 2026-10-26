FROM rust:1.98-slim@sha256:4cd829461bd5c4d511c32e269da9cb8929223b666519d8004e35fc8d1d771ab7 AS builder
WORKDIR /build
RUN apt-get update && apt-get install -y --no-install-recommends pkg-config libssl-dev ca-certificates && rm -rf /var/lib/apt/lists/*
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
# oracle_degraded.rs embeds the [pyth_staleness.overrides] table at compile time.
COPY assets.toml ./
RUN cargo build --release -p api-rs --locked

FROM debian:bookworm-slim@sha256:7ff6ba31527b9e336162fa061746c366c4b2032f4d2cff2078bea43f78efe3f8
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates libssl3 curl && rm -rf /var/lib/apt/lists/*
RUN useradd -r -u 10001 pegana
WORKDIR /app
COPY --from=builder /build/target/release/api-rs /usr/local/bin/api-rs
USER pegana
EXPOSE 8080
ENTRYPOINT ["api-rs"]
