import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildMatrixCombos,
  DEFAULT_MATRIX_PRESETS,
  DEFAULT_MATRIX_QUALITIES,
  DEFAULT_MATRIX_SCALES,
  describeSettings,
  makeMatrixCells,
  MATRIX_PRESETS,
  MATRIX_QUALITIES,
  MATRIX_SCALERS,
  MATRIX_SCALES,
} from "../../src/lib/qualityMatrix";
import { cli, encodeTest, resetState, state } from "../../src/lib/state";
import type { MatrixCell, TrackInfo } from "../../src/lib/types";

/** Settles the A/B window's load, so a test can hold a chosen square half-way into the window and
 * look at the grid while it is there. */
let settleAbLoad: { resolve: () => void; reject: (err: Error) => void } | null = null;

// The A/B window decodes with mediabunny, which is not the part of choosing a square under test
// here: what matters is what the grid does before and after the window has the square.
vi.mock("../../src/ui/abPanel", () => ({
  onAbDisplaced: () => {},
  loadEncodedIntoAB: () =>
    new Promise<void>((resolve, reject) => {
      settleAbLoad = { resolve, reject };
    }),
}));

const { renderCompareTab } = await import("../../src/ui/compareTab");

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
  settleAbLoad = null;
  resetState();
  // The CLI settings deliberately survive resetState (they are the user's, not the file's), so the
  // ones this file edits are put back by hand rather than leaking into the tests after it.
  cli.quality = "medium";
  cli.crf = 25;
  cli.preset = "superfast";
  cli.scale = 1;
  cli.scaler = "lanczos";
  encodeTest.segments = 5;
});

