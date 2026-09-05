import { beforeEach, describe, expect, it, vi } from "vitest";
import { initTabs } from "../../src/ui/tabs";

/** The tab bar as index.html has it: the row of tab buttons, the Full Analysis button beside it,
 * and one panel each. */
function mountTabBar(): void {
  document.body.innerHTML = `
    <div class="tabs">
      <button class="tab on" data-tab="inspect">Inspect</button>
      <button class="tab" data-tab="encode">Encode</button>
      <button class="tab" data-tab="compare">Compare</button>
      <button class="tab" data-tab="nope">Retired</button>
      <button id="analysisBtn" data-tab="analysis">Full Analysis</button>
    </div>
    <div id="panel-inspect" class="tab-panel on"></div>
    <div id="panel-encode" class="tab-panel"></div>
    <div id="panel-compare" class="tab-panel"></div>
    <div id="panel-analysis" class="tab-panel"></div>`;
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

function setUrl(search: string): void {
  window.history.replaceState({}, "", "/encoding-helper/" + search);
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

  it("falls back to the default tab when the history entry names none", () => {
    initTabs(() => {});
    click("encode");
    setUrl("");
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(shownPanel()).toBe("panel-inspect");
  });
});
