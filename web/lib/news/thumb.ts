// News thumbnails render at 48x48 (96 device px at 2x), but the feed carries
// full-size images: CoinGecko article "large" files up to ~440 KB and X media
// at 1200x675. These helpers pick a small variant per host.

const COINGECKO_HOST = "assets.coingecko.com";
const TWIMG_HOST = "pbs.twimg.com";

/** X video posters: `/amplify_video_thumb/<id>/img/<key>.<ext>`. */
const VIDEO_THUMB = /^(\/amplify_video_thumb\/\d+\/img\/[^/.]+)\.(jpg|jpeg|png)$/i;

/**
 * X media (`/media/<id>.<ext>`) serves a 150x150 crop with `name=thumb`
 * (about 2-7 KB instead of 36-95 KB).
 *
 * Video posters (amplify_video_thumb) ignore `name=thumb` on the `.jpg` URL
 * and 404 it in the `?format=` form, but they do serve sized variants:
 * `?format=jpg&name=240x240` measured 7.6 KB against 71.8 KB for the
 * original (2026-10-21). 240px covers the 48px tile at 3x.
 */
function twimgThumb(u: URL): string {
  const video = VIDEO_THUMB.exec(u.pathname);
  if (video) {
    const out = new URL(u.toString());
    out.pathname = video[1];
    out.search = "";
    out.searchParams.set("format", "jpg");
    out.searchParams.set("name", "240x240");
    return out.toString();
  }
  if (!u.pathname.startsWith("/media/")) return u.toString();
  const m = /^(\/media\/[^/.]+)\.(jpg|jpeg|png|webp)$/i.exec(u.pathname);
  const out = new URL(u.toString());
  if (m) {
    out.pathname = m[1];
    out.searchParams.set("format", m[2].toLowerCase() === "png" ? "png" : "jpg");
  }
  out.searchParams.set("name", "thumb");
  return out.toString();
}

/**
 * CoinGecko has no small variant (/thumb/ and /small/ answer 403), so its
 * images go through the Next image optimizer (next.config `images`). The
 * cache-busting query is dropped: the optimizer's remotePatterns allow no
 * query string, and the file answers the same without it.
 */
export function isOptimizableNewsImage(src: string): boolean {
  try {
    const u = new URL(src);
    return u.protocol === "https:" && u.hostname === COINGECKO_HOST &&
      u.pathname.startsWith("/articles/images/");
  } catch {
    return false;
  }
}

export function newsThumbSrc(src: string): string {
  let u: URL;
  try {
    u = new URL(src);
  } catch {
    return src;
  }
  if (u.hostname === TWIMG_HOST) return twimgThumb(u);
  if (isOptimizableNewsImage(src)) {
    u.search = "";
    return u.toString();
  }
  return src;
}
