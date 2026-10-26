# pegana-protocol-indexer (Sub-C loop-intelligence indexer).
#
# Runs the TypeScript directly with Bun (like bot-ts) — NOT `bun build`. Bundling
# the heavy klend-sdk + @solana/kit tree produces a 17MB file Bun then fails to
# parse ("SyntaxError: Unexpected token ';'"); Bun runs TS natively from
# node_modules with no such issue. Single stage keeps node_modules for the run.

FROM oven/bun:1@sha256:1d22548f177f4ff38e0c15baa3c2c46c6c2060ba2d1bc573bb4720b407548f1d
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY tsconfig.json ./
COPY src ./src

EXPOSE 8091

# Run as the non-root user shipped by the oven/bun base image (audit F-34).
USER bun

HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD bun -e "fetch('http://localhost:8091/health').then(r=>process.exit(r.ok?0:1))"

CMD ["bun", "run", "src/index.ts"]
