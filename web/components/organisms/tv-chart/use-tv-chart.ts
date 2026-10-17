"use client";

import { useEffect, useRef, useState } from "react";
import { createChart, type IChartApi } from "lightweight-charts";
import { readTvTokens, tvChartOptions, type TvTokens } from "./theme";

/**
 * Creates one Lightweight Charts instance bound to a container div, with
 * autoSize on (so it follows the wrapper's flex/grid layout).
 *
 * `aliveRef` flips to false the moment the chart is removed, so dependent
 * effects can short-circuit their own series-cleanup without throwing
 * "Value is undefined" inside LWC's removeSeries.
 */
export function useTvChart() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const aliveRef = useRef(false);
  const [chart, setChart] = useState<IChartApi | null>(null);
  const [tokens, setTokens] = useState<TvTokens | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const t = readTvTokens();
    const c = createChart(containerRef.current, tvChartOptions(t));
    aliveRef.current = true;
    setChart(c);
    setTokens(t);

    const observer = new MutationObserver((mutations) => {
      if (!mutations.some((m) => m.attributeName === "data-theme")) return;
      const nextTokens = readTvTokens();
      c.applyOptions(tvChartOptions(nextTokens));
      setTokens(nextTokens);
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    return () => {
      observer.disconnect();
      aliveRef.current = false;
      c.remove();
      setChart(null);
    };
  }, []);

  return { containerRef, chart, tokens, aliveRef };
}
