import { mountHtml, readIndexHtml } from "@brain-bbqs/test-utils/vitest";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetCliDefaults, VIDEO_TRACK } from "../fixtures/state";
import { ChunkedSource } from "../../src/lib/chunkedSource";
import { encoderBusy } from "../../src/lib/encoderRun";
import { ffmpegPool, MAX_POOL_WORKERS } from "../../src/lib/ffmpegPool";
import { matrixCache } from "../../src/lib/matrixCache";
import {
  buildMatrixCombos,
  DEFAULT_MATRIX_PRESETS,
  describeSettings,
  makeMatrixCells,
  MATRIX_PRESETS,
  MATRIX_QUALITIES,
  MATRIX_SCALERS,
  MATRIX_SCALES,
} from "../../src/lib/qualityMatrix";
import { cli, resetState, sampledEncode, state } from "../../src/lib/state";
import type { EncodeSettings, MatrixCell, SampleWindow, X264Preset } from "../../src/lib/types";
import { deferred, flush } from "./helpers/async";

/** What the faked cores were asked to do, and what a test wants an encode to do. */
const core = vi.hoisted(() => ({
  execs: [] as string[][],
  terminated: 0,
  /** How many bytes the output of an exec comes to, so squares can differ in size and one can win. */
  sizeOf: ((): number => 3) as (args: string[]) => number,
  /** Stands in for the encode itself; the default finishes at once. */
  exec: null as ((args: string[]) => Promise<void>) | null,
  /** Stand in for a core's load, an input written to it and a file deleted from it while set, so a
   * test can hold one part-way through. All finish at once by default. */
  load: null as (() => Promise<void>) | null,
  writeFile: null as ((path: string) => Promise<void>) | null,
  deleteFile: null as ((path: string) => Promise<void>) | null,
}));

/** The stubbed decoder's answer for an encode's length. */
const ENCODED_SECONDS = vi.hoisted(() => 1.9);

/** What the page waits on outside the cores, held while set: measuring an encode's length, and
 * parsing a file being loaded. Neither can be interrupted, so a run stopped meanwhile waits them out. */
const slow = vi.hoisted(() => ({
  measure: null as (() => Promise<void>) | null,
  parse: null as (() => Promise<void>) | null,
}));

const fetchFile = vi.hoisted(() => vi.fn());

vi.mock("@ffmpeg/util", () => ({ toBlobURL: () => Promise.resolve("blob:core"), fetchFile }));

// ffmpeg.wasm is faked at the core alone, the way segmentRun's tests fake it: the real engine, pool
// and run code sit between the tab and this class, so a sweep here is the sweep the page runs.
vi.mock("@ffmpeg/ffmpeg", () => {
  class FakeFFmpeg {
    /** The command whose output the next read hands back. */
    private lastExec: string[] = [];
    /** The calls still in flight, which terminate() fails the way the real core does. */
    private pending: ((err: Error) => void)[] = [];
    /** Settles as `outcome` does, unless the core is terminated first. */
    private inFlight(outcome: Promise<void>): Promise<void> {
      return new Promise<void>((resolve, reject) => {
        this.pending.push(reject);
        outcome.then(resolve, reject);
      });
    }
    on(): void {}
    load(): Promise<void> {
      return core.load ? this.inFlight(core.load()) : Promise.resolve();
    }
    terminate(): void {
      core.terminated++;
      for (const reject of this.pending) reject(new Error("called FFmpeg.terminate()"));
      this.pending = [];
    }
    writeFile(path: string): Promise<void> {
      return core.writeFile ? this.inFlight(core.writeFile(path)) : Promise.resolve();
    }
    exec(args: string[]): Promise<void> {
      core.execs.push(args);
      this.lastExec = args;
      return this.inFlight(core.exec ? core.exec(args) : Promise.resolve());
    }
    readFile(): Promise<Uint8Array> {
      return Promise.resolve(new Uint8Array(core.sizeOf(this.lastExec)));
    }
    deleteFile(path: string): Promise<void> {
      return core.deleteFile ? this.inFlight(core.deleteFile(path)) : Promise.resolve();
    }
  }
  return { FFmpeg: FakeFFmpeg };
});

// jsdom has nothing to measure an encode's length with.
vi.mock("../../src/lib/mediabunny", () => {
  class FakeInput {
    computeDuration(): Promise<number> {
      return slow.measure ? slow.measure().then(() => ENCODED_SECONDS) : Promise.resolve(ENCODED_SECONDS);
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
// here: what matters is what the grid does before and after the window has the square. It refuses a
// stopped run as the real window does, so a run's own checks are what a test sees, not the stand-in.
vi.mock("../../src/ui/abPanel", async () => {
  const { RunStopped } = await import("../../src/lib/encoderRun");
  return {
    onAbDisplaced: (_host: HTMLElement, handler: () => void) => {
      abDisplaced = handler;
    },
    loadEncodedIntoAB: (
      blobs: Blob[],
      settings: EncodeSettings,
      _vt: unknown,
      _host: unknown,
      totals?: { bytes: number; windows: SampleWindow[] },
      run?: { stopped: boolean },
    ) => {
      if (run?.stopped) return Promise.reject(new RunStopped());
      abLoads.push({ blobs: blobs.length, settings, totals });
      return new Promise<void>((resolve, reject) => {
        settleAbLoad = { resolve: () => (run?.stopped ? reject(new RunStopped()) : resolve()), reject };
      });
    },
  };
});

// What a file load parses, for the cases that open one through the page's own loader: the same
// 20-second clip with a keyframe every two seconds that loadClip sets up by hand.
vi.mock("../../src/lib/mp4boxParser", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/lib/mp4boxParser")>()),
  parseWithMp4Box: async () => {
    await slow.parse?.();
    return { mp4boxFile: {}, info: { videoTracks: [{ id: 1, timescale: 600 }] } };
  },
  extractBoxTree: () => [],
  detectFaststart: () => true,
  extractSampleAnalysis: () => ({
    samples: [],
    keyframeDecodeIndices: [],
    gopLengths: [],
    hasBFrames: false,
    keyframeTimestampsSec: Array.from({ length: 10 }, (_, i) => i * 2),
  }),
  extractDeclaredBitrate: () => null,
}));
vi.mock("../../src/lib/mediabunnyMeta", async () => {
  const { VIDEO_TRACK: track } = await import("../fixtures/state");
  const meta = { format: "MP4", mimeType: "video/mp4", duration: 20, tags: null, tracks: [track], fps: 30 };
  return { loadMediabunnyMetadata: () => Promise.resolve({ ...meta, videoTrack: null }) };
});

/** Where the whole-file encode put what it saved; jsdom has no download to make. */
const downloadBlob = vi.hoisted(() => vi.fn());
vi.mock("../../src/lib/save", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/lib/save")>()),
  downloadBlob,
}));

// The measurement cache opens the page's IndexedDB on first use, which jsdom does not have.
globalThis.indexedDB = new IDBFactory();

const { renderCompareTab } = await import("../../src/ui/compareTab");
const { renderEncodeTab } = await import("../../src/ui/encodeTab");
const { initFileLoadingUi } = await import("../../src/ui/fileLoading");
const { getElements } = await import("../../src/ui/elements");

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

/** Ticks or unticks `box`, with the change event the tab listens for. */
function setChecked(box: HTMLInputElement, on: boolean): void {
  box.checked = on;
  box.dispatchEvent(new Event("change"));
}