// A square left half-way into the A/B window holds the tab's one encoder, which the next test would
// then find already busy.
afterEach(async () => {
  settleAbLoad?.resolve();
  settleAbLoad = null;
  await new Promise((resolve) => setTimeout(resolve, 0));
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

  it("sweeps the first two resolutions with one kernel until told otherwise", () => {
    const panel = renderTab();
    const ticked = (label: string): string[] =>
      axisBoxes(panel, label)
        .filter((b) => b.checked)
        .map((b) => b.value);
    expect(ticked("Resolutions")).toEqual(["1", "0.75"]);
    expect(ticked("Scalers")).toEqual(["lanczos"]);
    // One kernel multiplies the sweep by one, so the bar counts the resolutions but not it.
    expect(panel.querySelector(".matrix-settings-count")!.textContent).toBe("2 × 5 × 2 = 20 runs");
  });

  // The rate axis starts at the source's own, so a sweep costs what it always did until a reduction
  // is asked for.
  it("offers frame rates as an axis, ticked to the source alone", () => {
    const panel = renderTab();
    const boxes = axisBoxes(panel, "Frame rates");
    expect(boxes).toHaveLength(3);
    expect(boxes.filter((b) => b.checked).map((b) => b.value)).toEqual(["1"]);
    expect(encodeTest.matrix.fpsFractions).toEqual([1]);
  });

  it("multiplies the sweep by every rate ticked beyond the source's", () => {
    const panel = renderTab();
    const half = axisBoxes(panel, "Frame rates").find((b) => b.value === "0.5")!;
    half.checked = true;
    half.dispatchEvent(new Event("change"));
    expect(encodeTest.matrix.fpsFractions).toEqual([1, 0.5]);
    expect(panel.querySelector(".matrix-settings-count")!.textContent).toBe("2 × 5 × 2 × 2 = 40 runs");
  });

  it("records ticked resolutions as the next sweep's coverage, and counts them in the bar", () => {
    const panel = renderTab();
    const half = axisBoxes(panel, "Resolutions").find((b) => b.value === "0.5")!;
    half.checked = true;
    half.dispatchEvent(new Event("change"));
    expect(encodeTest.matrix.scales).toEqual([1, 0.75, 0.5]);
    expect(panel.querySelector(".matrix-settings-count")!.textContent).toBe("2 × 5 × 3 = 30 runs");

    const bicubic = axisBoxes(panel, "Scalers").find((b) => b.value === "bicubic")!;
    bicubic.checked = true;
    bicubic.dispatchEvent(new Event("change"));
    expect(encodeTest.matrix.scalers).toEqual(["lanczos", "bicubic"]);
    expect(panel.querySelector(".matrix-settings-count")!.textContent).toBe("2 × 5 × 3 × 2 = 60 runs");
  });

  // A second kernel resamples nothing while every ticked resolution is the source's, so it does not
  // multiply the sweep and the bar does not claim it does.
  it("leaves the kernel axis out of the count when no downscale is ticked", () => {
    const panel = renderTab();
    const threeQuarters = axisBoxes(panel, "Resolutions").find((b) => b.value === "0.75")!;
    threeQuarters.checked = false;
    threeQuarters.dispatchEvent(new Event("change"));
    const bicubic = axisBoxes(panel, "Scalers").find((b) => b.value === "bicubic")!;
    bicubic.checked = true;
    bicubic.dispatchEvent(new Event("change"));
    expect(panel.querySelector(".matrix-settings-count")!.textContent).toBe("2 × 5 = 10 runs");
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

  // Stop (or a failed square) leaves holes the run button offers to fill back into the same grid —
  // but only while that grid is still what the checkboxes ask for. Once the sweep is edited, filling
  // the old holes back in would resume into a shape nobody ticked anymore.
  it("drops a stopped sweep's grid once the ticked axes move away from it, instead of resuming into the old shape", () => {
    encodeTest.matrix.qualities = ["high", "low"];
    encodeTest.matrix.presets = ["fast"];
    encodeTest.matrix.cells = makeMatrixCells(buildMatrixCombos(["high", "low"], ["fast"], [1], ["lanczos"]));
    encodeTest.matrix.cells[0].status = "done";
    encodeTest.matrix.cells[0].bytes = 100;
    encodeTest.matrix.cells[1].status = "skipped"; // what Stop leaves behind
    encodeTest.matrix.selectedKey = encodeTest.matrix.cells[0].combo.key;

    const panel = renderTab();
    expect(runButton(panel).textContent).toBe("Run 1 unmeasured");
    expect(panel.querySelector(".matrix-section h2")).not.toBeNull();

    // Adjust the sweep: tick a preset that was not part of the stopped run.
    const mediumBox = axisBoxes(panel, "x264 presets").find((b) => b.value === "medium")!;
    mediumBox.checked = true;
    mediumBox.dispatchEvent(new Event("change"));

    expect(encodeTest.matrix.cells).toEqual([]);
    expect(encodeTest.matrix.selectedKey).toBeNull();
    expect(runButton(panel).textContent).toBe("Run Matrix");
    expect((panel.querySelector(".matrix-section") as HTMLElement).style.display).toBe("none");
  });

  it("ticks the middle qualities, the faster presets, and the first resolution drop to begin with", () => {
    const panel = renderTab();
    const ticked = (label: string): string[] =>
      axisBoxes(panel, label)
        .filter((b) => b.checked)
        .map((b) => b.value);
    expect(ticked("Quality levels")).toEqual(DEFAULT_MATRIX_QUALITIES);
    expect(ticked("x264 presets")).toEqual(DEFAULT_MATRIX_PRESETS);
    expect(ticked("Resolutions")).toEqual(DEFAULT_MATRIX_SCALES.map(String));
    // The extremes are offered, just not run unasked.
    expect(axisBoxes(panel, "Quality levels")).toHaveLength(MATRIX_QUALITIES.length);
    expect(axisBoxes(panel, "x264 presets")).toHaveLength(MATRIX_PRESETS.length);
  });

  it("folds the axis tick lists away behind a bar carrying what they come to", () => {
    const panel = renderTab();
    const settings = panel.querySelector<HTMLDetailsElement>(".matrix-settings")!;
    expect(settings.open).toBe(false);
    expect(settings.querySelector("summary")!.textContent).toContain("Settings to sweep");
    expect(panel.querySelector(".matrix-settings-count")!.textContent).toBe("2 × 5 × 2 = 20 runs");
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
    expect(panel.querySelector(".matrix-settings-count")!.textContent).toBe("0 × 2 × 2 = 0 runs");
  });

  it("ticks every value on every axis from the one select-all button", () => {
    const panel = renderTab();
    panel.querySelector<HTMLButtonElement>(".axis-select-all")!.click();
    expect(encodeTest.matrix.qualities).toEqual(MATRIX_QUALITIES);
    expect(encodeTest.matrix.presets).toEqual(MATRIX_PRESETS);
    expect(encodeTest.matrix.scales).toEqual(MATRIX_SCALES);
    expect(encodeTest.matrix.scalers).toEqual(MATRIX_SCALERS);
    expect(axisBoxes(panel, "Quality levels").every((b) => b.checked)).toBe(true);
    expect(panel.querySelector(".matrix-settings-count")!.textContent).toBe("4 × 9 × 4 × 2 × 3 = 864 runs");
  });
});

// A square is chosen by clicking it, and choosing one usually means encoding it again: only the few
// most recent outputs are held. What the grid does during that wait is the point of these.
describe("choosing a square", () => {
  /** A finished two-square grid with the first square in the A/B window. */
  function sweptGrid(): MatrixCell[] {
    const cells = makeMatrixCells(buildMatrixCombos(["high", "low"], ["fast"], [1], ["lanczos"]));
    for (const cell of cells) {
      cell.status = "done";
      cell.bytes = 1024;
      cell.blobs = [new Blob(["x"])];
    }
    encodeTest.matrix.cells = cells;
    encodeTest.matrix.selectedKey = cells[0].combo.key;
    return cells;
  }

  function cellButton(panel: HTMLElement, cell: MatrixCell): HTMLButtonElement {
    return Array.from(panel.querySelectorAll<HTMLButtonElement>("button.matrix-cell")).find((b) =>
      (b.getAttribute("aria-label") ?? "").startsWith(describeSettings(cell.combo)),
    )!;
  }

  const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

  // The ring says which square was picked, not which video has finished decoding: waiting for the
  // load to move it left a click on a released square looking like a click that missed.
  it("moves the ring to the clicked square before the A/B window has it", () => {
    const cells = sweptGrid();
    const panel = renderTab();
    expect(cellButton(panel, cells[0]).classList.contains("selected")).toBe(true);

    cellButton(panel, cells[1]).click();

    expect(settleAbLoad).not.toBeNull();
    expect(encodeTest.matrix.selectedKey).toBe(cells[1].combo.key);
    expect(cellButton(panel, cells[0]).classList.contains("selected")).toBe(false);
    expect(cellButton(panel, cells[1]).classList.contains("selected")).toBe(true);
    expect(cellButton(panel, cells[1]).getAttribute("aria-pressed")).toBe("true");
  });

  // There is one encoder, and getting a released square into the window uses it.
  it("takes no second click while a square is on its way into the window", async () => {
    const cells = sweptGrid();
    const panel = renderTab();
    cellButton(panel, cells[1]).click();
    expect(cellButton(panel, cells[0]).disabled).toBe(true);
    expect(runButton(panel).disabled).toBe(true);

    settleAbLoad!.resolve();
    await flush();
    expect(cellButton(panel, cells[0]).disabled).toBe(false);
    expect(runButton(panel).disabled).toBe(false);
  });

  // Only when the square never gets there is the old one still what the window holds.
  it("puts the ring back on the square still showing when the chosen one cannot be loaded", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const cells = sweptGrid();
    const panel = renderTab();
    cellButton(panel, cells[1]).click();

    settleAbLoad!.reject(new Error("this browser will not decode it"));
    await flush();

    expect(encodeTest.matrix.selectedKey).toBe(cells[0].combo.key);
    expect(cellButton(panel, cells[0]).classList.contains("selected")).toBe(true);
    expect(cellButton(panel, cells[1]).classList.contains("selected")).toBe(false);
    error.mockRestore();
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
