import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VIDEO_TRACK } from "../fixtures/state";
import { sampledEncode, resetState, state } from "../../src/lib/state";
import { heldBytes } from "../../src/lib/qualityMatrix";
import type { EncodeSettings, SampleWindow } from "../../src/lib/types";
import { flush } from "./helpers/async";
import { gridRows, gridValue } from "./helpers/grid";

/** The id of every Input the stub has seen disposed, so the test can check the old ones are let go
 * of. */
const disposed: number[] = [];
let openedInputs = 0;
/** The Input the stub refuses to give a video track, standing in for a stretch that will not open. */
let refuseInput = -1;
/** The Input whose track the stub says the browser cannot decode. */
let undecodableInput = -1;
/** How long the stub says every stretch runs. */
let stretchSeconds = 1;
/** Called as each stretch is opened, for a test to act while a load is part-way through. */
let onOpen: (() => void) | null = null;

/** A decoded frame as the sinks hand one back: a canvas of the frame's own size. */
interface FakeFrame {
  canvas: HTMLCanvasElement;
}
/** What a sink answers a frame request with, told the track of the sink that is asking (as in
 * `frameRequests`); null is "no frame at that time", the default. */
let frameAt: (seconds: number, track: unknown) => Promise<FakeFrame | null> = async () => null;
/** Every frame the panel asked for, and the track it asked for it on: the original's is
 * `state.videoTrack`, each stretch's the encoded track the stub handed out. `sink` is the sink that
 * was asked, which tells the stretches apart. */
const frameRequests: { track: unknown; seconds: number; sink: unknown }[] = [];

// The panel only asks mediabunny to decode the encodes it was handed; what it does with the answers
// is the part under test, so the decoder is stubbed rather than run.
vi.mock("../../src/lib/mediabunny", () => {
  class FakeInput {
    id = openedInputs++;
    async getPrimaryVideoTrack(): Promise<{ canDecode: () => Promise<boolean> } | null> {
      onOpen?.();
      const decodable = this.id !== undecodableInput;
      return this.id === refuseInput ? null : { canDecode: async () => decodable };
    }
    async computeDuration(): Promise<number> {
      return stretchSeconds;
    }
    dispose(): void {
      disposed.push(this.id);
    }
  }
  class FakeCanvasSink {
    constructor(private readonly track: unknown) {}
    getCanvas(seconds: number): Promise<FakeFrame | null> {
      frameRequests.push({ track: this.track, seconds, sink: this });
      return frameAt(seconds, this.track);
    }
  }
  return {
    ensureMediabunny: async () => ({
      Input: FakeInput,
      BlobSource: class {},
      CanvasSink: FakeCanvasSink,
      ALL_FORMATS: [],
    }),
  };
});

const { describeSampledStretches, loadEncodedIntoAB, onAbDisplaced } = await import("../../src/ui/abPanel");

const SETTINGS: EncodeSettings = {
  quality: "medium",
  crf: 25,
  preset: "superfast",
  scale: 1,
  scaler: "lanczos",
  fps: null,
};

function hostSection(): HTMLDivElement {
  const sec = document.createElement("div");
  sec.style.display = "none";
  document.body.append(sec);
  return sec;
}

/** One encoded stretch per window, at the stub's one-second length apiece. */
function encodedStretches(count: number): Blob[] {
  return Array.from({ length: count }, (_, i) => new Blob(["encoded " + i]));
}

/** What a run hands over with `count` stretches, in the shape the tabs build it but with the stub's
 * values: their bytes added up, and one window per stretch, each at the start of the file and the
 * length the stub says it runs. */
function totalsFor(count: number): { bytes: number; windows: SampleWindow[] } {
  return {
    bytes: heldBytes(encodedStretches(count)),
    windows: Array.from({ length: count }, () => ({ startSeconds: 0, seconds: stretchSeconds })),
  };
}

async function load(host: HTMLDivElement): Promise<void> {
  await loadEncodedIntoAB(encodedStretches(1), SETTINGS, VIDEO_TRACK, host, totalsFor(1));
}

/** A run of `count` one-second stretches, spread a few seconds apart the way the sampler places
 * them, loaded into `host`. */
async function loadSampled(host: HTMLDivElement, count: number): Promise<void> {
  const windows = Array.from({ length: count }, (_, i) => ({ startSeconds: i * 4, seconds: 1 }));
  await loadEncodedIntoAB(encodedStretches(count), SETTINGS, VIDEO_TRACK, host, { bytes: 4096, windows });
}

/** The stretch the ruler has lit, i.e. the one the playhead is in. */
function currentBand(host: HTMLDivElement): number {
  return [...host.querySelectorAll(".compare-reel-seg")].findIndex((b) => b.classList.contains("current"));
}

function reelLabels(host: HTMLDivElement): string[] {
  return [...host.querySelectorAll(".compare-reel-label")].map((l) => l.textContent ?? "");
}

function scrubBar(host: HTMLDivElement): HTMLInputElement {
  return host.querySelector<HTMLInputElement>('.compare-scrub input[type="range"]')!;
}

/** A frame of the given size, for a sink to hand back. */
function frameOf(width: number, height: number): FakeFrame {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return { canvas };
}

/** Has the original's sink hand back `original` and every stretch's sink `encoded`, so that a pane
 * drawn from the other side's frame shows in its size. */
function answerEachSide(original: FakeFrame, encoded: FakeFrame): void {
  frameAt = async (_seconds, track) => (track === state.videoTrack ? original : encoded);
}

/** jsdom has no 2D context; this stands one in that only remembers what was drawn on it. */
function stubCanvasContext(): { drawImage: ReturnType<typeof vi.fn>; smoothing: boolean[] } {
  const drawImage = vi.fn();
  const smoothing: boolean[] = [];
  const ctx = {
    drawImage,
    set imageSmoothingEnabled(on: boolean) {
      smoothing.push(on);
    },
  } as unknown as CanvasRenderingContext2D;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => ctx);
  return { drawImage, smoothing };
}

/** The panes as laid out on a real page, so the zoom buttons have a pane centre to hold still. */
function layOutPanes(width: number, height: number): void {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    width,
    height,
    right: width,
    bottom: height,
    toJSON: () => ({}),
  });
}

function playButton(host: HTMLDivElement): HTMLButtonElement {
  return [...host.querySelectorAll<HTMLButtonElement>(".compare-controls button")].find(
    (b) => b.textContent === "Play" || b.textContent === "Pause",
  )!;
}

function progressLabel(host: HTMLDivElement): string {
  return host.querySelector(".progress-label")!.textContent ?? "";
}

function scrubTo(host: HTMLDivElement, value: number): void {
  const scrub = scrubBar(host);
  scrub.value = String(value);
  scrub.dispatchEvent(new Event("input"));
}

