import { permanentRedirect } from "next/navigation";

// B-024: `/live` typed directly used to 404 because the navbar used to point
// at the home-page anchor `href="/#live"`. The landing V5 no longer renders
// that section, so this now redirects `/live` -> `/events`, the standalone
// route that replaced it.
//
// Server component using redirect() from next/navigation (Next 16). redirect()
// throws NEXT_REDIRECT and terminates rendering, so no markup is returned.
//
// permanentRedirect() (308), not redirect() (307): both of these are PERMANENT
// architectural aliases — the comments above describe them as such — and a 307
// tells search engines the move is temporary, so the destination never inherits
// the alias's link equity and the alias keeps getting recrawled.
export default function LiveRedirectPage(): never {
  permanentRedirect("/events");
}
