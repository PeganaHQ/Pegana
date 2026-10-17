"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

// W2 (2026-07-03): the 3-pane code tab strip ("verify_alert · free" /
// "subscribe · free" / "REST · no client"). Client island so tab switching
// doesn't need a route change; reuses the `.v2-in-ptabs` / `.v2-in-pane`
// classes shared with /audit's filter pills and the pane-entrance keyframe
// already defined for ProductTabsV2 (`.v2-pane-enter`, gated under
// prefers-reduced-motion like every other V2 animation).

export interface AgentTab {
  id: string;
  label: string;
  pane: ReactNode;
}

export function AgentTabs({ tabs }: { tabs: AgentTab[] }) {
  const [active, setActive] = useState(tabs[0]?.id ?? "");

  return (
    <div>
      <div className="v2-in-ptabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            id={`agents-tab-${t.id}`}
            type="button"
            role="tab"
            aria-selected={active === t.id}
            aria-controls={`agents-panel-${t.id}`}
            onClick={() => setActive(t.id)}
            className={cn("v2-in-ptab", active === t.id && "v2-in-on")}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tabs.map((t) => (
        <div
          key={t.id}
          id={`agents-panel-${t.id}`}
          role="tabpanel"
          aria-labelledby={`agents-tab-${t.id}`}
          hidden={active !== t.id}
          className={active === t.id ? "v2-pane-enter" : undefined}
        >
          {t.pane}
        </div>
      ))}
    </div>
  );
}
