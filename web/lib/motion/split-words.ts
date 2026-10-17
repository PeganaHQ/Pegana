// Word-level text splitter. Free alternative to GSAP's paid SplitText for the
// reveal patterns we need. Preserves inline element structure (e.g., .iri spans).
//
// Returns the array of word spans in document order — pass directly to gsap.from().

export function splitWords(el: HTMLElement): HTMLSpanElement[] {
  function walk(node: Node, accumulator: Node[]): void {
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        const parts = (child.textContent ?? "").split(/(\s+)/);
        parts.forEach((part) => {
          if (part === "") return;
          if (/^\s+$/.test(part)) {
            accumulator.push(document.createTextNode(part));
          } else {
            const span = document.createElement("span");
            span.className = "word";
            span.style.display = "inline-block";
            span.textContent = part;
            accumulator.push(span);
          }
        });
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const element = child as HTMLElement;
        if (element.tagName === "BR") {
          accumulator.push(element.cloneNode(true));
        } else {
          const clone = element.cloneNode(false) as HTMLElement;
          const inner: Node[] = [];
          walk(element, inner);
          inner.forEach((n) => clone.appendChild(n));
          accumulator.push(clone);
        }
      }
    });
  }

  const out: Node[] = [];
  walk(el, out);
  el.innerHTML = "";
  out.forEach((n) => el.appendChild(n));
  return Array.from(el.querySelectorAll<HTMLSpanElement>("span.word"));
}