/** Ticks or unticks the box for `value` in the axis field labelled `label`. */
function tickAxis(panel: HTMLElement, label: string, value: string, on: boolean): void {
  const box = axisBoxes(panel, label).find((b) => b.value === value)!;
  setChecked(box, on);
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

/** The page reloaded over the same file: nothing sampled or swept and the cores empty, so the
 * measurement cache is all that is left of earlier runs. */
function reloadClip(): void {
  document.body.innerHTML = "";
  resetCliDefaults();
  for (const worker of ffmpegPool(MAX_POOL_WORKERS)) worker.reset();
  loadClip();
  core.execs = [];
  fetchFile.mockClear();
}

/** The next sweep: `presets` at one quality and the source resolution, over `segments` two-second
 * stretches (one unless a test asks for more). As few squares as still make a grid. */
function sweepOf(presets: X264Preset[], segments = 1): void {
  sampledEncode.matrix.qualities = ["high"];
  sampledEncode.matrix.presets = presets;
  sampledEncode.matrix.scales = [1];
  sampledEncode.duration = 2;
  sampledEncode.segments = segments;
}

/** The encodes the cores were asked for, leaving the stream-copy cuts aside. */
function encodes(): string[][] {
  return core.execs.filter((args) => args.includes("-crf"));
}

/** The stream-copy cuts of the sampled stretch, told apart from the encodes by their rebased timestamps. */
function cuts(): string[][] {
  return core.execs.filter((args) => args.includes("-avoid_negative_ts"));
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

/** Sweeps ultrafast and superfast with ultrafast failing, and waits for superfast, the winner, to
 * be on its way into the A/B window. */
async function sweepWithOneFailure(): Promise<{ panel: HTMLElement; cells: MatrixCell[] }> {
  loadClip();
  sweepOf(["ultrafast", "superfast"]);
  vi.spyOn(Math, "random").mockReturnValue(0);
  core.exec = (args) => (args.includes("ultrafast") ? Promise.reject(new Error("x264 gave up")) : Promise.resolve());
  const panel = renderTab();
  await pressRun(panel);
  return { panel, cells: sampledEncode.matrix.cells };
}

/** What a square says under its figure: "queued", "retry", "run it" and so on. */
function squareSub(panel: HTMLElement, cell: MatrixCell): string {
  return square(panel, cell).querySelector(".matrix-sub")!.textContent ?? "";
}

/** The controls of the Reencode with FFmpeg tab's two encodes: the sample run and the whole-file one. */
interface ReencodeControls {
  runButton: HTMLButtonElement;
  stopButton: HTMLButtonElement;
  note: HTMLElement;
  wholeFileButton: HTMLButtonElement;
  wholeFileNote: HTMLElement;
}

/** The Reencode with FFmpeg tab over the same file, beside the Compare tab as the page has it. */
function renderReencodeTab(): ReencodeControls {
  const panel = document.createElement("div");
  document.body.append(panel);
  renderEncodeTab(panel);
  return reencodeControls(panel);
}

function reencodeControls(panel: HTMLElement): ReencodeControls {
  const notes = panel.querySelectorAll<HTMLElement>(".progress-label");
  return {
    runButton: runButton(panel),
    stopButton: stopButton(panel),
    note: notes[0],
    wholeFileButton: Array.from(panel.querySelectorAll("button")).find((b) => b.textContent!.endsWith(" and Save"))!,
    wholeFileNote: notes[1],
  };
}

/** Whether an exec is the whole-file encode: everything the sampled runs write is named et_…. */
function isWholeFile(args: string[]): boolean {
  return !args.at(-1)!.startsWith("et_");
}

/** The page's own markup and file loader, drawing both encoding tabs on every load as main.ts does. */
function mountLoader(): { els: ReturnType<typeof getElements>; loader: ReturnType<typeof initFileLoadingUi> } {
  mountHtml(readIndexHtml());
  const els = getElements();
  const loader = initFileLoadingUi(els, {
    onLoaded: () => {
      renderEncodeTab(els.panels.encode);
      renderCompareTab(els.panels.compare);
    },
  });
  return { els, loader };
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
  core.load = null;
  core.writeFile = null;
  core.deleteFile = null;
  core.sizeOf = (args) => SEGMENT_BYTES[args[args.indexOf("-preset") + 1]] ?? 3;
  slow.measure = null;
  slow.parse = null;
  fetchFile.mockReset();
  fetchFile.mockResolvedValue(new Uint8Array(8));
  downloadBlob.mockClear();
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
    expect(axisBoxes(panel, "Frame rates")).toHaveLength(3);
    expect(ticked(panel, "Frame rates")).toEqual(["1"]);
    expect(sampledEncode.matrix.fpsFractions).toEqual([1]);
  });

  it("multiplies the sweep by every rate ticked beyond the source's", () => {
    const panel = renderTab();
    tickAxis(panel, "Frame rates", "0.5", true);
    expect(sampledEncode.matrix.fpsFractions).toEqual([1, 0.5]);
    expect(panel.querySelector(".matrix-settings-count")!.textContent).toBe("2 × 5 × 2 × 2 = 40 runs");
  });

  it("records ticked resolutions as the next sweep's coverage, and counts them in the bar", () => {
    const panel = renderTab();
    tickAxis(panel, "Resolutions", "0.5", true);
    expect(sampledEncode.matrix.scales).toEqual([1, 0.75, 0.5]);
    expect(panel.querySelector(".matrix-settings-count")!.textContent).toBe("2 × 5 × 3 = 30 runs");

    tickAxis(panel, "Scalers", "bicubic", true);
    expect(sampledEncode.matrix.scalers).toEqual(["lanczos", "bicubic"]);
    expect(panel.querySelector(".matrix-settings-count")!.textContent).toBe("2 × 5 × 3 × 2 = 60 runs");
  });

  // A second kernel resamples nothing while every ticked resolution is the source's, so it does not
  // multiply the sweep and the bar does not claim it does.
  it("leaves the kernel axis out of the count when no downscale is ticked", () => {
    const panel = renderTab();
    tickAxis(panel, "Resolutions", "0.75", false);
    tickAxis(panel, "Scalers", "bicubic", true);
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
    expect(sampledEncode.segments).toBe(4);
  });

  // One button, saying what pressing it would do to the grid as it stands: a sweep that left holes
  // is asking to have those filled, not to be run again from the top.
  it("turns the run button into the one that fills a swept grid's holes", () => {
    sampledEncode.matrix.cells = makeMatrixCells(buildMatrixCombos(["high", "low"], ["fast"], [1], ["lanczos"]));
    expect(runButton(renderTab()).textContent).toBe("Run Matrix");

    sampledEncode.matrix.cells[0].status = "failed";
    expect(runButton(renderTab()).textContent).toBe("Retry 1 failed");

    sampledEncode.matrix.cells[1].status = "skipped";
    expect(runButton(renderTab()).textContent).toBe("Run 2 unmeasured");
  });

  // Stop (or a failed square) leaves holes the run button offers to fill back into the same grid,
  // but only while that grid is still what the checkboxes ask for. Once the sweep is edited, filling
  // the old holes back in would resume into a shape nobody ticked anymore.
  it("drops a stopped sweep's grid once the ticked axes move away from it, instead of resuming into the old shape", () => {
    sampledEncode.matrix.qualities = ["high", "low"];
    sampledEncode.matrix.presets = ["fast"];
    sampledEncode.matrix.cells = makeMatrixCells(buildMatrixCombos(["high", "low"], ["fast"], [1], ["lanczos"]));
    sampledEncode.matrix.cells[0].status = "done";
    sampledEncode.matrix.cells[0].bytes = 100;
    sampledEncode.matrix.cells[1].status = "skipped"; // what Stop leaves behind
    sampledEncode.matrix.selectedKey = sampledEncode.matrix.cells[0].combo.key;

    const panel = renderTab();
    expect(runButton(panel).textContent).toBe("Run 1 unmeasured");
    expect(panel.querySelector(".matrix-section h2")).not.toBeNull();

    // Adjust the sweep: tick a preset that was not part of the stopped run.
    tickAxis(panel, "x264 presets", "medium", true);

    expect(sampledEncode.matrix.cells).toEqual([]);
    expect(sampledEncode.matrix.selectedKey).toBeNull();
    expect(runButton(panel).textContent).toBe("Run Matrix");
    expect((panel.querySelector(".matrix-section") as HTMLElement).style.display).toBe("none");
  });

  it("ticks the middle qualities, the faster presets, and the first resolution drop to begin with", () => {
    const panel = renderTab();
    expect(ticked(panel, "Quality levels")).toEqual(["high", "medium"]);
    expect(ticked(panel, "x264 presets")).toEqual(["ultrafast", "superfast", "veryfast", "faster", "fast"]);
    expect(ticked(panel, "Resolutions")).toEqual(["1", "0.75"]);
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
    for (const box of axisBoxes(panel, "x264 presets").slice(1)) setChecked(box, false);
    expect(sampledEncode.matrix.presets).toEqual(["ultrafast"]);

    setChecked(axisBoxes(panel, "x264 presets").at(-1)!, true);
    expect(sampledEncode.matrix.presets).toEqual(["ultrafast", "veryslow"]);

    for (const box of axisBoxes(panel, "Quality levels")) setChecked(box, false);
    expect(sampledEncode.matrix.qualities).toEqual([]);
    expect(panel.querySelector(".matrix-settings-count")!.textContent).toBe("0 × 2 × 2 = 0 runs");
  });

  it("ticks every value on every axis from the one select-all button", () => {
    const panel = renderTab();
    panel.querySelector<HTMLButtonElement>(".axis-select-all")!.click();
    expect(sampledEncode.matrix.qualities).toEqual(MATRIX_QUALITIES);
    expect(sampledEncode.matrix.presets).toEqual(MATRIX_PRESETS);
    expect(sampledEncode.matrix.scales).toEqual(MATRIX_SCALES);
    expect(sampledEncode.matrix.scalers).toEqual(MATRIX_SCALERS);
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
    sampledEncode.matrix.cells = makeMatrixCells(buildMatrixCombos(["high"], ["fast"], [1, 0.75], ["lanczos"]));
    const panel = renderTab();
    const titles = Array.from(panel.querySelectorAll(".matrix-group-title")).map((t) => t.textContent);
    expect(titles).toEqual(["Source (100%) (640×480)", "75% (480×360)"]);
  });

  // A single run on the other tab takes the A/B window over, so no square is showing here anymore
  // and the command under the grid is no longer the command for what is on screen.
  it("forgets the showing square when a run elsewhere takes the A/B window over", () => {
    sampledEncode.matrix.cells = makeMatrixCells(buildMatrixCombos(["high"], ["fast"], [1], ["lanczos"]));
    const [cell] = sampledEncode.matrix.cells;
    cell.status = "done";
    cell.bytes = 1024;
    sampledEncode.matrix.selectedKey = cell.combo.key;
    const panel = renderTab();
    expect(panel.querySelector("pre.cmd")).not.toBeNull();
    expect(square(panel, cell).classList.contains("selected")).toBe(true);

    abDisplaced!();

    expect(sampledEncode.matrix.selectedKey).toBeNull();
    expect(panel.querySelector("pre.cmd")).toBeNull();
    expect(square(panel, cell).classList.contains("selected")).toBe(false);
  });

  // A second kernel changes nothing at the source resolution, so the grid the checkboxes describe
  // is the same grid, and its holes are still worth offering to fill.
  it("keeps a half-run grid while the ticked axes still describe it", () => {
    sampledEncode.matrix.scales = [1];
    const cells = makeMatrixCells(buildMatrixCombos(["high", "medium"], DEFAULT_MATRIX_PRESETS, [1], ["lanczos"]));
    cells[0].status = "skipped";
    sampledEncode.matrix.cells = cells;
    const panel = renderTab();
    expect(runButton(panel).textContent).toBe("Run 1 unmeasured");

    tickAxis(panel, "Scalers", "bicubic", true);

    expect(sampledEncode.matrix.scalers).toEqual(["lanczos", "bicubic"]);
    expect(sampledEncode.matrix.cells).toBe(cells);
    expect(runButton(panel).textContent).toBe("Run 1 unmeasured");
    expect(panel.querySelector(".matrix-section h2")).not.toBeNull();
  });
});

