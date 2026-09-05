// The decoder is stubbed (jsdom has none): what these cases pin down is the track — where the band
// sits, what moves it, and what the run is told to encode — plus the preview's two failure notes.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetCliDefaults } from "../fixtures/state";
import { SAMPLE_SECONDS } from "../../src/lib/sampleTimeline";
import { encodeTest, state } from "../../src/lib/state";
import { samplePicker } from "../../src/ui/samplePicker";

const getCanvas = vi.hoisted(() => vi.fn());
const ensureMediabunny = vi.hoisted(() => vi.fn());

vi.mock("../../src/lib/mediabunny", () => ({ ensureMediabunny }));

const TOTAL = 100;

interface Picker {
  el: HTMLElement;
  track: HTMLElement;
  band: HTMLElement;
  note: HTMLElement;
  window: () => { startSeconds: number; seconds: number };
}

function picker(): Picker {
  const p = samplePicker()!;
  document.body.append(p.el);
  return {
    el: p.el,
    track: p.el.querySelector<HTMLElement>(".sample-track")!,
    band: p.el.querySelector<HTMLElement>(".sample-band")!,
    note: p.el.querySelector<HTMLElement>(".sample-preview-note")!,
    window: p.window,
  };
}

/** A 400px-wide track starting 50px into the page, since jsdom lays nothing out. */
function stubTrackWidth(track: HTMLElement, width = 400): void {
  track.getBoundingClientRect = () => ({ left: 50, width, right: 50 + width, top: 0, bottom: 12 }) as DOMRect;
}

function pointer(el: HTMLElement, type: string, clientX: number, target?: EventTarget): void {
  const event = new MouseEvent(type, { clientX, bubbles: true, cancelable: true });
  Object.defineProperty(event, "pointerId", { value: 1 });
  if (target) Object.defineProperty(event, "target", { value: target });
  el.dispatchEvent(event);
}

function key(band: HTMLElement, key: string, shiftKey = false): void {
  band.dispatchEvent(new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true }));
}

beforeEach(() => {
  document.body.innerHTML = "";
  resetCliDefaults();
  vi.clearAllMocks();
  state.duration = TOTAL;
  state.videoTrack = { id: 1 } as never;
  state.keyframeTimestampsSec = [];
  getCanvas.mockResolvedValue({ canvas: { width: 64, height: 48 } });
  ensureMediabunny.mockResolvedValue({
    CanvasSink: class {
      getCanvas = getCanvas;
    },
  });
  // jsdom's canvas has no 2D context and pointer capture is not implemented.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: vi.fn() } as never);
  Element.prototype.setPointerCapture = vi.fn();
});

afterEach(() => vi.restoreAllMocks());

