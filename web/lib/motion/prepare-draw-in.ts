// Sets a path up for GSAP "draw-in" animation via stroke-dasharray trick.
// Equivalent of DrawSVG plugin (paid) for our simple use case.
//
// Usage:
//   const lengths = prepareDrawIn(svgEl.querySelectorAll("path"));
//   gsap.to(paths, { strokeDashoffset: 0, duration: 1, ease: "power2.out" });

export function prepareDrawIn(paths: ArrayLike<SVGPathElement>): number[] {
  const lengths: number[] = [];
  Array.from(paths).forEach((path) => {
    const len = path.getTotalLength();
    path.style.strokeDasharray = String(len);
    path.style.strokeDashoffset = String(len);
    lengths.push(len);
  });
  return lengths;
}