// A square is chosen by clicking it, and goes into the A/B window, encoded again first when its
// outputs were released to stay inside the memory budget. What the grid does while it waits is the
// point of these.
describe("choosing a square", () => {
  /** A finished two-square grid, every square still holding its output, with the first square in
   * the A/B window. */
  function sweptGrid(): MatrixCell[] {
    const cells = makeMatrixCells(buildMatrixCombos(["high", "low"], ["fast"], [1], ["lanczos"]));
    for (const cell of cells) {
      cell.status = "done";
      cell.bytes = 1024;
      cell.blobs = [new Blob(["x"])];
    }
    sampledEncode.matrix.cells = cells;
    sampledEncode.matrix.selectedKey = cells[0].combo.key;
    return cells;
  }

  // The ring says which square was picked, not which video the A/B window has finished loading, so
  // it moves while that load is still held.
  it("moves the ring to the clicked square before the A/B window has it", () => {
    const cells = sweptGrid();
    const panel = renderTab();
    expect(square(panel, cells[0]).classList.contains("selected")).toBe(true);

    square(panel, cells[1]).click();

    expect(settleAbLoad).not.toBeNull();
    expect(sampledEncode.matrix.selectedKey).toBe(cells[1].combo.key);
    expect(square(panel, cells[0]).classList.contains("selected")).toBe(false);
    expect(square(panel, cells[1]).classList.contains("selected")).toBe(true);
    expect(square(panel, cells[1]).getAttribute("aria-pressed")).toBe("true");
  });

  // Until the A/B window has the chosen square, the grid takes no other click and the run button
  // stays off.
  it("takes no second click while a square is on its way into the window", async () => {
    const cells = sweptGrid();
    const panel = renderTab();
    square(panel, cells[1]).click();
    expect(square(panel, cells[0]).disabled).toBe(true);
    expect(runButton(panel).disabled).toBe(true);

    settleAbLoad!.resolve();
    await flush();
    expect(square(panel, cells[0]).disabled).toBe(false);
    expect(runButton(panel).disabled).toBe(false);
  });

  // Nor does a failed square take one: with no sweep's queue to join, retrying it would be a second
  // encode, so it waits like the rest instead of offering a click that is only refused.
  it("offers no retry of a failed square while another square is on its way into the window", async () => {
    const cells = sweptGrid();
    cells[1].status = "failed";
    cells[1].error = "x264 gave up";
    cells[1].bytes = null;
    cells[1].blobs = null;
    const panel = renderTab();
    expect(square(panel, cells[1]).disabled).toBe(false);

    square(panel, cells[0]).click();
    expect(square(panel, cells[1]).disabled).toBe(true);

    settleAbLoad!.resolve();
    await flush();
    expect(square(panel, cells[1]).disabled).toBe(false);
    expect(runNote(panel).textContent).toBe("");
  });

  // A square whose output was released is encoded again before the A/B window can have it, which
  // is seconds of work: the ring moves and the grid is held for all of it, not only for the load.
  it("moves the ring and holds the grid while a released square is encoded again", async () => {
    loadClip();
    const cells = sweptGrid();
    cells[1].blobs = null;
    const held = deferred<void>();
    core.exec = (args) => (args.includes("-crf") ? held.promise : Promise.resolve());
    const panel = renderTab();

    square(panel, cells[1]).click();
    await vi.waitFor(() => expect(encodes()).toHaveLength(1), WAIT);

    expect(settleAbLoad).toBeNull();
    expect(sampledEncode.matrix.selectedKey).toBe(cells[1].combo.key);
    expect(square(panel, cells[0]).classList.contains("selected")).toBe(false);
    expect(square(panel, cells[1]).classList.contains("selected")).toBe(true);
    expect(square(panel, cells[0]).disabled).toBe(true);
    expect(runButton(panel).disabled).toBe(true);

    held.resolve();
    await awaitRun(panel);
    expect(cells[1].blobs).toHaveLength(1);
    await settleRun(panel);
    expect(square(panel, cells[0]).disabled).toBe(false);
  });

  // Only when the square never gets there is the old one still what the window holds.
  it("puts the ring back on the square still showing when the chosen one cannot be loaded", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const cells = sweptGrid();
    const panel = renderTab();
    square(panel, cells[1]).click();

    settleAbLoad!.reject(new Error("this browser will not decode it"));
    await flush();

    expect(sampledEncode.matrix.selectedKey).toBe(cells[0].combo.key);
    expect(square(panel, cells[0]).classList.contains("selected")).toBe(true);
    expect(square(panel, cells[1]).classList.contains("selected")).toBe(false);
  });

  // The A/B window compares against the seconds the grid was measured over, which the fields may
  // have been moved off since.
  it("puts the sample fields back to the stretch the sweep covered when a square is chosen", () => {
    const cells = sweptGrid();
    sampledEncode.matrix.segmentStart = 6;
    sampledEncode.matrix.segmentLength = 3;
    const panel = renderTab();
    const duration = panel.querySelector<HTMLInputElement>("#etDuration")!;
    duration.value = "4";
    duration.dispatchEvent(new Event("input"));
    expect(sampledEncode.duration).toBe(4);

    square(panel, cells[1]).click();

    expect(sampledEncode.startTime).toBe(6);
    expect(sampledEncode.duration).toBe(3);
    expect(duration.value).toBe("3");
    expect(abLoads.at(-1)?.totals?.windows).toEqual([{ startSeconds: 6, seconds: 3 }]);
  });

  // A square whose output was released is encoded again on the way into the window, which takes the
  // encoder like any run: while the Reencode tab's run has it, the click is refused and says why.
  it("refuses a square that would encode while the Reencode tab's run is encoding", async () => {
    loadClip();
    const cells = sweptGrid();
    cells[1].blobs = null;
    // The sample run encodes at the builder's medium quality, CRF 25, which no square here uses.
    const held = deferred<void>();
    core.exec = (args) => (args[args.indexOf("-crf") + 1] === "25" ? held.promise : Promise.resolve());
    const panel = renderTab();
    const reencode = renderReencodeTab();
    reencode.runButton.click();
    await vi.waitFor(() => expect(encodes()).toHaveLength(1), WAIT);

    square(panel, cells[1]).click();
    await flush();

    expect(encodes()).toHaveLength(1);
    expect(runNote(panel).textContent).toBe(
      "An encode is already running on the Reencode with FFmpeg tab. Wait for it to finish or stop it.",
    );
    expect(sampledEncode.matrix.selectedKey).toBe(cells[0].combo.key);
    expect(square(panel, cells[0]).classList.contains("selected")).toBe(true);
    expect(square(panel, cells[1]).disabled).toBe(false);
    held.resolve();
  });

  // A run on the Reencode tab takes the A/B window from the square showing here, which repaints the
  // grid while that run is still going. The squares are usable once it ends, not left disabled until
  // something else happens to repaint them.
  it("leaves the grid usable after a run on the Reencode tab took the A/B window from it", async () => {
    loadClip();
    const cells = sweptGrid();
    cells[1].blobs = null;
    const panel = renderTab();
    const reencode = renderReencodeTab();
    reencode.runButton.click();
    await vi.waitFor(() => expect(settleAbLoad).not.toBeNull(), WAIT);
    abDisplaced!();
    settleAbLoad!.resolve();
    settleAbLoad = null;
    await vi.waitFor(() => expect(reencode.runButton.disabled).toBe(false), WAIT);

    expect(square(panel, cells[0]).disabled).toBe(false);
    expect(square(panel, cells[1]).disabled).toBe(false);
    square(panel, cells[1]).click();
    await vi.waitFor(() => expect(settleAbLoad).not.toBeNull(), WAIT);
    expect(abLoads.at(-1)?.settings.quality).toBe("low");
    expect(sampledEncode.matrix.selectedKey).toBe(cells[1].combo.key);
  });

  it("leaves the fields alone for a grid that never recorded what it covered", () => {
    const cells = sweptGrid();
    sampledEncode.matrix.segmentStart = 6;
    sampledEncode.matrix.segmentLength = 0;
    const panel = renderTab();

    square(panel, cells[1]).click();

    expect(sampledEncode.startTime).toBe(0);
    expect(sampledEncode.duration).toBe(5);
  });
});

