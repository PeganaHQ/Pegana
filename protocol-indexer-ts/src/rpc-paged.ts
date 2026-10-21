// Paginated getProgramAccounts (Helius getProgramAccountsV2) with a hard memory
// and time budget.
//
// WHY THIS EXISTS (2026-10-21 crash loop): the klend-sdk's
// getAllObligationsByDepositedReserve issues an UNPAGINATED getProgramAccounts
// per deposit slot (x8 per reserve). A Kamino obligation account is ~3.3 KB, so
// ~4.6 KB as base64 JSON; a popular reserve matches tens of thousands of
// obligations => hundreds of MB per response. Bun/@solana/kit buffer the whole
// body and JSON.parse it (measured: ~540 MB body => >3 GB RSS), far beyond the
// container's 1 GB mem_limit, so the process died seconds after the HF sources
// started. This pager bounds every response to `pageSize` accounts (~4.6 MB at
// 1000) and yields page by page so the caller can fold + discard.

import { redactSecrets } from "./fetch-util";
import { isQuotaExhausted, isRetryableRpcFailure } from "./rpc-quota";

export type GpaFilter =
  | { dataSize: number }
  | { memcmp: { offset: number; bytes: string; encoding?: "base58" } };

export interface RawAccount {
  pubkey: string;
  /** base64 account data */
  data: string;
}

export class PageTimeoutError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "PageTimeoutError";
  }
}

export class PagingBudgetExceededError extends Error {
  constructor(reason: string) {
    super(`getProgramAccountsV2 budget exceeded: ${reason}`);
    this.name = "PagingBudgetExceededError";
  }
}

export interface PageOptions {
  pageSize?: number; // accounts per request (Helius max 10_000)
  maxPages?: number; // hard cap on pages per walk
  deadlineMs?: number; // absolute Date.now() deadline for the whole walk
  maxPageBytes?: number; // reject a single response bigger than this
  retries?: number;
  retryDelayMs?: number;
  /** Injected for tests; must honour init.signal. Defaults to global fetch. */
  fetchFn?: (url: string, init: RequestInit) => Promise<Response>;
  timeoutMs?: number; // covers connect + headers + BODY read, per attempt
  timeoutRetries?: number; // bounded retries for timeouts (default 3)
  sleepFn?: (ms: number) => Promise<void>;
}

const DEFAULT_PAGE_SIZE = 1000;
const DEFAULT_MAX_PAGES = 2000;
const DEFAULT_MAX_PAGE_BYTES = 64 * 1024 * 1024;

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function fetchPage(
  url: string,
  programId: string,
  filters: GpaFilter[],
  paginationKey: string | null,
  o: Required<Pick<PageOptions, "pageSize" | "maxPageBytes" | "fetchFn" | "timeoutMs">>,
): Promise<{ accounts: RawAccount[]; paginationKey: string | null }> {
  const config: Record<string, unknown> = {
    encoding: "base64",
    filters,
    limit: o.pageSize,
  };
  if (paginationKey) config.paginationKey = paginationKey;
  // ONE AbortController for the whole request including the body read: a
  // server that sends headers then stalls the body must not hang the walk.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), o.timeoutMs);
  let text: string;
  try {
    const res = await o.fetchFn(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getProgramAccountsV2",
        params: [programId, config],
      }),
      signal: ctrl.signal,
    });
    const len = Number(res.headers?.get?.("content-length") ?? 0);
    if (len > o.maxPageBytes) {
      throw new Error(`rpc getProgramAccountsV2 page too large: ${len} bytes`);
    }
    text = await res.text();
    if (!res.ok) {
      throw new Error(`rpc getProgramAccountsV2 http ${res.status}: ${text.slice(0, 200)}`);
    }
  } catch (e) {
    if (ctrl.signal.aborted) {
      throw new PageTimeoutError(`rpc getProgramAccountsV2 timeout after ${o.timeoutMs}ms`);
    }
    throw new Error(redactSecrets(String((e as Error)?.message ?? e)));
  } finally {
    clearTimeout(timer);
  }
  if (text.length > o.maxPageBytes) {
    throw new Error(`rpc getProgramAccountsV2 page too large: ${text.length} bytes`);
  }
  const json = JSON.parse(text) as {
    result?: {
      accounts?: Array<{ pubkey: string; account: { data: [string, string] } }>;
      paginationKey?: string | null;
    };
    error?: { message: string };
  };
  if (json.error) throw new Error(`rpc getProgramAccountsV2: ${json.error.message}`);
  const accounts = (json.result?.accounts ?? []).map((a) => ({
    pubkey: a.pubkey,
    data: a.account.data[0],
  }));
  return { accounts, paginationKey: json.result?.paginationKey ?? null };
}

/** Walk every matching account, one bounded page at a time. */
export async function* pagedProgramAccounts(
  url: string,
  programId: string,
  filters: GpaFilter[],
  opts: PageOptions = {},
): AsyncGenerator<RawAccount[]> {
  const pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE;
  const maxPages = opts.maxPages ?? DEFAULT_MAX_PAGES;
  const maxPageBytes = opts.maxPageBytes ?? DEFAULT_MAX_PAGE_BYTES;
  const retries = opts.retries ?? 4;
  const retryDelayMs = opts.retryDelayMs ?? 2000;
  const fetchFn = opts.fetchFn ?? ((u: string, i: RequestInit) => fetch(u, i));
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const timeoutRetries = opts.timeoutRetries ?? 3;
  const sleepFn = opts.sleepFn ?? defaultSleep;

  let key: string | null = null;
  for (let page = 0; ; page++) {
    if (page >= maxPages) throw new PagingBudgetExceededError(`>${maxPages} pages`);
    if (opts.deadlineMs !== undefined && Date.now() > opts.deadlineMs) {
      throw new PagingBudgetExceededError("time budget");
    }
    let res;
    for (let attempt = 0; ; attempt++) {
      try {
        res = await fetchPage(url, programId, filters, key, { pageSize, maxPageBytes, fetchFn, timeoutMs });
        break;
      } catch (e) {
        // Quota exhaustion and non-429 errors are terminal for the walk; only a
        // plain rate limit is retried (see rpc-quota.ts).
        if (e instanceof PageTimeoutError) {
          // A single hiccup must not discard a whole reserve walk.
          if (attempt >= Math.min(retries, timeoutRetries)) throw e;
        } else if (isQuotaExhausted(e) || !isRetryableRpcFailure(e) || attempt >= retries) {
          throw e;
        }
        await sleepFn(retryDelayMs * (attempt + 1));
      }
    }
    if (res.accounts.length > 0) yield res.accounts;
    if (!res.paginationKey || res.accounts.length === 0) return;
    key = res.paginationKey;
  }
}
