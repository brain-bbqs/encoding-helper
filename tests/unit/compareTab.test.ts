import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_MATRIX_PRESETS, MATRIX_PRESETS, MATRIX_QUALITIES } from "../../src/lib/qualityMatrix";
import { encodeTest, resetState, state } from "../../src/lib/state";
import type { TrackInfo } from "../../src/lib/types";
import { renderEncodeTestTab } from "../../src/ui/compareTab";

const VIDEO_TRACK: TrackInfo = {
  kind: "video",
  codec: "avc",
  codecString: "avc1.640020",
  codecInfo: null,
  packetCount: 600,
  packetRate: 30,
  bitrate: 500_000,
  codedWidth: 640,
  codedHeight: 480,
};

/** The tab, rendered over one loaded 20-second file. The panel goes into the document because the
 * tab binds its fields by id, the way the app's own panels are already in the page. */
function renderTab(): HTMLElement {
  state.tracks = [VIDEO_TRACK];
  state.duration = 20;
  const panel = document.createElement("div");
  document.body.append(panel);
  renderEncodeTestTab(panel);
  return panel;
}

function axisBoxes(panel: HTMLElement, label: string): HTMLInputElement[] {
  const field = Array.from(panel.querySelectorAll<HTMLElement>(".field")).find(
    (f) => f.querySelector(".field-label")?.textContent === label,
  );
  return Array.from(field?.querySelectorAll<HTMLInputElement>('input[type="checkbox"]') ?? []);
}

function hint(panel: HTMLElement): string {
  return panel.querySelector(".field.hint")?.textContent ?? "";
}

beforeEach(() => {
  document.body.innerHTML = "";
  resetState();
});

describe("renderEncodeTestTab", () => {
  it("renders nothing without a video track", () => {
    state.tracks = [];
    const panel = document.createElement("div");
    renderEncodeTestTab(panel);
    expect(panel.children).toHaveLength(0);
  });

  it("opens on the single-setting controls, with the matrix ones out of the way", () => {
    const panel = renderTab();
    expect(panel.querySelector<HTMLSelectElement>("#etMode")!.value).toBe("single");
    expect(panel.querySelector<HTMLElement>(".compare-single-controls")!.style.display).toBe("");
    expect(panel.querySelector<HTMLElement>(".compare-matrix-controls")!.style.display).toBe("none");
    expect(panel.querySelector(".compare-run-buttons button")!.textContent).toBe("Run Comparison");
  });

  it("swaps the controls and the button when matrix mode is picked", () => {
    const panel = renderTab();
    const mode = panel.querySelector<HTMLSelectElement>("#etMode")!;
    mode.value = "matrix";
    mode.dispatchEvent(new Event("change"));
    expect(encodeTest.mode).toBe("matrix");
    expect(panel.querySelector<HTMLElement>(".compare-single-controls")!.style.display).toBe("none");
    expect(panel.querySelector<HTMLElement>(".compare-matrix-controls")!.style.display).toBe("");
    expect(panel.querySelector(".compare-run-buttons button")!.textContent).toBe("Run Matrix");
    // The quality/preset dropdowns stay in the DOM so the Reencode tab can still sync them.
    expect(panel.querySelector("#etQuality")).not.toBeNull();
  });

  it("ticks every quality and the faster presets to begin with", () => {
    const panel = renderTab();
    const ticked = (label: string): string[] =>
      axisBoxes(panel, label)
        .filter((b) => b.checked)
        .map((b) => b.value);
    expect(ticked("Quality levels")).toEqual(MATRIX_QUALITIES);
    expect(ticked("x264 presets")).toEqual(DEFAULT_MATRIX_PRESETS);
    // The slow end is offered, just not run unasked.
    expect(axisBoxes(panel, "x264 presets")).toHaveLength(MATRIX_PRESETS.length);
  });

  it("counts the combinations a sweep would run as the axes are ticked", () => {
    const panel = renderTab();
    expect(hint(panel)).toBe("24 combinations × 3.0s of video");

    const presets = axisBoxes(panel, "x264 presets");
    for (const box of presets.slice(1)) {
      box.checked = false;
      box.dispatchEvent(new Event("change"));
    }
    expect(encodeTest.matrix.presets).toEqual(["ultrafast"]);
    expect(hint(panel)).toBe("4 combinations × 3.0s of video");

    const qualities = axisBoxes(panel, "Quality levels");
    for (const box of qualities) {
      box.checked = false;
      box.dispatchEvent(new Event("change"));
    }
    expect(hint(panel)).toBe("Tick at least one quality and one preset.");
  });

  it("warns when the sweep gets long, and follows the segment length", () => {
    const panel = renderTab();
    for (const box of axisBoxes(panel, "x264 presets")) {
      box.checked = true;
      box.dispatchEvent(new Event("change"));
    }
    const hintEl = panel.querySelector<HTMLElement>(".field.hint")!;
    expect(hintEl.textContent).toContain("36 combinations");
    expect(hintEl.classList.contains("warn-hint")).toBe(true);

    const duration = panel.querySelector<HTMLInputElement>("#etDuration")!;
    duration.value = "5";
    duration.dispatchEvent(new Event("input"));
    expect(hintEl.textContent).toContain("× 5.0s of video");
  });
});
