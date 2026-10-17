# Multi-stage build for pegana-mcp.
#
# Builder uses the full Bun image to install + build; runtime is the
# slim variant. Final image is ~80MB. Health-check piggy-backs on the
# /health route Hono mounts in src/transport.ts.

FROM oven/bun:1@sha256:ec06c3b6cea04192ae6770c434f668ca41d343ad19fa6472216c7b48be39c598 AS builder
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY tsconfig.json ./
COPY src ./src
RUN bun build src/index.ts --outdir dist --target bun

FROM oven/bun:1-slim@sha256:14a223fa35747ec728bce300ef85888bc5f7958164d15bbba6a54b22b52a3288
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./

EXPOSE 8090

# Run as the non-root user shipped by the oven/bun base image (audit F-34).
USER bun

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD bun -e "fetch('http://localhost:8090/health').then(r=>process.exit(r.ok?0:1))"

CMD ["bun", "dist/index.js"]
