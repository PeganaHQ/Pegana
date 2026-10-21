import { describe, it, expect } from "vitest";
import { isOptimizableNewsImage, newsThumbSrc } from "@/lib/news/thumb";

describe("newsThumbSrc", () => {
  it("asks X media for the 150px thumb", () => {
    expect(newsThumbSrc("https://pbs.twimg.com/media/HVGnsScbkAA6LKT.png")).toBe(
      "https://pbs.twimg.com/media/HVGnsScbkAA6LKT?format=png&name=thumb",
    );
    expect(newsThumbSrc("https://pbs.twimg.com/media/ABC?format=jpg&name=large")).toBe(
      "https://pbs.twimg.com/media/ABC?format=jpg&name=thumb",
    );
  });
  it("asks X video posters for the 240x240 variant (they ignore name=thumb)", () => {
    const u =
      "https://pbs.twimg.com/amplify_video_thumb/2112563161736032257/img/L3YFcFpgu9FtUZGA.jpg";
    expect(newsThumbSrc(u)).toBe(
      "https://pbs.twimg.com/amplify_video_thumb/2112563161736032257/img/L3YFcFpgu9FtUZGA?format=jpg&name=240x240",
    );
  });
  it("leaves other X paths alone", () => {
    const u = "https://pbs.twimg.com/profile_images/123/abc_normal.jpg";
    expect(newsThumbSrc(u)).toBe(u);
  });
  it("strips CoinGecko's cache-buster so the optimizer pattern (no query) matches", () => {
    const u =
      "https://assets.coingecko.com/articles/images/108619086/large/open-uri20261021-1-yt2v3q.?1792545604";
    expect(isOptimizableNewsImage(u)).toBe(true);
    expect(newsThumbSrc(u)).toBe(
      "https://assets.coingecko.com/articles/images/108619086/large/open-uri20261021-1-yt2v3q.",
    );
  });
  it("only optimizes the allow-listed CoinGecko path", () => {
    expect(isOptimizableNewsImage("https://assets.coingecko.com/coins/images/1/large/x.png")).toBe(false);
    expect(isOptimizableNewsImage("http://assets.coingecko.com/articles/images/1/large/x")).toBe(false);
    expect(isOptimizableNewsImage("not a url")).toBe(false);
  });
});
