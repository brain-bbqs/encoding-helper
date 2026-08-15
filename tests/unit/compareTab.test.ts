import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_MATRIX_PRESETS, MATRIX_PRESETS, MATRIX_QUALITIES } from "../../src/lib/qualityMatrix";
import { cli, encodeTest, resetState, state } from "../../src/lib/state";
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

beforeEach(() => {
  document.body.innerHTML = "";
  resetState();
  // The CLI settings deliberately survive resetState (they are the user's, not the file's), so the
  // one this file edits is put back by hand rather than leaking into the tests after it.
  cli.scale = 1;
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

  it("labels each resolution with the size it comes out at, and applies it to the CLI state", () => {
    const panel = renderTab();
    const scale = panel.querySelector<HTMLSelectElement>("#etScale")!;
    expect(scale.value).toBe("1");
    expect(Array.from(scale.options).map((o) => o.textContent)).toEqual([
      "Source (100%) (640×480)",
      "75% (480×360)",
      "50% (320×240)",
      "25% (160×120)",
    ]);
    scale.value = "0.5";
    scale.dispatchEvent(new Event("change"));
    expect(cli.scale).toBe(0.5);
  });

  it("keeps the resolution out of both mode blocks, since a sweep runs at one of them", () => {
    const panel = renderTab();
    const scale = panel.querySelector<HTMLSelectElement>("#etScale")!;
    expect(scale.closest(".compare-single-controls")).toBeNull();
    expect(scale.closest(".compare-matrix-controls")).toBeNull();
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

  it("folds the axis tick lists away behind a bar carrying what they come to", () => {
    const panel = renderTab();
    const settings = panel.querySelector<HTMLDetailsElement>(".matrix-settings")!;
    expect(settings.open).toBe(false);
    expect(settings.querySelector("summary")!.textContent).toContain("Settings to sweep");
    expect(panel.querySelector(".matrix-settings-count")!.textContent).toBe("4 × 6");
    // The lists themselves are inside it, not beside it.
    expect(axisBoxes(panel, "Quality levels")[0].closest(".matrix-settings")).toBe(settings);
  });

  it("records what the axes are ticked to as the next sweep's coverage", () => {
    const panel = renderTab();
    for (const box of axisBoxes(panel, "x264 presets").slice(1)) {
      box.checked = false;
      box.dispatchEvent(new Event("change"));
    }
    expect(encodeTest.matrix.presets).toEqual(["ultrafast"]);

    const slowest = axisBoxes(panel, "x264 presets").at(-1)!;
    slowest.checked = true;
    slowest.dispatchEvent(new Event("change"));
    expect(encodeTest.matrix.presets).toEqual(["ultrafast", "veryslow"]);

    for (const box of axisBoxes(panel, "Quality levels")) {
      box.checked = false;
      box.dispatchEvent(new Event("change"));
    }
    expect(encodeTest.matrix.qualities).toEqual([]);
    expect(panel.querySelector(".matrix-settings-count")!.textContent).toBe("0 × 2");
  });
});
