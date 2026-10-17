import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo/page-metadata";
import { cn } from "@/lib/utils/cn";
import { switzerV2, geistMonoV2 } from "@/app/fonts/v2-fonts";
import { EmbedClient } from "./embed-client";

export const metadata: Metadata = pageMetadata({
  title: "Embed playground",
  description:
    "One iframe, zero config. The Pegana peg badge updates server-side every 60 seconds against the same live API the dashboard runs on.",
  path: "/embed",
});

export default function EmbedPage() {
  return (
    <div className={cn("pegana-v2", switzerV2.variable, geistMonoV2.variable)}>
      <EmbedClient />
    </div>
  );
}
