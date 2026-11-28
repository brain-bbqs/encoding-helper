import { mountHtml, readIndexHtml } from "@brain-bbqs/test-utils/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initTabs } from "../../src/ui/tabs";
import { setUrl } from "./helpers/url";

const INDEX_HTML = readIndexHtml();

/** The page itself, its tab bar and panels included, with one button added to the row of tabs that
 * names a tab the app does not have. */
function mountTabBar(): void {
  mountHtml(INDEX_HTML);
  const retired = document.createElement("button");
  retired.className = "tab";
  retired.dataset.tab = "nope";
  retired.textContent = "Retired";
  document.querySelector(".tabs")!.append(retired);
}

function click(tab: string): void {
  document.querySelector<HTMLButtonElement>(`[data-tab="${tab}"]`)!.click();
}

function shownPanel(): string | null {
  return document.querySelector(".tab-panel.on")?.id ?? null;
}

function litButtons(): (string | undefined)[] {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-tab].on")).map((b) => b.dataset.tab);
}

describe("initTabs", () => {
  beforeEach(() => {
    setUrl("");
    mountTabBar();
  });

  it("leaves the markup's own tab showing when the URL names none", () => {
    initTabs(() => {});
    expect(shownPanel()).toBe("panel-inspect");
    expect(new URL(window.location.href).searchParams.has("tab")).toBe(false);
  });

  it("opens the tab the URL names", () => {
    setUrl("?tab=compare");
    initTabs(() => {});
    expect(shownPanel()).toBe("panel-compare");
    expect(litButtons()).toEqual(["compare"]);
  });

  it("rewrites a link naming a retired tab to the tab its content moved to", () => {
    setUrl("?tab=seek");
    initTabs(() => {});
    expect(shownPanel()).toBe("panel-inspect");
    expect(new URL(window.location.href).searchParams.get("tab")).toBe("inspect");
  });

  // A name every object inherits used to come back as a function: no panel kept `on`, and the
  // function's source text was written into the address bar.
  it("treats a link naming an inherited object key like any other unknown tab", () => {
    setUrl("?tab=constructor");
    initTabs(() => {});
    expect(shownPanel()).toBe("panel-inspect");
    expect(new URL(window.location.href).searchParams.get("tab")).toBe("constructor");
  });

  it("shows one panel at a time and records the click in the address bar", () => {
    initTabs(() => {});
    click("encode");
    expect(shownPanel()).toBe("panel-encode");
    expect(litButtons()).toEqual(["encode"]);
    expect(new URL(window.location.href).searchParams.get("tab")).toBe("encode");
  });

  it("treats the Full Analysis button beside the row as one of the tabs", () => {
    const onShowAnalysis = vi.fn();
    initTabs(onShowAnalysis);
    click("analysis");
    expect(shownPanel()).toBe("panel-analysis");
    expect(litButtons()).toEqual(["analysis"]);
    expect(onShowAnalysis).toHaveBeenCalledOnce();
  });

  it("rebuilds the analysis document on every visit, since the other tabs add to it", () => {
    const onShowAnalysis = vi.fn();
    initTabs(onShowAnalysis);
    click("analysis");
    click("inspect");
    click("analysis");
    expect(onShowAnalysis).toHaveBeenCalledTimes(2);
  });

  it("ignores a button naming a tab the app does not have", () => {
    initTabs(() => {});
    click("nope");
    expect(shownPanel()).toBe("panel-inspect");
    expect(new URL(window.location.href).searchParams.has("tab")).toBe(false);
  });

  it("walks back through the tabs the reader visited", () => {
    initTabs(() => {});
    click("encode");
    setUrl("?tab=compare");
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(shownPanel()).toBe("panel-compare");
  });

  // What's New moves to its own fragment, and the demos page adds entries of its own: neither
  // changes the tab, so the analysis document is not rebuilt behind them.
  it("leaves the tab alone when a history step does not change it", () => {
    const onShowAnalysis = vi.fn();
    initTabs(onShowAnalysis);
    click("analysis");
    setUrl("?tab=analysis#changelog");
    window.dispatchEvent(new PopStateEvent("popstate"));
    setUrl("?demos&tab=analysis");
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(onShowAnalysis).toHaveBeenCalledOnce();
    expect(shownPanel()).toBe("panel-analysis");
  });

  it("still rebuilds the analysis document when a history step returns to it", () => {
    const onShowAnalysis = vi.fn();
    initTabs(onShowAnalysis);
    click("analysis");
    click("encode");
    setUrl("?tab=analysis");
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(onShowAnalysis).toHaveBeenCalledTimes(2);
    expect(shownPanel()).toBe("panel-analysis");
  });

  it("falls back to the default tab when the history entry names none", () => {
    initTabs(() => {});
    click("encode");
    setUrl("");
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(shownPanel()).toBe("panel-inspect");
  });
});
