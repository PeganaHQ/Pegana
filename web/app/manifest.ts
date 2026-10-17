import type { MetadataRoute } from "next";

import { BRAND_CANVAS } from "@/lib/brand/canvas";

/**
 * Web app manifest, as a typed metadata route rather than a static file in
 * `public/`.
 *
 * It was `public/site.webmanifest`: valid, but untyped, untestable, and unable
 * to reference anything the app knows. Next serves this at `/manifest.webmanifest`
 * and injects the `<link rel="manifest">` itself.
 *
 * The decision behind this file is ADR-0045: Pegana ships as ONE installable
 * web app with one interaction language on both platforms, not as native iOS
 * and Android clients. The short version: alerts, the only capability that
 * genuinely argues for a native shell, already reach users through Telegram and
 * webhooks without a store review in the path; and a solo founder cannot keep
 * two interaction languages honest.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    // A stable identity, so a re-install or a scope change does not register as
    // a different app and orphan the user's existing icon.
    id: "/?app=pegana",
    name: "Pegana: Solana peg-risk oracle",
    short_name: "Pegana",
    description:
      "Peg-risk oracle for Solana. Intrinsic-vs-market monitoring for LSTs, stablecoins, yield-bearing assets, CDPs and synthetics.",

    // An installed Pegana opens the console, not the marketing landing. The old
    // `start_url: "/"` meant tapping the home-screen icon put you on a page
    // trying to sell you the product you had already installed. `scope` stays
    // `/` so marketing pages still open in-app rather than kicking out to the
    // browser.
    start_url: "/dashboard?source=pwa",
    scope: "/",

    display: "standalone",
    // Ordered fallback. `standalone` is what we want; `minimal-ui` keeps a
    // reload affordance where standalone is refused; `browser` is the honest
    // last resort rather than a broken install.
    display_override: ["standalone", "minimal-ui", "browser"],
    orientation: "any",

    background_color: BRAND_CANVAS,
    theme_color: BRAND_CANVAS,
    categories: ["finance", "developer", "utilities"],

    icons: [
      {
        src: "/android-chrome-192x192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/android-chrome-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-maskable-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],

    // Long-press the installed icon. Four destinations, matching the app's own
    // primary navigation so the shortcuts and the tab bar tell the same story.
    shortcuts: [
      {
        name: "Dashboard",
        short_name: "Dashboard",
        description: "Every tracked asset, worst first",
        url: "/dashboard?source=pwa-shortcut",
        icons: [{ src: "/android-chrome-192x192.png", sizes: "192x192" }],
      },
      {
        name: "Assets",
        short_name: "Assets",
        description: "The full screener",
        url: "/assets?source=pwa-shortcut",
        icons: [{ src: "/android-chrome-192x192.png", sizes: "192x192" }],
      },
      {
        name: "Events",
        short_name: "Events",
        description: "Recent state transitions",
        url: "/events?source=pwa-shortcut",
        icons: [{ src: "/android-chrome-192x192.png", sizes: "192x192" }],
      },
      {
        name: "Compare",
        short_name: "Compare",
        description: "Overlay up to 4 assets",
        url: "/compare?source=pwa-shortcut",
        icons: [{ src: "/android-chrome-192x192.png", sizes: "192x192" }],
      },
    ],
  };
}