// The sweep ranks settings; the command is how the winner leaves the browser and reaches the file.
describe("the command for the selected square", () => {
  /** A finished grid with one square showing in the A/B window. */
  function sweptWith(quality: "high" | "low", preset: "fast", scale = 1): void {
    sampledEncode.matrix.cells = makeMatrixCells(buildMatrixCombos([quality], [preset], [scale], ["lanczos"]));
    const cell = sampledEncode.matrix.cells[0];
    cell.status = "done";
    cell.bytes = 1024;
    sampledEncode.matrix.selectedKey = cell.combo.key;
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
    const cells = sampledEncode.matrix.cells;
    expect(cells.map((c) => c.status)).toEqual(["done", "done"]);
    expect(cells.map((c) => c.bytes)).toEqual([300, 200]);
    expect(cells.map((c) => c.segmentSeconds)).toEqual([1.9, 1.9]);
    expect(cells.every((c) => c.fromCache === false)).toBe(true);
    expect(sampledEncode.matrix.selectedKey).toBe(cells[1].combo.key);
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
    expect(sampledEncode.matrix.windows).toEqual([{ startSeconds: 0, seconds: 2 }]);
    expect(sampledEncode.sampled).toBe(sampledEncode.matrix.windows);
    expect(sampledEncode.matrix.segmentStart).toBe(0);
    expect(sampledEncode.matrix.segmentLength).toBe(2);
    expect(square(panel, cells[1]).classList.contains("best")).toBe(true);
    expect(square(panel, cells[1]).classList.contains("selected")).toBe(true);
    expect(panel.querySelector(".matrix-summary-figure")!.textContent).toBe("98% smaller");
    expect(panel.querySelector("pre.cmd")!.textContent).toContain("-preset superfast");
    expect(logText(panel)).toContain("$ ffmpeg ");
  });

  it("encodes every square over every sampled stretch, and adds the stretches up", async () => {
    loadClip();
    // Two stretches of the 20-second file, each drawn at the start of its half.
    sweepOf(["ultrafast", "superfast"], 2);
    vi.spyOn(Math, "random").mockReturnValue(0);
    const panel = renderTab();

    await pressRun(panel);

    // One cut per stretch, then each square encoded from both cuts in sampled order.
    expect(cuts()).toHaveLength(2);
    expect(encodes().map((args) => [args[args.indexOf("-preset") + 1], args[args.indexOf("-i") + 1]])).toEqual([
      ["ultrafast", expect.stringMatching(/^et_snip_.*_0\.000_2\.000\.mp4$/)],
      ["ultrafast", expect.stringMatching(/^et_snip_.*_10\.000_2\.000\.mp4$/)],
      ["superfast", expect.stringMatching(/^et_snip_.*_0\.000_2\.000\.mp4$/)],
      ["superfast", expect.stringMatching(/^et_snip_.*_10\.000_2\.000\.mp4$/)],
    ]);
    expect(fetchFile).toHaveBeenCalledTimes(1);
    // A square's figures are both stretches added together.
    const cells = sampledEncode.matrix.cells;
    expect(cells.map((c) => c.bytes)).toEqual([600, 400]);
    expect(cells[0].segmentSeconds).toBeCloseTo(3.8, 10);
    expect(cells[1].segmentSeconds).toBeCloseTo(3.8, 10);
    // And the A/B window is handed both stretches of the winner, with where each came from.
    expect(abLoads).toHaveLength(1);
    expect(abLoads[0].blobs).toBe(2);
    expect(abLoads[0].totals?.bytes).toBe(400);
    expect(abLoads[0].totals?.windows.map((w) => w.startSeconds)).toEqual([0, 10]);

    await settleRun(panel);

    expect(sampledEncode.matrix.windows).toEqual([
      { startSeconds: 0, seconds: 2 },
      { startSeconds: 10, seconds: 2 },
    ]);
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

    // The page reloaded, and the sampler would now draw elsewhere.
    reloadClip();
    sweepOf(["ultrafast", "superfast"]);
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const panel = renderTab();

    await pressRun(panel);

    const cells = sampledEncode.matrix.cells;
    expect(sampledEncode.matrix.windows).toEqual([{ startSeconds: 0, seconds: 2 }]);
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

    const cells = sampledEncode.matrix.cells;
    expect(cells.map((c) => c.status)).toEqual(["failed", "done"]);
    expect(cells[0].error).toBe("x264 gave up");
    expect(logText(panel)).toContain("high (CRF 18), ultrafast: x264 gave up");
    expect(runNote(panel).textContent).toBe("1 of 2 encoded, 1 failed");
    expect(runButton(panel).textContent).toBe("Retry 1 failed");
    expect(sampledEncode.matrix.selectedKey).toBe(cells[1].combo.key);
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
    expect(sampledEncode.matrix.selectedKey).toBe(cells[1].combo.key);
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
    const cells = sampledEncode.matrix.cells;
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
    expect(encoderBusy()).toBe(false);
    expect(sampledEncode.matrix.running).toBe(false);
    expect(error).toHaveBeenCalledOnce();
    // Nothing is left queued once no run will take it: the square the sweep never reached is
    // offered to run, as one Stop left behind would be.
    const [cell] = sampledEncode.matrix.cells;
    expect(cell.status).toBe("skipped");
    expect(squareSub(panel, cell)).toBe("run it");
    expect(runButton(panel).textContent).toBe("Run 1 unmeasured");
  });

  it("asks for a quality and a preset before sweeping anything", async () => {
    loadClip();
    sampledEncode.matrix.qualities = [];
    const panel = renderTab();

    runButton(panel).click();
    await flush();

    expect(runNote(panel).textContent).toBe("Tick at least one quality level and one preset first.");
    expect(runButton(panel).disabled).toBe(false);
    expect(sampledEncode.matrix.cells).toEqual([]);
    expect(core.execs).toEqual([]);
  });

  // The Reencode with FFmpeg tab's run holds the same encoder, so a press here while it is going
  // starts nothing, whether it would have been a sweep or the run of a swept grid's holes. It says
  // why, and the button is left usable rather than greyed out until a file load rebuilds the panel.
  it("refuses a press while the Reencode tab's run is going, says why, and leaves the button usable", async () => {
    loadClip();
    sweepOf(["superfast"]);
    const panel = renderTab();
    const reencode = renderReencodeTab();
    reencode.runButton.click();
    // Held while it puts its result in the A/B window, the last thing it does before letting go.
    await vi.waitFor(() => expect(settleAbLoad).not.toBeNull(), WAIT);
    const execs = core.execs.length;

    runButton(panel).click();
    await flush();

    expect(runButton(panel).disabled).toBe(false);
    expect(runNote(panel).textContent).toBe(
      "An encode is already running on the Reencode with FFmpeg tab. Wait for it to finish or stop it.",
    );
    expect(sampledEncode.matrix.cells).toEqual([]);
    expect(core.execs).toHaveLength(execs);

    const cells = makeMatrixCells(buildMatrixCombos(["high"], ["superfast"], [1], ["lanczos"]));
    cells[0].status = "failed";
    sampledEncode.matrix.cells = cells;
    const retryPanel = renderTab();
    expect(runButton(retryPanel).textContent).toBe("Retry 1 failed");

    runButton(retryPanel).click();
    await flush();

    expect(runButton(retryPanel).disabled).toBe(false);
    expect(runNote(retryPanel).textContent).toBe(
      "An encode is already running on the Reencode with FFmpeg tab. Wait for it to finish or stop it.",
    );
    expect(cells[0].status).toBe("failed");
    expect(core.execs).toHaveLength(execs);

    // Once that run has ended, the same press runs.
    settleAbLoad!.resolve();
    settleAbLoad = null;
    await vi.waitFor(() => expect(reencode.runButton.disabled).toBe(false), WAIT);
    expect(runButton(retryPanel).disabled).toBe(false);
    runButton(retryPanel).click();
    await vi.waitFor(() => expect(settleAbLoad).not.toBeNull(), WAIT);
    expect(cells[0].status).toBe("done");
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

    const [cell] = sampledEncode.matrix.cells;
    expect(cell.status).toBe("done");
    expect(cell.bytes).toBe(200);
    expect(sampledEncode.matrix.windows).toEqual([]);
    expect(sampledEncode.matrix.segmentStart).toBe(0);
    expect(sampledEncode.matrix.segmentLength).toBe(2);
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
    const cells = sampledEncode.matrix.cells;
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
    expect(sampledEncode.matrix.selectedKey).toBe(cells[0].combo.key);
    // The terminated core lost its cut, so the stretch was cut out of the file again first.
    expect(cuts()).toHaveLength(2);

    // The button runs the rest, and the grid is whole.
    await pressRun(panel);
    await settleRun(panel);
    expect(cells.map((c) => c.status)).toEqual(["done", "done"]);
    expect(cells.map((c) => c.bytes)).toEqual([300, 200]);
    expect(sampledEncode.matrix.selectedKey).toBe(cells[1].combo.key);
    expect(runNote(panel).textContent).toBe("");
    expect(runButton(panel).textContent).toBe("Run Matrix");
    expect(cuts()).toHaveLength(2);
  });

  // Stop can land while a core is being handed the video to cut from. Terminating the core fails
  // that write as it fails an encode, so nothing more runs on it.
  it("runs nothing once Stop lands while a core is handed the video to cut", async () => {
    loadClip();
    sweepOf(["ultrafast"]);
    vi.spyOn(Math, "random").mockReturnValue(0);
    let writing = false;
    core.writeFile = () => {
      writing = true;
      return new Promise<void>(() => {});
    };
    const panel = renderTab();
    runButton(panel).click();
    await vi.waitFor(() => expect(writing).toBe(true), WAIT);

    stopButton(panel).click();
    await vi.waitFor(() => expect(runButton(panel).disabled).toBe(false), WAIT);

    expect(core.execs).toEqual([]);
    expect(runNote(panel).textContent).toBe("Stopped.");
    expect(sampledEncode.matrix.cells.map((c) => c.status)).toEqual(["skipped"]);
  });

  // Or while a second core is still loading to take its first square: Stop closes that core as well,
  // so the sweep ends without waiting for the load, and that core encodes nothing.
  it("encodes nothing on a core still loading when Stop lands", async () => {
    vi.spyOn(navigator, "hardwareConcurrency", "get").mockReturnValue(4);
    loadClip();
    sweepOf(["ultrafast", "superfast"]);
    vi.spyOn(Math, "random").mockReturnValue(0);
    let loads = 0;
    core.load = () => (++loads === 2 ? new Promise<void>(() => {}) : Promise.resolve());
    core.exec = (args) => (args.includes("-crf") ? new Promise<void>(() => {}) : Promise.resolve());
    const panel = renderTab();
    runButton(panel).click();
    await vi.waitFor(() => expect(loads).toBe(2), WAIT);
    await vi.waitFor(() => expect(encodes()).toHaveLength(1), WAIT);

    stopButton(panel).click();
    await vi.waitFor(() => expect(runButton(panel).disabled).toBe(false), WAIT);

    expect(encodes()).toHaveLength(1);
    expect(runNote(panel).textContent).toBe("Stopped: 0 of 2 encoded");
  });

  // A Stop ends the run it was pressed on, not whatever next needs an encoder: a square read back
  // from the cache, clicked after a stopped sweep, is encoded into the A/B window.
  it("encodes a square clicked after a stopped sweep instead of answering that it stopped", async () => {
    loadClip();
    sweepOf(["ultrafast"]);
    vi.spyOn(Math, "random").mockReturnValue(0);
    const first = renderTab();
    await pressRun(first);
    await settleRun(first);
    await matrixCache.flush();

    // Swept again with one more preset: the first square comes back from the cache holding no
    // output, and Stop lands while the new one encodes.
    reloadClip();
    sweepOf(["ultrafast", "superfast"]);
    core.exec = (args) => (args.includes("-crf") ? new Promise<void>(() => {}) : Promise.resolve());
    const panel = renderTab();
    runButton(panel).click();
    await vi.waitFor(() => expect(encodes()).toHaveLength(1), WAIT);
    stopButton(panel).click();
    await vi.waitFor(() => expect(runButton(panel).disabled).toBe(false), WAIT);
    const cells = sampledEncode.matrix.cells;
    expect(cells.map((c) => c.status)).toEqual(["done", "skipped"]);
    expect(cells[0].blobs).toBeNull();

    core.exec = null;
    square(panel, cells[0]).click();
    await awaitRun(panel);

    expect(runNote(panel).textContent).not.toBe("Stopped.");
    expect(settleAbLoad).not.toBeNull();
    expect(abLoads.at(-1)?.settings.preset).toBe("ultrafast");
    expect(sampledEncode.matrix.selectedKey).toBe(cells[0].combo.key);
  });

  // On a repeat sweep every square comes back from the cache, so encoding the winner again for the
  // A/B window is the only encoding the run does: a Stop then ends the run as stopped, not as a
  // winner that could not be shown.
  it("ends as stopped when Stop lands while the winner is encoded for the A/B window", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    loadClip();
    sweepOf(["ultrafast", "superfast"]);
    vi.spyOn(Math, "random").mockReturnValue(0);
    const first = renderTab();
    await pressRun(first);
    await settleRun(first);
    await matrixCache.flush();

    reloadClip();
    sweepOf(["ultrafast", "superfast"]);
    core.exec = (args) => (args.includes("-crf") ? new Promise<void>(() => {}) : Promise.resolve());
    const panel = renderTab();
    runButton(panel).click();
    await vi.waitFor(() => expect(encodes()).toHaveLength(1), WAIT);
    expect(encodes()[0]).toContain("superfast");
    expect(logText(panel)).toContain("Read 2 of 2 squares back from earlier runs of this file");

    stopButton(panel).click();
    await vi.waitFor(() => expect(runButton(panel).disabled).toBe(false), WAIT);

    expect(runNote(panel).textContent).toBe("Stopped.");
    expect(progressBar(panel).style.display).toBe("none");
    expect(logText(panel)).not.toContain("could not be shown");
    expect(error).not.toHaveBeenCalled();
    expect(sampledEncode.matrix.cells.map((c) => c.status)).toEqual(["done", "done"]);
    expect(sampledEncode.matrix.selectedKey).toBeNull();
    expect(encoderBusy()).toBe(false);
  });

  // Without a keyframe table the winner is encoded from the whole video, which is deleted from the
  // core once that encode is done. A Stop landing during the delete ends the run as stopped, and the
  // encode it caught is not kept for the square either.
  it("keeps nothing of the winner's encode when Stop lands while its video is dropped from the core", async () => {
    loadClip();
    state.keyframeTimestampsSec = [];
    sweepOf(["ultrafast", "superfast"]);
    vi.spyOn(Math, "random").mockReturnValue(0);
    const first = renderTab();
    await pressRun(first);
    await settleRun(first);
    await matrixCache.flush();

    reloadClip();
    state.keyframeTimestampsSec = [];
    sweepOf(["ultrafast", "superfast"]);
    let dropping = false;
    core.deleteFile = (path) => {
      if (path !== "et_in.mp4") return Promise.resolve();
      dropping = true;
      return new Promise<void>(() => {});
    };
    const panel = renderTab();
    const shown = abLoads.length;
    runButton(panel).click();
    await vi.waitFor(() => expect(dropping).toBe(true), WAIT);
    expect(encodes()).toHaveLength(1);

    stopButton(panel).click();
    await vi.waitFor(() => expect(runButton(panel).disabled).toBe(false), WAIT);

    expect(runNote(panel).textContent).toBe("Stopped.");
    expect(sampledEncode.matrix.cells[1].blobs).toBeNull();
    expect(sampledEncode.matrix.selectedKey).toBeNull();
    expect(abLoads).toHaveLength(shown);
  });

  // Clicking a failed square while the sweep is still going puts it at the back of the queue the
  // sweep is working through, rather than asking for a second encode alongside it.
  it("queues a failed square back into the sweep still running when it is clicked", async () => {
    loadClip();
    sweepOf(["ultrafast", "superfast"]);
    vi.spyOn(Math, "random").mockReturnValue(0);
    const held = deferred<void>();
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
    const cells = sampledEncode.matrix.cells;
    expect(cells.map((c) => c.status)).toEqual(["failed", "running"]);

    square(panel, cells[0]).click();

    expect(cells[0].status).toBe("pending");
    expect(cells[0].error).toBeNull();
    expect(logText(panel)).toContain("Queued a retry of high (CRF 18), ultrafast");
    expect(square(panel, cells[0]).querySelector(".matrix-sub")!.textContent).toBe("queued");
    // An axis moved mid-sweep does not throw the half-run grid away under the run.
    tickAxis(panel, "Quality levels", "medium", true);
    expect(sampledEncode.matrix.cells).toBe(cells);

    held.resolve();
    await awaitRun(panel);
    await settleRun(panel);

    expect(attempts).toBe(3);
    expect(cells.map((c) => c.status)).toEqual(["done", "done"]);
    expect(cells.map((c) => c.bytes)).toEqual([300, 200]);
    expect(runNote(panel).textContent).toBe("");
    expect(runButton(panel).textContent).toBe("Run Matrix");
  });

  // With a core per square, the one whose square failed has already left the queue by the time the
  // retry is clicked; the core still encoding picks the retry up.
  it("runs a square queued back after one of the sweep's cores has finished", async () => {
    vi.spyOn(navigator, "hardwareConcurrency", "get").mockReturnValue(4);
    loadClip();
    sweepOf(["ultrafast", "superfast"]);
    vi.spyOn(Math, "random").mockReturnValue(0);
    const held = deferred<void>();
    let failedOnce = false;
    core.exec = (args) => {
      if (!args.includes("-crf")) return Promise.resolve();
      if (args.includes("superfast")) return held.promise;
      if (failedOnce) return Promise.resolve();
      failedOnce = true;
      return Promise.reject(new Error("x264 gave up"));
    };
    const panel = renderTab();
    runButton(panel).click();
    await vi.waitFor(
      () => expect(sampledEncode.matrix.cells.map((c) => c.status)).toEqual(["failed", "running"]),
      WAIT,
    );
    const cells = sampledEncode.matrix.cells;
    expect(logText(panel)).toContain("Encoding on 2 cores at once");

    square(panel, cells[0]).click();
    expect(logText(panel)).toContain("Queued a retry of high (CRF 18), ultrafast");
    held.resolve();
    await awaitRun(panel);
    await settleRun(panel);

    expect(encodes()).toHaveLength(3);
    expect(cells.map((c) => c.status)).toEqual(["done", "done"]);
    expect(cells.map((c) => c.bytes)).toEqual([300, 200]);
    expect(runNote(panel).textContent).toBe("");
    expect(runButton(panel).textContent).toBe("Run Matrix");
  });

  // Once the sweep's cores have run out of squares there is no queue left to join, so a failed
  // square clicked while the winner goes into the A/B window asks for a run of its own, which the
  // sweep still holding the encoder refuses. The square stays as it was rather than queued for
  // nothing, and runs when clicked once the sweep has ended.
  it("leaves a failed square as it was when it is clicked while the winner goes into the A/B window", async () => {
    const { panel, cells } = await sweepWithOneFailure();
    expect(settleAbLoad).not.toBeNull();

    square(panel, cells[0]).click();
    await flush();

    expect(cells.map((c) => c.status)).toEqual(["failed", "done"]);
    expect(cells[0].error).toBe("x264 gave up");
    expect(logText(panel)).not.toContain("Queued a retry");
    expect(runNote(panel).textContent).toBe(
      "An encode is already running on the Compare Quality tab. Wait for it to finish or stop it.",
    );

    await settleRun(panel);

    expect(cells.map((c) => c.status)).toEqual(["failed", "done"]);
    expect(squareSub(panel, cells[0])).toBe("retry");
    expect(runButton(panel).textContent).toBe("Retry 1 failed");
    expect(runNote(panel).textContent).toBe("1 of 2 encoded, 1 failed");

    core.exec = null;
    square(panel, cells[0]).click();
    await awaitRun(panel);
    expect(cells.map((c) => c.status)).toEqual(["done", "done"]);
    expect(encodes()).toHaveLength(3);
    expect(runButton(panel).textContent).toBe("Run Matrix");
  });

  // A retry puts its squares in line before it has read or loaded anything. Stopped before it
  // reaches them, it leaves each as it was: a failed square still failed, with what it failed with.
  it("leaves a retried square as it was when Stop lands before the retry reaches it", async () => {
    const { panel, cells } = await sweepWithOneFailure();
    await settleRun(panel);
    expect(runButton(panel).textContent).toBe("Retry 1 failed");
    // The cores were emptied meanwhile, so the retry cuts the stretch out of the file again first,
    // and that cut is held.
    for (const worker of ffmpegPool(MAX_POOL_WORKERS)) worker.reset();
    core.exec = (args) => (args.includes("-crf") ? Promise.resolve() : new Promise<void>(() => {}));
    runButton(panel).click();
    await vi.waitFor(() => expect(cuts()).toHaveLength(2), WAIT);
    expect(squareSub(panel, cells[0])).toBe("queued");

    stopButton(panel).click();
    await vi.waitFor(() => expect(runButton(panel).disabled).toBe(false), WAIT);

    expect(cells.map((c) => c.status)).toEqual(["failed", "done"]);
    expect(cells[0].error).toBe("x264 gave up");
    expect(squareSub(panel, cells[0])).toBe("retry");
    expect(runButton(panel).textContent).toBe("Retry 1 failed");
    expect(runNote(panel).textContent).toBe("Stopped.");
    expect(encodes()).toHaveLength(2);
  });

  // Stopped while it encodes the square, a retry leaves it as it was too: the encode Stop cut short
  // measured nothing, so the square still failed, and says what with.
  it("leaves a retried square as it was when Stop cuts its encode short", async () => {
    const { panel, cells } = await sweepWithOneFailure();
    await settleRun(panel);
    core.exec = (args) => (args.includes("-crf") ? new Promise<void>(() => {}) : Promise.resolve());
    runButton(panel).click();
    await vi.waitFor(() => expect(encodes()).toHaveLength(3), WAIT);
    expect(squareSub(panel, cells[0])).toBe("encoding");

    stopButton(panel).click();
    await vi.waitFor(() => expect(runButton(panel).disabled).toBe(false), WAIT);

    expect(cells.map((c) => c.status)).toEqual(["failed", "done"]);
    expect(cells[0].error).toBe("x264 gave up");
    expect(squareSub(panel, cells[0])).toBe("retry");
    expect(runButton(panel).textContent).toBe("Retry 1 failed");
    expect(runNote(panel).textContent).toBe("Stopped: 1 of 2 encoded");
  });

  // The same for a retry that fails before it reaches a square: the failure is the run's, not the
  // square's, so the square keeps the error its own last attempt ended with.
  it("leaves a retried square as it was when the retry cannot read the file", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { panel, cells } = await sweepWithOneFailure();
    await settleRun(panel);
    for (const worker of ffmpegPool(MAX_POOL_WORKERS)) worker.reset();
    fetchFile.mockRejectedValueOnce(new Error("the file could not be read"));
    core.exec = null;

    runButton(panel).click();
    await vi.waitFor(() => expect(runButton(panel).disabled).toBe(false), WAIT);

    expect(cells.map((c) => c.status)).toEqual(["failed", "done"]);
    expect(cells[0].error).toBe("x264 gave up");
    expect(squareSub(panel, cells[0])).toBe("retry");
    expect(runButton(panel).textContent).toBe("Retry 1 failed");
    expect(runNote(panel).textContent).toBe("Failed: the file could not be read");
    expect(encodes()).toHaveLength(2);
    expect(error).toHaveBeenCalledOnce();
  });

  // A square queued back into a sweep that Stop then ends was never reached by it, so it too is
  // left as it was before it was queued.
  it("leaves a square queued back into a sweep as it was when Stop ends the sweep first", async () => {
    loadClip();
    sweepOf(["ultrafast", "superfast"]);
    vi.spyOn(Math, "random").mockReturnValue(0);
    let attempts = 0;
    core.exec = (args) => {
      if (!args.includes("-crf")) return Promise.resolve();
      attempts++;
      return attempts === 1 ? Promise.reject(new Error("x264 gave up")) : new Promise<void>(() => {});
    };
    const panel = renderTab();
    runButton(panel).click();
    await vi.waitFor(() => expect(attempts).toBe(2), WAIT);
    const cells = sampledEncode.matrix.cells;
    square(panel, cells[0]).click();
    expect(squareSub(panel, cells[0])).toBe("queued");

    stopButton(panel).click();
    await vi.waitFor(() => expect(runButton(panel).disabled).toBe(false), WAIT);

    expect(cells.map((c) => c.status)).toEqual(["failed", "skipped"]);
    expect(cells[0].error).toBe("x264 gave up");
    expect(squareSub(panel, cells[0])).toBe("retry");
    expect(squareSub(panel, cells[1])).toBe("run it");
    expect(runButton(panel).textContent).toBe("Run 2 unmeasured");
    expect(runNote(panel).textContent).toBe("Stopped: 0 of 2 encoded");
  });

  // Once Stop is pressed the sweep takes nothing more from its queue, even while it still waits on a
  // square it was measuring: a failed square clicked then is refused rather than queued for nothing.
  it("queues no retry into a sweep that Stop has ended but that is still winding down", async () => {
    loadClip();
    sweepOf(["ultrafast", "superfast"]);
    vi.spyOn(Math, "random").mockReturnValue(0);
    core.exec = (args) => (args.includes("ultrafast") ? Promise.reject(new Error("x264 gave up")) : Promise.resolve());
    const measuring = deferred<void>();
    let measures = 0;
    slow.measure = () => {
      measures++;
      return measuring.promise;
    };
    const panel = renderTab();
    runButton(panel).click();
    await vi.waitFor(() => expect(measures).toBe(1), WAIT);
    const cells = sampledEncode.matrix.cells;
    expect(cells[0].status).toBe("failed");
    stopButton(panel).click();

    square(panel, cells[0]).click();
    await flush();

    expect(logText(panel)).not.toContain("Queued a retry");
    expect(squareSub(panel, cells[0])).toBe("retry");
    expect(runNote(panel).textContent).toBe(
      "An encode is already running on the Compare Quality tab. Wait for it to finish.",
    );
    measuring.resolve();
    await vi.waitFor(() => expect(runButton(panel).disabled).toBe(false), WAIT);
    expect(cells[0].status).toBe("failed");
    expect(cells[0].error).toBe("x264 gave up");
  });

  // A Stop pressed while a fresh sweep still reads the file to fix its stretches is acted on once
  // they are fixed, so the squares it leaves unreached are run later over the stretches the fields
  // asked for rather than over whatever an earlier sweep covered.
  it("fixes a sweep's stretches before ending it for a Stop pressed while it reads the file", async () => {
    loadClip();
    sweepOf(["ultrafast"]);
    vi.spyOn(Math, "random").mockReturnValue(0);
    const reading = deferred<void>();
    const source = state.source!;
    const readChunk = source.readChunk.bind(source);
    source.readChunk = (offset, size) => reading.promise.then(() => readChunk(offset, size));
    const panel = renderTab();
    runButton(panel).click();
    await flush();

    stopButton(panel).click();
    reading.resolve();
    await vi.waitFor(() => expect(runButton(panel).disabled).toBe(false), WAIT);

    const cells = sampledEncode.matrix.cells;
    expect(cells.map((c) => c.status)).toEqual(["skipped"]);
    expect(squareSub(panel, cells[0])).toBe("run it");
    expect(runButton(panel).textContent).toBe("Run 1 unmeasured");
    expect(runNote(panel).textContent).toBe("Stopped.");
    expect(sampledEncode.matrix.windows).toEqual([{ startSeconds: 0, seconds: 2 }]);
    expect(core.execs).toEqual([]);

    await pressRun(panel);
    expect(cells.map((c) => c.status)).toEqual(["done"]);
    expect(cuts()[0]).toEqual(expect.arrayContaining(["-ss", "0", "-t", "2"]));
  });

  // The same Stop on a file measured before ends the run there too: nothing is read back from the
  // earlier run, so the button is left to run every square.
  it("reads nothing back from earlier runs for a Stop pressed while the sweep reads the file", async () => {
    loadClip();
    sweepOf(["ultrafast"]);
    vi.spyOn(Math, "random").mockReturnValue(0);
    const first = renderTab();
    await pressRun(first);
    await settleRun(first);
    await matrixCache.flush();

    reloadClip();
    sweepOf(["ultrafast"]);
    const reading = deferred<void>();
    const source = state.source!;
    const readChunk = source.readChunk.bind(source);
    source.readChunk = (offset, size) => reading.promise.then(() => readChunk(offset, size));
    const panel = renderTab();
    runButton(panel).click();
    await flush();

    stopButton(panel).click();
    reading.resolve();
    await vi.waitFor(() => expect(runButton(panel).disabled).toBe(false), WAIT);

    expect(sampledEncode.matrix.cells.map((c) => c.status)).toEqual(["skipped"]);
    expect(logText(panel)).not.toContain("squares back from earlier runs");
    expect(runNote(panel).textContent).toBe("Stopped.");
    expect(runButton(panel).textContent).toBe("Run 1 unmeasured");
    expect(core.execs).toEqual([]);
  });

  // Or while it reads them back: no core is loaded for a sweep already stopped, which on first use
  // would be the whole core download for nothing.
  it("loads no core for a Stop pressed while earlier measurements are read back", async () => {
    loadClip();
    sweepOf(["ultrafast"]);
    vi.spyOn(Math, "random").mockReturnValue(0);
    const reading = deferred<Awaited<ReturnType<typeof matrixCache.readMeasurements>>>();
    vi.spyOn(matrixCache, "readMeasurements").mockReturnValueOnce(reading.promise);
    let loads = 0;
    core.load = () => {
      loads++;
      return Promise.resolve();
    };
    const panel = renderTab();
    runButton(panel).click();
    await vi.waitFor(() => expect(matrixCache.readMeasurements).toHaveBeenCalledOnce(), WAIT);

    stopButton(panel).click();
    reading.resolve(new Map());
    await vi.waitFor(() => expect(runButton(panel).disabled).toBe(false), WAIT);

    expect(loads).toBe(0);
    expect(runNote(panel).textContent).toBe("Stopped.");
    expect(sampledEncode.matrix.cells.map((c) => c.status)).toEqual(["skipped"]);
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
    expect(sampledEncode.matrix.cells.map((c) => c.status)).toEqual(["done", "done"]);
    expect(sampledEncode.matrix.cells.map((c) => c.bytes)).toEqual([300, 200]);
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

    const [cell] = sampledEncode.matrix.cells;
    expect(cell.status).toBe("done");
    expect(cell.bytes).toBe(200);
    expect(logText(panel)).toContain("Encoded fine, but could not be shown: this browser will not decode it");
    expect(runNote(panel).textContent).toBe("");
    expect(progressBar(panel).querySelector(".fill")!.classList.contains("done")).toBe(true);
    // The window holds nothing of this grid, so no square is marked showing and no command is offered.
    expect(sampledEncode.matrix.selectedKey).toBeNull();
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
    const [cell] = sampledEncode.matrix.cells;
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
    const held = deferred<void>();
    core.exec = (args) => (args.includes("-crf") ? held.promise : Promise.resolve());
    const panel = renderTab();
    runButton(panel).click();
    await vi.waitFor(() => expect(encodes()).toHaveLength(1), WAIT);

    state.tracks = [];
    held.resolve();
    await awaitRun(panel);
    await settleRun(panel);

    const [cell] = sampledEncode.matrix.cells;
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

    const [cell] = sampledEncode.matrix.cells;
    expect(cell.status).toBe("failed");
    expect(cell.error).toBe("No video track loaded");
    expect(runNote(panel).textContent).toBe(
      "No combination produced an encode. Try faster presets or a shorter segment.",
    );
    await matrixCache.flush();
    expect(await storedCount("measurements")).toBe(0);
  });
});

