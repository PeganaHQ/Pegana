/**
 * The FAQ, as DATA.
 *
 * Shared by `/faq` (which renders it, plus FAQPage JSON-LD) and by
 * `llms-full.txt` (which inlines it). Answer engines quote question-shaped text
 * far more readily than prose, so this is the highest-value content to make
 * retrievable in ONE fetch rather than behind a second request.
 *
 * Keeping it here rather than in the page component is what lets llms-full.txt
 * be genuinely "full" without duplicating the copy — a duplicate would drift,
 * and drifted answers about what a product CANNOT do are worse than none.
 */

export type Qa = { q: string; a: string };

export const FAQ: Qa[] = [
  {
    q: "What is a peg-risk oracle?",
    a: "It is a system that continuously answers one question: is this asset still worth what its peg mechanism says it should be worth? Pegana computes each asset's intrinsic value from its own mechanism, compares it against the best executable market quote, and publishes the gap, plus a verifiable receipt every time that gap crosses a threshold.",
  },
  {
    q: "How does Pegana decide an asset is depegged?",
    a: "It compares intrinsic value against market value, smooths the result to reject single bad prints, and classifies it against that specific asset's calibrated thresholds with hysteresis so a verdict cannot flap on noise. Thresholds are per-asset because a 30bps move means something very different for USDC than for a leveraged synthetic.",
  },
  {
    q: "What do PEGGED, DRIFT, DEPEG, CRITICAL and UNKNOWN mean?",
    a: "PEGGED: the spread is inside the asset's calibrated drift band. DRIFT: outside that band but short of the depeg threshold, worth watching, not yet an event. DEPEG: past the depeg threshold, with hysteresis confirming it held. CRITICAL: a deep, sustained break. UNKNOWN: an input is missing or failed a sanity check, so Pegana reports that it does not know rather than guessing.",
  },
  {
    q: "Is a premium bad?",
    a: "It depends entirely on the mechanism, which is why Pegana treats classes differently. A yield-bearing stable is supposed to trade above $1. That is the yield accruing. A leveraged synthetic trades above NAV when leverage demand is high, which is the product working. For those assets the signal that matters is a sustained discount, not a premium. For a fiat-backed stablecoin, a persistent premium is genuinely unusual.",
  },
  {
    q: "How do I verify a Pegana alert myself?",
    a: "Every state change emits a receipt containing the frozen inputs and the methodology version that produced it. Every receipt's hash also checks in your browser. Install the open-source CLI and re-derive it: `pegana-replay --alert-id <UUID>`. The CLI matches the receipt's methodology version exactly, so an older receipt prints the install command for the matching release (receipts older than methodology 0.4.0 predate every published CLI build and verify by hash only). It recomputes the verdict from the same pure functions the live engine ran and compares hashes. If our number is wrong, the CLI says so. You do not have to take our word for it.",
  },
  {
    q: "Does Pegana anchor its receipts on-chain?",
    a: "Severe transitions can be anchored on Solana mainnet via an SPL Memo, and some are. Routine ones are not. Anchoring every receipt would cost more than it proves. Each receipt states its own anchoring status explicitly rather than implying all of them are on-chain. The off-chain re-derivation is byte-exact either way, and that is the guarantee that always holds.",
  },
  {
    q: "What can Pegana NOT detect?",
    a: "Several things, deliberately stated. It does not model slippage at size. A peg that holds for $10k may not hold for $10m. It does not detect a mechanism depeg, where the peg design itself changes and the intrinsic value we compute is silently wrong while the spread reads near zero. It does not measure solvency or bad debt. And it cannot see a source that has frozen while still reporting fresh timestamps. These are documented in full on the methodology honesty page.",
  },
  {
    q: "How is this different from a stake-pool ratio or a DefiLlama peg chart?",
    a: "A stake-pool ratio tells you the exchange rate. A price chart tells you the last trade. Neither tells you whether the market price has diverged from what the mechanism says the asset is worth, by how much, since when, or whether that divergence is inside the range that asset normally lives in. That comparison, and a reproducible record of every time it crossed a line, is the whole product.",
  },
  {
    q: "How do I get alerted when something moves?",
    a: "Hold a WebSocket open against the live feed, poll the REST API, or subscribe to the Atom feed. All of them carry the same transition payload with a link to its receipt.",
  },
  {
    q: "Can an AI agent use Pegana?",
    a: "Yes, and it is built for that. There is an MCP server with no API keys, and every tool is free. Every signal carries an evidence URL, so an agent that acts on a peg-risk read can cite the receipt back to whoever it is acting for. The REST API needs no auth for reads.",
  },
];
