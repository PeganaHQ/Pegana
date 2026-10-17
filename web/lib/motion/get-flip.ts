// Dynamic-loads the Flip plugin and registers it once. Mirrors get-scroll-trigger.ts.

import { getGsap } from "./gsap";

let flipPromise: Promise<typeof import("gsap/Flip").Flip> | null = null;
let flipRegistered = false;

export async function getFlip() {
  if (!flipPromise) {
    flipPromise = (async () => {
      const [gsap, { Flip }] = await Promise.all([
        getGsap(),
        import("gsap/Flip"),
      ]);
      if (!flipRegistered) {
        gsap.registerPlugin(Flip);
        flipRegistered = true;
      }
      return Flip;
    })();
  }
  return flipPromise;
}
