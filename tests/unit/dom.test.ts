import { beforeEach, describe, expect, it } from "vitest";
import { closeInfoPopovers, escapeHtml, gridItem, infoIcon } from "../../src/lib/dom";

describe("escapeHtml", () => {
  it("escapes every character that could break out of an attribute or element", () => {
    expect(escapeHtml(`<img src="x" onerror='alert(1)'>&`)).toBe(
      "&lt;img src=&quot;x&quot; onerror=&#39;alert(1)&#39;&gt;&amp;",
    );
  });

  it("leaves ordinary tag names alone", () => {
    expect(escapeHtml("©too")).toBe("©too");
  });
});

describe("gridItem", () => {
  it("renders a plain label and value with no info affordance", () => {
    const item = gridItem("Duration", "12.5 s");
    expect(item.querySelector("label")?.textContent).toBe("Duration");
    expect(item.querySelector(".val")?.textContent).toBe("12.5 s");
    expect(item.querySelector(".info")).toBeNull();
  });

  it("adds an info button as a sibling of the label, not a child of it", () => {
    const item = gridItem("Container", "MP4", { info: "<b>MP4</b> is a container." });
    const label = item.querySelector("label");
    expect(label?.querySelector(".info")).toBeNull();
    expect(item.querySelector(".item-head .info-btn")?.getAttribute("aria-label")).toBe("About Container");
    expect(item.querySelector(".info-pop")?.innerHTML).toBe("<b>MP4</b> is a container.");
  });

  it("keeps raw tag names out of the uppercase label styling", () => {
    expect(gridItem("©too", "Lavf60.16.100", { rawLabel: true }).querySelector("label")?.className).toBe("raw");
    expect(gridItem("Duration", "12.5 s").querySelector("label")?.className).toBe("");
  });
});

describe("infoIcon", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("toggles open on click and reports the state to assistive tech", () => {
    const icon = infoIcon("Explainer");
    document.body.append(icon);
    const btn = icon.querySelector<HTMLButtonElement>(".info-btn");

    btn?.click();
    expect(icon.classList.contains("open")).toBe(true);
    expect(btn?.getAttribute("aria-expanded")).toBe("true");

    btn?.click();
    expect(icon.classList.contains("open")).toBe(false);
    expect(btn?.getAttribute("aria-expanded")).toBe("false");
  });

  it("closes on a click elsewhere in the document", () => {
    const icon = infoIcon("Explainer");
    document.body.append(icon);
    icon.querySelector<HTMLButtonElement>(".info-btn")?.click();
    expect(icon.classList.contains("open")).toBe(true);

    document.body.click();
    expect(icon.classList.contains("open")).toBe(false);
  });

  it("stays open when the popover itself is clicked", () => {
    const icon = infoIcon('Explainer with a <a href="#x">link</a>');
    document.body.append(icon);
    icon.querySelector<HTMLButtonElement>(".info-btn")?.click();

    icon.querySelector<HTMLElement>(".info-pop")?.click();
    expect(icon.classList.contains("open")).toBe(true);
  });

  it("closes every open popover at once", () => {
    const first = infoIcon("One");
    const second = infoIcon("Two");
    document.body.append(first, second);
    first.querySelector<HTMLButtonElement>(".info-btn")?.click();
    second.querySelector<HTMLButtonElement>(".info-btn")?.click();
    // Opening the second one already dismissed the first.
    expect(first.classList.contains("open")).toBe(false);

    closeInfoPopovers();
    expect(second.classList.contains("open")).toBe(false);
    expect(second.querySelector(".info-btn")?.getAttribute("aria-expanded")).toBe("false");
  });
});
