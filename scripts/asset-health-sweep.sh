#!/usr/bin/env bash
# Monthly cross-reference of tracked assets against external health signals.
# Catches dSOL-style protocol failures before they become a credibility leak.
#
# Reads:
#   assets.toml                — source of truth for tracked assets
#   ~/.claude/skills/data/solana-knowledge/04-protocols-and-sdks.md
#                              — optional, scanned for DEFUNCT mentions
# Writes:
#   /tmp/pegana-health-<date>.md
#
# Cron entry (Hetzner):
#   0 9 1 * * /opt/pegana/scripts/asset-health-sweep.sh > /var/log/pegana-health.log 2>&1

set -euo pipefail

# Resolve repo root from script location so cron + manual runs both work.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

OUT="/tmp/pegana-health-$(date -u +%Y%m%d).md"
echo "# Asset health sweep — $(date -u +%Y-%m-%d)" > "$OUT"
echo "" >> "$OUT"

# 1. Extract active assets from assets.toml
TOML_PATH="$REPO_ROOT/assets.toml" python3 - <<'PY' >> "$OUT"
import os, re
toml_path = os.environ["TOML_PATH"]
content = open(toml_path).read()
# Strip whole-line comments so `active=false` inside the dSOL header comment
# does not bleed into the previous block when splitting by [[assets]].
clean = "\n".join(l for l in content.splitlines() if not l.strip().startswith("#"))
blocks = clean.split("[[assets]]")[1:]
print("## Active assets in TOML\n")
for b in blocks:
    sym = re.search(r'symbol\s*=\s*"([^"]+)"', b)
    cls = re.search(r'class\s*=\s*"([^"]+)"', b)
    act = re.search(r'^\s*active\s*=\s*(true|false)', b, re.MULTILINE)
    if sym and (not act or act.group(1) == "true"):
        print(f"- {sym.group(1)} ({cls.group(1) if cls else '?'})")
PY

# 2. Cross-reference each protocol against DefiLlama TVL
echo "" >> "$OUT"
echo "## TVL check (DefiLlama)" >> "$OUT"
for slug in jito-liquid-staking marinade-finance solayer maple-finance ethena ondo-finance hylo; do
  tvl="$(curl -sf "https://api.llama.fi/protocol/$slug" 2>/dev/null \
    | python3 -c "import sys,json; d=json.load(sys.stdin); t=d.get('tvl',[{}]); print(t[-1].get('totalLiquidityUSD','?') if t else '?')" 2>/dev/null || echo "?")"
  echo "- $slug: \$$tvl" >> "$OUT"
done

# 3. Flag any solana-knowledge DEFUNCT mentions (optional — silently skip if absent)
echo "" >> "$OUT"
echo "## DEFUNCT scan (solana-knowledge skill)" >> "$OUT"
SK_FILE="$HOME/.claude/skills/data/solana-knowledge/04-protocols-and-sdks.md"
if [[ -f "$SK_FILE" ]]; then
  grep -i "DEFUNCT\|exploit\|frozen" "$SK_FILE" | head -10 >> "$OUT" || echo "(no matches)" >> "$OUT"
else
  echo "(skill not installed — skipped)" >> "$OUT"
fi

echo ""
echo "Report written to $OUT"
echo "Review and open follow-up tickets for any anomaly."
