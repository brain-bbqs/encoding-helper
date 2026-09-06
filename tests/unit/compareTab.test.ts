import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetCliDefaults, VIDEO_TRACK } from "../fixtures/state";
import { ChunkedSource } from "../../src/lib/chunkedSource";
import { ffmpegPool, MAX_POOL_WORKERS } from "../../src/lib/ffmpegPool";
import { matrixCache } from "../../src/lib/matrixCache";
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
import { cli, encodeTest, state } from "../../src/lib/state";
import type { EncodeSettings, MatrixCell, SampleWindow, X264Preset } from "../../src/lib/types";

/** What the faked cores were asked to do, and what a test wants an encode to do. */
const core = vi.hoisted(() => ({
  execs: [] as string[][],
  terminated: 0,
  /** How many bytes the output of an exec comes to, so squares can differ in size and one can win. */
  sizeOf: ((): number => 3) as (args: string[]) => number,
  /** Stands in for the encode itself; the default finishes at once. */
  exec: null as ((args: string[]) => Promise<void>) | null,
}));

/** The stubbed decoder's answer for an encode's length. */
const ENCODED_SECONDS = vi.hoisted(() => 1.9);

const fetchFile = vi.hoisted(() => vi.fn());

vi.mock("@ffmpeg/util", () => ({ toBlobURL: () => Promise.resolve("blob:core"), fetchFile }));

// ffmpeg.wasm is faked at the core alone, the way segmentRun's tests fake it: the real engine, pool
// and run code sit between the tab and this class, so a sweep here is the sweep the page runs.
vi.mock("@ffmpeg/ffmpeg", () => {
  class FakeFFmpeg {
    /** The command whose output the next read hands back. */
    private lastExec: string[] = [];
    /** The execs still in flight, which terminate() fails the way the real core does. */
    private pending: ((err: Error) => void)[] = [];
    on(): void {}
    load(): Promise<void> {
      return Promise.resolve();
    }
    terminate(): void {
      core.terminated++;
      for (const reject of this.pending) reject(new Error("called FFmpeg.terminate()"));
      this.pending = [];
    }
    writeFile(): Promise<void> {
      return Promise.resolve();
    }
    exec(args: string[]): Promise<void> {
      core.execs.push(args);
      this.lastExec = args;
      return new Promise<void>((resolve, reject) => {
        this.pending.push(reject);
        (core.exec ? core.exec(args) : Promise.resolve()).then(resolve, reject);
      });
    }
    readFile(): Promise<Uint8Array> {
      return Promise.resolve(new Uint8Array(core.sizeOf(this.lastExec)));
    }
    deleteFile(): Promise<void> {
      return Promise.resolve();
    }
  }
  return { FFmpeg: FakeFFmpeg };
});

// jsdom has nothing to measure an encode's length with.
vi.mock("../../src/lib/mediabunny", () => {
  class FakeInput {
    computeDuration(): Promise<number> {
      return Promise.resolve(ENCODED_SECONDS);
    }
    dispose(): void {}
  }
  return {
    ensureMediabunny: () => Promise.resolve({ Input: FakeInput, BlobSource: class {}, ALL_FORMATS: [] }),
  };
});

/** Settles the A/B window's load, so a test can hold a chosen square half-way into the window and
 * look at the grid while it is there. */
let settleAbLoad: { resolve: () => void; reject: (err: Error) => void } | null = null;

/** What the A/B window was handed, load by load. */
const abLoads: { blobs: number; settings: EncodeSettings; totals?: { bytes: number; windows: SampleWindow[] } }[] = [];

/** What the tab asked to be told when a run elsewhere takes the A/B window over. */
let abDisplaced: (() => void) | null = null;

// The A/B window decodes with mediabunny, which is not the part of choosing a square under test
// here: what matters is what the grid does before and after the window has the square.
vi.mock("../../src/ui/abPanel", () => ({
  onAbDisplaced: (_host: HTMLElement, handler: () => void) => {
    abDisplaced = handler;
  },
  loadEncodedIntoAB: (
    blobs: Blob[],
    settings: EncodeSettings,
    _vt: unknown,
    _host: unknown,
    totals?: { bytes: number; windows: SampleWindow[] },
  ) => {
    abLoads.push({ blobs: blobs.length, settings, totals });
    return new Promise<void>((resolve, reject) => {
      settleAbLoad = { resolve, reject };
    });
  },
}));

// The measurement cache opens the page's IndexedDB on first use, which jsdom does not have.
globalThis.indexedDB = new IDBFactory();

const { renderCompareTab } = await import("../../src/ui/compareTab");

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