/** The frames asked of the original's sink and of the stretches' sinks, as seconds into each. */
function requestedSeconds(): { original: number[]; encoded: number[] } {
  return {
    original: frameRequests.filter((r) => r.track === state.videoTrack).map((r) => r.seconds),
    encoded: frameRequests.filter((r) => r.track !== state.videoTrack).map((r) => r.seconds),
  };
}

/**
 * The frames asked of the stretches' sinks, as `[stretch, frame]`, for an encode at `rate` frames a
 * second.
 *
 * Read the way the sink under the panel would read them: a stretch's frames start at its own 0 and
 * a frame apart, and mediabunny hands back the last frame starting at or before the time asked for,
 * so the frame is the seconds into the stretch times the rate, rounded down. Nudged by a millionth
 * of a frame first, since mediabunny rounds away the floating-point dust that can leave a whole
 * number of frames a hair under itself.
 */
function encodedFrames(rate: number): [number, number][] {
  return frameRequests
    .filter((r) => r.track !== state.videoTrack)
    .map((r) => [
      sampledEncode.abSegments.findIndex((seg) => seg.sink === r.sink),
      Math.floor(r.seconds * rate + 1e-6),
    ]);
}

/** `[stretch, frame]` for each of a stretch's frames from `first` to `last`, in order. */
function framesOf(stretch: number, first: number, last: number): [number, number][] {
  return Array.from({ length: last - first + 1 }, (_, i) => [stretch, first + i]);
}

/**
 * Has the sinks pause playback from inside a draw once more than `limit` encoded frames have been
 * asked for, answering every request with no frame.
 *
 * A loop that never waits never lets the fake clock move, so one that spins would hang the test
 * rather than fail it; this ends it, and the test's own assertions then say what went wrong. Only
 * while the button reads "Pause", since each draw asks both sides and a second press would play.
 */
function pauseFromDrawAfter(play: HTMLButtonElement, limit: number): void {
  frameAt = async () => {
    if (play.textContent === "Pause" && requestedSeconds().encoded.length > limit) play.click();
    return null;
  };
}

beforeEach(() => {
  document.body.innerHTML = "";
  refuseInput = -1;
  undecodableInput = -1;
  stretchSeconds = 1;
  onOpen = null;
  frameAt = async () => null;
  frameRequests.length = 0;
  // Cleared after the reset, which disposes whatever the test before it left the window holding.
  resetState();
  disposed.length = 0;
  openedInputs = 0;
  state.duration = 20;
  // The panel refuses to draw without one; `requestedSeconds` tells the original's frame requests
  // apart by it, since the sinks are stubbed.
  state.videoTrack = {} as never;
});

// A reel left playing would keep asking the stubs for frames into the next test's window. Once
// paused, its loop still waits on a frame timer, which is let fire so the loop exits rather than
// hanging on a clock that has gone.
afterEach(async () => {
  for (const b of document.querySelectorAll<HTMLButtonElement>("button")) if (b.textContent === "Pause") b.click();
  if (vi.isFakeTimers()) await vi.runOnlyPendingTimersAsync();
  vi.useRealTimers();
  await flush();
  vi.restoreAllMocks();
});

