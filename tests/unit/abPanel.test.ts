import { beforeEach, describe, expect, it, vi } from "vitest";
import { VIDEO_TRACK } from "../fixtures/state";
import { encodeTest, resetState, state } from "../../src/lib/state";
import type { EncodeSettings } from "../../src/lib/types";

/** Every Input the stub has handed out, so the test can check the old ones are let go of. */
const disposed: number[] = [];
let openedInputs = 0;
/** The Input the stub refuses to give a video track, standing in for a stretch that will not open. */
let refuseInput = -1;

// The panel only asks mediabunny to decode the encodes it was handed; what it does with the answers
// is the part under test, so the decoder is stubbed rather than run.
vi.mock("../../src/lib/mediabunny", () => {
  class FakeInput {
    id = openedInputs++;
    async getPrimaryVideoTrack(): Promise<{ canDecode: () => Promise<boolean> } | null> {
      return this.id === refuseInput ? null : { canDecode: async () => true };
    }
    async computeDuration(): Promise<number> {
      return 1;
    }
    dispose(): void {
      disposed.push(this.id);
    }
  }
  class FakeCanvasSink {
    async getCanvas(): Promise<null> {
      return null;
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

const { loadEncodedIntoAB, onAbDisplaced } = await import("../../src/ui/abPanel");

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

beforeEach(() => {
  document.body.innerHTML = "";
  refuseInput = -1;
  // Cleared after the reset, which disposes whatever the test before it left the window holding.
  resetState();
  disposed.length = 0;
  openedInputs = 0;
  state.tracks = [VIDEO_TRACK];
  state.duration = 20;
  // The panel refuses to draw without one; nothing here reads it, since the sinks are stubbed.
  state.videoTrack = {} as never;
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