/** The values ticked in the axis field labelled `label`. */
function ticked(panel: HTMLElement, label: string): string[] {
  return axisBoxes(panel, label)
    .filter((b) => b.checked)
    .map((b) => b.value);
}

/** Lets whatever the last event queued run to completion. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** The bytes of the file the sweeps run over: enough of them to be a size worth projecting from,
 * read back by hand for the checksum since jsdom's Blob cannot be read as an ArrayBuffer. */
const CLIP_BYTES = Uint8Array.from({ length: 100_000 }, (_, i) => i % 251);

/** What one encoded stretch comes to at each preset, so the squares differ and one of them wins. */
const SEGMENT_BYTES: Partial<Record<string, number>> = { ultrafast: 300, superfast: 200 };

/** How a test waits on a sweep: polling, never sleeping. */
const WAIT = { interval: 5, timeout: 3000 };

/** A 20-second file with a keyframe every two seconds, loaded from disk. */
function loadClip(): void {
  state.fps = 30;
  state.file = new File([CLIP_BYTES], "clip.mp4");
  const source = ChunkedSource.fromFile(state.file);
  source.readChunk = (offset, size) =>
    Promise.resolve(CLIP_BYTES.slice(offset, Math.min(offset + size, CLIP_BYTES.length)).buffer as ArrayBuffer);
  state.source = source;
  state.keyframeTimestampsSec = Array.from({ length: 10 }, (_, i) => i * 2);
}

/** The next sweep: `presets` at one quality and the source resolution, over `segments` two-second
 * stretches. As few squares as still make a grid. */
function sweepOf(presets: X264Preset[], segments = 1): void {
  encodeTest.matrix.qualities = ["high"];
  encodeTest.matrix.presets = presets;
  encodeTest.matrix.scales = [1];
  encodeTest.duration = 2;
  encodeTest.segments = segments;
}

/** The encodes the cores were asked for, leaving the stream-copy cuts aside. */
function encodes(): string[][] {
  return core.execs.filter((args) => args.includes("-crf"));
}

/** The stream-copy cuts of the sampled stretch, told apart from the encodes by their rebased timestamps. */
function cuts(): string[][] {
  return core.execs.filter((args) => args.includes("-avoid_negative_ts"));
}

/** An encode held open until the test lets it finish. */
function heldEncode(): { promise: Promise<void>; release: () => void } {
  let release = (): void => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

function runNote(panel: HTMLElement): HTMLElement {
  return panel.querySelector<HTMLElement>(".progress-label")!;
}

function logText(panel: HTMLElement): string {
  return panel.querySelector(".log-console")!.textContent ?? "";
}

function stopButton(panel: HTMLElement): HTMLButtonElement {
  return panel.querySelectorAll<HTMLButtonElement>(".compare-run-buttons button")[1];
}

function progressBar(panel: HTMLElement): HTMLElement {
  return panel.querySelector<HTMLElement>(".progress-wrap")!;
}

/** The square standing for `cell` in the grid. */
function square(panel: HTMLElement, cell: MatrixCell): HTMLButtonElement {
  return Array.from(panel.querySelectorAll<HTMLButtonElement>("button.matrix-cell")).find((b) =>
    (b.getAttribute("aria-label") ?? "").startsWith(describeSettings(cell.combo) + " — "),
  )!;
}

/** Waits until the run in progress is holding the A/B window's load, or has ended without one. */
async function awaitRun(panel: HTMLElement): Promise<void> {
  await vi.waitFor(() => expect(settleAbLoad != null || !runButton(panel).disabled).toBe(true), WAIT);
}

/** Presses Run and waits as above. */
async function pressRun(panel: HTMLElement): Promise<void> {
  runButton(panel).click();
  await awaitRun(panel);
}

/** Lets the A/B window take its square, and waits for the run to hand the button back. */
async function settleRun(panel: HTMLElement): Promise<void> {
  settleAbLoad?.resolve();
  settleAbLoad = null;
  await vi.waitFor(() => expect(runButton(panel).disabled).toBe(false), WAIT);
}

/** How many records one of the cache's stores holds, read straight out of IndexedDB. */
function storedCount(store: "measurements" | "windows"): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("encoding-helper.matrix-cache", 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const count = db.transaction(store).objectStore(store).count();
      count.onerror = () => reject(count.error);
      count.onsuccess = () => {
        db.close();
        resolve(count.result);
      };
    };
  });
}