describe("loadEncodedIntoAB", () => {
  it("draws the comparison into the section it was given", async () => {
    const host = hostSection();
    await load(host);
    expect(host.style.display).toBe("block");
    expect(host.querySelector("h2")!.textContent).toBe("Side-by-Side");
    expect(host.querySelectorAll(".compare-pane")).toHaveLength(2);
    expect(sampledEncode.activeCombo).toEqual(SETTINGS);
  });

  // One encode's sinks feed the window, so two tabs cannot both be showing a comparison: the tab
  // that loses it is told, since it has more to put back than the markup.
  it("hands the window over from the tab that had it, telling that tab", async () => {
    const first = hostSection();
    const second = hostSection();
    const displaced = vi.fn();
    onAbDisplaced(first, displaced);

    await load(first);
    await load(second);
    expect(first.innerHTML).toBe("");
    expect(first.style.display).toBe("none");
    expect(displaced).toHaveBeenCalledTimes(1);
    expect(second.querySelector("h2")!.textContent).toBe("Side-by-Side");
  });

  // Loading another file rebuilds the tabs, leaving the section that held the window off the page
  // with its handler still registered. That handler would undo what the rebuilt tab has just set,
  // such as the square a sweep chose.
  it("tells a section that has left the page nothing when the window moves on", async () => {
    const gone = hostSection();
    const displaced = vi.fn();
    onAbDisplaced(gone, displaced);
    await load(gone);
    gone.remove();

    const next = hostSection();
    await load(next);
    expect(displaced).not.toHaveBeenCalled();
    expect(next.querySelector("h2")!.textContent).toBe("Side-by-Side");
  });

  it("leaves the section alone when the same one is loaded again", async () => {
    const host = hostSection();
    const displaced = vi.fn();
    onAbDisplaced(host, displaced);
    await load(host);
    await load(host);
    expect(displaced).not.toHaveBeenCalled();
    expect(host.querySelectorAll(".compare-pane")).toHaveLength(2);
  });

  // The size figures cover every stretch the run measured, so the window has to cover them too: one
  // reel of all of them, rather than the first with the rest thrown away.
  it("loads every sampled stretch as one reel", async () => {
    const host = hostSection();
    await loadSampled(host, 3);
    expect(sampledEncode.abSegments).toHaveLength(3);
    expect(sampledEncode.abSegments.map((seg) => seg.window.startSeconds)).toEqual([0, 4, 8]);
    expect(sampledEncode.encodedSize).toBe(4096);
  });

  // A stretch handed over without a window of its own is placed at the start the run recorded, for
  // as long as it decoded to, so the reel and the panes still have a place in the source for it.
  it("places a stretch that came without a window at the recorded start, for its decoded length", async () => {
    stretchSeconds = 2;
    sampledEncode.startTime = 7;
    const host = hostSection();
    await loadEncodedIntoAB(encodedStretches(2), SETTINGS, VIDEO_TRACK, host, {
      bytes: 10,
      windows: [{ startSeconds: 3, seconds: 2 }],
    });
    expect(sampledEncode.abSegments.map((seg) => seg.window)).toEqual([
      { startSeconds: 3, seconds: 2 },
      { startSeconds: 7, seconds: 2 },
    ]);
    expect(host.querySelectorAll(".compare-reel-seg")).toHaveLength(2);
  });

  // The size estimate beside the panes reads these, so they are the windows the run measured, as
  // handed over, rather than the lengths the stretches decode to here.
  it("keeps the run's own windows and bytes for the size estimate", async () => {
    stretchSeconds = 1.04;
    const windows = [
      { startSeconds: 0, seconds: 1 },
      { startSeconds: 4, seconds: 0.96 },
    ];
    await loadEncodedIntoAB(encodedStretches(2), SETTINGS, VIDEO_TRACK, hostSection(), { bytes: 4096, windows });
    expect(sampledEncode.windows).toEqual(windows);
    expect(sampledEncode.encodedSize).toBe(4096);
  });

  // The stretches are drawn on the bar that plays them: one band apiece, and a boundary between
  // each pair carrying the time in the source it was cut from.
  it("divides the scrub bar into the stretches it plays", async () => {
    const host = hostSection();
    await loadSampled(host, 3);
    const bands = host.querySelectorAll<HTMLElement>(".compare-reel-seg");
    expect(bands).toHaveLength(3);
    expect([...bands].map((b) => b.style.left)).toEqual(["0%", "33.333%", "66.667%"]);
    // A hairline short of a third apiece, which is what leaves a gap at each boundary.
    expect([...bands].map((b) => b.style.width)).toEqual(Array(3).fill("calc(33.333% - 2px)"));
    // Drawn where the bar's own track would be, which is what the stripped-down slider needs.
    expect(bands[0].parentElement!.className).toBe("compare-reel-track");
    expect(host.querySelector(".compare-scrub")!.classList.contains("has-reel")).toBe(true);
    // One boundary more than there are stretches, the last closing the bar off at 9.0s.
    expect(host.querySelectorAll(".compare-reel-tick")).toHaveLength(4);
    expect(reelLabels(host)).toEqual(["0:00", "0:04", "0:08", "0:09"]);
  });

  // Past about six the times stop being read and start being a smear, so the boundaries between
  // the labelled ones are ticks alone.
  it("labels about six of the boundaries however many stretches a run sampled", async () => {
    const host = hostSection();
    await loadSampled(host, 10);
    expect(host.querySelectorAll(".compare-reel-seg")).toHaveLength(10);
    expect(host.querySelectorAll(".compare-reel-tick")).toHaveLength(11);
    expect(reelLabels(host)).toHaveLength(6);
  });

  it("lights the band the playhead is in and steps between them, wrapping either way", async () => {
    const host = hostSection();
    await loadSampled(host, 3);
    const [prev, next] = Array.from(host.querySelectorAll<HTMLButtonElement>(".compare-segment-buttons button"));
    expect(prev.getAttribute("aria-label")).toBe("Jump to the previous sampled segment");
    expect(next.getAttribute("aria-label")).toBe("Jump to the next sampled segment");
    expect(currentBand(host)).toBe(0);
    next.click();
    expect(currentBand(host)).toBe(1);
    // Round the cycle rather than off the end of it: the reel loops, so the buttons do too.
    next.click();
    next.click();
    expect(currentBand(host)).toBe(0);
    prev.click();
    expect(currentBand(host)).toBe(2);
  });

  it("scrubs across the whole reel rather than one stretch of it", async () => {
    const host = hostSection();
    await loadSampled(host, 3);
    const scrub = scrubBar(host);
    // Half way along a three-second reel is a second and a half in, which is the second stretch.
    scrubTo(host, 500);
    expect(progressLabel(host)).toBe("1.50s");
    expect(currentBand(host)).toBe(1);
    // What the bands say, said in words: they sit under the slider and can carry no tooltip of
    // their own, and the slider's own value is a thousandth of a reel.
    const where = "1.50s · Segment 2 of 3 · 4.0s–5.0s in the source";
    expect(scrub.getAttribute("aria-label")).toBe("Playback position across the sampled segments");
    expect(scrub.getAttribute("aria-valuetext")).toBe(where);
    expect(scrub.title).toBe(where);
  });

  // Nothing to divide a bar into, so the slider keeps the track it came with.
  it("leaves the ruler and the step buttons out when a run sampled a single stretch", async () => {
    const host = hostSection();
    await loadSampled(host, 1);
    expect(host.querySelector(".compare-reel")).toBeNull();
    expect(host.querySelector(".compare-reel-track")).toBeNull();
    expect(host.querySelector(".compare-scrub")!.classList.contains("has-reel")).toBe(false);
    expect(host.querySelector(".compare-segment-buttons")).toBeNull();
    expect(scrubBar(host)).not.toBeNull();
  });

  it("lets go of the stretches it was showing when the next encode takes over", async () => {
    const host = hostSection();
    await loadSampled(host, 3);
    await loadSampled(host, 2);
    expect(disposed).toEqual([0, 1, 2]);
    expect(sampledEncode.encodedInputs).toHaveLength(2);
  });

  // A run that will not open all the way leaves the comparison that is already up alone, rather
  // than half a new one: the panes would otherwise still be drawing from sinks nothing points at.
  it("keeps the loaded comparison when a later stretch will not open", async () => {
    const host = hostSection();
    await loadSampled(host, 2);
    const held = sampledEncode.encodedInputs;
    // The second stretch of the run about to be loaded is the one that will not open.
    refuseInput = openedInputs + 1;
    await expect(loadSampled(host, 3)).rejects.toThrow("no video track");
    expect(sampledEncode.encodedInputs).toBe(held);
    expect(sampledEncode.abSegments).toHaveLength(2);
    // The two it did open on the way to failing are let go of; the two still showing are not.
    expect(disposed).toEqual([2, 3]);
  });
});

describe("loadEncodedIntoAB refusals", () => {
  it("refuses a run with nothing in it, and a window with no video track", async () => {
    const host = hostSection();
    await expect(loadEncodedIntoAB([], SETTINGS, VIDEO_TRACK, host, totalsFor(0))).rejects.toThrow(
      "No encoded segment",
    );
    state.videoTrack = null;
    await expect(load(host)).rejects.toThrow("No video track loaded");
    expect(host.style.display).toBe("none");
  });

  // Asked up front rather than found out in the playback loop, where the failure would surface as
  // an unhandled rejection with nothing under the panes to say why.
  it("refuses an encode the browser will not decode, letting go of what it opened", async () => {
    const host = hostSection();
    undecodableInput = 0;
    await expect(load(host)).rejects.toThrow("will not decode the encode");
    expect(disposed).toEqual([0]);
    expect(sampledEncode.abSegments).toHaveLength(0);
    expect(host.style.display).toBe("none");
  });

  // Stopped part-way through opening its stretches, by Stop or by a file load or Reset, a run puts
  // nothing in the window: after a load, the window and the state behind it are another file's.
  it("puts nothing in the window for a run stopped while its stretches were being opened", async () => {
    const host = hostSection();
    await loadSampled(host, 2);
    const held = sampledEncode.encodedInputs;
    const run = { tab: "Compare Quality", stoppable: true, stopped: false, workers: new Set() };
    onOpen = () => {
      run.stopped = true;
    };
    const windows = [{ startSeconds: 0, seconds: 1 }];
    await expect(
      loadEncodedIntoAB(encodedStretches(1), SETTINGS, VIDEO_TRACK, host, { bytes: 1, windows }, run as never),
    ).rejects.toThrow("Stopped");
    expect(sampledEncode.encodedInputs).toBe(held);
    expect(sampledEncode.abSegments).toHaveLength(2);
    expect(disposed).toEqual([2]);
  });
});

