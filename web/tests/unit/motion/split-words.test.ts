import { describe, it, expect, beforeEach } from "vitest";
import { splitWords } from "@/lib/motion/split-words";

describe("splitWords", () => {
  let host: HTMLElement;
  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  it("wraps each word in a span with class 'word'", () => {
    host.textContent = "Catch a depeg";
    const words = splitWords(host);
    expect(words.length).toBe(3);
    expect(words[0].textContent).toBe("Catch");
    expect(words[2].textContent).toBe("depeg");
    expect(words[0].className).toBe("word");
  });

  it("preserves <br> elements between text nodes", () => {
    host.innerHTML = "first<br/>second";
    splitWords(host);
    expect(host.querySelector("br")).not.toBeNull();
  });

  it("recursively splits inside nested inline elements", () => {
    host.innerHTML = `before <span class="iri">catches you.</span>`;
    const words = splitWords(host);
    const texts = Array.from(words).map((w) => w.textContent);
    expect(texts).toEqual(["before", "catches", "you."]);
    expect(host.querySelector(".iri")).not.toBeNull();
  });
});
