"use client";

import { useState } from "react";
import { api } from "@/lib/api/client";
import { cn } from "@/lib/utils/cn";
import { displaySymbol } from "@/lib/asset/display-symbol";

interface ExportButtonsProps {
  symbol: string;
  className?: string;
}

type Format = "csv" | "json";

function isoDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Streams 30 days of 1m history straight to the user's disk as CSV or JSON.
// No server-side endpoint needed — we just hit the existing /v1/assets/{sym}/history
// and serialize on the client. 30d × 1m = ~43k points; well within browser memory.
export function ExportButtons({ symbol, className }: ExportButtonsProps) {
  const [downloading, setDownloading] = useState<Format | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function download(fmt: Format) {
    setError(null);
    setDownloading(fmt);
    try {
      const from = new Date(Date.now() - 30 * 86400_000).toISOString();
      const data = await api.assetHistory(symbol, {
        bucket: "1m",
        from,
        limit: 50000,
      });
      const filename = `pegana-${displaySymbol(symbol).toLowerCase()}-${isoDateOnly(new Date())}-30d.${fmt}`;
      const blob =
        fmt === "csv"
          ? new Blob([toCsv(data)], { type: "text/csv;charset=utf-8" })
          : new Blob([JSON.stringify(data, null, 2)], {
              type: "application/json",
            });
      triggerDownload(blob, filename);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setDownloading(null);
    }
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
        Download 30d
      </span>
      <button
        type="button"
        onClick={() => download("csv")}
        disabled={downloading !== null}
        className="border border-hairline px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted transition-colors hover:border-outline hover:text-text disabled:opacity-50"
      >
        {downloading === "csv" ? "preparing…" : "CSV ↓"}
      </button>
      <button
        type="button"
        onClick={() => download("json")}
        disabled={downloading !== null}
        className="border border-hairline px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted transition-colors hover:border-outline hover:text-text disabled:opacity-50"
      >
        {downloading === "json" ? "preparing…" : "JSON ↓"}
      </button>
      {error && (
        <span role="alert" className="font-mono text-[10px] text-st-depeg-text">
          {error}
        </span>
      )}
    </div>
  );
}

function toCsv(
  rows: Array<{ ts: string; discount: string; state: string }>,
): string {
  // Quote nothing — all three columns are CSV-safe (ISO timestamp, signed
  // decimal, ASCII enum). Saves us a quoting library.
  const header = "ts,discount,state\n";
  const body = rows.map((r) => `${r.ts},${r.discount},${r.state}`).join("\n");
  return header + body + "\n";
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Give the browser a moment before revoking — some Safari builds need it.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
