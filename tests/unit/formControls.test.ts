import { describe, expect, it } from "vitest";
import { fieldSelect } from "../../src/ui/formControls";

const OPTIONS: [string, string][] = [
  ["superfast", "superfast"],
  ["veryslow", "veryslow"],
];

describe("fieldSelect", () => {
  it("builds a labelled select with the current value chosen", () => {
    const field = fieldSelect("etPreset", "x264 Preset", OPTIONS, "veryslow");
    expect(field.querySelector("label")!.textContent).toBe("x264 Preset");
    const select = field.querySelector("select")!;
    expect(select.id).toBe("etPreset");
    expect(select.value).toBe("veryslow");
  });

  it("leaves the label bare when there is nothing to explain", () => {
    const field = fieldSelect("etPreset", "x264 Preset", OPTIONS, "superfast");
    expect(field.querySelector(".field-head")).toBeNull();
    expect(field.querySelector(".info-btn")).toBeNull();
  });

  it("puts an ⓘ beside the label when given explainer copy", () => {
    const field = fieldSelect("etPreset", "x264 Preset", OPTIONS, "superfast", "<b>Preset</b> sets how hard…");
    const head = field.querySelector(".field-head")!;
    expect(head.querySelector("label")!.textContent).toBe("x264 Preset");
    expect(head.querySelector(".info-btn")!.getAttribute("aria-label")).toBe("About x264 Preset");
    expect(head.querySelector(".info-pop")!.innerHTML).toBe("<b>Preset</b> sets how hard…");
    // The control itself is unchanged by the explainer.
    expect(field.querySelector("select")!.value).toBe("superfast");
  });
});
