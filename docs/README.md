# Pegana Docs

- [Backend specification (HTML)](./spec.html) — full system design, all 9 decisions locked
- [Architecture](./ARCHITECTURE.md) — service map, data flow, freeze-order invariants, trust boundary
- [Deploy guide](./ops/deploy-hetzner.md) — Hetzner CPX32 setup, Caddy, backups
- [Calibration log](./CALIBRATION-v1.md) — per-class verdict thresholds + tuning (see also [CALIBRATION-v2-mcp-spike.md](./CALIBRATION-v2-mcp-spike.md))

## Key references

| Decision | Result | Why |
|---|---|---|
| Stack | Rust + TypeScript (bot) | grammY has the best i18n story; Rust everywhere else |
| Streaming | Polling only (no gRPC) | $0 provider cost in v1; gRPC = v1.5 if latency hurts |
| Hylo IDL | Hardcoded + drift check | Stable cold start + Sentry alert if program upgrades |
| Launch | 2-week private dogfood | Real thresholds, not heuristics |
| Hosting | Single VPS bundled | ~$16.50/mo total (Hetzner CPX32); migrate Postgres to Neon when it hurts |