// Stop closes a core still loading as it closes one encoding, so a run stopped before its core is
// up ends there and then, on either tab, rather than once a load that would be thrown away is done.
describe("a Stop while the core is still loading", () => {
  /** Holds every core's load for good, and hands back how many have started. */
  function holdLoads(): () => number {
    let loads = 0;
    core.load = () => {
      loads++;
      return new Promise<void>(() => {});
    };
    return () => loads;
  }

  it("ends a sweep at once, as stopped", async () => {
    loadClip();
    sweepOf(["ultrafast"]);
    vi.spyOn(Math, "random").mockReturnValue(0);
    const loads = holdLoads();
    const panel = renderTab();
    runButton(panel).click();
    await vi.waitFor(() => expect(loads()).toBe(1), WAIT);

    stopButton(panel).click();
    await vi.waitFor(() => expect(runButton(panel).disabled).toBe(false), WAIT);

    expect(runNote(panel).textContent).toBe("Stopped.");
    expect(core.terminated).toBe(1);
    expect(core.execs).toEqual([]);
    expect(sampledEncode.matrix.cells.map((c) => c.status)).toEqual(["skipped"]);
    expect(encoderBusy()).toBe(false);
  });

  it("ends a sample run on the Reencode tab at once, as stopped", async () => {
    loadClip();
    renderTab();
    const loads = holdLoads();
    const reencode = renderReencodeTab();
    reencode.runButton.click();
    await vi.waitFor(() => expect(loads()).toBe(1), WAIT);

    reencode.stopButton.click();
    await vi.waitFor(() => expect(reencode.runButton.disabled).toBe(false), WAIT);

    expect(reencode.note.textContent).toBe("Stopped.");
    expect(core.terminated).toBe(1);
    expect(core.execs).toEqual([]);
    expect(abLoads).toEqual([]);
    expect(encoderBusy()).toBe(false);
  });
});

