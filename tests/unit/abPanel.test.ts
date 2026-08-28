import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodeTest, resetState, state } from "../../src/lib/state";
import type { EncodeSettings, TrackInfo } from "../../src/lib/types";

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

const SETTINGS: EncodeSettings = { quality: "medium", crf: 25, preset: "superfast", scale: 1, scaler: "lanczos" };

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

function segmentLine(host: HTMLDivElement): string {
  return host.querySelector(".compare-segment-label")?.textContent ?? "";
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

  it("names the stretch on screen and steps between them, wrapping either way", async () => {
    const host = hostSection();
    await loadSampled(host, 3);
    const [prev, next] = Array.from(host.querySelectorAll<HTMLButtonElement>(".compare-segment-buttons button"));
    expect(segmentLine(host)).toBe("Segment 1 of 3 · 0.0s–1.0s in the source");
    next.click();
    expect(segmentLine(host)).toBe("Segment 2 of 3 · 4.0s–5.0s in the source");
    // Round the cycle rather than off the end of it: the reel loops, so the buttons do too.
    next.click();
    next.click();
    expect(segmentLine(host)).toBe("Segment 1 of 3 · 0.0s–1.0s in the source");
    prev.click();
    expect(segmentLine(host)).toBe("Segment 3 of 3 · 8.0s–9.0s in the source");
  });

  it("scrubs across the whole reel rather than one stretch of it", async () => {
    const host = hostSection();
    await loadSampled(host, 3);
    const scrub = host.querySelector<HTMLInputElement>('.compare-controls input[type="range"]')!;
    // Half way along a three-second reel is a second and a half in, which is the second stretch.
    scrub.value = "500";
    scrub.dispatchEvent(new Event("input"));
    expect(host.querySelector(".progress-label")!.textContent).toBe("1.50s");
    expect(segmentLine(host)).toBe("Segment 2 of 3 · 4.0s–5.0s in the source");
  });

  it("leaves the segment line out when a run sampled a single stretch", async () => {
    const host = hostSection();
    await loadSampled(host, 1);
    expect(host.querySelector(".compare-segments")).toBeNull();
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
