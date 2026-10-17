// Single source of truth for GSAP. Dynamic-imports so the bundle only pays the
// cost on routes that actually use it. Registers ScrollTrigger exactly once.

let gsapPromise: Promise<typeof import("gsap").gsap> | null = null;
let scrollTriggerRegistered = false;

export async function getGsap() {
  if (!gsapPromise) {
    gsapPromise = import("gsap").then((mod) => mod.gsap);
  }
  return gsapPromise;
}

export async function getScrollTrigger() {
  const [gsap, { ScrollTrigger }] = await Promise.all([
    getGsap(),
    import("gsap/ScrollTrigger"),
  ]);
  if (!scrollTriggerRegistered) {
    gsap.registerPlugin(ScrollTrigger);
    scrollTriggerRegistered = true;
  }
  return ScrollTrigger;
}
