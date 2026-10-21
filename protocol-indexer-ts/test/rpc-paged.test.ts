import { describe, expect, it, vi } from "vitest";
import { pagedProgramAccounts, PagingBudgetExceededError } from "../src/rpc-paged";

const acct = (n: number) => ({ pubkey: `pk${n}`, account: { data: ["AAAA", "base64"] } });
const resp = (accounts: unknown[], paginationKey: string | null, status = 200) =>
  ({
    ok: status < 400,
    status,
    text: async () => JSON.stringify({ jsonrpc: "2.0", id: 1, result: { accounts, paginationKey } }),
  }) as unknown as Response;
const httpErr = (status: number, body: string) =>
  ({ ok: false, status, text: async () => body }) as unknown as Response;

async function collect(gen: AsyncGenerator<{ pubkey: string }[]>) {
  const pages: string[][] = [];
  for await (const p of gen) pages.push(p.map((a) => a.pubkey));
  return pages;
}

describe("pagedProgramAccounts", () => {
  it("walks pages via paginationKey and sends bounded limit + filters", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(resp([acct(1), acct(2)], "k1"))
      .mockResolvedValueOnce(resp([acct(3)], null));
    const pages = await collect(
      pagedProgramAccounts("http://x", "PROG", [{ dataSize: 10 }], { pageSize: 2, fetchFn }),
    );
    expect(pages).toEqual([["pk1", "pk2"], ["pk3"]]);
    const body1 = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(body1.method).toBe("getProgramAccountsV2");
    expect(body1.params[1].limit).toBe(2);
    expect(body1.params[1].paginationKey).toBeUndefined();
    expect(JSON.parse(fetchFn.mock.calls[1][1].body).params[1].paginationKey).toBe("k1");
  });

  it("stops on an empty page", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(resp([], "k1"));
    expect(await collect(pagedProgramAccounts("u", "P", [], { fetchFn }))).toEqual([]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("retries a plain 429 but not quota exhaustion", async () => {
    const sleepFn = vi.fn().mockResolvedValue(undefined);
    const ok = vi
      .fn()
      .mockResolvedValueOnce(httpErr(429, "Too Many Requests"))
      .mockResolvedValueOnce(resp([acct(1)], null));
    expect(await collect(pagedProgramAccounts("u", "P", [], { fetchFn: ok, sleepFn }))).toEqual([["pk1"]]);
    expect(sleepFn).toHaveBeenCalledTimes(1);

    const quota = vi.fn().mockResolvedValue(httpErr(429, "max usage reached"));
    await expect(
      collect(pagedProgramAccounts("u", "P", [], { fetchFn: quota, sleepFn })),
    ).rejects.toThrow(/max usage/);
    expect(quota).toHaveBeenCalledTimes(1);
  });

  it("fails fast on 401 without retry", async () => {
    const fetchFn = vi.fn().mockResolvedValue(httpErr(401, "Unauthorized"));
    await expect(collect(pagedProgramAccounts("u", "P", [], { fetchFn }))).rejects.toThrow(/401/);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("enforces the page cap and the time budget", async () => {
    const fetchFn = vi.fn().mockImplementation(async () => resp([acct(1)], "more"));
    await expect(
      collect(pagedProgramAccounts("u", "P", [], { fetchFn, maxPages: 3 })),
    ).rejects.toBeInstanceOf(PagingBudgetExceededError);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    await expect(
      collect(pagedProgramAccounts("u", "P", [], { fetchFn, deadlineMs: Date.now() - 1 })),
    ).rejects.toBeInstanceOf(PagingBudgetExceededError);
  });
});

import { redactSecrets } from "../src/fetch-util";
import { PageTimeoutError } from "../src/rpc-paged";

describe("request shape, timeouts, secrets", () => {
  it("requests base64 encoding and passes filters through", async () => {
    const fetchFn = vi.fn().mockResolvedValue(resp([], null));
    await collect(pagedProgramAccounts("u", "P", [{ dataSize: 3344 }], { fetchFn }));
    const cfg = JSON.parse(fetchFn.mock.calls[0][1].body).params[1];
    expect(cfg.encoding).toBe("base64");
    expect(cfg.filters).toEqual([{ dataSize: 3344 }]);
  });

  it("aborts a stalled BODY read and retries timeouts a bounded number of times", async () => {
    const sleepFn = vi.fn().mockResolvedValue(undefined);
    const fetchFn = vi.fn().mockImplementation(async (_u: string, init: RequestInit) => ({
      ok: true,
      status: 200,
      // headers arrive, body never does until aborted
      text: () =>
        new Promise((_r, rej) =>
          init.signal!.addEventListener("abort", () => rej(new Error("aborted"))),
        ),
    }));
    await expect(
      collect(pagedProgramAccounts("u", "P", [], { fetchFn, sleepFn, timeoutMs: 5 })),
    ).rejects.toBeInstanceOf(PageTimeoutError);
    expect(fetchFn).toHaveBeenCalledTimes(4); // 1 + 3 retries
  });

  it("recovers from a single timeout hiccup", async () => {
    const sleepFn = vi.fn().mockResolvedValue(undefined);
    let n = 0;
    const fetchFn = vi.fn().mockImplementation(async (_u: string, init: RequestInit) => {
      if (n++ === 0) {
        return {
          ok: true,
          status: 200,
          text: () =>
            new Promise((_r, rej) =>
              init.signal!.addEventListener("abort", () => rej(new Error("aborted"))),
            ),
        };
      }
      return resp([acct(1)], null);
    });
    expect(
      await collect(pagedProgramAccounts("u", "P", [], { fetchFn, sleepFn, timeoutMs: 5 })),
    ).toEqual([["pk1"]]);
  });

  it("never leaks the api key in errors", async () => {
    const KEY = "abcd1234-secret-key";
    const url = `https://mainnet.helius-rpc.com/?api-key=${KEY}`;
    const fetchFn = vi.fn().mockRejectedValue(new Error(`connect failed ${url}`));
    let msg = "";
    try {
      await collect(pagedProgramAccounts(url, "P", [], { fetchFn }));
    } catch (e) {
      msg = String(e);
    }
    expect(msg).not.toContain(KEY);
    expect(redactSecrets(`x ${url} y`)).not.toContain(KEY);
    expect(redactSecrets(`x ${url} y`)).toContain("api-key=REDACTED");
  });
});
