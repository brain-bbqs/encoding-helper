import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountInspectToc } from "../../src/ui/inspectToc";

/** The observers built during a test, so a case can fire one and see what it lit up. */
interface FakeObserver {
  observed: Element[];
  disconnected: boolean;
  fire(entries: unknown[]): void;
}

let observers: FakeObserver[] = [];

class StubIntersectionObserver implements FakeObserver {
  observed: Element[] = [];
  disconnected = false;
  constructor(private callback: (entries: unknown[]) => void) {
    observers.push(this);
  }
  observe(el: Element): void {
    this.observed.push(el);
  }
  disconnect(): void {
    this.disconnected = true;
  }
  unobserve(): void {}
  takeRecords(): [] {
    return [];
  }
  fire(entries: unknown[]): void {
    this.callback(entries);
  }
}

/** A panel of `titles` sections, as the Inspect renderers leave it. */
function panelWith(titles: string[]): HTMLElement {
  const panel = document.createElement("div");
  for (const title of titles) {
    const sec = document.createElement("div");
    sec.className = "section";
    const heading = document.createElement("h2");
    heading.textContent = title;
    sec.append(heading, document.createElement("p"));
    panel.append(sec);
  }
  document.body.append(panel);
  return panel;
}

function tocLinks(panel: HTMLElement): HTMLAnchorElement[] {
  return Array.from(panel.querySelectorAll<HTMLAnchorElement>(".inspect-toc a"));
}

beforeEach(() => {
  observers = [];
  vi.stubGlobal("IntersectionObserver", StubIntersectionObserver);
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("mountInspectToc", () => {
  it("builds the nav from the headings that are actually on the page", () => {
    const panel = panelWith(["File Overview", "Atom Map"]);
    mountInspectToc(panel);

    expect(tocLinks(panel).map((a) => a.textContent)).toEqual(["File Overview", "Atom Map"]);
    expect(tocLinks(panel).map((a) => a.getAttribute("href"))).toEqual(["#file-overview", "#atom-map"]);
    expect(panel.querySelector(".inspect-toc-title")!.textContent).toBe("On this page");
    expect(panel.querySelector(".inspect-toc")!.getAttribute("aria-label")).toBe("On this page");
  });

  it("moves what was already in the panel into the content column beside the nav", () => {
    const panel = panelWith(["File Overview"]);
    mountInspectToc(panel);

    expect(panel.children).toHaveLength(1);
    const layout = panel.firstElementChild!;
    expect(layout.className).toBe("inspect-layout");
    expect(layout.firstElementChild!.className).toBe("inspect-content");
    expect(layout.querySelector(".inspect-content > .section > h2")!.textContent).toBe("File Overview");
  });

  it("gives two sections that read the same distinct anchors", () => {
    const panel = panelWith(["Metadata", "Metadata", "Metadata"]);
    mountInspectToc(panel);
    expect(tocLinks(panel).map((a) => a.getAttribute("href"))).toEqual(["#metadata", "#metadata-2", "#metadata-3"]);
    expect(Array.from(panel.querySelectorAll("h2")).map((h) => h.id)).toEqual(["metadata", "metadata-2", "metadata-3"]);
  });

  it("leaves the panel alone when no file is loaded and there is nothing to link to", () => {
    const panel = document.createElement("div");
    panel.innerHTML = "<p>Load a file.</p>";
    mountInspectToc(panel);
    expect(panel.querySelector(".inspect-toc")).toBeNull();
    expect(panel.innerHTML).toBe("<p>Load a file.</p>");
  });

  it("marks the first section as the one being read before any scrolling", () => {
    const panel = panelWith(["File Overview", "Atom Map"]);
    mountInspectToc(panel);
    expect(tocLinks(panel).map((a) => a.classList.contains("on"))).toEqual([true, false]);
  });

  it("follows the last heading scrolled past the trigger line", () => {
    const panel = panelWith(["File Overview", "Atom Map", "Seeking"]);
    mountInspectToc(panel);
    const headings = Array.from(panel.querySelectorAll<HTMLHeadingElement>("h2"));
    // The first two have been scrolled above the line; the third is still below it.
    const tops = [10, 40, 400];
    headings.forEach((hd, i) => {
      hd.getBoundingClientRect = () => ({ top: tops[i] }) as DOMRect;
    });

    observers[0].fire([{}]);

    expect(tocLinks(panel).map((a) => a.classList.contains("on"))).toEqual([false, true, false]);
  });

  it("stays on the first section while the page is still above every heading", () => {
    const panel = panelWith(["File Overview", "Atom Map"]);
    mountInspectToc(panel);
    for (const hd of panel.querySelectorAll<HTMLHeadingElement>("h2")) {
      hd.getBoundingClientRect = () => ({ top: 500 }) as DOMRect;
    }
    observers[0].fire([{}]);
    expect(tocLinks(panel)[0].classList.contains("on")).toBe(true);
  });

  it("ignores an empty batch rather than moving the mark", () => {
    const panel = panelWith(["File Overview", "Atom Map"]);
    mountInspectToc(panel);
    observers[0].fire([]);
    expect(tocLinks(panel).map((a) => a.classList.contains("on"))).toEqual([true, false]);
  });

  it("drops the previous build's observer when the panel is rebuilt", () => {
    mountInspectToc(panelWith(["File Overview"]));
    mountInspectToc(panelWith(["File Overview"]));
    expect(observers.map((o) => o.disconnected)).toEqual([true, false]);
  });
});