// Every kind of encode shares the cores, so only one of them runs at a time: the sweep, a square
// encoded again for the A/B window, and both of the Reencode tab's runs. One started while another
// holds the encoder is refused, and says so.
describe("one encode at a time", () => {
  it("refuses the whole-file encode while a sweep is encoding, and runs it once the sweep is done", async () => {
    loadClip();
    sweepOf(["superfast"]);
    vi.spyOn(Math, "random").mockReturnValue(0);
    const held = deferred<void>();
    core.exec = (args) => (args.includes("-crf") ? held.promise : Promise.resolve());
    const panel = renderTab();
    const reencode = renderReencodeTab();
    runButton(panel).click();
    await vi.waitFor(() => expect(encodes()).toHaveLength(1), WAIT);

    reencode.wholeFileButton.click();
    await flush();

    expect(core.execs.filter(isWholeFile)).toEqual([]);
    expect(reencode.wholeFileNote.textContent).toBe(
      "An encode is already running on the Compare Quality tab. Wait for it to finish or stop it.",
    );
    expect(reencode.wholeFileButton.disabled).toBe(false);

    held.resolve();
    await awaitRun(panel);
    await settleRun(panel);
    reencode.wholeFileButton.click();
    await vi.waitFor(() => expect(downloadBlob).toHaveBeenCalledOnce(), WAIT);
    expect(core.execs.filter(isWholeFile)).toHaveLength(1);
  });

  it("refuses a sweep while the whole-file encode runs, and sweeps once it is saved", async () => {
    loadClip();
    sweepOf(["superfast"]);
    vi.spyOn(Math, "random").mockReturnValue(0);
    const held = deferred<void>();
    core.exec = (args) => (isWholeFile(args) ? held.promise : Promise.resolve());
    const panel = renderTab();
    const reencode = renderReencodeTab();
    reencode.wholeFileButton.click();
    await vi.waitFor(() => expect(core.execs.filter(isWholeFile)).toHaveLength(1), WAIT);

    runButton(panel).click();
    await flush();

    expect(runButton(panel).disabled).toBe(false);
    // The whole-file encode has no Stop of its own, so the note says only to wait.
    expect(runNote(panel).textContent).toBe(
      "An encode is already running on the Reencode with FFmpeg tab. Wait for it to finish.",
    );
    expect(sampledEncode.matrix.cells).toEqual([]);
    expect(core.execs).toHaveLength(1);

    held.resolve();
    await vi.waitFor(() => expect(downloadBlob).toHaveBeenCalledOnce(), WAIT);
    await pressRun(panel);
    expect(sampledEncode.matrix.cells.map((c) => c.status)).toEqual(["done"]);
  });

  // A refusal names a run that is going. Once that run has ended, the note says nothing rather than
  // still claiming a run that is no longer there.
  it("takes a refusal back once the run it named has ended", async () => {
    loadClip();
    sweepOf(["superfast"]);
    const panel = renderTab();
    const reencode = renderReencodeTab();
    reencode.runButton.click();
    await vi.waitFor(() => expect(settleAbLoad).not.toBeNull(), WAIT);
    runButton(panel).click();
    reencode.wholeFileButton.click();
    await flush();
    expect(runNote(panel).textContent).toBe(
      "An encode is already running on the Reencode with FFmpeg tab. Wait for it to finish or stop it.",
    );
    expect(reencode.wholeFileNote.textContent).toBe(
      "An encode is already running on the Reencode with FFmpeg tab. Wait for it to finish or stop it.",
    );

    settleAbLoad!.resolve();
    settleAbLoad = null;
    await vi.waitFor(() => expect(reencode.runButton.disabled).toBe(false), WAIT);

    expect(runNote(panel).textContent).toBe("");
    expect(reencode.wholeFileNote.textContent).toBe("");
  });

  // A file load or Reset ends the run a refusal named as surely as the run finishing does. The
  // panels are rebuilt only once the next file has loaded, so until then the old note is on screen.
  it("takes a refusal back when a file load or Reset ends the run it named", async () => {
    loadClip();
    sweepOf(["superfast"]);
    const panel = renderTab();
    const reencode = renderReencodeTab();
    reencode.runButton.click();
    await vi.waitFor(() => expect(settleAbLoad).not.toBeNull(), WAIT);
    runButton(panel).click();
    await flush();
    expect(runNote(panel).textContent).toBe(
      "An encode is already running on the Reencode with FFmpeg tab. Wait for it to finish or stop it.",
    );

    resetState();

    expect(runNote(panel).textContent).toBe("");
  });

  // A sweep reads the file to identify it before encoding anything, which for a URL can be seconds
  // of reading. The encoder is taken before that read, so nothing starts in the gap, and the sweep's
  // Stop still reaches its cores once it is encoding.
  it("holds the encoder from the moment a sweep is pressed, through its reading of the file", async () => {
    loadClip();
    sweepOf(["ultrafast"]);
    vi.spyOn(Math, "random").mockReturnValue(0);
    const reading = deferred<void>();
    const source = state.source!;
    const readChunk = source.readChunk.bind(source);
    source.readChunk = (offset, size) => reading.promise.then(() => readChunk(offset, size));
    core.exec = (args) => (args.includes("ultrafast") ? new Promise<void>(() => {}) : Promise.resolve());
    const panel = renderTab();
    const reencode = renderReencodeTab();
    runButton(panel).click();
    await flush();

    reencode.runButton.click();
    await flush();

    expect(reencode.note.textContent).toBe(
      "An encode is already running on the Compare Quality tab. Wait for it to finish or stop it.",
    );
    expect(reencode.runButton.disabled).toBe(false);
    expect(core.execs).toEqual([]);

    reading.resolve();
    await vi.waitFor(() => expect(encodes()).toHaveLength(1), WAIT);
    stopButton(panel).click();
    await vi.waitFor(() => expect(runButton(panel).disabled).toBe(false), WAIT);
    expect(core.terminated).toBe(1);
    expect(runNote(panel).textContent).toBe("Stopped: 0 of 1 encoded");
  });

  // A stopped run can still be waiting on what Stop cannot cut short, such as its reading of the
  // file. A press meanwhile is refused without offering the Stop already pressed, and runs once it
  // ends.
  it("asks only to wait for a stopped run that is still winding down", async () => {
    loadClip();
    sweepOf(["ultrafast"]);
    vi.spyOn(Math, "random").mockReturnValue(0);
    const reading = deferred<void>();
    let reads = 0;
    const source = state.source!;
    const readChunk = source.readChunk.bind(source);
    source.readChunk = (offset, size) => {
      reads++;
      return reading.promise.then(() => readChunk(offset, size));
    };
    const panel = renderTab();
    const reencode = renderReencodeTab();
    runButton(panel).click();
    await vi.waitFor(() => expect(reads).toBeGreaterThan(0), WAIT);
    stopButton(panel).click();

    reencode.runButton.click();
    await flush();

    expect(reencode.note.textContent).toBe(
      "An encode is already running on the Compare Quality tab. Wait for it to finish.",
    );
    expect(reencode.runButton.disabled).toBe(false);

    reading.resolve();
    await vi.waitFor(() => expect(runButton(panel).disabled).toBe(false), WAIT);
    expect(runNote(panel).textContent).toBe("Stopped.");
    expect(reencode.note.textContent).toBe("");
    expect(core.execs).toEqual([]);

    reencode.runButton.click();
    await vi.waitFor(() => expect(settleAbLoad).not.toBeNull(), WAIT);
    expect(encodes()).toHaveLength(1);
  });

  // Without a keyframe table nothing is cut, so every core a run encodes on is written the whole
  // video. All of them drop it afterwards: a core still holding it would be handed it again as the
  // next such file of the same type, since it is known by that name.
  it("drops the whole video from every core it was written to when there was nothing to cut", async () => {
    vi.spyOn(navigator, "hardwareConcurrency", "get").mockReturnValue(4);
    loadClip();
    state.keyframeTimestampsSec = [];
    sweepOf(["ultrafast", "superfast"]);
    vi.spyOn(Math, "random").mockReturnValue(0);
    const panel = renderTab();

    await pressRun(panel);
    await settleRun(panel);

    expect(logText(panel)).toContain("Encoding on 2 cores at once");
    expect(cuts()).toEqual([]);
    expect(ffmpegPool(2).map((worker) => worker.has("et_in.mp4"))).toEqual([false, false]);
  });
});

