import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetCliDefaults, VIDEO_TRACK } from "../fixtures/state";
import type { FfmpegWorker } from "../../src/lib/ffmpegEngine";
import { SAMPLE_SECONDS } from "../../src/lib/sampleTimeline";
import { cli, encodeTest, state } from "../../src/lib/state";
import type { SampleWindow } from "../../src/lib/types";
import type { loadEncodedIntoAB } from "../../src/ui/abPanel";
import type { encodeWindows, prepareRun, RunInputs } from "../../src/ui/segmentRun";

/** What the faked run was handed, and the hooks a test uses to settle its encode by hand. */
const run = vi.hoisted(() => ({
  prepareRun: vi.fn<typeof prepareRun>(),
  encodeWindows: vi.fn<typeof encodeWindows>(),
  loadEncodedIntoAB: vi.fn<typeof loadEncodedIntoAB>(),
  /** The one core the faked pool hands out, which only has to load. */
  worker: { id: 0, load: vi.fn(() => Promise.resolve()) },
}));

// The A/B window decodes with mediabunny, which is not what a run of the builder's command is about
// here: what matters is what the run hands it.
vi.mock("../../src/ui/abPanel", () => ({
  onAbDisplaced: () => {},
  loadEncodedIntoAB: run.loadEncodedIntoAB,
}));

// The cutting and encoding are ffmpeg.wasm's, tested in segmentRun's own file; what this tab adds
// is the run around them, so those two steps and the pool they need are faked and the rest is real.
vi.mock("../../src/ui/segmentRun", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/ui/segmentRun")>()),
  acquireWorkers: () => [run.worker as unknown as FfmpegWorker],
  prepareRun: run.prepareRun,
  encodeWindows: run.encodeWindows,
}));

const { renderCompareTab } = await import("../../src/ui/compareTab");
const { renderEncodeTab } = await import("../../src/ui/encodeTab");
const realRun = await vi.importActual<typeof import("../../src/ui/segmentRun")>("../../src/ui/segmentRun");

/** The tab, rendered over one loaded 20-second file. The panel goes into the document because the
 * tab binds its fields by id, the way the app's own panels are already in the page. */
function renderTab(format = "MP4"): HTMLElement {
  state.tracks = [VIDEO_TRACK];
  state.duration = 20;
  state.fps = 30;
  state.format = format;
  const panel = document.createElement("div");
  document.body.append(panel);
  renderEncodeTab(panel);
  return panel;
}

beforeEach(() => {
  document.body.innerHTML = "";
  resetCliDefaults();
  encodeTest.duration = 5;
});

