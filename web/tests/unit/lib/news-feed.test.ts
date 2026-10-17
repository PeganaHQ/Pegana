import { describe, expect, it } from "vitest";
import {
  decodeXmlText,
  matchTerms,
  mergeItems,
  parseFeed,
  type NewsItem,
} from "@/lib/news/feed";

/**
 * The filter IS the feature. Without it this is a worse crypto news app; the
 * only reason it belongs in a peg-risk product is that it shows nothing else.
 * So the tests that matter are the ones about what gets let in and kept out.
 */

describe("matchTerms — what counts as peg-relevant", () => {
  it("matches our tickers on word boundaries", () => {
    expect(matchTerms("USDC briefly loses its peg")).toContain("USDC");
    expect(matchTerms("Jito's jitoSOL hits a new high")).toContain("jitoSOL");
  });

  it("does NOT match a ticker embedded in a longer word", () => {
    // "USDC" inside "USDCoinbase" is not a mention of USDC.
    expect(matchTerms("USDCoinbase launches")).toEqual([]);
    // The classic: "INF" inside "INFLATION".
    expect(matchTerms("INFLATION data lands")).toEqual([]);
  });

  it("is case-sensitive on tickers, because lowercase collides with English", () => {
    // "inf" appears inside "information"; "lst" inside nothing useful. If we
    // lowercased tickers, every headline containing "information" would match.
    expect(matchTerms("More information on the launch")).toEqual([]);
    expect(matchTerms("INF grows its TVL")).toContain("INF");
  });

  it("matches topics case-insensitively, including multi-word ones", () => {
    expect(matchTerms("A Solana liquid staking primer")).toContain("liquid staking");
    expect(matchTerms("Solana STABLECOIN supply climbs")).toContain("stablecoin");
  });

  it("does not fire 'peg' on an unrelated word, but does on its inflections", () => {
    expect(matchTerms("Pegasus raises a round")).toEqual([]);
    // "pegged" is its own listed term, not a stem of "peg" — word-boundary
    // matching means the short form would miss the inflected headline entirely.
    // Every inflection reports the canonical "peg" so the UI chip is stable.
    expect(matchTerms("Hylo keeps hyUSD pegged to the dollar")).toContain("peg");
    expect(matchTerms("USDe is repegging after the wick")).toContain("peg");
    expect(matchTerms("Three Solana stablecoins depegged overnight")).toContain("peg");
  });

  it("subject terms stand alone; adjacent terms need an ecosystem anchor", () => {
    // SCOPE is Solana, LSTs and stablecoins — not "peg events only". An earlier
    // draft demanded an ecosystem word on every match, which rejected
    // "Western Union launches a stablecoin card". Stablecoin industry news is
    // in scope whether or not Solana is named.
    expect(matchTerms("Western Union launches a stablecoin card"))
      .toContain("stablecoin");
    expect(matchTerms("ether.fi removes restaking from weETH")).toContain("restaking");

    // "collateral" / "reserves" / "redemption" are ordinary finance words and
    // do NOT define the subject, so they still have to name the ecosystem.
    expect(matchTerms("Bank raises collateral requirements")).toEqual([]);
    expect(matchTerms("Kamino raises collateral requirements")).toContain("collateral");
  });

  it("a tracked ticker is its own anchor, no ecosystem word needed", () => {
    // "USDC depegs" needs no further proof of relevance.
    expect(matchTerms("USDC depegs on Arbitrum")).toContain("USDC");
  });

  it("lets an ordinary crypto headline through the net — i.e. rejects it", () => {
    expect(matchTerms("Bitcoin ETF sees record inflows")).toEqual([]);
    expect(matchTerms("NFT volumes rebound in Q3")).toEqual([]);
  });
});

