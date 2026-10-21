/**
 * CSS for the marketing layout's <noscript> block: un-hides what the JS
 * reveals (useRevealV2, the hero board rows) server-render at opacity 0. Only
 * `opacity:0` exactly (followed by ";" or at the end of the attribute) is
 * matched, so an intentional `opacity:0.4` keeps its value.
 */
export const NO_JS_REVEAL_CSS =
  '.pegana-v2 [style*="opacity:0;"],.pegana-v2 [style$="opacity:0"]{opacity:1!important;transform:none!important;filter:none!important}';