describe("the panes", () => {
  // The reel's second is not the source's: the original is read from where the stretch on screen
  // was cut, so both sides show the same seconds however far the reel has run.
  it("reads the original at the seconds the stretch on the other side was cut from", async () => {
    const host = hostSection();
    await loadSampled(host, 3);
    expect(requestedSeconds()).toEqual({ original: [0], encoded: [0] });
    frameRequests.length = 0;
    // Half way along the three-second reel is half a second into the second stretch, cut at 4s.
    scrubTo(host, 500);
    expect(requestedSeconds()).toEqual({ original: [4.5], encoded: [0.5] });
  });

  // A sink asked for the very end of its stretch has no frame to give, so the reel's last
  // thousandth stops a hair short of it.
  it("stops a hair short of the end of the last stretch", async () => {
    const host = hostSection();
    await loadSampled(host, 2);
    frameRequests.length = 0;
    scrubTo(host, 1000);
    expect(requestedSeconds()).toEqual({ original: [4.999], encoded: [0.999] });
  });

  it("draws each decoded frame onto its pane at the frame's own size", async () => {
    const { drawImage } = stubCanvasContext();
    const original = frameOf(320, 240);
    const encoded = frameOf(160, 120);
    answerEachSide(original, encoded);
    const host = hostSection();
    await load(host);
    await flush();
    const [origCanvas, encCanvas] = Array.from(host.querySelectorAll("canvas"));
    expect([origCanvas.width, origCanvas.height]).toEqual([320, 240]);
    expect([encCanvas.width, encCanvas.height]).toEqual([160, 120]);
    expect(drawImage).toHaveBeenCalledTimes(2);
    expect(drawImage).toHaveBeenCalledWith(original.canvas, 0, 0, 320, 240);
    expect(drawImage).toHaveBeenCalledWith(encoded.canvas, 0, 0, 160, 120);
  });

  // A downscaled encode is drawn back at the source's geometry, so one zoom shows the same part of
  // the frame on each side; how it is drawn back up is the viewer's call.
  it("draws a downscaled encode back at the source's size, one block per pixel by default", async () => {
    const { drawImage, smoothing } = stubCanvasContext();
    // The source's own 640×480 against the half-size encode's 320×240.
    const original = frameOf(640, 480);
    const encoded = frameOf(320, 240);
    answerEachSide(original, encoded);
    const host = hostSection();
    await loadEncodedIntoAB(encodedStretches(1), { ...SETTINGS, scale: 0.5 }, VIDEO_TRACK, host, totalsFor(1));
    await flush();
    const [origCanvas, encCanvas] = Array.from(host.querySelectorAll("canvas"));
    expect([origCanvas.width, origCanvas.height]).toEqual([640, 480]);
    expect([encCanvas.width, encCanvas.height]).toEqual([640, 480]);
    expect(drawImage).toHaveBeenCalledWith(original.canvas, 0, 0, 640, 480);
    expect(drawImage).toHaveBeenLastCalledWith(encoded.canvas, 0, 0, 640, 480);
    expect(smoothing).toEqual([false, false]);
  });

  // Not throwing is the behaviour under test: the canvas takes the frame's size, then nothing is
  // drawn on it and nothing is reported under the panes.
  it("gives up on the draw quietly when the canvas will not give a drawing context", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => null);
    frameAt = async () => frameOf(320, 240);
    const host = hostSection();
    await load(host);
    await flush();
    expect(host.querySelector("canvas")!.width).toBe(320);
    expect(host.querySelector(".error-msg")!.textContent).toBe("");
  });

  // A frame that will not decode used to freeze the panes silently; the section is for the
  // comparison, so it says so under the panes.
  it("says so under the panes when the comparison will not draw", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    frameAt = async () => {
      throw new Error("no keyframe");
    };
    const host = hostSection();
    await load(host);
    await flush();
    const msg = host.querySelector<HTMLElement>(".error-msg")!;
    expect(msg.textContent).toBe("Could not draw the comparison: no keyframe");
    // "block" rather than cleared: the class's own rule hides it, as it hides #errorMsg.
    expect(msg.style.display).toBe("block");
    expect(error).toHaveBeenCalledWith("[encoding-helper] could not draw the comparison:", expect.any(Error));
  });

  // Dragging the slider draws as the view switch and the step buttons do, so a frame that will not
  // decode there is said under the panes too rather than left as an unhandled rejection.
  it("says so under the panes when a scrubbed-to frame will not draw", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const host = hostSection();
    await loadSampled(host, 2);
    await flush();
    const msg = host.querySelector<HTMLElement>(".error-msg")!;
    expect(msg.style.display).toBe("none");
    frameAt = async () => {
      throw new Error("no keyframe");
    };
    scrubTo(host, 750);
    await flush();
    expect(msg.textContent).toBe("Could not draw the comparison: no keyframe");
    expect(msg.style.display).toBe("block");
    expect(error).toHaveBeenCalledWith("[encoding-helper] could not draw the comparison:", expect.any(Error));
  });

  // The message is about the frame that would not draw, so the next one that does takes it away.
  it("takes the message away once a later frame draws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    frameAt = async () => {
      throw new Error("no keyframe");
    };
    const host = hostSection();
    await loadSampled(host, 2);
    await flush();
    const msg = host.querySelector<HTMLElement>(".error-msg")!;
    expect(msg.style.display).toBe("block");
    const { drawImage } = stubCanvasContext();
    frameAt = async () => frameOf(320, 240);
    scrubTo(host, 750);
    await flush();
    expect(drawImage).toHaveBeenCalledTimes(2);
    expect(msg.style.display).toBe("none");
  });

  // The panel's handlers outlive the window's contents when a new file is opened under them: they
  // fall back to the start rather than reading a stretch that is no longer there.
  it("falls back to the start of the reel once the window has been emptied under it", async () => {
    const host = hostSection();
    await loadSampled(host, 2);
    resetState();
    frameRequests.length = 0;
    scrubTo(host, 750);
    expect(progressLabel(host)).toBe("1.50s");
    expect(currentBand(host)).toBe(0);
    expect(frameRequests).toHaveLength(0);
  });
});

