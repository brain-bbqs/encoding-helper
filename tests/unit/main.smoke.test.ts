// @vitest-environment jsdom
// Boots the real src/main.ts against the real index.html with nothing loaded, and drives the page's
// own wiring: the version stamp, the intro card and the Educational switch, the theme toggle, the
// sweep-cache button and the What's New modal fed from the real CHANGELOG.md.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { countChangelogVersions } from "@brain-bbqs/ui";
import { throwingStorage } from "@brain-bbqs/test-utils/vitest";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { isEducationalEnabled, setEducationalEnabled } from "../../src/lib/educational";
import { matrixCache } from "../../src/lib/matrixCache";
import { THEME_KEY } from "../../src/lib/settings";
import { bootMain, el } from "./helpers/mainHarness";

const CHANGELOG = readFileSync(resolve(process.cwd(), "CHANGELOG.md"), "utf-8");
const VERSIONS = [...CHANGELOG.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
const RECENT_VERSIONS = 3;

function renderedVersions(): string[] {
  return Array.from(el("whats-new-content").querySelectorAll(".changelog-version h3"), (h) => h.textContent ?? "");
}

beforeAll(async () => {
  await bootMain();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("main.ts boot", () => {
  it("stamps the version into the footer link", () => {
    expect(el("version-indicator").textContent).toBe(`v${__APP_VERSION__}`);
    expect(el("version-indicator").textContent).toMatch(/^v\d+\.\d+\.\d+/);
  });

  it("opens on the drop zone, with the file view and the demos page hidden", () => {
    expect(el("dropZone").style.display).toBe("");
    expect(el("app").style.display).toBe("none");
    expect(el("demosPage").style.display).toBe("none");
  });

  it("puts the intro card up before any file, and the Educational switch in the header", () => {
    expect(el("introCard").querySelector(".teach-icon")?.textContent).toBe("🎓");
    expect(el("introCard").textContent).toContain("BBQS Encoding Helper");
    const input = el("eduToggleSlot").querySelector<HTMLInputElement>("input.switch");
    expect(input?.checked).toBe(true);
  });

  it("redraws the intro card when the switch flips, leaving the empty panels alone", () => {
    const input = el("eduToggleSlot").querySelector<HTMLInputElement>("input.switch")!;
    input.checked = false;
    input.dispatchEvent(new Event("change"));
    expect(isEducationalEnabled()).toBe(false);
    expect(el("introCard").querySelector(".teach")?.classList.contains("edu-off")).toBe(true);
    expect(el("panel-inspect").childElementCount).toBe(0);

    setEducationalEnabled(true);
    expect(el("introCard").querySelector(".teach-icon")?.textContent).toBe("🎓");
    expect(el("panel-inspect").childElementCount).toBe(0);
  });

  it("flips the theme from the header toggle and remembers the choice", () => {
    // The harness's matchMedia reports a light OS preference and nothing is stored, so the first
    // click lands on dark.
    el("themeToggle").click();
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem(THEME_KEY)).toBe("dark");
    el("themeToggle").click();
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem(THEME_KEY)).toBe("light");
  });

  it("still flips the theme when storage refuses the write, and warns rather than throws", () => {
    const restoreStorage = throwingStorage();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      el("themeToggle").click();
      expect(document.documentElement.dataset.theme).toBe("dark");
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith("Could not save theme preference:", expect.any(Error));
    } finally {
      restoreStorage();
      warn.mockRestore();
      el("themeToggle").click();
    }
  });

  it("clears the sweep cache from the footer, saying so for a moment before putting the label back", async () => {
    let finish!: () => void;
    const clear = vi.spyOn(matrixCache, "clear").mockReturnValue(new Promise<void>((r) => (finish = r)));
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const btn = el<HTMLButtonElement>("clear-matrix-cache-btn");
    const label = btn.textContent;
    try {
      btn.click();
      expect(clear).toHaveBeenCalledTimes(1);
      expect(btn.disabled).toBe(true);
      expect(btn.textContent).toBe("Sweep cache cleared");

      finish();
      // A macrotask lets the clear's promise chain settle; only setTimeout is faked.
      await new Promise((r) => setImmediate(r));
      expect(vi.getTimerCount()).toBe(1);
      vi.advanceTimersByTime(1499);
      expect(btn.disabled).toBe(true);
      vi.advanceTimersByTime(1);
      expect(btn.disabled).toBe(false);
      expect(btn.textContent).toBe(label);
    } finally {
      clear.mockRestore();
    }
  });
});

describe("What's New", () => {
  const modal = (): HTMLDialogElement => el<HTMLDialogElement>("whats-new-modal");

  it("renders the latest versions of the real CHANGELOG.md, with Show more for the rest", () => {
    expect(VERSIONS.length).toBe(countChangelogVersions(CHANGELOG));
    expect(renderedVersions()).toEqual(VERSIONS.slice(0, RECENT_VERSIONS));
    expect(el("whats-new-show-more").hidden).toBe(VERSIONS.length <= RECENT_VERSIONS);
    expect(modal().open).toBe(false);
  });

  it("opens from the footer link and closes on ×, tracking the #changelog fragment", async () => {
    el("whats-new-button").click();
    expect(modal().open).toBe(true);
    expect(window.location.hash).toBe("#changelog");

    el("whats-new-close").click();
    expect(modal().open).toBe(false);
    await vi.waitFor(() => expect(window.location.hash).toBe(""));
  });

  it("opens when the page is pointed at #changelog, and closes on Escape", async () => {
    window.location.hash = "changelog";
    await vi.waitFor(() => expect(modal().open).toBe(true));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(modal().open).toBe(false);
    await vi.waitFor(() => expect(window.location.hash).toBe(""));
  });

  it("closes on a backdrop click, but not on a click inside the modal", async () => {
    el("whats-new-button").click();
    el("whats-new-content").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(modal().open).toBe(true);
    modal().dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(modal().open).toBe(false);
    await vi.waitFor(() => expect(window.location.hash).toBe(""));
  });

  it("swaps in every version on Show more and hides the button", () => {
    el("whats-new-show-more").click();
    expect(renderedVersions()).toEqual(VERSIONS);
    expect(el("whats-new-show-more").hidden).toBe(true);
  });
});
