import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodeTest, resetState, state } from "../../src/lib/state";
import type { EncodeSettings, TrackInfo } from "../../src/lib/types";

// The panel only asks mediabunny to decode the encode it was handed; what it does with the answer
// is the part under test, so the decoder is stubbed rather than run.
vi.mock("../../src/lib/mediabunny", () => {
  class FakeInput {
    async getPrimaryVideoTrack(): Promise<{ canDecode: () => Promise<boolean> }> {
      return { canDecode: async () => true };
    }
    async computeDuration(): Promise<number> {
      return 1;
    }
    dispose(): void {}
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

async function load(host: HTMLDivElement): Promise<void> {
  await loadEncodedIntoAB(new Blob(["encoded"]), SETTINGS, VIDEO_TRACK, host);
}

beforeEach(() => {
  document.body.innerHTML = "";
  resetState();
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
});