describe("a downscaled encode", () => {
  const DOWNSCALED: EncodeSettings = { ...SETTINGS, scale: 0.5 };

  it("says what resolution it was encoded at, and offers how to draw it back up", async () => {
    const host = hostSection();
    await loadEncodedIntoAB(encodedStretches(1), DOWNSCALED, VIDEO_TRACK, host, totalsFor(1));
    expect(host.querySelector(".grid")!.textContent).toContain("Resolution");
    const encLabel = host.querySelectorAll(".pane-label")[1];
    expect(encLabel.textContent).toBe("Encoded (medium, superfast, 320×240)");
    expect(encLabel.getAttribute("title")).toContain("one block per encoded pixel");
    const select = host.querySelector<HTMLSelectElement>("#etUpscaleView")!;
    expect(select.value).toBe("blocks");
  });

  it("leaves the view control out when nothing is drawn back up", async () => {
    const host = hostSection();
    await load(host);
    expect(host.querySelector("#etUpscaleView")).toBeNull();
    expect(host.querySelector(".grid")!.textContent).not.toContain("Resolution");
    expect(host.querySelectorAll(".pane-label")[1].getAttribute("title")).toBeNull();
  });

  // The switch shows on the frame being looked at rather than only on the next one.
  it("redraws the frame on screen when the view is switched to smooth", async () => {
    const { smoothing } = stubCanvasContext();
    frameAt = async () => frameOf(320, 240);
    const host = hostSection();
    await loadEncodedIntoAB(encodedStretches(1), DOWNSCALED, VIDEO_TRACK, host, totalsFor(1));
    await flush();
    frameRequests.length = 0;
    const select = host.querySelector<HTMLSelectElement>("#etUpscaleView")!;
    select.value = "smooth";
    select.dispatchEvent(new Event("change"));
    await flush();
    expect(sampledEncode.upscaleSmoothing).toBe(true);
    expect(host.querySelectorAll(".pane-label")[1].getAttribute("title")).toContain("with smoothing");
    expect(requestedSeconds()).toEqual({ original: [0], encoded: [0] });
    expect(smoothing).toEqual([false, false, true, true]);
    // Remembered across loads, so the next comparison opens on the view the reader chose.
    const again = hostSection();
    await loadEncodedIntoAB(encodedStretches(1), DOWNSCALED, VIDEO_TRACK, again, totalsFor(1));
    expect(again.querySelector<HTMLSelectElement>("#etUpscaleView")!.value).toBe("smooth");
  });
});

// Fewer frames is a change the panes alone do not show, and the comparison is not like for like
// without it, so the summary says so; at the source's own rate the row would say nothing.
describe("an encode at a frame rate of its own", () => {
  it("states the rate it was encoded at against the source's", async () => {
    state.fps = 30;
    const host = hostSection();
    await loadEncodedIntoAB(encodedStretches(1), { ...SETTINGS, fps: 15 }, VIDEO_TRACK, host, totalsFor(1));
    expect(gridValue(host, "Frame Rate")).toBe("30 fps → 15 fps");
  });

  it("states the rate alone when the source's is not known", async () => {
    state.fps = null;
    const host = hostSection();
    await loadEncodedIntoAB(encodedStretches(1), { ...SETTINGS, fps: 12 }, VIDEO_TRACK, host, totalsFor(1));
    expect(gridValue(host, "Frame Rate")).toBe("12 fps");
  });

  it("leaves the rate out of an encode made at the source's", async () => {
    state.fps = 30;
    const host = hostSection();
    await load(host);
    expect(gridRows(host).map((row) => row.label)).not.toContain("Frame Rate");
  });

  // The Reencode tab's FPS override takes any rate, the source's own included.
  it("leaves the rate out of an encode given the source's rate as its own", async () => {
    state.fps = 30;
    const host = hostSection();
    await loadEncodedIntoAB(encodedStretches(1), { ...SETTINGS, fps: 30 }, VIDEO_TRACK, host, totalsFor(1));
    expect(gridRows(host).map((row) => row.label)).not.toContain("Frame Rate");
  });
});

describe("the size estimate", () => {
  it("heads the panes with the savings and follows the controls with the detail", async () => {
    state.source = { kind: "file", name: "clip.mp4", size: 2_000_000 } as never;
    const host = hostSection();
    await loadSampled(host, 2);
    const headings = [...host.querySelectorAll("h3")].map((el) => el.textContent);
    expect(headings).toEqual(["Estimated Data Savings", "Estimate Detail"]);
    expect(host.querySelector(".savings")).not.toBeNull();
    // 4 KB for two seconds of a 2 MB, twenty-second file.
    expect(host.querySelector(".savings-headline")!.textContent).toBe("98% smaller");
    // Order on the page: strip, panes, controls, detail.
    const children = Array.from(host.children).map((el) => el.className);
    expect(children.indexOf("savings")).toBeLessThan(children.indexOf("compare-stage"));
    expect(children.lastIndexOf("grid")).toBeGreaterThan(children.indexOf("compare-controls"));
  });

  it("leaves the estimate out before the file's own size is known", async () => {
    const host = hostSection();
    await load(host);
    expect(host.querySelector(".savings")).toBeNull();
    expect([...host.querySelectorAll("h3")]).toHaveLength(0);
  });
});

describe("the zoom buttons", () => {
  function zoomButtons(host: HTMLDivElement): HTMLButtonElement[] {
    return Array.from(host.querySelectorAll<HTMLButtonElement>(".zoom-buttons button"));
  }

  function transforms(host: HTMLDivElement): string[] {
    return Array.from(host.querySelectorAll("canvas")).map((c) => c.style.transform);
  }

  // No wheel on a touch device or a plain mouse, so every zoom move has a button.
  it("zooms both panes together about the middle of the pane", async () => {
    layOutPanes(320, 240);
    const host = hostSection();
    await load(host);
    const [zoomOut, zoomIn, fit] = zoomButtons(host);
    zoomIn.click();
    expect(transforms(host)).toEqual(Array(2).fill("translate(-80px, -60px) scale(1.5)"));
    zoomIn.click();
    expect(transforms(host)).toEqual(Array(2).fill("translate(-200px, -150px) scale(2.25)"));
    zoomOut.click();
    expect(transforms(host)[0]).toBe("translate(-80px, -60px) scale(1.5)");
    fit.click();
    expect(transforms(host)).toEqual(Array(2).fill("translate(0px, 0px) scale(1)"));
  });

  it("shows one source pixel per CSS pixel at Actual Size", async () => {
    layOutPanes(320, 240);
    const host = hostSection();
    await load(host);
    const actual = zoomButtons(host)[3];
    expect(actual.textContent).toBe("Actual Size (100%)");
    actual.click();
    // 640 source pixels across a 320px pane is twice the fit scale, held about the pane's centre.
    expect(transforms(host)).toEqual(Array(2).fill("translate(-160px, -120px) scale(2)"));
  });

  it("greys out the button whose end of the range has been reached", async () => {
    layOutPanes(320, 240);
    const host = hostSection();
    await load(host);
    const [zoomOut, zoomIn] = zoomButtons(host);
    expect([zoomOut.disabled, zoomIn.disabled]).toEqual([false, false]);
    for (let i = 0; i < 4; i++) zoomOut.click();
    expect(transforms(host)[0]).toContain("scale(0.2)");
    expect([zoomOut.disabled, zoomIn.disabled]).toEqual([true, false]);
    for (let i = 0; i < 14; i++) zoomIn.click();
    expect(transforms(host)[0]).toContain("scale(50)");
    expect([zoomOut.disabled, zoomIn.disabled]).toEqual([false, true]);
  });
});

