# Multi-stage build for pegana-mcp.
#
# Builder uses the full Bun image to install + build; runtime is the
# slim variant. Final image is ~80MB. Health-check piggy-backs on the
# /health route Hono mounts in src/transport.ts.

FROM oven/bun:1@sha256:1d22548f177f4ff38e0c15baa3c2c46c6c2060ba2d1bc573bb4720b407548f1d AS builder
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY tsconfig.json ./
COPY src ./src
RUN bun build src/index.ts --outdir dist --target bun

FROM oven/bun:1-slim@sha256:1846adf22496bd711036aae8be147e57bdebbaea2e5264e3e0b5af1db187d9a4
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