beforeEach(async () => {
  document.body.innerHTML = "";
  settleAbLoad = null;
  abLoads.length = 0;
  abDisplaced = null;
  resetCliDefaults();
  // Every core the pool may have built is emptied, so no sweep starts with the last one's cuts.
  for (const worker of ffmpegPool(MAX_POOL_WORKERS)) worker.reset();
  core.execs = [];
  core.terminated = 0;
  core.exec = null;
  core.sizeOf = (args) => SEGMENT_BYTES[args[args.indexOf("-preset") + 1]] ?? 3;
  fetchFile.mockReset();
  fetchFile.mockResolvedValue(new Uint8Array(8));
  // One core, so the squares encode in grid order and a held encode is the one a test expects.
  vi.spyOn(navigator, "hardwareConcurrency", "get").mockReturnValue(2);
  // Nothing measured by an earlier test is read back by this one.
  await matrixCache.clear();
});

// A square left half-way into the A/B window holds the tab's one encoder, which the next test would
// then find already busy.
afterEach(async () => {
  settleAbLoad?.resolve();
  settleAbLoad = null;
  await flush();
  vi.restoreAllMocks();
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
    expect(ticked(panel, "Resolutions")).toEqual(["1", "0.75"]);
    expect(ticked(panel, "Scalers")).toEqual(["lanczos"]);
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
    expect(ticked(panel, "Quality levels")).toEqual(DEFAULT_MATRIX_QUALITIES);
    expect(ticked(panel, "x264 presets")).toEqual(DEFAULT_MATRIX_PRESETS);
    expect(ticked(panel, "Resolutions")).toEqual(DEFAULT_MATRIX_SCALES.map(String));
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

  // The Educational toggle rebuilds the whole panel, which must not slam the fold shut on whoever
  // had it open.
  it("keeps the settings fold open across a rebuild of the panel", () => {
    const settings = renderTab().querySelector<HTMLDetailsElement>(".matrix-settings")!;
    settings.open = true;
    settings.dispatchEvent(new Event("toggle"));
    expect(renderTab().querySelector<HTMLDetailsElement>(".matrix-settings")!.open).toBe(true);

    settings.open = false;
    settings.dispatchEvent(new Event("toggle"));
    expect(renderTab().querySelector<HTMLDetailsElement>(".matrix-settings")!.open).toBe(false);
  });

  it("titles each block of rows with the resolution it was run at, in the file's own pixels", () => {
    encodeTest.matrix.cells = makeMatrixCells(buildMatrixCombos(["high"], ["fast"], [1, 0.75], ["lanczos"]));
    const panel = renderTab();
    const titles = Array.from(panel.querySelectorAll(".matrix-group-title")).map((t) => t.textContent);
    expect(titles).toEqual(["Source (100%) (640×480)", "75% (480×360)"]);
  });

  // A single run on the other tab takes the A/B window over, so no square is showing here anymore
  // and the command under the grid is no longer the command for what is on screen.
  it("forgets the showing square when a run elsewhere takes the A/B window over", () => {
    encodeTest.matrix.cells = makeMatrixCells(buildMatrixCombos(["high"], ["fast"], [1], ["lanczos"]));
    const [cell] = encodeTest.matrix.cells;
    cell.status = "done";
    cell.bytes = 1024;
    encodeTest.matrix.selectedKey = cell.combo.key;
    const panel = renderTab();
    expect(panel.querySelector("pre.cmd")).not.toBeNull();
    expect(square(panel, cell).classList.contains("selected")).toBe(true);

    abDisplaced!();

    expect(encodeTest.matrix.selectedKey).toBeNull();
    expect(panel.querySelector("pre.cmd")).toBeNull();
    expect(square(panel, cell).classList.contains("selected")).toBe(false);
  });

  // A second kernel changes nothing at the source resolution, so the grid the checkboxes describe
  // is the same grid, and its holes are still worth offering to fill.
  it("keeps a half-run grid while the ticked axes still describe it", () => {
    encodeTest.matrix.scales = [1];
    const cells = makeMatrixCells(buildMatrixCombos(["high", "medium"], DEFAULT_MATRIX_PRESETS, [1], ["lanczos"]));
    cells[0].status = "skipped";
    encodeTest.matrix.cells = cells;
    const panel = renderTab();
    expect(runButton(panel).textContent).toBe("Run 1 unmeasured");

    const bicubic = axisBoxes(panel, "Scalers").find((b) => b.value === "bicubic")!;
    bicubic.checked = true;
    bicubic.dispatchEvent(new Event("change"));

    expect(encodeTest.matrix.scalers).toEqual(["lanczos", "bicubic"]);
    expect(encodeTest.matrix.cells).toBe(cells);
    expect(runButton(panel).textContent).toBe("Run 1 unmeasured");
    expect(panel.querySelector(".matrix-section h2")).not.toBeNull();
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

  // The A/B window compares against the seconds the grid was measured over, which the fields may
  // have been moved off since.
  it("puts the sample fields back to the stretch the sweep covered when a square is chosen", () => {
    const cells = sweptGrid();
    encodeTest.matrix.segmentStart = 6;
    encodeTest.matrix.segmentLength = 3;
    const panel = renderTab();
    const duration = panel.querySelector<HTMLInputElement>("#etDuration")!;
    duration.value = "4";
    duration.dispatchEvent(new Event("input"));
    expect(encodeTest.duration).toBe(4);

    cellButton(panel, cells[1]).click();

    expect(encodeTest.startTime).toBe(6);
    expect(encodeTest.duration).toBe(3);
    expect(duration.value).toBe("3");
    expect(abLoads.at(-1)?.totals?.windows).toEqual([{ startSeconds: 6, seconds: 3 }]);
  });

  it("leaves the fields alone for a grid that never recorded what it covered", () => {
    const cells = sweptGrid();
    encodeTest.matrix.segmentStart = 6;
    encodeTest.matrix.segmentLength = 0;
    const panel = renderTab();

    cellButton(panel, cells[1]).click();

    expect(encodeTest.startTime).toBe(0);
    expect(encodeTest.duration).toBe(5);
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

// The sweep itself: Run Matrix cuts the sampled stretch out of the file, encodes it once per ticked
// combination on the faked cores, fills the grid in as it goes, and puts the winner in the A/B
// window. Everything between the button and the core is the page's own code.
describe("running the sweep", () => {
  it("encodes every ticked combination over the sampled stretch and shows the best reduction", async () => {
    loadClip();
    sweepOf(["ultrafast", "superfast"]);
    vi.spyOn(Math, "random").mockReturnValue(0);
    const panel = renderTab();

    await pressRun(panel);

    // Both squares measured, the smaller one on its way into the window, and the grid saying so.
    const cells = encodeTest.matrix.cells;
    expect(cells.map((c) => c.status)).toEqual(["done", "done"]);
    expect(cells.map((c) => c.bytes)).toEqual([300, 200]);
    expect(cells.map((c) => c.segmentSeconds)).toEqual([1.9, 1.9]);
    expect(cells.every((c) => c.fromCache === false)).toBe(true);
    expect(encodeTest.matrix.selectedKey).toBe(cells[1].combo.key);
    expect(runNote(panel).textContent).toBe("Loading the best reduction into the A/B window…");
    expect(abLoads).toHaveLength(1);
    expect(abLoads[0].settings.preset).toBe("superfast");
    expect(abLoads[0].blobs).toBe(1);
    expect(abLoads[0].totals?.bytes).toBe(200);
    expect(abLoads[0].totals?.windows[0].startSeconds).toBe(0);
    expect(abLoads[0].totals?.windows[0].seconds).toBeCloseTo(1.9, 10);
    // One cut of the stretch, then one encode per square, each reading the cut rather than the file.
    expect(cuts()).toEqual([core.execs[0]]);
    expect(encodes().map((args) => args[args.indexOf("-preset") + 1])).toEqual(["ultrafast", "superfast"]);
    expect(encodes().every((args) => args[args.indexOf("-i") + 1].startsWith("et_snip_"))).toBe(true);
    expect(fetchFile).toHaveBeenCalledTimes(1);

    await settleRun(panel);

    expect(runNote(panel).textContent).toBe("");
    expect(runButton(panel).textContent).toBe("Run Matrix");
    expect(stopButton(panel).style.display).toBe("none");
    const fill = progressBar(panel).querySelector<HTMLElement>(".fill")!;
    expect(fill.style.width).toBe("100%");
    expect(fill.classList.contains("done")).toBe(true);
    expect(encodeTest.matrix.windows).toEqual([{ startSeconds: 0, seconds: 2 }]);
    expect(encodeTest.sampled).toBe(encodeTest.matrix.windows);
    expect(encodeTest.matrix.segmentStart).toBe(0);
    expect(encodeTest.matrix.segmentLength).toBe(2);
    expect(square(panel, cells[1]).classList.contains("best")).toBe(true);
    expect(square(panel, cells[1]).classList.contains("selected")).toBe(true);
    expect(panel.querySelector(".matrix-summary-figure")!.textContent).toBe("98% smaller");
    expect(panel.querySelector("pre.cmd")!.textContent).toContain("-preset superfast");
    expect(logText(panel)).toContain("$ ffmpeg ");
  });

  // A square is a function of the file, the command and the stretches, none of which a reload
  // changes: coming back to the same file fills the grid in from what earlier runs measured, over
  // the stretches they measured it.
  it("reads a file's measured squares back from an earlier run instead of encoding them again", async () => {
    loadClip();
    sweepOf(["ultrafast", "superfast"]);
    vi.spyOn(Math, "random").mockReturnValue(0);
    const first = renderTab();
    await pressRun(first);
    await settleRun(first);
    await matrixCache.flush();
    expect(await storedCount("measurements")).toBe(2);
    expect(await storedCount("windows")).toBe(1);

    // The page reloaded: nothing sampled, nothing swept, the cores empty, and the sampler would now
    // draw elsewhere.
    document.body.innerHTML = "";
    resetCliDefaults();
    for (const worker of ffmpegPool(MAX_POOL_WORKERS)) worker.reset();
    loadClip();
    sweepOf(["ultrafast", "superfast"]);
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    core.execs = [];
    fetchFile.mockClear();
    const panel = renderTab();

    await pressRun(panel);

    const cells = encodeTest.matrix.cells;
    expect(encodeTest.matrix.windows).toEqual([{ startSeconds: 0, seconds: 2 }]);
    expect(cells.map((c) => c.status)).toEqual(["done", "done"]);
    expect(cells.map((c) => c.bytes)).toEqual([300, 200]);
    expect(cells.every((c) => c.fromCache)).toBe(true);
    expect(cells[0].blobs).toBeNull();
    expect(logText(panel)).toContain("Read 2 of 2 squares back from earlier runs of this file");
    expect(square(panel, cells[0]).querySelector(".matrix-sub")!.textContent).toContain("↺");
    // Nothing was swept: the one cut and the one encode are the winner's, made to fill the A/B
    // window from a square that holds only its numbers.
    expect(cuts()).toHaveLength(1);
    expect(encodes()).toHaveLength(1);
    expect(encodes()[0]).toContain("superfast");
    expect(fetchFile).toHaveBeenCalledTimes(1);
    expect(abLoads.at(-1)?.totals?.bytes).toBe(200);

    await settleRun(panel);

    expect(cells[1].blobs).toHaveLength(1);
    expect(runNote(panel).textContent).toBe("");
    expect(runButton(panel).textContent).toBe("Run Matrix");
  });

  // A failed combination is a result, not the end of the sweep: the point of the grid is finding
  // out what this file and this browser can do.
  it("keeps the sweep going past a square that fails, then encodes it on its own when clicked", async () => {
    loadClip();
    sweepOf(["ultrafast", "superfast"]);
    vi.spyOn(Math, "random").mockReturnValue(0);
    core.exec = (args) => (args.includes("ultrafast") ? Promise.reject(new Error("x264 gave up")) : Promise.resolve());
    const panel = renderTab();

    await pressRun(panel);
    await settleRun(panel);

    const cells = encodeTest.matrix.cells;
    expect(cells.map((c) => c.status)).toEqual(["failed", "done"]);
    expect(cells[0].error).toBe("x264 gave up");
    expect(logText(panel)).toContain("high (CRF 18), ultrafast: x264 gave up");
    expect(runNote(panel).textContent).toBe("1 of 2 encoded, 1 failed");
    expect(runButton(panel).textContent).toBe("Retry 1 failed");
    expect(encodeTest.matrix.selectedKey).toBe(cells[1].combo.key);
    const failed = square(panel, cells[0]);
    expect(failed.classList.contains("failed")).toBe(true);
    expect(failed.disabled).toBe(false);
    expect(failed.querySelector(".matrix-sub")!.textContent).toBe("retry");

    // Outside a sweep a failed square is encoded on its own. It did not beat the square showing,
    // so the A/B window is left alone.
    core.exec = null;
    failed.click();
    await awaitRun(panel);

    expect(settleAbLoad).toBeNull();
    expect(cells.map((c) => c.status)).toEqual(["done", "done"]);
    expect(cells[0].bytes).toBe(300);
    expect(encodes()).toHaveLength(3);
    expect(runNote(panel).textContent).toBe("");
    expect(runButton(panel).textContent).toBe("Run Matrix");
    expect(encodeTest.matrix.selectedKey).toBe(cells[1].combo.key);
  });

  it("says so when no combination produced an encode", async () => {
    loadClip();
    sweepOf(["ultrafast", "superfast"]);
    vi.spyOn(Math, "random").mockReturnValue(0);
    core.exec = (args) => (args.includes("-crf") ? Promise.reject(new Error("Aborted()")) : Promise.resolve());
    const panel = renderTab();

    await pressRun(panel);

    expect(settleAbLoad).toBeNull();
    expect(abLoads).toHaveLength(0);
    const cells = encodeTest.matrix.cells;
    expect(cells.map((c) => c.status)).toEqual(["failed", "failed"]);
    // The engine's own account of the crash reaches the square.
    expect(cells[0].error).toMatch(/^ffmpeg\.wasm crashed part-way through \(Aborted\(\)\)/);
    expect(runNote(panel).textContent).toBe(
      "No combination produced an encode. Try faster presets or a shorter segment.",
    );
    expect(progressBar(panel).style.display).toBe("none");
    expect(runButton(panel).textContent).toBe("Retry 2 failed");
    expect(core.terminated).toBe(2);
  });

  it("reports a run that could not start, and hands the button back", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    loadClip();
    sweepOf(["superfast"]);
    const panel = renderTab();
    // The file went away under the tab.
    state.source = null;

    await pressRun(panel);

    expect(runNote(panel).textContent).toBe("Failed: No video loaded");
    expect(logText(panel)).toContain("No video loaded");
    expect(progressBar(panel).style.display).toBe("none");
    expect(encodes()).toEqual([]);
    expect(encodeTest.running).toBe(false);
    expect(encodeTest.matrix.running).toBe(false);
    expect(error).toHaveBeenCalledOnce();
  });

  it("asks for a quality and a preset before sweeping anything", async () => {
    loadClip();
    encodeTest.matrix.qualities = [];
    const panel = renderTab();

    runButton(panel).click();
    await flush();

    expect(runNote(panel).textContent).toBe("Tick at least one quality level and one preset first.");
    expect(runButton(panel).disabled).toBe(false);
    expect(encodeTest.matrix.cells).toEqual([]);
    expect(core.execs).toEqual([]);
  });

  // The Reencode with FFmpeg tab's run holds the same encoder, so a press here while it is going
  // starts nothing, whether it would have been a sweep or the run of a swept grid's holes.
  it("does not start over a run already going on the other tab", async () => {
    loadClip();
    sweepOf(["superfast"]);
    const panel = renderTab();
    encodeTest.running = true;

    runButton(panel).click();
    await flush();

    expect(runButton(panel).disabled).toBe(true);
    expect(encodeTest.matrix.cells).toEqual([]);
    expect(runNote(panel).textContent).toBe("");
    expect(core.execs).toEqual([]);

    const cells = makeMatrixCells(buildMatrixCombos(["high"], ["superfast"], [1], ["lanczos"]));
    cells[0].status = "failed";
    encodeTest.matrix.cells = cells;
    const retryPanel = renderTab();
    expect(runButton(retryPanel).textContent).toBe("Retry 1 failed");

    runButton(retryPanel).click();
    await flush();

    expect(runButton(retryPanel).disabled).toBe(true);
    expect(cells[0].status).toBe("failed");
    expect(core.execs).toEqual([]);
    encodeTest.running = false;
  });

  // With no length to spread stretches across, the sampler has nothing to draw; the sweep still
  // encodes the one stretch the fields describe, from the start of the file, and the squares carry
  // sizes rather than a projection nothing can be projected onto.
  it("sweeps one stretch from the start of a file whose length is unknown", async () => {
    loadClip();
    sweepOf(["superfast"]);
    const panel = renderTab();
    state.duration = null;

    await pressRun(panel);
    await settleRun(panel);

    const [cell] = encodeTest.matrix.cells;
    expect(cell.status).toBe("done");
    expect(cell.bytes).toBe(200);
    expect(encodeTest.matrix.windows).toEqual([]);
    expect(encodeTest.matrix.segmentStart).toBe(0);
    expect(encodeTest.matrix.segmentLength).toBe(2);
    expect(cuts()[0]).toEqual(expect.arrayContaining(["-ss", "0", "-t", "2"]));
    expect(abLoads[0].totals?.windows[0].startSeconds).toBe(0);
    expect(abLoads[0].totals?.windows[0].seconds).toBeCloseTo(1.9, 10);
    expect(panel.querySelector(".matrix-summary-figure")!.textContent).toBe("Best reduction");
  });

  // Nothing interrupts a call already inside wasm, so Stop terminates the core: the square it was
  // on and the ones it never reached are left unmeasured, for the button to offer running later.
  it("stops mid-sweep, leaves the unreached squares unmeasured, and runs them on request", async () => {
    loadClip();
    sweepOf(["ultrafast", "superfast"]);
    vi.spyOn(Math, "random").mockReturnValue(0);
    core.exec = (args) => (args.includes("-crf") ? new Promise<void>(() => {}) : Promise.resolve());
    const panel = renderTab();
    runButton(panel).click();
    await vi.waitFor(() => expect(encodes()).toHaveLength(1), WAIT);
    const cells = encodeTest.matrix.cells;
    expect(stopButton(panel).style.display).toBe("");
    expect(square(panel, cells[0]).querySelector(".matrix-sub")!.textContent).toBe("encoding");
    expect(square(panel, cells[0]).disabled).toBe(true);

    stopButton(panel).click();

    expect(runNote(panel).textContent).toBe("Stopping…");
    await vi.waitFor(() => expect(runButton(panel).disabled).toBe(false), WAIT);
    expect(runNote(panel).textContent).toBe("Stopped: 0 of 2 encoded");
    expect(progressBar(panel).style.display).toBe("none");
    expect(cells.map((c) => c.status)).toEqual(["skipped", "skipped"]);
    expect(cells.every((c) => c.error === null)).toBe(true);
    expect(core.terminated).toBe(1);
    expect(settleAbLoad).toBeNull();
    expect(runButton(panel).textContent).toBe("Run 2 unmeasured");
    expect(square(panel, cells[0]).querySelector(".matrix-sub")!.textContent).toBe("run it");

    // One square run by hand: the only one measured, so it goes into the window, and the note
    // counts what is still not run.
    core.exec = null;
    square(panel, cells[0]).click();
    await awaitRun(panel);
    expect(settleAbLoad).not.toBeNull();
    await settleRun(panel);
    expect(cells.map((c) => c.status)).toEqual(["done", "skipped"]);
    expect(runNote(panel).textContent).toBe("1 of 2 encoded, 1 skipped");
    expect(runButton(panel).textContent).toBe("Run 1 unmeasured");
    expect(encodeTest.matrix.selectedKey).toBe(cells[0].combo.key);
    // The terminated core lost its cut, so the stretch was cut out of the file again first.
    expect(cuts()).toHaveLength(2);

    // The button runs the rest, and the grid is whole.
    await pressRun(panel);
    await settleRun(panel);
    expect(cells.map((c) => c.status)).toEqual(["done", "done"]);
    expect(cells.map((c) => c.bytes)).toEqual([300, 200]);
    expect(encodeTest.matrix.selectedKey).toBe(cells[1].combo.key);
    expect(runNote(panel).textContent).toBe("");
    expect(runButton(panel).textContent).toBe("Run Matrix");
    expect(cuts()).toHaveLength(2);
  });

  // Clicking a failed square while the sweep is still going puts it at the back of the queue the
  // sweep is working through, rather than asking for a second encode alongside it.
  it("queues a failed square back into the sweep still running when it is clicked", async () => {
    loadClip();
    sweepOf(["ultrafast", "superfast"]);
    vi.spyOn(Math, "random").mockReturnValue(0);
    const held = heldEncode();
    let attempts = 0;
    core.exec = (args) => {
      if (!args.includes("-crf")) return Promise.resolve();
      attempts++;
      if (attempts === 1) return Promise.reject(new Error("x264 gave up"));
      return attempts === 2 ? held.promise : Promise.resolve();
    };
    const panel = renderTab();
    runButton(panel).click();
    await vi.waitFor(() => expect(attempts).toBe(2), WAIT);
    const cells = encodeTest.matrix.cells;
    expect(cells.map((c) => c.status)).toEqual(["failed", "running"]);

    square(panel, cells[0]).click();

    expect(cells[0].status).toBe("pending");
    expect(cells[0].error).toBeNull();
    expect(logText(panel)).toContain("Queued a retry of high (CRF 18), ultrafast");
    expect(square(panel, cells[0]).querySelector(".matrix-sub")!.textContent).toBe("queued");
    // An axis moved mid-sweep does not throw the half-run grid away under the run.
    const medium = axisBoxes(panel, "Quality levels").find((b) => b.value === "medium")!;
    medium.checked = true;
    medium.dispatchEvent(new Event("change"));
    expect(encodeTest.matrix.cells).toBe(cells);

    held.release();
    await awaitRun(panel);
    await settleRun(panel);

    expect(attempts).toBe(3);
    expect(cells.map((c) => c.status)).toEqual(["done", "done"]);
    expect(cells.map((c) => c.bytes)).toEqual([300, 200]);
    expect(runNote(panel).textContent).toBe("");
    expect(runButton(panel).textContent).toBe("Run Matrix");
  });

  it("spreads the squares over the cores the machine offers, and says so", async () => {
    vi.spyOn(navigator, "hardwareConcurrency", "get").mockReturnValue(4);
    loadClip();
    sweepOf(["ultrafast", "superfast"]);
    vi.spyOn(Math, "random").mockReturnValue(0);
    const panel = renderTab();

    await pressRun(panel);
    await settleRun(panel);

    expect(logText(panel)).toContain("Encoding on 2 cores at once");
    expect(
      encodes()
        .map((args) => args.at(-1))
        .sort(),
    ).toEqual(["et_out_0.mp4", "et_out_1.mp4"]);
    expect(encodeTest.matrix.cells.map((c) => c.status)).toEqual(["done", "done"]);
    expect(encodeTest.matrix.cells.map((c) => c.bytes)).toEqual([300, 200]);
  });

  // The sweep measured everything it was asked to; only the preview of the winner failed, which is
  // no reason to throw a grid full of good measurements away.
  it("keeps the grid when the A/B window cannot show the winner", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    loadClip();
    sweepOf(["superfast"]);
    vi.spyOn(Math, "random").mockReturnValue(0);
    const panel = renderTab();
    await pressRun(panel);

    settleAbLoad!.reject(new Error("this browser will not decode it"));
    settleAbLoad = null;
    await vi.waitFor(() => expect(runButton(panel).disabled).toBe(false), WAIT);

    const [cell] = encodeTest.matrix.cells;
    expect(cell.status).toBe("done");
    expect(cell.bytes).toBe(200);
    expect(logText(panel)).toContain("Encoded fine, but could not be shown: this browser will not decode it");
    expect(runNote(panel).textContent).toBe("");
    expect(progressBar(panel).querySelector(".fill")!.classList.contains("done")).toBe(true);
    // The window holds nothing of this grid, so no square is marked showing and no command is offered.
    expect(encodeTest.matrix.selectedKey).toBeNull();
    expect(panel.querySelector("pre.cmd")).toBeNull();
    expect(error).toHaveBeenCalledOnce();
  });

  // A file that cannot be checksummed is a file with no cache: the sweep still runs, and nothing
  // is written under a name that might be another video's.
  it("warns and sweeps without a cache when the file cannot be identified", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    loadClip();
    state.source!.readChunk = () => Promise.reject(new Error("read failed"));
    sweepOf(["superfast"]);
    vi.spyOn(Math, "random").mockReturnValue(0);
    const panel = renderTab();

    await pressRun(panel);
    await settleRun(panel);

    expect(warn).toHaveBeenCalledWith(
      "[encoding-helper] could not identify the video for the measurement cache:",
      expect.any(Error),
    );
    const [cell] = encodeTest.matrix.cells;
    expect(cell.status).toBe("done");
    expect(cell.fromCache).toBe(false);
    expect(logText(panel)).not.toContain("squares back from earlier runs");
    await matrixCache.flush();
    expect(await storedCount("measurements")).toBe(0);
    expect(await storedCount("windows")).toBe(0);
  });

  // A square measured after its track went away has no command left to key it by, so its numbers
  // stay out of a cache they could only be read back from for the wrong video.
  it("keeps a square out of the cache when the track vanished while it encoded", async () => {
    loadClip();
    sweepOf(["superfast"]);
    vi.spyOn(Math, "random").mockReturnValue(0);
    const held = heldEncode();
    core.exec = (args) => (args.includes("-crf") ? held.promise : Promise.resolve());
    const panel = renderTab();
    runButton(panel).click();
    await vi.waitFor(() => expect(encodes()).toHaveLength(1), WAIT);

    state.tracks = [];
    held.release();
    await awaitRun(panel);
    await settleRun(panel);

    const [cell] = encodeTest.matrix.cells;
    expect(cell.status).toBe("done");
    expect(cell.bytes).toBe(200);
    await matrixCache.flush();
    // The file itself was identified, so its stretches were remembered; only the square was not.
    expect(await storedCount("windows")).toBe(1);
    expect(await storedCount("measurements")).toBe(0);
  });

  // Without a video track there is no command to key a square by and none to encode with, so every
  // square says what was missing and nothing is written to the cache.
  it("fails every square on the spot when the video track is gone", async () => {
    loadClip();
    sweepOf(["superfast"]);
    vi.spyOn(Math, "random").mockReturnValue(0);
    const panel = renderTab();
    state.tracks = [];

    await pressRun(panel);

    const [cell] = encodeTest.matrix.cells;
    expect(cell.status).toBe("failed");
    expect(cell.error).toBe("No video track loaded");
    expect(runNote(panel).textContent).toBe(
      "No combination produced an encode. Try faster presets or a shorter segment.",
    );
    await matrixCache.flush();
    expect(await storedCount("measurements")).toBe(0);
  });
});