// Playback is paced off the wall clock, which the fake timers stand in for: each frame's wait is a
// timer, and advancing the clock is what moves the reel.
describe("playback", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("plays from the playhead at the source's frame rate, and pauses where it is", async () => {
    const host = hostSection();
    await loadSampled(host, 3);
    // Parked half way through the second stretch, so a run that started anywhere but the playhead
    // would show.
    scrubTo(host, 500);
    frameRequests.length = 0;
    const play = playButton(host);
    play.click();
    expect(play.textContent).toBe("Pause");
    await vi.advanceTimersByTimeAsync(0);
    expect(progressLabel(host)).toBe("1.50s");
    // Three frames of a 30 fps reel is a tenth of a second, each asked for at the second the clock
    // had reached rather than the one after the last: 0.6s into the second stretch.
    await vi.advanceTimersByTimeAsync(100);
    expect(progressLabel(host)).toBe("1.60s");
    expect(requestedSeconds().encoded.at(-1)).toBeCloseTo(0.6);
    expect(currentBand(host)).toBe(1);
    play.click();
    expect(play.textContent).toBe("Play");
    const drawn = frameRequests.length;
    await vi.advanceTimersByTimeAsync(500);
    expect(progressLabel(host)).toBe("1.60s");
    expect(frameRequests).toHaveLength(drawn);
  });

  // A rate other than the fixture's 30, so a pace that ignored the track's own would show.
  it("paces a 10 fps track a tenth of a second a frame", async () => {
    const host = hostSection();
    await loadEncodedIntoAB(encodedStretches(1), SETTINGS, { ...VIDEO_TRACK, packetRate: 10 }, host, totalsFor(1));
    frameRequests.length = 0;
    playButton(host).click();
    await vi.advanceTimersByTimeAsync(250);
    expect(requestedSeconds().encoded).toEqual([0, 0.1, 0.2]);
  });

  // Parked where floating point puts the next frame a hair short of itself ((0.6 - 0.5) / 0.1 is
  // 0.9999999999999998), which had the loop ask for the frame it had just drawn over and over with
  // no wait. At 10 fps a frame is a whole number of milliseconds, which the fake timers keep to.
  it("steps one frame at a time from a playhead parked at half a second", async () => {
    const host = hostSection();
    await loadEncodedIntoAB(encodedStretches(1), SETTINGS, { ...VIDEO_TRACK, packetRate: 10 }, host, totalsFor(1));
    scrubTo(host, 500);
    frameRequests.length = 0;
    const play = playButton(host);
    // A loop that never waits never lets the clock move, so it is stopped from inside a draw once
    // it has asked for more frames than the span holds.
    frameAt = async () => {
      if (requestedSeconds().encoded.length > 4) play.click();
      return null;
    };
    play.click();
    await vi.advanceTimersByTimeAsync(300);
    expect(requestedSeconds().encoded).toEqual([0.5, 0.6, 0.7, 0.8]);
  });

  it("asks for each frame once at 30 fps, whose frame time is not a whole number of milliseconds", async () => {
    const host = hostSection();
    await loadEncodedIntoAB(encodedStretches(1), SETTINGS, VIDEO_TRACK, host, totalsFor(1));
    scrubTo(host, 500);
    frameRequests.length = 0;
    const play = playButton(host);
    frameAt = async () => {
      if (requestedSeconds().encoded.length > 8) play.click();
      return null;
    };
    play.click();
    // A frame is 33.3 ms; four of them land inside 101 ms.
    await vi.advanceTimersByTimeAsync(101);
    const frames = requestedSeconds().encoded.map((t) => Math.floor(t * 30 + 1e-6));
    expect(frames).toEqual([15, 16, 17, 18]);
  });

  // Each playhead is parked just short of the end of a frame. Wakes timed from there would each sit
  // just short of a frame's end as well, where rounding the timer up to whole milliseconds carries
  // some into the frame after and not others: one frame skipped, the next asked for twice.
  it.each([
    { at: "29.97 fps from 0.5s", rate: 30000 / 1001, seconds: 2, scrub: 250, first: 14, last: 26 },
    { at: "59.94 fps from 0.5s", rate: 60000 / 1001, seconds: 2, scrub: 250, first: 29, last: 53 },
    { at: "29.97 fps from 0.333s", rate: 30000 / 1001, seconds: 1, scrub: 333, first: 9, last: 21 },
    { at: "30 fps from 0.033s", rate: 30, seconds: 1, scrub: 33, first: 0, last: 12 },
  ])("asks for each frame once and in order at $at", async ({ rate, seconds, scrub, first, last }) => {
    stretchSeconds = seconds;
    const host = hostSection();
    await loadEncodedIntoAB(encodedStretches(1), SETTINGS, { ...VIDEO_TRACK, packetRate: rate }, host, totalsFor(1));
    scrubTo(host, scrub);
    frameRequests.length = 0;
    playButton(host).click();
    await vi.advanceTimersByTimeAsync(400);
    expect(encodedFrames(rate)).toEqual(framesOf(0, first, last));
  });

  // A draw that runs past the next frame's start is followed at once by whichever frame the clock
  // has reached; the waits after it still have to land at the start of each frame.
  it("never asks for a frame twice or goes back when some draws take longer than a frame", async () => {
    const host = hostSection();
    await load(host);
    // Half-way through the second frame of the 30 fps reel.
    scrubTo(host, 50);
    frameRequests.length = 0;
    // Every other encoded frame takes 50 ms to come back, a frame and a half.
    let asked = 0;
    frameAt = (_seconds, track) =>
      track === state.videoTrack || ++asked % 2 === 1
        ? Promise.resolve(null)
        : new Promise((resolve) => setTimeout(() => resolve(null), 50));
    playButton(host).click();
    await vi.advanceTimersByTimeAsync(400);
    const frames = encodedFrames(30).map(([, frame]) => frame);
    // Each one later than the one before it: none asked for twice in a row, none gone back to.
    expect(frames.filter((frame, i) => i > 0 && frame <= frames[i - 1])).toEqual([]);
    // Still on the wall clock: 0.45s, which is in frame 13.
    expect(frames.at(-1)).toBe(13);
  });

  // 300 thousandths of the three-second reel come to a hair under 0.9s in floating point, so the
  // clock reaches the end of the first stretch a hair short of where the stretch says it ends.
  it("starts the next stretch at its first frame, without repeating the last one before it", async () => {
    const host = hostSection();
    await loadSampled(host, 3);
    scrubTo(host, 300);
    frameRequests.length = 0;
    playButton(host).click();
    await vi.advanceTimersByTimeAsync(300);
    expect(encodedFrames(30)).toEqual([...framesOf(0, 27, 29), ...framesOf(1, 0, 6)]);
    // At the very start of the second stretch, on both sides: it was cut from 4s into the source.
    expect(requestedSeconds().encoded[3]).toBe(0);
    expect(requestedSeconds().original[3]).toBe(4);
  });

  // Each stretch runs half a millisecond past its thirtieth frame, so a 31st would start in the last
  // thousandth of it, which is never drawn: the next thing to show is the next stretch.
  it("starts the next stretch rather than wait for a frame that would begin in this one's last thousandth", async () => {
    stretchSeconds = 1.0005;
    const host = hostSection();
    await loadEncodedIntoAB(encodedStretches(2), SETTINGS, VIDEO_TRACK, host, totalsFor(2));
    // Just past 0.9s into the reel.
    scrubTo(host, 450);
    frameRequests.length = 0;
    playButton(host).click();
    await vi.advanceTimersByTimeAsync(150);
    expect(encodedFrames(30)).toEqual([...framesOf(0, 27, 29), ...framesOf(1, 0, 1)]);
  });

  // Three stretches of 0.4s add up to a hair over 1.2s in floating point, so the clock reaches the
  // end of the reel a hair short of where the stretches say it ends.
  it("goes from the reel's last frame to its first without repeating the last", async () => {
    stretchSeconds = 0.4;
    const host = hostSection();
    await loadEncodedIntoAB(encodedStretches(3), SETTINGS, { ...VIDEO_TRACK, packetRate: 25 }, host, totalsFor(3));
    frameRequests.length = 0;
    const play = playButton(host);
    // Past the 33 frames this run asks for.
    pauseFromDrawAfter(play, 40);
    play.click();
    await vi.advanceTimersByTimeAsync(1300);
    expect(encodedFrames(25)).toEqual([
      ...framesOf(0, 0, 9),
      ...framesOf(1, 0, 9),
      ...framesOf(2, 0, 9),
      ...framesOf(0, 0, 2),
    ]);
  });

  // A stretch with no length has no next frame in it to wake for, so the loop waits a frame rather
  // than drawing again at once, over and over.
  it("waits a frame at a time through stretches with no length", async () => {
    stretchSeconds = 0;
    const host = hostSection();
    await loadSampled(host, 2);
    frameRequests.length = 0;
    const play = playButton(host);
    pauseFromDrawAfter(play, 20);
    play.click();
    await vi.advanceTimersByTimeAsync(100);
    // A frame at 0 and one a frame after each, rather than as many as the loop could ask for.
    expect(requestedSeconds().encoded.length).toBeLessThanOrEqual(4);
  });

  // The encoded side is the one being judged, so it is stepped through a frame at a time at the rate
  // it was encoded at, and the original is read at the same instants.
  it("steps at the encode's own frame rate when the run changed it", async () => {
    const host = hostSection();
    await loadEncodedIntoAB(encodedStretches(1), { ...SETTINGS, fps: 15 }, VIDEO_TRACK, host, totalsFor(1));
    frameRequests.length = 0;
    playButton(host).click();
    await vi.advanceTimersByTimeAsync(400);
    expect(encodedFrames(15)).toEqual(framesOf(0, 0, 6));
    // Every other frame of the 30 fps source.
    const original = requestedSeconds().original.map((t) => Math.floor(t * 30 + 1e-6));
    expect(original).toEqual([0, 2, 4, 6, 8, 10, 12]);
  });

  // The reel is every stretch end to end, played through and then back to the first, the way a
  // player set to repeat would.
  it("runs through every stretch and loops back to the first", async () => {
    const host = hostSection();
    await loadSampled(host, 2);
    const play = playButton(host);
    // Past the 65 frames this run asks for, the one drawn on loading included.
    pauseFromDrawAfter(play, 100);
    play.click();
    await vi.advanceTimersByTimeAsync(1500);
    expect(currentBand(host)).toBe(1);
    expect(progressLabel(host)).toBe("1.50s");
    await vi.advanceTimersByTimeAsync(600);
    expect(currentBand(host)).toBe(0);
    expect(progressLabel(host)).toBe("0.10s");
    expect(playButton(host).textContent).toBe("Pause");
  });

  it("starts the reel over when Play is pressed with the playhead parked at the end", async () => {
    const host = hostSection();
    await load(host);
    // Inside the last frame rather than on the very end, where the loop's own wrap would start the
    // reel over whether or not Play did.
    scrubTo(host, 990);
    expect(progressLabel(host)).toBe("0.99s");
    playButton(host).click();
    await vi.advanceTimersByTimeAsync(0);
    expect(progressLabel(host)).toBe("0.00s");
    expect(scrubBar(host).value).toBe("0");
  });

  it("moves the playhead when scrubbed or stepped mid-playback rather than stopping", async () => {
    const host = hostSection();
    await loadSampled(host, 3);
    const play = playButton(host);
    play.click();
    await vi.advanceTimersByTimeAsync(100);
    scrubTo(host, 500);
    expect(progressLabel(host)).toBe("1.50s");
    await vi.advanceTimersByTimeAsync(100);
    expect(play.textContent).toBe("Pause");
    expect(progressLabel(host)).toBe("1.60s");
    const next = host.querySelectorAll<HTMLButtonElement>(".compare-segment-buttons button")[1];
    next.click();
    expect(progressLabel(host)).toBe("2.00s");
    await vi.advanceTimersByTimeAsync(100);
    expect(progressLabel(host)).toBe("2.10s");
    expect(currentBand(host)).toBe(2);
  });

  // A frame that will not decode ends playback rather than leaving the button stuck on Pause, and
  // says why under the panes, as a scrub or a step that will not draw does.
  it("ends playback when a frame will not decode, and says so under the panes", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const host = hostSection();
    await load(host);
    frameAt = async () => {
      throw new Error("decoder gone");
    };
    const play = playButton(host);
    play.click();
    expect(play.textContent).toBe("Pause");
    await vi.advanceTimersByTimeAsync(0);
    expect(play.textContent).toBe("Play");
    expect(error).toHaveBeenCalledWith("[encoding-helper] playback stopped:", expect.any(Error));
    const msg = host.querySelector<HTMLElement>(".error-msg")!;
    expect(msg.textContent).toBe("Could not draw the comparison: decoder gone");
    expect(msg.style.display).toBe("block");
  });

  // A loop still waiting on a frame when Play is pressed again must neither keep drawing nor stop
  // the run that replaced it.
  it("lets a run left over from before a pause die without stopping the one after it", async () => {
    const host = hostSection();
    await load(host);
    const play = playButton(host);
    play.click();
    await vi.advanceTimersByTimeAsync(0);
    play.click();
    frameRequests.length = 0;
    play.click();
    expect(play.textContent).toBe("Pause");
    await vi.advanceTimersByTimeAsync(200);
    expect(play.textContent).toBe("Pause");
    expect(progressLabel(host)).toBe("0.20s");
    // One loop's frames: a stale loop still drawing would ask for each second a second time.
    const encoded = requestedSeconds().encoded;
    expect(encoded).toEqual([...new Set(encoded)]);
  });

  // Loading another file rebuilds the tab the window was in, taking its Pause button off the page
  // with it, so nothing would be left to stop a loop decoding into canvases no one can see.
  it("ends playback once its section has left the page", async () => {
    const host = hostSection();
    await load(host);
    const play = playButton(host);
    play.click();
    await vi.advanceTimersByTimeAsync(50);
    host.remove();
    await vi.advanceTimersByTimeAsync(100);
    frameRequests.length = 0;
    await vi.advanceTimersByTimeAsync(200);
    expect(frameRequests).toEqual([]);
    expect(play.textContent).toBe("Play");
  });

  it("halts the run before it when a fresh comparison takes the window", async () => {
    const host = hostSection();
    await load(host);
    const play = playButton(host);
    play.click();
    await vi.advanceTimersByTimeAsync(50);
    frameRequests.length = 0;
    await load(host);
    expect(play.textContent).toBe("Play");
    await vi.advanceTimersByTimeAsync(200);
    // Only the fresh window's first frame: the old loop drew nothing more.
    expect(requestedSeconds().encoded).toEqual([0]);
  });

  // The old loop's frame comes back after the window has moved on to a run with more stretches, so
  // where its playhead falls in the new reel is a stretch the old one never had.
  it("lets a run die quietly when a comparison with more stretches loads while it waits on a frame", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    stretchSeconds = 2;
    const host = hostSection();
    await load(host);
    // 1.5s into the one two-second stretch, which is in the second of three one-second ones.
    scrubTo(host, 750);
    let release = (): void => {};
    frameAt = (_seconds, track) =>
      track === state.videoTrack ? Promise.resolve(null) : new Promise((resolve) => (release = () => resolve(null)));
    playButton(host).click();
    await vi.advanceTimersByTimeAsync(0);
    frameAt = async () => null;
    stretchSeconds = 1;
    await loadSampled(host, 3);
    release();
    await vi.advanceTimersByTimeAsync(100);
    expect(error.mock.calls).toEqual([]);
  });
});