describe("renderEncodeTab", () => {
  it("renders nothing without a video track", () => {
    state.tracks = [];
    const panel = document.createElement("div");
    renderEncodeTab(panel);
    expect(panel.children).toHaveLength(0);
  });

  it("builds the command live from the fields above it", () => {
    const panel = renderTab();
    expect(panel.querySelector("#cmdPre")!.textContent).toContain("-crf 25");
    const quality = panel.querySelector<HTMLSelectElement>("#cliQuality")!;
    quality.value = "low";
    quality.dispatchEvent(new Event("change"));
    expect(panel.querySelector("#cmdPre")!.textContent).toContain("-crf 32");
  });

  // Trying one setting on a few seconds moved here from Compare Quality, where it sat beside a
  // sweep it had nothing to do with; here it is a run of the command directly above it.
  it("offers a run of the built command over one fixed stretch", () => {
    const panel = renderTab();
    // The length and the count are fixed, so they are not on the page at all: where the stretch
    // comes from is the only question, and the track below asks it.
    expect(panel.querySelector("#sampleDuration")).toBeNull();
    expect(panel.querySelector("#sampleSegments")).toBeNull();
    expect(panel.querySelector(".compare-run-buttons button")!.textContent).toBe("Run Comparison");
  });

  it("puts a track across the whole recording to pick that stretch with", () => {
    const panel = renderTab();
    const band = panel.querySelector<HTMLElement>(".sample-band")!;
    // Three seconds of a twenty-second file, drawn to scale.
    expect(band.style.width).toBe("15%");
    expect(band.style.left).toBe("0%");
    expect(panel.querySelectorAll(".sample-tick-label").length).toBeGreaterThan(1);

    band.focus();
    band.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", shiftKey: true, bubbles: true }));
    expect(encodeTest.sampleStart).toBe(10);
    expect(band.style.left).toBe("50%");

    // The window keeps its length at the end of the file rather than being trimmed to fit.
    band.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    expect(encodeTest.sampleStart).toBe(17);
  });

  // The whole-file encode is the last step of the same page: build the command, try it, run it.
  it("ends with the in-browser encode of the whole file, on ffmpeg alone", () => {
    const panel = renderTab();
    const headings = Array.from(panel.querySelectorAll("h2")).map((el) => el.textContent);
    expect(headings).toEqual(["FFmpeg Command Builder", "Try It on a Sample", "Reencode the Entire File Here"]);
    // One engine, so one button and no engine picker to choose between them.
    const buttons = Array.from(panel.querySelectorAll("button")).map((el) => el.textContent);
    expect(buttons).toContain("Reencode and Save");
    expect(panel.textContent).not.toContain("WebCodecs");
  });

  // The output is always an MP4, so what the button offers depends on what went in.
  it("offers a transcode when the source is in another container", () => {
    const panel = renderTab("QuickTime File Format");
    const buttons = Array.from(panel.querySelectorAll("button")).map((el) => el.textContent);
    expect(buttons).toContain("Transcode and Save");
    expect(buttons).not.toContain("Reencode and Save");
  });

  // The two tabs ask for different things now — one stretch here, a sampled spread there — so the
  // sweep's fields are its own rather than a second copy of these.
  it("leaves the Compare Quality tab's duration and segments alone", () => {
    const panel = renderTab();
    const comparePanel = document.createElement("div");
    document.body.append(comparePanel);
    renderCompareTab(comparePanel);

    const sweepDuration = comparePanel.querySelector<HTMLInputElement>("#etDuration")!;
    sweepDuration.value = "8";
    sweepDuration.dispatchEvent(new Event("input"));
    expect(encodeTest.duration).toBe(8);
    // This tab's run is three seconds whatever the sweep is set to, which the band's width says.
    const band = panel.querySelector<HTMLElement>(".sample-band")!;
    expect(band.style.width).toBe(`${(SAMPLE_SECONDS / 20) * 100}%`);
  });
});

/** The command as the page currently shows it. */
function command(panel: HTMLElement): string {
  return panel.querySelector("#cmdPre")!.textContent!;
}

