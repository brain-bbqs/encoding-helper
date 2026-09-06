import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VIDEO_TRACK } from "../fixtures/state";
import { encodeTest, resetState, state } from "../../src/lib/state";
import type { EncodeSettings } from "../../src/lib/types";

/** Every Input the stub has handed out, so the test can check the old ones are let go of. */
const disposed: number[] = [];
let openedInputs = 0;
/** The Input the stub refuses to give a video track, standing in for a stretch that will not open. */
let refuseInput = -1;
/** The Input whose track the stub says the browser cannot decode. */
let undecodableInput = -1;
/** How long the stub says every stretch runs. */
let stretchSeconds = 1;

/** A decoded frame as the sinks hand one back: a canvas of the frame's own size. */
interface FakeFrame {
  canvas: HTMLCanvasElement;
}
/** What every sink answers a frame request with; null is "no frame at that time", the default. */
let frameAt: (seconds: number) => Promise<FakeFrame | null> = async () => null;
/** Every frame the panel asked for, and the track it asked for it on: the original's is
 * `state.videoTrack`, each stretch's the encoded track the stub handed out. */
const frameRequests: { track: unknown; seconds: number }[] = [];

// The panel only asks mediabunny to decode the encodes it was handed; what it does with the answers
// is the part under test, so the decoder is stubbed rather than run.
vi.mock("../../src/lib/mediabunny", () => {
  class FakeInput {
    id = openedInputs++;
    async getPrimaryVideoTrack(): Promise<{ canDecode: () => Promise<boolean> } | null> {
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
      frameRequests.push({ track: this.track, seconds });
      return frameAt(seconds);
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

async function load(host: HTMLDivElement): Promise<void> {
  await loadEncodedIntoAB(encodedStretches(1), SETTINGS, VIDEO_TRACK, host);
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

/** Lets whatever the last event queued run to completion. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** A frame of the given size, for a sink to hand back. */
function frameOf(width: number, height: number): FakeFrame {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return { canvas };
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

beforeEach(() => {
  document.body.innerHTML = "";
  refuseInput = -1;
  undecodableInput = -1;
  stretchSeconds = 1;
  frameAt = async () => null;
  frameRequests.length = 0;
  // Cleared after the reset, which disposes whatever the test before it left the window holding.
  resetState();
  disposed.length = 0;
  openedInputs = 0;
  state.tracks = [VIDEO_TRACK];
  state.duration = 20;
  // The panel refuses to draw without one; nothing here reads it, since the sinks are stubbed.
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
    expect(encodeTest.activeCombo).toEqual(SETTINGS);
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
    expect(encodeTest.abSegments).toHaveLength(3);
    expect(encodeTest.abSegments.map((seg) => seg.window.startSeconds)).toEqual([0, 4, 8]);
    expect(encodeTest.segDuration).toBe(3);
    expect(encodeTest.encodedSize).toBe(4096);
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
    scrub.value = "500";
    scrub.dispatchEvent(new Event("input"));
    expect(host.querySelector(".progress-label")!.textContent).toBe("1.50s");
    expect(currentBand(host)).toBe(1);
    // What the bands say, said in words: they sit under the slider and can carry no tooltip of
    // their own, and the slider's own value is a thousandth of a reel.
    const where = "1.50s · Segment 2 of 3 · 4.0s–5.0s in the source";
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
    expect(encodeTest.encodedInputs).toHaveLength(2);
  });

  // A run that will not open all the way leaves the comparison that is already up alone, rather
  // than half a new one: the panes would otherwise still be drawing from sinks nothing points at.
  it("keeps the loaded comparison when a later stretch will not open", async () => {
    const host = hostSection();
    await loadSampled(host, 2);
    const held = encodeTest.encodedInputs;
    // The second stretch of the run about to be loaded is the one that will not open.
    refuseInput = openedInputs + 1;
    await expect(loadSampled(host, 3)).rejects.toThrow("no video track");
    expect(encodeTest.encodedInputs).toBe(held);
    expect(encodeTest.abSegments).toHaveLength(2);
    // The two it did open on the way to failing are let go of; the two still showing are not.
    expect(disposed).toEqual([2, 3]);
  });
});

describe("loadEncodedIntoAB refusals", () => {
  it("refuses a run with nothing in it, and a window with no video track", async () => {
    const host = hostSection();
    await expect(loadEncodedIntoAB([], SETTINGS, VIDEO_TRACK, host)).rejects.toThrow("No encoded segment");
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
    expect(encodeTest.abSegments).toHaveLength(0);
    expect(host.style.display).toBe("none");
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
    const frame = frameOf(320, 240);
    frameAt = async () => frame;
    const host = hostSection();
    await load(host);
    await flush();
    const [origCanvas, encCanvas] = Array.from(host.querySelectorAll("canvas"));
    expect([origCanvas.width, origCanvas.height]).toEqual([320, 240]);
    expect([encCanvas.width, encCanvas.height]).toEqual([320, 240]);
    expect(drawImage).toHaveBeenCalledTimes(2);
    expect(drawImage).toHaveBeenCalledWith(frame.canvas, 0, 0, 320, 240);
  });

  // A downscaled encode is drawn back at the source's geometry, so one zoom shows the same part of
  // the frame on each side; how it is drawn back up is the viewer's call.
  it("draws a downscaled encode back at the source's size, one block per pixel by default", async () => {
    const { drawImage, smoothing } = stubCanvasContext();
    const frame = frameOf(320, 240);
    frameAt = async () => frame;
    const host = hostSection();
    await loadEncodedIntoAB(encodedStretches(1), { ...SETTINGS, scale: 0.5 }, VIDEO_TRACK, host);
    await flush();
    const encCanvas = host.querySelectorAll("canvas")[1];
    expect([encCanvas.width, encCanvas.height]).toEqual([640, 480]);
    expect(drawImage).toHaveBeenLastCalledWith(frame.canvas, 0, 0, 640, 480);
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
    expect(msg.style.display).toBe("");
    expect(error).toHaveBeenCalledWith("[encoding-helper] could not draw the comparison:", expect.any(Error));
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
    await loadEncodedIntoAB(encodedStretches(1), DOWNSCALED, VIDEO_TRACK, host);
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
    await loadEncodedIntoAB(encodedStretches(1), DOWNSCALED, VIDEO_TRACK, host);
    await flush();
    frameRequests.length = 0;
    const select = host.querySelector<HTMLSelectElement>("#etUpscaleView")!;
    select.value = "smooth";
    select.dispatchEvent(new Event("change"));
    await flush();
    expect(encodeTest.upscaleSmoothing).toBe(true);
    expect(host.querySelectorAll(".pane-label")[1].getAttribute("title")).toContain("with smoothing");
    expect(requestedSeconds()).toEqual({ original: [0], encoded: [0] });
    expect(smoothing).toEqual([false, false, true, true]);
    // Remembered across loads, so the next comparison opens on the view the reader chose.
    const again = hostSection();
    await loadEncodedIntoAB(encodedStretches(1), DOWNSCALED, VIDEO_TRACK, again);
    expect(again.querySelector<HTMLSelectElement>("#etUpscaleView")!.value).toBe("smooth");
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
    await loadSampled(host, 2);
    frameRequests.length = 0;
    const play = playButton(host);
    play.click();
    expect(play.textContent).toBe("Pause");
    await vi.advanceTimersByTimeAsync(0);
    expect(progressLabel(host)).toBe("0.00s");
    // Three frames of a 30 fps reel is a tenth of a second, each asked for at the second the clock
    // had reached rather than the one after the last.
    await vi.advanceTimersByTimeAsync(100);
    expect(progressLabel(host)).toBe("0.10s");
    expect(requestedSeconds().encoded.at(-1)).toBe(0.1);
    expect(currentBand(host)).toBe(0);
    play.click();
    expect(play.textContent).toBe("Play");
    const drawn = frameRequests.length;
    await vi.advanceTimersByTimeAsync(500);
    expect(progressLabel(host)).toBe("0.10s");
    expect(frameRequests).toHaveLength(drawn);
  });

  // The reel is every stretch end to end, played through and then back to the first, the way a
  // player set to repeat would.
  it("runs through every stretch and loops back to the first", async () => {
    const host = hostSection();
    await loadSampled(host, 2);
    playButton(host).click();
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
    scrubTo(host, 1000);
    expect(progressLabel(host)).toBe("1.00s");
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

  // A frame that will not decode ends playback rather than leaving the button stuck on Pause.
  it("ends playback when a frame will not decode", async () => {
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
    play.click();
    expect(play.textContent).toBe("Pause");
    await vi.advanceTimersByTimeAsync(200);
    expect(play.textContent).toBe("Pause");
    expect(progressLabel(host)).toBe("0.20s");
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

  it("labels a custom-quality encode by its CRF", async () => {
    const host = hostSection();
    await loadEncodedIntoAB(encodedStretches(1), { ...SETTINGS, quality: "custom", crf: 18 }, VIDEO_TRACK, host);
    expect(host.querySelectorAll(".pane-label")[1].textContent).toBe("Encoded (CRF 18, superfast)");
  });

  // A track the probe could not size or time still gets a comparison: the panes start empty and
  // playback paces itself at thirty frames a second.
  it("copes with a track of unknown size and frame rate", async () => {
    vi.useFakeTimers();
    const host = hostSection();
    const bare = { ...VIDEO_TRACK, packetRate: null, codedWidth: undefined, codedHeight: undefined };
    await loadEncodedIntoAB(encodedStretches(1), SETTINGS, bare, host);
    const [orig, enc] = Array.from(host.querySelectorAll("canvas"));
    expect([orig.width, orig.height, enc.width, enc.height]).toEqual([0, 0, 0, 0]);
    expect(host.querySelector<HTMLElement>(".compare-pane")!.style.aspectRatio).toBe("0 / 0");
    frameRequests.length = 0;
    playButton(host).click();
    await vi.advanceTimersByTimeAsync(100);
    expect(requestedSeconds().encoded.at(-1)).toBe(0.1);
    expect(host.querySelector(".grid")!.textContent).not.toContain("Resolution");
  });

  it("labels the ruler in the reel's own clock before the file's length is known", async () => {
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
    expect(encodeTest.segDuration).toBe(0);
    const bands = host.querySelectorAll<HTMLElement>(".compare-reel-seg");
    expect([...bands].map((b) => b.style.left)).toEqual(["0%", "0%"]);
    scrubTo(host, 500);
    expect(progressLabel(host)).toBe("0.50s");
  });
});

describe("describeSampledStretches", () => {
  it("falls back to the run's own start and length before a run has loaded", () => {
    encodeTest.startTime = 3;
    encodeTest.duration = 5;
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