describe("the heading and labels", () => {
  // A host marked ab-inline is a block inside the card that ran the encode, so its heading ranks
  // under that card's rather than beside it.
  it("heads an inline host at the rank of the card's own sections", async () => {
    const host = hostSection();
    host.classList.add("ab-inline");
    await load(host);
    expect(host.querySelector("h2")).toBeNull();
    expect(host.querySelector("h3")!.textContent).toBe("Side-by-Side");
  });

  // The encoded size is the one stretch's own bytes: "encoded 0" is nine of them.
  it("lists the seconds encoded, the settings and the size above the panes, in that order", async () => {
    const host = hostSection();
    await load(host);
    expect(gridRows(host.querySelector(".grid")!)).toEqual([
      { label: "Segment", value: "0.0s–1.0s", info: false, sm: false },
      { label: "Quality", value: "medium (CRF 25)", info: false, sm: false },
      { label: "Preset", value: "superfast", info: false, sm: false },
      { label: "Encoded Segment Size", value: "9 B", info: false, sm: false },
    ]);
  });

  it("puts a downscaled encode's resolution between its settings and its size", async () => {
    const host = hostSection();
    await loadEncodedIntoAB(encodedStretches(1), { ...SETTINGS, scale: 0.5 }, VIDEO_TRACK, host, {
      bytes: 9,
      windows: [{ startSeconds: 0, seconds: stretchSeconds }],
    });
    expect(gridRows(host.querySelector(".grid")!).map((row) => [row.label, row.value])).toEqual([
      ["Segment", "0.0s–1.0s"],
      ["Quality", "medium (CRF 25)"],
      ["Preset", "superfast"],
      ["Resolution", "640×480 → 320×240 (50%, lanczos)"],
      ["Encoded Segment Size", "9 B"],
    ]);
  });

  it("labels a custom-quality encode by its CRF", async () => {
    const host = hostSection();
    await loadEncodedIntoAB(
      encodedStretches(1),
      { ...SETTINGS, quality: "custom", crf: 18 },
      VIDEO_TRACK,
      host,
      totalsFor(1),
    );
    expect(host.querySelectorAll(".pane-label")[1].textContent).toBe("Encoded (CRF 18, superfast)");
  });

  // A track the probe could not size or time still gets a comparison: the panes start empty and
  // playback paces itself at thirty frames a second.
  it("copes with a track of unknown size and frame rate", async () => {
    vi.useFakeTimers();
    const host = hostSection();
    const bare = { ...VIDEO_TRACK, packetRate: null, codedWidth: undefined, codedHeight: undefined };
    await loadEncodedIntoAB(encodedStretches(1), SETTINGS, bare, host, totalsFor(1));
    const [orig, enc] = Array.from(host.querySelectorAll("canvas"));
    expect([orig.width, orig.height, enc.width, enc.height]).toEqual([0, 0, 0, 0]);
    expect(host.querySelector<HTMLElement>(".compare-pane")!.style.aspectRatio).toBe("0 / 0");
    frameRequests.length = 0;
    playButton(host).click();
    await vi.advanceTimersByTimeAsync(100);
    expect(requestedSeconds().encoded.at(-1)).toBe(0.1);
    expect(host.querySelector(".grid")!.textContent).not.toContain("Resolution");
  });

  it("still labels the ruler when the file's length is unknown", async () => {
    state.duration = null;
    const host = hostSection();
    await loadSampled(host, 2);
    expect(reelLabels(host)).toEqual(["0:00", "0:04", "0:05"]);
  });

  // Nothing to be a fraction of otherwise: the bar keeps a second of range and the band its start.
  it("keeps a range for the bar when a run came out with no length", async () => {
    stretchSeconds = 0;
    const host = hostSection();
    await loadSampled(host, 2);
    const bands = host.querySelectorAll<HTMLElement>(".compare-reel-seg");
    expect([...bands].map((b) => b.style.left)).toEqual(["0%", "0%"]);
    scrubTo(host, 500);
    expect(progressLabel(host)).toBe("0.50s");
  });
});