describe("samplePicker", () => {
  it("gives nothing to pick across for a file with no duration", () => {
    state.duration = null;
    expect(samplePicker()).toBeNull();
    state.duration = 0;
    expect(samplePicker()).toBeNull();
  });

  it("names itself and its range, since the band is the control", () => {
    const { band } = picker();
    expect(band.getAttribute("role")).toBe("slider");
    expect(band.getAttribute("aria-label")).toBe("Which seconds of the video to encode");
    expect(band.getAttribute("aria-valuemin")).toBe("0");
    expect(band.getAttribute("aria-valuemax")).toBe((TOTAL - SAMPLE_SECONDS).toFixed(1));
  });

  it("draws the band over the seconds the run will encode", () => {
    encodeTest.sampleStart = 20;
    const { band } = picker();
    expect(band.style.left).toBe("20%");
    expect(parseFloat(band.style.width)).toBeCloseTo((SAMPLE_SECONDS / TOTAL) * 100, 3);
    expect(band.getAttribute("aria-valuenow")).toBe("20.0");
    expect(band.getAttribute("aria-valuetext")).toContain("to");
  });

  it("gradates the track, labelling the major marks only", () => {
    const { el } = picker();
    expect(el.querySelectorAll(".sample-tick").length).toBeGreaterThan(el.querySelectorAll(".sample-tick.major").length);
    expect(el.querySelectorAll(".sample-tick-label")).toHaveLength(el.querySelectorAll(".sample-tick.major").length);
    expect(el.querySelector(".sample-ruler")!.getAttribute("aria-hidden")).toBe("true");
  });

  it("aligns a label at either end inwards, so it does not hang off the track", () => {
    // A minute divides into labelled marks at both 0 and the end; a hundred seconds does not.
    state.duration = 60;
    const { el } = picker();
    expect(el.querySelector(".sample-tick-label.at-start")).not.toBeNull();
    expect(el.querySelector(".sample-tick-label.at-end")).not.toBeNull();
  });

  it("covers the whole of a file shorter than one sample", () => {
    state.duration = 2;
    const p = picker();
    expect(p.window().seconds).toBe(2);
    expect(p.band.style.width).toBe("100%");
  });

  it("reports the keyframe the cut will actually be made at, not the second asked for", () => {
    state.keyframeTimestampsSec = [0, 10, 20, 30];
    encodeTest.sampleStart = 25;
    expect(picker().window()).toEqual({ startSeconds: 20, seconds: SAMPLE_SECONDS });
  });

  it("takes the second asked for when the file has no keyframe before it", () => {
    state.keyframeTimestampsSec = [30];
    encodeTest.sampleStart = 10;
    expect(picker().window().startSeconds).toBe(10);
  });

  it("centres the window where the bare track was pressed", () => {
    const p = picker();
    stubTrackWidth(p.track);
    // Half way along a 400px track: 50 s, less half the window.
    pointer(p.track, "pointerdown", 250);
    expect(encodeTest.sampleStart).toBe(50 - SAMPLE_SECONDS / 2);
    expect(p.band.classList.contains("dragging")).toBe(true);
  });

  it("slides the band from wherever it was grabbed, rather than jumping under the pointer", () => {
    encodeTest.sampleStart = 20;
    const p = picker();
    stubTrackWidth(p.track);
    // Grabbed 5 s into a band that starts at 20 s, then dragged 10 s to the right.
    pointer(p.track, "pointerdown", 50 + 100, p.band);
    expect(encodeTest.sampleStart).toBe(20);
    pointer(p.track, "pointermove", 50 + 140);
    expect(encodeTest.sampleStart).toBe(30);
  });

  it("stops following the pointer once it is released", () => {
    const p = picker();
    stubTrackWidth(p.track);
    pointer(p.track, "pointerdown", 250);
    pointer(p.track, "pointerup", 250);
    const settled = encodeTest.sampleStart;

    pointer(p.track, "pointermove", 350);

    expect(encodeTest.sampleStart).toBe(settled);
    expect(p.band.classList.contains("dragging")).toBe(false);
  });

  it("reads a track with no width as the start of the file rather than dividing by zero", () => {
    const p = picker();
    stubTrackWidth(p.track, 0);
    pointer(p.track, "pointerdown", 250);
    expect(encodeTest.sampleStart).toBe(0);
  });

  it("walks the window with the arrow keys, a coarser step with Shift", () => {
    encodeTest.sampleStart = 20;
    const { band } = picker();

    key(band, "ArrowRight");
    expect(encodeTest.sampleStart).toBe(21);
    key(band, "ArrowLeft");
    expect(encodeTest.sampleStart).toBe(20);
    key(band, "ArrowRight", true);
    expect(encodeTest.sampleStart).toBe(30);
    key(band, "ArrowLeft", true);
    expect(encodeTest.sampleStart).toBe(20);
  });

  it("jumps to either end of the file, and stops there", () => {
    encodeTest.sampleStart = 20;
    const { band } = picker();

    key(band, "Home");
    expect(encodeTest.sampleStart).toBe(0);
    key(band, "ArrowLeft");
    expect(encodeTest.sampleStart).toBe(0);

    key(band, "End");
    expect(encodeTest.sampleStart).toBe(TOTAL - SAMPLE_SECONDS);
    key(band, "ArrowRight");
    expect(encodeTest.sampleStart).toBe(TOTAL - SAMPLE_SECONDS);
  });

  it("leaves any other key to the browser", () => {
    const { band } = picker();
    const event = new KeyboardEvent("keydown", { key: "a", bubbles: true, cancelable: true });
    band.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it("shows the frame the window starts on", async () => {
    state.keyframeTimestampsSec = [0, 30];
    encodeTest.sampleStart = 40;
    const p = picker();

    await vi.waitFor(() => expect(p.el.querySelector(".sample-preview-wrap")!.classList).toContain("has-frame"));
    expect(getCanvas).toHaveBeenCalledWith(30);
    expect(p.note.textContent).toBe("");
  });

  it("draws the frame the drag ended on, not whichever request came back last", async () => {
    const frames = new Map([
      [10, { canvas: { width: 1, height: 1 } }],
      [20, { canvas: { width: 2, height: 2 } }],
    ]);
    getCanvas.mockImplementation((at: number) => Promise.resolve(frames.get(at)));
    const p = picker();
    const canvas = p.el.querySelector<HTMLCanvasElement>("canvas")!;

    key(p.band, "ArrowRight", true);
    key(p.band, "ArrowRight", true);
    await vi.waitFor(() => expect(canvas.width).toBe(2));

    expect(canvas.width).toBe(2);
  });

  it("says there is no picture rather than failing when nothing can be decoded from", () => {
    state.videoTrack = null;
    const p = picker();
    expect(p.note.textContent).toBe("No decoded frame to show for this file.");
    expect(ensureMediabunny).not.toHaveBeenCalled();
  });

  it("keeps the track usable when the browser will not decode the video", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    getCanvas.mockRejectedValue(new Error("unsupported codec"));
    const p = picker();

    await vi.waitFor(() =>
      expect(p.note.textContent).toBe("This browser will not decode the video, so there is no preview to scan."),
    );
    key(p.band, "End");
    expect(encodeTest.sampleStart).toBe(TOTAL - SAMPLE_SECONDS);
  });
});