// A file load or Reset replaces everything a run was working from, so it stops the run first. What
// that run still has to unwind afterwards is its own business, and leaves the next file alone.
describe("a run across a file change", () => {
  /**
   * Loads a.mp4 and sweeps it until its one square is encoded and being measured, which is held
   * there, then loads b.mp4. Measuring is not the core's work, so the load cannot cut it short.
   * `cut` false takes the keyframe table from both files, so each run writes the whole video into
   * the core instead. Hands back the page and what lets the old sweep's measuring finish.
   */
  async function loadOverMeasuringSweep(
    cut = true,
  ): Promise<ReturnType<typeof mountLoader> & { measured: () => void }> {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const page = mountLoader();
    await page.loader.loadFile(new File([CLIP_BYTES], "a.mp4"));
    if (!cut) state.keyframeTimestampsSec = [];
    sweepOf(["ultrafast"]);
    vi.spyOn(Math, "random").mockReturnValue(0);
    const measuring = deferred<void>();
    let measured = false;
    slow.measure = () => {
      measured = true;
      return measuring.promise;
    };
    runButton(page.els.panels.compare).click();
    await vi.waitFor(() => expect(measured).toBe(true), WAIT);

    await page.loader.loadFile(new File([CLIP_BYTES], "b.mp4"));
    if (!cut) state.keyframeTimestampsSec = [];
    slow.measure = null;
    return { ...page, measured: () => measuring.resolve() };
  }

  it("stops a sweep when another file is loaded, and sweeps the new one from scratch", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { els, loader } = mountLoader();
    await loader.loadFile(new File([CLIP_BYTES], "a.mp4"));
    sweepOf(["ultrafast"]);
    vi.spyOn(Math, "random").mockReturnValue(0);
    core.exec = (args) => (args.includes("ultrafast") ? new Promise<void>(() => {}) : Promise.resolve());
    runButton(els.panels.compare).click();
    await vi.waitFor(() => expect(encodes()).toHaveLength(1), WAIT);
    const [stoppedCell] = sampledEncode.matrix.cells;

    await loader.loadFile(new File([CLIP_BYTES], "b.mp4"));

    expect(core.terminated).toBe(1);
    await vi.waitFor(() => expect(stoppedCell.status).toBe("skipped"), WAIT);
    expect(state.source!.name).toBe("b.mp4");
    expect(runButton(els.panels.compare).disabled).toBe(false);
    expect(stopButton(els.panels.compare).style.display).toBe("none");

    sweepOf(["superfast"]);
    await pressRun(els.panels.compare);
    expect(sampledEncode.matrix.cells.map((c) => c.status)).toEqual(["done"]);
    expect(encodes().map((args) => args[args.indexOf("-preset") + 1])).toEqual(["ultrafast", "superfast"]);
  });

  // The sweep is still reading the first file (a URL downloading, say) when Reset is pressed, and
  // that read cannot be interrupted. When it comes back the next file's sweep is already encoding:
  // the stopped one goes no further, and the running one keeps its Stop.
  it("leaves the next file's sweep alone when a sweep stopped by Reset catches up", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { els, loader } = mountLoader();
    await loader.loadFile(new File([CLIP_BYTES], "a.mp4"));
    sweepOf(["ultrafast"]);
    vi.spyOn(Math, "random").mockReturnValue(0);
    const reading = deferred<Uint8Array>();
    fetchFile.mockReturnValueOnce(reading.promise);
    runButton(els.panels.compare).click();
    await vi.waitFor(() => expect(fetchFile).toHaveBeenCalledOnce(), WAIT);

    els.resetBtn.click();
    await loader.loadFile(new File([CLIP_BYTES], "b.mp4"));
    sweepOf(["superfast"]);
    core.exec = (args) => (args.includes("superfast") ? new Promise<void>(() => {}) : Promise.resolve());
    runButton(els.panels.compare).click();
    await vi.waitFor(() => expect(encodes()).toHaveLength(1), WAIT);

    reading.resolve(new Uint8Array(8));
    await flush();
    await flush();

    expect(cuts()).toHaveLength(1);
    expect(encodes()).toHaveLength(1);
    expect(sampledEncode.matrix.running).toBe(true);
    const terminated = core.terminated;
    stopButton(els.panels.compare).click();
    await vi.waitFor(() => expect(runButton(els.panels.compare).disabled).toBe(false), WAIT);
    expect(core.terminated).toBe(terminated + 1);
    expect(runNote(els.panels.compare).textContent).toBe("Stopped: 0 of 1 encoded");
  });

  // A sweep whose core is still loading when another file is loaded is not left loading beside the
  // next file's: the file load closes that core on the spot, and the next file's sweep encodes on a
  // core of its own, which its Stop reaches.
  it("closes a sweep's core still loading when another file is loaded", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { els, loader } = mountLoader();
    await loader.loadFile(new File([CLIP_BYTES], "a.mp4"));
    sweepOf(["ultrafast"]);
    vi.spyOn(Math, "random").mockReturnValue(0);
    let loads = 0;
    core.load = () => {
      loads++;
      return new Promise<void>(() => {});
    };
    runButton(els.panels.compare).click();
    await vi.waitFor(() => expect(loads).toBe(1), WAIT);

    await loader.loadFile(new File([CLIP_BYTES], "b.mp4"));
    expect(core.terminated).toBe(1);

    core.load = null;
    sweepOf(["superfast"]);
    core.exec = (args) => (args.includes("-crf") ? new Promise<void>(() => {}) : Promise.resolve());
    runButton(els.panels.compare).click();
    await vi.waitFor(() => expect(encodes()).toHaveLength(1), WAIT);
    stopButton(els.panels.compare).click();

    await vi.waitFor(() => expect(runButton(els.panels.compare).disabled).toBe(false), WAIT);
    expect(runNote(els.panels.compare).textContent).toBe("Stopped: 0 of 1 encoded");
    expect(core.terminated).toBe(2);
    expect(encoderBusy()).toBe(false);
  });

  // A Stop lets a sweep still reading the file fix its stretches first, but a file load does not:
  // the fields and the grid the stretches would be written into are the next file's by then.
  it("fixes no stretches for the next file when a sweep stopped while reading the last one catches up", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { els, loader } = mountLoader();
    await loader.loadFile(new File([CLIP_BYTES], "a.mp4"));
    sweepOf(["ultrafast"]);
    vi.spyOn(Math, "random").mockReturnValue(0);
    const reading = deferred<void>();
    state.source!.readChunk = () => reading.promise.then(() => Promise.reject(new Error("read failed")));
    runButton(els.panels.compare).click();
    await flush();

    await loader.loadFile(new File([CLIP_BYTES], "b.mp4"));
    reading.resolve();
    await vi.waitFor(() => expect(warn).toHaveBeenCalled(), WAIT);
    await flush();

    expect(state.source!.name).toBe("b.mp4");
    expect(sampledEncode.matrix.windows).toEqual([]);
    expect(sampledEncode.sampled).toEqual([]);
    expect(sampledEncode.matrix.cells).toEqual([]);
    expect(core.execs).toEqual([]);
    expect(encoderBusy()).toBe(false);
  });

  // The same for the earlier stretches read back from the cache, the other wait before a sweep's
  // stretches are fixed.
  it("fixes no stretches for the next file when a sweep stopped while recalling earlier ones catches up", async () => {
    const { els, loader } = mountLoader();
    await loader.loadFile(new File([CLIP_BYTES], "a.mp4"));
    state.source!.readChunk = (offset, size) =>
      Promise.resolve(CLIP_BYTES.slice(offset, Math.min(offset + size, CLIP_BYTES.length)).buffer as ArrayBuffer);
    sweepOf(["ultrafast"]);
    vi.spyOn(Math, "random").mockReturnValue(0);
    const recalling = deferred<null>();
    vi.spyOn(matrixCache, "recallWindows").mockReturnValueOnce(recalling.promise);
    runButton(els.panels.compare).click();
    await vi.waitFor(() => expect(matrixCache.recallWindows).toHaveBeenCalledOnce(), WAIT);

    await loader.loadFile(new File([CLIP_BYTES], "b.mp4"));
    recalling.resolve(null);
    for (let i = 0; i < 6; i++) await flush();

    expect(sampledEncode.matrix.windows).toEqual([]);
    expect(sampledEncode.sampled).toEqual([]);
    expect(core.execs).toEqual([]);
    expect(encoderBusy()).toBe(false);
  });

  // A sweep still reading the old file (a URL downloading, say) when another is loaded cuts none of
  // it once the read comes back, so the next file's sweep cuts its own stretch rather than finding
  // the old file's in the core and measuring that.
  it("cuts nothing of the old file when a sweep stopped while reading it catches up", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { els, loader } = mountLoader();
    await loader.loadFile(new File([CLIP_BYTES], "a.mp4"));
    sweepOf(["ultrafast"]);
    vi.spyOn(Math, "random").mockReturnValue(0);
    const reading = deferred<Uint8Array>();
    fetchFile.mockReturnValueOnce(reading.promise);
    runButton(els.panels.compare).click();
    await vi.waitFor(() => expect(fetchFile).toHaveBeenCalledOnce(), WAIT);

    await loader.loadFile(new File([CLIP_BYTES], "b.mp4"));
    reading.resolve(new Uint8Array(8));
    for (let i = 0; i < 6; i++) await flush();
    expect(cuts()).toEqual([]);
    expect(encoderBusy()).toBe(false);

    sweepOf(["ultrafast"]);
    await pressRun(els.panels.compare);
    expect(cuts()).toHaveLength(1);
    expect(fetchFile).toHaveBeenCalledTimes(2);
  });

  // The same without a keyframe table, where the whole video goes into the core under a name that
  // says only what type of file it is: the old file's is never written there for the next to use.
  it("writes nothing of the old file into the core when a sweep stopped while reading it catches up", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { els, loader } = mountLoader();
    await loader.loadFile(new File([CLIP_BYTES], "a.mp4"));
    state.keyframeTimestampsSec = [];
    sweepOf(["ultrafast"]);
    vi.spyOn(Math, "random").mockReturnValue(0);
    const reading = deferred<Uint8Array>();
    fetchFile.mockReturnValueOnce(reading.promise);
    runButton(els.panels.compare).click();
    await vi.waitFor(() => expect(fetchFile).toHaveBeenCalledOnce(), WAIT);

    await loader.loadFile(new File([CLIP_BYTES], "b.mp4"));
    state.keyframeTimestampsSec = [];
    const writes: string[] = [];
    core.writeFile = (path) => {
      writes.push(path);
      return Promise.resolve();
    };
    reading.resolve(new Uint8Array(8));
    for (let i = 0; i < 6; i++) await flush();
    expect(writes).toEqual([]);
    expect(ffmpegPool(1)[0].has("et_in.mp4")).toBe(false);

    sweepOf(["ultrafast"]);
    await pressRun(els.panels.compare);
    expect(writes).toEqual(["et_in.mp4"]);
    expect(fetchFile).toHaveBeenCalledTimes(2);
  });

  // When the old sweep's measuring comes back, the grid is the next file's, and none of the outputs
  // it holds are dropped to keep within a budget that was the old run's to keep.
  it("drops none of the next file's outputs when a sweep stopped by a file load catches up", async () => {
    const { measured } = await loadOverMeasuringSweep();
    // The next file's grid holding more than a sweep keeps, as it does once a released square has
    // been encoded again for the A/B window on top of the rest.
    const cells = makeMatrixCells(buildMatrixCombos(["high", "low"], ["fast"], [1], ["lanczos"]));
    for (const cell of cells) {
      cell.status = "done";
      cell.bytes = 100 * 1024 * 1024;
      cell.blobs = [new Blob(["x"])];
    }
    sampledEncode.matrix.cells = cells;
    sampledEncode.matrix.selectedKey = cells[0].combo.key;

    measured();
    await flush();

    expect(cells.map((c) => c.blobs?.length)).toEqual([1, 1]);
    expect(encoderBusy()).toBe(false);
  });

  // Without a keyframe table every run writes the whole video into the core under one name. The old
  // sweep catching up once the next file's sweep has written its own copy there leaves that copy be.
  it("leaves the next file's video in the core when a sweep stopped by a file load catches up", async () => {
    const { els, measured } = await loadOverMeasuringSweep(false);
    const [firstCore] = ffmpegPool(1);
    sweepOf(["superfast"]);
    core.exec = (args) => (args.includes("-crf") ? new Promise<void>(() => {}) : Promise.resolve());
    runButton(els.panels.compare).click();
    await vi.waitFor(() => expect(encodes()).toHaveLength(2), WAIT);
    expect(firstCore.has("et_in.mp4")).toBe(true);

    measured();
    await flush();

    expect(firstCore.has("et_in.mp4")).toBe(true);
    stopButton(els.panels.compare).click();
    await vi.waitFor(() => expect(runButton(els.panels.compare).disabled).toBe(false), WAIT);
    expect(runNote(els.panels.compare).textContent).toBe("Stopped: 0 of 1 encoded");
  });

  // A square is being encoded again for the A/B window, still reading the file (a URL downloading,
  // say), when another file is loaded and swept. When the old read comes back, the square the next
  // file's sweep chose stays chosen: the ring the stopped run would put back was the old grid's.
  it("leaves the next file's chosen square alone when a square's re-encode a file load stopped catches up", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { els, loader } = mountLoader();
    const panel = els.panels.compare;
    await loader.loadFile(new File([CLIP_BYTES], "a.mp4"));
    sweepOf(["ultrafast", "superfast"]);
    vi.spyOn(Math, "random").mockReturnValue(0);
    await pressRun(panel);
    await settleRun(panel);
    const old = sampledEncode.matrix.cells;
    expect(sampledEncode.matrix.selectedKey).toBe(old[1].combo.key);
    // Released to stay inside the memory budget, and its stretch no longer cut, so clicking it reads
    // the file again to encode it.
    old[0].blobs = null;
    for (const worker of ffmpegPool(MAX_POOL_WORKERS)) worker.reset();
    const reading = deferred<Uint8Array>();
    fetchFile.mockReturnValueOnce(reading.promise);
    square(panel, old[0]).click();
    await vi.waitFor(() => expect(fetchFile).toHaveBeenCalledTimes(2), WAIT);

    await loader.loadFile(new File([CLIP_BYTES], "b.mp4"));
    sweepOf(["ultrafast", "superfast"]);
    core.sizeOf = (args) => ({ ultrafast: 100, superfast: 200 })[args[args.indexOf("-preset") + 1] as "ultrafast"] ?? 3;
    await pressRun(panel);
    await settleRun(panel);
    const next = sampledEncode.matrix.cells;
    expect(sampledEncode.matrix.selectedKey).toBe(next[0].combo.key);

    reading.resolve(new Uint8Array(8));
    for (let i = 0; i < 6; i++) await flush();

    expect(sampledEncode.matrix.selectedKey).toBe(next[0].combo.key);
    expect(abLoads).toHaveLength(2);
    expect(encoderBusy()).toBe(false);
  });

  // The whole-file encode is still reading the file when another is loaded, and that read cannot be
  // cut short. When it comes back the encode goes no further: nothing is encoded, saved or recorded.
  it("encodes nothing once a file load stops the whole-file encode while it reads the file", async () => {
    const { els, loader } = mountLoader();
    await loader.loadFile(new File([CLIP_BYTES], "a.mp4"));
    const reading = deferred<Uint8Array>();
    fetchFile.mockReturnValueOnce(reading.promise);
    reencodeControls(els.panels.encode).wholeFileButton.click();
    await vi.waitFor(() => expect(fetchFile).toHaveBeenCalledOnce(), WAIT);

    await loader.loadFile(new File([CLIP_BYTES], "b.mp4"));
    reading.resolve(new Uint8Array(8));
    await flush();

    expect(core.execs.filter(isWholeFile)).toEqual([]);
    expect(downloadBlob).not.toHaveBeenCalled();
    expect(state.reencodeResult).toBeNull();
    expect(encoderBusy()).toBe(false);
  });

  it("stops the whole-file encode when the file is closed, and saves nothing", async () => {
    const error = vi.spyOn(console, "error");
    const { els, loader } = mountLoader();
    await loader.loadFile(new File([CLIP_BYTES], "a.mp4"));
    core.exec = (args) => (isWholeFile(args) ? new Promise<void>(() => {}) : Promise.resolve());
    const reencode = reencodeControls(els.panels.encode);
    reencode.wholeFileButton.click();
    await vi.waitFor(() => expect(core.execs.filter(isWholeFile)).toHaveLength(1), WAIT);

    els.resetBtn.click();

    expect(core.terminated).toBe(1);
    await vi.waitFor(() => expect(reencode.wholeFileNote.textContent).toBe("Stopped."), WAIT);
    expect(downloadBlob).not.toHaveBeenCalled();
    expect(state.reencodeResult).toBeNull();
    expect(error).not.toHaveBeenCalled();
  });
});