describe("describeSampledStretches", () => {
  it("falls back to the run's own start and length before a run has loaded", () => {
    sampledEncode.startTime = 3;
    sampledEncode.duration = 5;
    expect(describeSampledStretches()).toBe("3.0s–8.0s");
  });

  it("says how many stretches a run sampled and where the first was", async () => {
    await loadSampled(hostSection(), 3);
    expect(describeSampledStretches()).toBe("3 × 1.0s at random (3.0s total), first at 0.0s–1.0s");
  });
});

describe("playback that cannot keep up", () => {
  // Paced off the wall clock and asked for whichever frame the elapsed time lands on: when decoding
  // is slower than a frame it drops frames rather than drifting into slow motion.
  it("drops frames rather than slowing down when decoding is slower than a frame", async () => {
    vi.useFakeTimers();
    const host = hostSection();
    await load(host);
    // The clock jumps 40ms every time it is read, which is more than a frame at 30 fps.
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => (clock += 40));
    frameRequests.length = 0;
    const play = playButton(host);
    frameAt = async () => {
      // Three frames in, the reader presses Pause; a loop that never waits has to be stopped from
      // inside a draw.
      if (frameRequests.length >= 6) play.click();
      return null;
    };
    play.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(play.textContent).toBe("Play");
    expect(requestedSeconds().encoded).toEqual([0.04, 0.12, 0.2]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
