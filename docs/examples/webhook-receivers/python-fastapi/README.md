# Python / FastAPI — Pegana webhook receiver

Verifies an Ed25519-signed Pegana webhook with FastAPI and
`cryptography`. The sample is intentionally small: one route, raw-body
verification, replay protection, and bounded in-process dedup.

## 60-second quickstart

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 9002
```

Register `https://your-domain.example/pegana-hook` at
https://pegana.xyz/account/webhooks.

`main.py` includes a baked-in fallback public key. For production, set
the active key list from the metadata endpoint:

```bash
curl -s https://api.pegana.xyz/v1/meta/webhook-keys
export PEGANA_PUB_KEY_B64="primary_base64,secondary_base64_during_rotation"
```

Back the dedup set with Redis or Postgres before using this in a
multi-process deployment.

## Local testing

```bash
PEGANA_RUN_RECEIVER_TESTS=1 \
RECEIVER_URL=http://127.0.0.1:9002 \
cargo test -p dispatcher-rs --test webhook_receivers
```

## Security notes

- Replay window: **5 minutes**.
- Pegana retries up to **6 attempts** with 5s / 30s / 5m / 30m / 2h
  backoff. Dedupe on `x-pegana-event-id`.
- `Ed25519PublicKey.verify` raises `InvalidSignature` on any
  failure — never returns False; always wrap in try/except.
- Use a real production ASGI runner (gunicorn + uvicorn workers, or
  your platform equivalent) instead of single-process uvicorn.
