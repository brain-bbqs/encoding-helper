import { beforeEach, describe, expect, it } from "vitest";
import { resetState, state } from "../../src/lib/state";
import type { DeclaredBitrate, SampleInfo, TrackInfo } from "../../src/lib/types";
import { renderAtomMap } from "../../src/ui/atomsTab";
import { renderBitrateTimelineSection, renderInspect } from "../../src/ui/inspectTab";
import { renderSeekTab } from "../../src/ui/seekTab";

const VIDEO_TRACK: TrackInfo = {
  kind: "video",
  codec: "avc",
  codecString: "avc1.640020",
  codecInfo: null,
  packetCount: 600,
  packetRate: 20,
  bitrate: 500_000,
  codedWidth: 640,
  codedHeight: 480,
};

/** `count` frames evenly spread across `durationSec`, sized by `size`. */
function samples(count: number, durationSec: number, size: (i: number) => number): SampleInfo[] {
  return Array.from({ length: count }, (_, i) => ({
    offset: 0,
    size: size(i),
    cts: 0,
    dts: 0,
    ctsSec: (durationSec * i) / count,
    dtsSec: (durationSec * i) / count,
    is_sync: i % 30 === 0,
    duration: 1,
  }));
}

/** Loads one file's worth of state: a video track, its frames, and any `btrt` declaration. */
function loadFile(opts: {
  durationSec: number;
  samples: SampleInfo[];
  declared?: DeclaredBitrate | null;
  tracks?: TrackInfo[];
}): void {
  state.tracks = opts.tracks ?? [VIDEO_TRACK];
  state.duration = opts.durationSec;
  state.samples = opts.samples;
  state.declaredVideoBitrate = opts.declared ?? null;
}

function chartOf(section: HTMLDivElement | null): SVGSVGElement | null {
  return section?.querySelector<SVGSVGElement>("svg.bitrate-chart") ?? null;
}

describe("renderBitrateTimelineSection", () => {
  beforeEach(() => resetState());

  it("renders nothing without a video track", () => {
    loadFile({ durationSec: 30, samples: samples(600, 30, () => 1000), tracks: [] });
    expect(renderBitrateTimelineSection()).toBeNull();
  });

  it("keeps the track's average, without a plot, when there are too few frames to bin", () => {
    // The Video Track card no longer carries the bitrate, so this card still has to report it.
    loadFile({ durationSec: 1, samples: samples(3, 1, () => 1000) });
    const section = renderBitrateTimelineSection();
    expect(chartOf(section)).toBeNull();
    expect(section!.textContent).toContain("500 kbps");
    expect(section!.textContent).toContain("too few frames");
  });

  it("plots a variable-bitrate track", () => {
    loadFile({ durationSec: 30, samples: samples(600, 30, (i) => (i % 30 === 0 ? 20_000 : 1_000)) });
    const section = renderBitrateTimelineSection();
    expect(chartOf(section)).not.toBeNull();
    expect(section!.textContent).toContain("Video Bitrate Over Time");
  });

  it("plots a track with no btrt declaration even when its rate happens not to move", () => {
    // Nothing in the container claims the rate was held, so flatness is the file's business.
    loadFile({ durationSec: 30, samples: samples(600, 30, () => 1000) });
    expect(chartOf(renderBitrateTimelineSection())).not.toBeNull();
  });

  it("replaces the plot with an explanation when the container declares a rate its frames confirm", () => {
    // 600 × 1000 bytes over 30 s = 160,000 bps, declared as both the average and the maximum.
    loadFile({
      durationSec: 30,
      samples: samples(600, 30, () => 1000),
      declared: { avgBitrate: 160_000, maxBitrate: 160_000 },
    });
    const section = renderBitrateTimelineSection();
    expect(chartOf(section)).toBeNull();
    expect(section!.textContent).toContain("constant bitrate");
    expect(section!.textContent).toContain("160 kbps");
  });

  it("still plots when the declaration says constant but the frame sizes disagree", () => {
    // What ffmpeg-muxed files look like: btrt repeats the average as the maximum regardless.
    loadFile({
      durationSec: 30,
      samples: samples(600, 30, (i) => (i < 300 ? 500 : 5_000)),
      declared: { avgBitrate: 160_000, maxBitrate: 160_000 },
    });
    const section = renderBitrateTimelineSection();
    expect(chartOf(section)).not.toBeNull();
    expect(section!.textContent).toContain("The sample sizes say otherwise");
  });

  it("says nothing about a declaration when the file carries none", () => {
    loadFile({ durationSec: 30, samples: samples(600, 30, (i) => (i < 300 ? 500 : 5_000)) });
    expect(renderBitrateTimelineSection()!.textContent).not.toContain("The sample sizes say otherwise");
  });
});

// The atom map and the seeking test are sections of Inspect rather than tabs of their own, so the
// three renderers share a panel and each one appends to what the last one left.
describe("the Inspect panel", () => {
  beforeEach(() => resetState());

  it("stacks the metadata, the atom map and the GOP/seeking sections in one panel", () => {
    loadFile({ durationSec: 30, samples: samples(600, 30, () => 1000) });
    // The metadata sections only render for a loaded file; the map and the seeking test do not care.
    state.source = { name: "clip.mp4", size: 2_000_000 } as never;
    state.format = "mp4";
    state.boxes = [{ type: "ftyp", start: 0, size: 32, hdrSize: 8, children: [] }];
    state.gopLengths = [30, 30];
    state.keyframeDecodeIndices = [0, 30];
    const panel = document.createElement("div");
    renderInspect(panel);
    renderAtomMap(panel);
    renderSeekTab(panel);
    const headings = Array.from(panel.querySelectorAll("h2")).map((el) => el.textContent);
    // Metadata first, then the map of where the bytes are, then the structure that governs seeking.
    expect(headings.slice(0, 2)).toEqual(["Video Container Overview", "Video Track"]);
    expect(headings.slice(-3)).toEqual([
      "MP4 Box / Atom Structure",
      "GOP / Keyframe Structure",
      "Empirical Seeking Test",
    ]);
  });
});
