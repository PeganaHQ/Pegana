"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils/cn";

// W2 (2026-07-03): the methodology page's sticky section rail. Desktop-only
// (hidden <900px via .v2-in-toc's own media query in v2.css — the
// `.v2-in-artgrid` collapses to one column there too, so the rail would have
// nowhere sensible to sit). Tracks which section heading is nearest the top
// of the viewport with an IntersectionObserver instead of a scroll listener.

export interface TocItem {
  href: string;
  label: string;
}

export function TocRailV2({ items }: { items: TocItem[] }) {
  const [active, setActive] = useState<string>(items[0]?.href ?? "");

  useEffect(() => {
    const targets = items
      .map((i) => document.getElementById(i.href.slice(1)))
      .filter((el): el is HTMLElement => el !== null);
    if (targets.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(`#${visible[0].target.id}`);
      },
      { rootMargin: "-15% 0px -70% 0px", threshold: [0, 1] },
    );
    targets.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [items]);

  return (
    <nav className="v2-in-toc" aria-label="Contents">
      {items.map((i) => (
        <a
          key={i.href}
          href={i.href}
          className={cn(active === i.href && "v2-in-on")}
        >
          {i.label}
        </a>
      ))}
    </nav>
  );
}