/** Types `value` into the number field `id`, the way a keystroke reaches it. */
function type(panel: HTMLElement, id: string, value: string): void {
  const input = panel.querySelector<HTMLInputElement>(`#${id}`)!;
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Picks `value` in the select `id`. */
function pick(panel: HTMLElement, id: string, value: string): void {
  const select = panel.querySelector<HTMLSelectElement>(`#${id}`)!;
  select.value = value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

/** Ticks or unticks the checkbox `id`. */
function tick(panel: HTMLElement, id: string, checked: boolean): void {
  const box = panel.querySelector<HTMLInputElement>(`#${id}`)!;
  box.checked = checked;
  box.dispatchEvent(new Event("change", { bubbles: true }));
}

// Every field writes straight into the shared builder state and the command under it says so at
// once; there is no Apply step between the two.
describe("the command builder's fields", () => {
  // The builder's settings survive resetState on purpose, so what these tests move is put back by
  // hand for the tests after them.
  afterEach(() => {
    cli.keyframeInterval = 1;
    cli.noBFrames = true;
    cli.pad = true;
    cli.faststart = false;
    cli.audioMode = "copy";
    cli.fps = null;
    cli.customScale = 60;
  });

  it("takes a custom CRF only once Custom is the quality picked", () => {
    const panel = renderTab();
    const crfField = panel.querySelector<HTMLElement>("#cliCrf")!.parentElement!;
    expect(crfField.style.display).toBe("none");

    pick(panel, "cliQuality", "custom");
    expect(crfField.style.display).toBe("");
    type(panel, "cliCrf", "30");
    expect(cli.crf).toBe(30);
    expect(command(panel)).toContain("-crf 30");

    // Nothing typed is the lossless end of the scale rather than a NaN in the command.
    type(panel, "cliCrf", "");
    expect(cli.crf).toBe(0);
    expect(command(panel)).toContain("-crf 0");
  });

  // A builder left on Custom is rendered that way again: the settings are the reader's, not the file's.
  it("shows the CRF field from the start when Custom is already the quality picked", () => {
    cli.quality = "custom";
    cli.crf = 12;
    const panel = renderTab();
    expect(panel.querySelector<HTMLElement>("#cliCrf")!.parentElement!.style.display).toBe("");
    expect(panel.querySelector<HTMLInputElement>("#cliCrf")!.value).toBe("12");
    expect(command(panel)).toContain("-crf 12");
  });

  it("writes the picked preset into the command", () => {
    const panel = renderTab();
    pick(panel, "cliPreset", "veryslow");
    expect(cli.preset).toBe("veryslow");
    expect(command(panel)).toContain("-preset veryslow");
  });

  // The kernel has nothing to do at full resolution, so it is live only once something is being
  // resampled, and then it names the flags the scale filter runs with.
  it("wakes the scaler once a downscale is picked, and writes it into the scale filter", () => {
    const panel = renderTab();
    const scaler = panel.querySelector<HTMLSelectElement>("#cliScaler")!;
    expect(scaler.disabled).toBe(true);

    pick(panel, "cliScale", "0.5");
    expect(scaler.disabled).toBe(false);
    pick(panel, "cliScaler", "bicubic");
    expect(cli.scaler).toBe("bicubic");
    expect(command(panel)).toContain("scale=trunc(iw*0.5/2)*2:-2:flags=bicubic");

    // With no kernel picked the field reads as empty, which the parser takes as the sharper default
    // rather than writing a scale filter with nothing after flags=.
    scaler.selectedIndex = -1;
    scaler.dispatchEvent(new Event("change", { bubbles: true }));
    expect(cli.scaler).toBe("lanczos");
    expect(command(panel)).toContain("flags=lanczos");
  });

  it("takes a custom percentage once Custom is the resolution picked", () => {
    const panel = renderTab();
    const customField = panel.querySelector<HTMLElement>("#cliScaleCustom")!.parentElement!;
    expect(customField.style.display).toBe("none");

    pick(panel, "cliScale", "custom");
    expect(customField.style.display).toBe("");
    expect(cli.scale).toBe(0.6);
    type(panel, "cliScaleCustom", "40");
    expect(cli.scale).toBe(0.4);
    expect(command(panel)).toContain("scale=trunc(iw*0.4/2)*2");
  });

  it("turns the keyframe interval into a GOP at the source's frame rate", () => {
    const panel = renderTab();
    type(panel, "cliKeyframeInterval", "2");
    expect(cli.keyframeInterval).toBe(2);
    expect(command(panel)).toContain("-g 60");

    // An emptied field keeps the last interval rather than leaving the GOP with nothing to be.
    type(panel, "cliKeyframeInterval", "");
    expect(cli.keyframeInterval).toBe(2);
    expect(command(panel)).toContain("-g 60");
  });

  it("drops the B-frame flag when B-frames are allowed again", () => {
    const panel = renderTab();
    expect(command(panel)).toContain("-bf 0");
    tick(panel, "cliNoBFrames", false);
    expect(cli.noBFrames).toBe(false);
    expect(command(panel)).not.toContain("-bf");
  });

  it("drops the pad filter when padding is turned off", () => {
    const panel = renderTab();
    expect(command(panel)).toContain("pad=ceil(iw/2)*2:ceil(ih/2)*2");
    tick(panel, "cliPad", false);
    expect(cli.pad).toBe(false);
    expect(command(panel)).not.toContain("pad=");
  });

  it("adds the faststart flag when asked for", () => {
    const panel = renderTab();
    expect(command(panel)).not.toContain("faststart");
    tick(panel, "cliFaststart", true);
    expect(cli.faststart).toBe(true);
    // Written on the line after its flag, which is where the formatter breaks the command.
    expect(command(panel)).toMatch(/-movflags \\\n\s+\+faststart/);
  });

  it("strips the audio when asked to", () => {
    const panel = renderTab();
    expect(command(panel)).toMatch(/-c:a \\\n\s+copy/);
    pick(panel, "cliAudio", "strip");
    expect(cli.audioMode).toBe("strip");
    expect(command(panel)).toContain("-an");
    expect(command(panel)).not.toContain("-c:a");
  });

  it("overrides the frame rate while the field holds one", () => {
    const panel = renderTab();
    type(panel, "cliFps", "15");
    expect(cli.fps).toBe(15);
    expect(command(panel)).toContain("-r 15");
    // The GOP follows the rate the output will have, not the source's.
    expect(command(panel)).toContain("-g 15");

    type(panel, "cliFps", "");
    expect(cli.fps).toBeNull();
    expect(command(panel)).not.toContain("-r ");
    expect(command(panel)).toContain("-g 30");
  });
});

/** A promise settled from outside, standing in for an encode still in flight. */
interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (err: Error) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (err: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Inputs as prepareRun hands them over once the stretch is cut. */
function cutInputs(windows: SampleWindow[]): RunInputs {
  return {
    windows,
    names: windows.map((_, i) => `snip${i}.mp4`),
    data: windows.map(() => new Uint8Array(4)),
    preCut: true,
  };
}

/** Lets whatever the last event queued run to completion. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** The run's controls as the tab put them in the page. */
function sampleRun(panel: HTMLElement): {
  runButton: HTMLButtonElement;
  stopButton: HTMLButtonElement;
  note: HTMLElement;
  progress: HTMLElement;
  fill: HTMLElement;
  log: HTMLElement;
  result: HTMLElement;
} {
  const [runButton, stopButton] = Array.from(panel.querySelectorAll<HTMLButtonElement>(".compare-run-buttons button"));
  return {
    runButton,
    stopButton,
    note: panel.querySelector<HTMLElement>(".progress-label")!,
    progress: panel.querySelector<HTMLElement>(".progress-wrap")!,
    fill: panel.querySelector<HTMLElement>(".progress-wrap .fill")!,
    log: panel.querySelector<HTMLElement>(".log-console")!,
    result: panel.querySelector<HTMLElement>(".ab-inline")!,
  };
}

// The run is the command above it over the stretch the track points at, and what it produces lands
// in the A/B window inside the same card.
describe("running the command on a sample", () => {
  /** What the faked encode answers with once a test lets it finish. */
  let encoded: Deferred<{ blobs: Blob[]; bytes: number; measured: SampleWindow[] }>;
  /** The progress callback the run handed the encode, for a test to advance the bar through. */
  let onProgress: ((fraction: number) => void) | null;

  beforeEach(() => {
    encoded = deferred();
    onProgress = null;
    run.worker.load.mockClear();
    run.prepareRun.mockReset().mockImplementation((windows) => Promise.resolve(cutInputs(windows)));
    run.encodeWindows.mockReset().mockImplementation((_cli, _inputs, _workers, _ui, progress) => {
      onProgress = progress;
      return encoded.promise;
    });
    run.loadEncodedIntoAB.mockReset().mockResolvedValue(undefined);
  });

  // A run left in flight holds the tab's one encoder, which the next test would then find busy.
  afterEach(async () => {
    encoded.resolve({ blobs: [], bytes: 0, measured: [] });
    await flush();
    encodeTest.running = false;
    vi.restoreAllMocks();
  });

  it("encodes the stretch the track points at and puts the result in the A/B window", async () => {
    const panel = renderTab();
    const ui = sampleRun(panel);
    const band = panel.querySelector<HTMLElement>(".sample-band")!;
    band.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", shiftKey: true, bubbles: true }));

    ui.runButton.click();
    expect(ui.runButton.disabled).toBe(true);
    expect(ui.note.textContent).toBe("Loading ffmpeg.wasm…");
    await flush();

    expect(run.worker.load).toHaveBeenCalledTimes(1);
    const windows: SampleWindow[] = [{ startSeconds: 10, seconds: SAMPLE_SECONDS }];
    expect(run.prepareRun.mock.calls[0][0]).toEqual(windows);
    expect(run.prepareRun.mock.calls[0][1]).toEqual([run.worker]);
    // The A/B window draws the original from here, so it follows the stretch actually encoded.
    expect(encodeTest.startTime).toBe(10);
    expect(encodeTest.running).toBe(true);
    expect(ui.stopButton.style.display).toBe("");
    expect(ui.note.textContent).toBe("Encoding test segment…");
    expect(run.encodeWindows.mock.calls[0].slice(0, 2)).toEqual([cli, cutInputs(windows)]);

    onProgress!(0.5);
    expect(ui.fill.style.width).toBe("50%");
    expect(ui.note.textContent).toBe("Encoding test segment… 50%");

    const blobs = [new Blob(["encoded"])];
    const measured = [{ startSeconds: 10, seconds: 2.9 }];
    encoded.resolve({ blobs, bytes: 7, measured });
    await flush();

    expect(run.loadEncodedIntoAB).toHaveBeenCalledTimes(1);
    const [abBlobs, settings, track, host, totals] = run.loadEncodedIntoAB.mock.calls[0];
    expect(abBlobs).toBe(blobs);
    expect(settings).toEqual({
      quality: "medium",
      crf: 25,
      preset: "superfast",
      scale: 1,
      scaler: "lanczos",
      fps: null,
    });
    expect(track).toBe(VIDEO_TRACK);
    expect(host).toBe(ui.result);
    expect(totals).toEqual({ bytes: 7, windows: measured });

    // A full bar in the colour of a good outcome, and the controls back to what they were.
    expect(ui.fill.style.width).toBe("100%");
    expect(ui.fill.classList.contains("done")).toBe(true);
    expect(ui.note.textContent).toBe("");
    expect(encodeTest.running).toBe(false);
    expect(ui.runButton.disabled).toBe(false);
    expect(ui.stopButton.style.display).toBe("none");
  });

  it("says what went wrong when the encode fails, and hands the controls back", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const panel = renderTab();
    const ui = sampleRun(panel);
    ui.runButton.click();
    await flush();

    encoded.reject(new Error("libx264 refused the frame size"));
    await flush();

    expect(error).toHaveBeenCalledTimes(1);
    expect(ui.note.textContent).toBe("Failed: libx264 refused the frame size");
    expect(ui.log.textContent).toContain("libx264 refused the frame size");
    // Nothing to show the length of, so the bar goes rather than freezing part-way.
    expect(ui.progress.style.display).toBe("none");
    expect(run.loadEncodedIntoAB).not.toHaveBeenCalled();
    expect(encodeTest.running).toBe(false);
    expect(ui.runButton.disabled).toBe(false);
  });

  // Stop is not a failure to report as one: the run says it stopped and the controls come back.
  it("stops the run when Stop is pressed", async () => {
    const panel = renderTab();
    const ui = sampleRun(panel);
    ui.runButton.click();
    await flush();
    expect(ui.stopButton.disabled).toBe(false);

    ui.stopButton.click();
    expect(encodeTest.cancelRequested).toBe(true);
    expect(ui.stopButton.disabled).toBe(true);
    expect(ui.note.textContent).toBe("Stopping…");

    // The real encode is what turns a Stop into the end the failure handler recognises, so it is
    // the one that runs from here: with Stop pressed it never touches a core.
    const [cliState, inputs, workers, runUi, progress] = run.encodeWindows.mock.calls[0];
    realRun.encodeWindows(cliState, inputs, workers, runUi, progress).then(encoded.resolve, encoded.reject);
    await flush();

    expect(ui.note.textContent).toBe("Stopped.");
    expect(ui.progress.style.display).toBe("none");
    expect(run.loadEncodedIntoAB).not.toHaveBeenCalled();
    expect(encodeTest.running).toBe(false);
    expect(ui.runButton.disabled).toBe(false);
    expect(ui.stopButton.style.display).toBe("none");
  });

  // One encoder and one pool: the sweep on the other tab has both, and its run came first.
  it("waits for a sweep on the Compare Quality tab rather than running beside it", async () => {
    const panel = renderTab();
    const ui = sampleRun(panel);
    encodeTest.running = true;
    ui.runButton.click();
    await flush();

    expect(ui.note.textContent).toBe("An encode is already running on the Compare Quality tab. Wait for it to finish.");
    expect(run.prepareRun).not.toHaveBeenCalled();
    // Still held, since the sweep that holds it has not finished.
    expect(ui.runButton.disabled).toBe(true);
    expect(ui.stopButton.style.display).toBe("none");
  });

  // Without a length there is no track to pick a stretch on, so there is nothing to encode.
  it("has nothing to run when the file has no length to pick a stretch from", async () => {
    state.tracks = [VIDEO_TRACK];
    state.duration = 0;
    state.fps = 30;
    const panel = document.createElement("div");
    document.body.append(panel);
    renderEncodeTab(panel);
    expect(panel.querySelector(".sample-band")).toBeNull();

    const ui = sampleRun(panel);
    ui.runButton.click();
    await flush();
    expect(ui.note.textContent).toBe("No video loaded to encode.");
    expect(run.prepareRun).not.toHaveBeenCalled();
    expect(ui.runButton.disabled).toBe(false);
  });
});
