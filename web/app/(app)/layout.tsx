import { LiveProvider } from "@/lib/store/live-context";
import { HealthBanner } from "@/components/molecules/health-banner";
import { WsBanner } from "@/components/molecules/ws-banner";
import { DashboardTopBar } from "@/components/organisms/dashboard-topbar";
import { SiteFooterV2 } from "@/components/organisms/v2/site-chrome-v2";
import { MobileTabBar } from "@/components/organisms/mobile-tab-bar";
import { AmbientGlowBg } from "@/components/atoms/ambient-glow-bg";
import { CommandPalette } from "@/components/organisms/command-palette";
import { SkipTarget } from "@/components/atoms/skip-target";
import { ViewTransitions } from "@/lib/motion/view-transitions";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-dvh flex-col overflow-x-hidden bg-canvas text-text pt-[env(safe-area-inset-top)]">
      <LiveProvider>
        <AmbientGlowBg />
        <CommandPalette />
        {/* Route transitions, driven by document.startViewTransition. Only
            the page body travels: the topbar and tab bar carry their own
            view-transition-name and are pinned in globals.css, so the user
            keeps a fixed reference and reads "the content moved". */}
        <ViewTransitions />
        <DashboardTopBar />
        <SkipTarget />
        {/* Status strip: single collapsible row directly BELOW the topbar
            (not stacked above it, the Birdeye anti-pattern — see w3/refs-
            chrome.md §"Reject"). Lives inside the padded content wrapper so
            its natural (unscrolled) position already sits right under the
            fixed/sticky header; each banner is independently `sticky` at
            the header's own height so it stays pinned there on scroll too. */}
        {/* Sticky-footer shell: the content grows (flex-1) so the footer is
            pushed to the viewport bottom — short pages no longer leave it
            floating with a big empty gap below. */}
        {/* Chrome offsets come from --app-topbar-h / --app-tabbar-h
            (app/globals.css) rather than a literal that five files had to
            keep in sync by hand. At `lg` the topbar is `sticky` (in flow) and
            the tab bar is hidden, so both reset to 0. */}
        <div className="relative z-10 flex flex-1 flex-col pt-[var(--app-topbar-h)] pb-[calc(var(--app-tabbar-h)+env(safe-area-inset-bottom))] lg:pt-0 lg:pb-0">
          <HealthBanner />
          <WsBanner />
          <div className="flex-1">{children}</div>
          <SiteFooterV2 />
        </div>
        <MobileTabBar />
      </LiveProvider>
    </div>
  );
}