describe("decodeXmlText", () => {
  it("unwraps CDATA, strips tags and decodes entities", () => {
    expect(decodeXmlText("<![CDATA[<b>USDC</b> &amp; USDT]]>")).toBe("USDC & USDT");
  });

  it("decodes &amp; last, so &amp;lt; does not become a tag delimiter", () => {
    // Decoding &amp; first would turn "&amp;lt;" into "&lt;" and then "<",
    // which is how entity-decoders grow XSS holes.
    expect(decodeXmlText("a &amp;lt; b")).toBe("a &lt; b");
  });

  it("decodes numeric and hex character references", () => {
    expect(decodeXmlText("caf&#233; &#x2014; bar")).toBe("café — bar");
  });
});

const RSS = `<?xml version="1.0"?><rss><channel>
<item>
  <title><![CDATA[USDC depegs briefly on Solana]]></title>
  <link>https://example.com/a?utm_source=rss</link>
  <pubDate>Sun, 10 Aug 2026 12:00:00 GMT</pubDate>
</item>
<item>
  <title>Bitcoin ETF inflows hit a record</title>
  <link>https://example.com/b</link>
  <pubDate>Sun, 10 Aug 2026 13:00:00 GMT</pubDate>
</item>
</channel></rss>`;

const ATOM = `<?xml version="1.0"?><feed>
<entry>
  <title>A Solana liquid staking explainer</title>
  <link href="https://other.com/c"/>
  <published>2026-08-09T10:00:00Z</published>
</entry>
</feed>`;

describe("parseFeed", () => {
  it("keeps only peg-relevant items and records why each was kept", () => {
    const items = parseFeed(RSS, "Example");
    expect(items).toHaveLength(1);
    expect(items[0]!.title).toBe("USDC depegs briefly on Solana");
    expect(items[0]!.matched).toContain("USDC");
    expect(items[0]!.source).toBe("Example");
  });

  it("reads Atom entries and their href-style links", () => {
    const items = parseFeed(ATOM, "Other");
    expect(items[0]!.url).toBe("https://other.com/c");
    expect(items[0]!.publishedAt).toBe("2026-08-09T10:00:00.000Z");
  });

  it("returns [] on malformed input instead of throwing", () => {
    // One feed changing shape must not blank the whole modal.
    expect(parseFeed("<html>not a feed</html>", "X")).toEqual([]);
    expect(parseFeed("", "X")).toEqual([]);
  });

  it("skips items missing a title or a link", () => {
    const partial = `<rss><item><title>USDC news</title></item></rss>`;
    expect(parseFeed(partial, "X")).toEqual([]);
  });
});

describe("mergeItems", () => {
  const at = (iso: string | null, title: string, url: string): NewsItem => ({
    title,
    url,
    source: "S",
    publishedAt: iso,
    matched: ["peg"],
  });

  it("sorts newest first and pushes undated items to the end", () => {
    const out = mergeItems([
      [at(null, "no date", "https://x.com/1")],
      [at("2026-08-01T00:00:00Z", "older", "https://x.com/2")],
      [at("2026-08-09T00:00:00Z", "newer", "https://x.com/3")],
    ]);
    expect(out.map((i) => i.title)).toEqual(["newer", "older", "no date"]);
  });

  it("drops duplicate URLs ignoring tracking params and trailing slash", () => {
    const out = mergeItems([
      [at("2026-08-09T00:00:00Z", "A", "https://x.com/p?utm_source=rss")],
      [at("2026-08-09T00:00:00Z", "B", "https://x.com/p")],
    ]);
    expect(out).toHaveLength(1);
  });

  it("drops the same wire story syndicated under a differently-punctuated headline", () => {
    const out = mergeItems([
      [at("2026-08-09T00:00:00Z", "USDC depegs — briefly!", "https://a.com/1")],
      [at("2026-08-09T00:00:00Z", "USDC depegs, briefly", "https://b.com/2")],
    ]);
    expect(out).toHaveLength(1);
  });

  it("honours the limit", () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      at("2026-08-09T00:00:00Z", `t${i}`, `https://x.com/${i}`),
    );
    expect(mergeItems([many], 5)).toHaveLength(5);
  });
});
