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

/** Both modes are on screen at once, as a segmented control rather than a dropdown. */
function modeButton(panel: HTMLElement, value: string): HTMLButtonElement {
  return panel.querySelector<HTMLButtonElement>(`#etMode button[data-value="${value}"]`)!;
}

function pickMode(panel: HTMLElement, value: string): void {
  modeButton(panel, value).click();
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
  // ones this file edits are put back by hand rather than leaking into the tests after it.
  cli.scale = 1;
  cli.scaler = "lanczos";
  encodeTest.segments = 1;
  encodeTest.matrix.scales = [1];
  encodeTest.matrix.scalers = ["lanczos"];
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
    expect(modeButton(panel, "single").classList.contains("active")).toBe(true);
    expect(panel.querySelector<HTMLElement>(".compare-single-controls")!.style.display).toBe("");
    expect(panel.querySelector<HTMLElement>(".compare-matrix-controls")!.style.display).toBe("none");
    expect(panel.querySelector(".compare-run-buttons button")!.textContent).toBe("Run Comparison");
  });

  it("swaps the controls and the button when matrix mode is picked", () => {
    const panel = renderTab();
    pickMode(panel, "matrix");
    expect(encodeTest.mode).toBe("matrix");
    expect(panel.querySelector<HTMLElement>(".compare-single-controls")!.style.display).toBe("none");
    expect(panel.querySelector<HTMLElement>(".compare-matrix-controls")!.style.display).toBe("");
    expect(panel.querySelector(".compare-run-buttons button")!.textContent).toBe("Run Matrix");
    // The quality/preset dropdowns stay in the DOM so the Reencode tab can still sync them.
    expect(panel.querySelector("#etQuality")).not.toBeNull();
    // Both modes stay readable side by side, so the alternative needs no click to see.
    expect(panel.querySelectorAll("#etMode button")).toHaveLength(2);
    expect(modeButton(panel, "single").classList.contains("active")).toBe(false);
    expect(modeButton(panel, "matrix").getAttribute("aria-pressed")).toBe("true");
    expect(modeButton(panel, "single").getAttribute("aria-pressed")).toBe("false");
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

  // The kernel resamples nothing at 100%, so the field only appears once there is a downscale.
  it("shows the scaler field only when the resolution is below the source's", () => {
    const panel = renderTab();
    const scaler = panel.querySelector<HTMLSelectElement>("#etScaler")!;
    expect(scaler.value).toBe("lanczos");
    expect(scaler.parentElement!.style.display).toBe("none");

    const scale = panel.querySelector<HTMLSelectElement>("#etScale")!;
    scale.value = "0.5";
    scale.dispatchEvent(new Event("change"));
    expect(scaler.parentElement!.style.display).toBe("");

    scaler.value = "bicubic";
    scaler.dispatchEvent(new Event("change"));
    expect(cli.scaler).toBe("bicubic");
  });

  // The dropdown sets one run's resolution; a sweep asks for it as an axis instead.
  it("keeps the resolution dropdowns to single mode and offers them as axes in matrix mode", () => {
    const panel = renderTab();
    expect(panel.querySelector("#etScale")!.closest(".compare-single-controls")).not.toBeNull();
    expect(axisBoxes(panel, "Resolutions")).toHaveLength(4);
    expect(axisBoxes(panel, "Scalers")).toHaveLength(2);
    expect(axisBoxes(panel, "Resolutions")[0].closest(".compare-matrix-controls")).not.toBeNull();
  });

  it("sweeps the source resolution with one kernel until told otherwise", () => {
    const panel = renderTab();
    const ticked = (label: string): string[] =>
      axisBoxes(panel, label)
        .filter((b) => b.checked)
        .map((b) => b.value);
    expect(ticked("Resolutions")).toEqual(["1"]);
    expect(ticked("Scalers")).toEqual(["lanczos"]);
    // One value each multiplies the sweep by one, so the bar keeps naming the two axes it always did.
    expect(panel.querySelector(".matrix-settings-count")!.textContent).toBe("4 × 6");
  });

  it("records ticked resolutions as the next sweep's coverage, and counts them in the bar", () => {
    const panel = renderTab();
    const half = axisBoxes(panel, "Resolutions").find((b) => b.value === "0.5")!;
    half.checked = true;
    half.dispatchEvent(new Event("change"));
    expect(encodeTest.matrix.scales).toEqual([1, 0.5]);
    expect(panel.querySelector(".matrix-settings-count")!.textContent).toBe("4 × 6 × 2");

    const bicubic = axisBoxes(panel, "Scalers").find((b) => b.value === "bicubic")!;
    bicubic.checked = true;
    bicubic.dispatchEvent(new Event("change"));
    expect(encodeTest.matrix.scalers).toEqual(["lanczos", "bicubic"]);
    expect(panel.querySelector(".matrix-settings-count")!.textContent).toBe("4 × 6 × 2 × 2");
  });

  // A second kernel resamples nothing while every ticked resolution is the source's, so it does not
  // multiply the sweep and the bar does not claim it does.
  it("leaves the kernel axis out of the count when no downscale is ticked", () => {
    const panel = renderTab();
    const bicubic = axisBoxes(panel, "Scalers").find((b) => b.value === "bicubic")!;
    bicubic.checked = true;
    bicubic.dispatchEvent(new Event("change"));
    expect(panel.querySelector(".matrix-settings-count")!.textContent).toBe("4 × 6");
  });

  // Where a stretch lands is the sampler's call, so there is no start field to offer at all.
  it("asks for a duration and a count, and nothing about placement", () => {
    const panel = renderTab();
    expect(panel.querySelector("#etStart")).toBeNull();
    expect(panel.querySelector<HTMLInputElement>("#etDuration")!.value).toBe("3");
    const segments = panel.querySelector<HTMLInputElement>("#etSegments")!;
    expect(segments.value).toBe("1");
    segments.value = "4";
    segments.dispatchEvent(new Event("input"));
    expect(encodeTest.segments).toBe(4);
  });

  it("holds the segment count inside what a run can sensibly encode", () => {
    const panel = renderTab();
    const segments = panel.querySelector<HTMLInputElement>("#etSegments")!;
    segments.value = "99";
    segments.dispatchEvent(new Event("input"));
    expect(encodeTest.segments).toBe(10);
    segments.value = "0";
    segments.dispatchEvent(new Event("input"));
    expect(encodeTest.segments).toBe(1);
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
