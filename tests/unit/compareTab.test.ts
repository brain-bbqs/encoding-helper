import { beforeEach, describe, expect, it } from "vitest";
import {
  buildMatrixCombos,
  DEFAULT_MATRIX_PRESETS,
  makeMatrixCells,
  MATRIX_PRESETS,
  MATRIX_QUALITIES,
} from "../../src/lib/qualityMatrix";
import { cli, encodeTest, resetState, state } from "../../src/lib/state";
import type { TrackInfo } from "../../src/lib/types";
import { renderCompareTab } from "../../src/ui/compareTab";

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
 * tab reaches for its fields by class, the way the app's own panels are already in the page. */
function renderTab(): HTMLElement {
  state.tracks = [VIDEO_TRACK];
  state.duration = 20;
  const panel = document.createElement("div");
  document.body.append(panel);
  renderCompareTab(panel);
  return panel;
}

function axisBoxes(panel: HTMLElement, label: string): HTMLInputElement[] {
  const field = Array.from(panel.querySelectorAll<HTMLElement>(".field")).find(
    (f) => f.querySelector(".field-label")?.textContent === label,
  );
  return Array.from(field?.querySelectorAll<HTMLInputElement>('input[type="checkbox"]') ?? []);
}

function runButton(panel: HTMLElement): HTMLButtonElement {
  return panel.querySelector<HTMLButtonElement>(".compare-run-buttons button")!;
}

beforeEach(() => {
  document.body.innerHTML = "";
  resetState();
  // The CLI settings deliberately survive resetState (they are the user's, not the file's), so the
  // ones this file edits are put back by hand rather than leaking into the tests after it.
  cli.quality = "medium";
  cli.crf = 25;
  cli.preset = "superfast";
  cli.scale = 1;
  cli.scaler = "lanczos";
  encodeTest.segments = 5;
  encodeTest.matrix.scales = [1];
  encodeTest.matrix.scalers = ["lanczos"];
});

describe("renderCompareTab", () => {
  it("renders nothing without a video track", () => {
    state.tracks = [];
    const panel = document.createElement("div");
    renderCompareTab(panel);
    expect(panel.children).toHaveLength(0);
  });

  // One setting at a time is the Reencode with FFmpeg tab's job now, so there is no mode to pick
  // and no second copy of the quality/preset dropdowns to keep in step with the builder.
  it("offers the sweep alone, without a mode control or the single-run dropdowns", () => {
    const panel = renderTab();
    expect(panel.querySelector("#etMode")).toBeNull();
    expect(panel.querySelector("#etQuality")).toBeNull();
    expect(panel.querySelector("#etPreset")).toBeNull();
    expect(panel.querySelector("#etScale")).toBeNull();
    expect(panel.querySelector("#etScaler")).toBeNull();
    expect(runButton(panel).textContent).toBe("Run Matrix");
  });

  it("offers resolution and the scaler as sweep axes", () => {
    const panel = renderTab();
    expect(axisBoxes(panel, "Resolutions")).toHaveLength(4);
    expect(axisBoxes(panel, "Scalers")).toHaveLength(2);
    expect(axisBoxes(panel, "Resolutions")[0].closest(".matrix-settings")).not.toBeNull();
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
    expect(panel.querySelector<HTMLInputElement>("#etDuration")!.value).toBe("5");
    const segments = panel.querySelector<HTMLInputElement>("#etSegments")!;
    expect(segments.value).toBe("5");
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

  // One button, saying what pressing it would do to the grid as it stands: a sweep that left holes
  // is asking to have those filled, not to be run again from the top.
  it("turns the run button into the one that fills a swept grid's holes", () => {
    encodeTest.matrix.cells = makeMatrixCells(buildMatrixCombos(["high", "low"], ["fast"], [1], ["lanczos"]));
    expect(runButton(renderTab()).textContent).toBe("Run Matrix");

    encodeTest.matrix.cells[0].status = "failed";
    expect(runButton(renderTab()).textContent).toBe("Retry 1 failed");

    encodeTest.matrix.cells[1].status = "skipped";
    expect(runButton(renderTab()).textContent).toBe("Run 2 unmeasured");
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

// The sweep ranks settings; the command is how the winner leaves the browser and reaches the file.
describe("the command for the selected square", () => {
  /** A finished grid with one square showing in the A/B window. */
  function sweptWith(quality: "high" | "low", preset: "fast", scale = 1): void {
    encodeTest.matrix.cells = makeMatrixCells(buildMatrixCombos([quality], [preset], [scale], ["lanczos"]));
    const cell = encodeTest.matrix.cells[0];
    cell.status = "done";
    cell.bytes = 1024;
    encodeTest.matrix.selectedKey = cell.combo.key;
  }

  it("stays out of the page until a square is showing", () => {
    const panel = renderTab();
    expect(panel.querySelector("pre.cmd")).toBeNull();
  });

  it("writes the square's own quality, preset and resolution into the command", () => {
    sweptWith("low", "fast", 0.5);
    const panel = renderTab();
    const command = panel.querySelector("pre.cmd")!.textContent!;
    expect(command).toContain("-crf 32");
    expect(command).toContain("-preset fast");
    expect(command).toContain("scale=trunc(iw*0.5/2)*2:-2:flags=lanczos");
  });

  // Everything the sweep does not vary comes from the builder, so the command runs the same encode
  // the tab next door is set up for rather than a partial one.
  it("takes the settings the sweep does not vary from the command builder", () => {
    cli.audioMode = "strip";
    cli.faststart = true;
    sweptWith("high", "fast");
    const panel = renderTab();
    const command = panel.querySelector("pre.cmd")!.textContent!;
    expect(command).toContain("-crf 18");
    expect(command).toContain("-an");
    expect(command).toContain("+faststart");
    cli.audioMode = "copy";
    cli.faststart = false;
  });
});
