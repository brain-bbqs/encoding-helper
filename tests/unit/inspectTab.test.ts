import { beforeEach, describe, expect, it } from "vitest";
import { resetState, state } from "../../src/lib/state";
import type { DeclaredBitrate, SampleInfo, TrackInfo } from "../../src/lib/types";
import { renderAtomMap } from "../../src/ui/atomsTab";
import { renderBitrateTimelineSection, renderInspectHead, renderInspectTail } from "../../src/ui/inspectTab";
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
    // The order main.ts appends them in.
    renderInspectHead(panel);
    renderAtomMap(panel);
    renderSeekTab(panel);
    renderInspectTail(panel);
    const headings = Array.from(panel.querySelectorAll("h2")).map((el) => el.textContent);
    // Metadata first, then the map of where the bytes are, then the keyframe structure that map's
    // box order decides (with the seeking test folded into that same card), then the bitrate over
    // time, and the audio track last.
    expect(headings).toEqual([
      "Video Container Overview: mp4",
      "Video Track",
      "MP4 Box / Atom Structure",
      "GOP / Keyframe Structure",
      "Video Bitrate Over Time",
    ]);
  });

  // Faststart is a fact about where moov sits relative to mdat, so it is read against the map that
  // draws them rather than in the file overview.
  it("reports faststart on the atom card, not on the overview", () => {
    loadFile({ durationSec: 30, samples: samples(600, 30, () => 1000) });
    state.source = { name: "clip.mp4", size: 2_000_000 } as never;
    state.format = "MP4";
    state.faststart = true;
    state.boxes = [{ type: "ftyp", start: 0, size: 32, hdrSize: 8, children: [] }];
    const overview = document.createElement("div");
    renderInspectHead(overview);
    expect(overview.textContent).not.toContain("Faststart");
    const atoms = document.createElement("div");
    renderAtomMap(atoms);
    expect(atoms.querySelector(".atom-faststart")?.textContent).toBe("✓ Faststart (moov before mdat)");
  });

  // The container's own card was folded into the overview, and its explainer names the container,
  // so the grid no longer carries a Type row saying the same thing.
  it("carries the container explainer in the overview card, without a Type row", () => {
    loadFile({ durationSec: 30, samples: samples(600, 30, () => 1000) });
    state.source = { name: "clip.mp4", size: 2_000_000 } as never;
    state.format = "MP4";
    const panel = document.createElement("div");
    renderInspectHead(panel);
    // The heading names the container, which is what the absorbed card's heading did.
    expect(Array.from(panel.querySelectorAll("h2")).map((el) => el.textContent)).toEqual([
      "Video Container Overview: MP4",
      "Video Track",
    ]);
    expect(panel.textContent).toContain("MPEG-4 Part 14");
    expect(Array.from(panel.querySelectorAll("label")).map((el) => el.textContent)).not.toContain("Type");
  });

  // Every card leads with what it measured; the teaching text reads under it, not in front of it.
  it("puts the overview's figures above the explainers that follow them", () => {
    loadFile({ durationSec: 30, samples: samples(600, 30, () => 1000) });
    state.source = { name: "clip.mp4", size: 2_000_000 } as never;
    state.format = "MP4";
    const panel = document.createElement("div");
    renderInspectHead(panel);
    const card = panel.querySelector(".section")!;
    const kinds = Array.from(card.querySelectorAll(".grid, .teach")).map((el) =>
      el.classList.contains("grid") ? "grid" : "teach",
    );
    expect(kinds[0]).toBe("grid");
    expect(kinds).toContain("teach");
  });

  // A zoomed view still draws the ancestors of what was zoomed to, each spanning the whole of it.
  // Clicking one used to push a crumb for the view already on screen, so a file with one video track
  // offered an endless path of traks.
  it("stops zooming at a block that already fills the view", () => {
    loadFile({ durationSec: 30, samples: samples(600, 30, () => 1000) });
    state.source = { name: "clip.mp4", size: 2_000_000 } as never;
    state.boxes = [
      {
        type: "moov",
        start: 0,
        size: 900,
        hdrSize: 8,
        children: [{ type: "trak", start: 8, size: 800, hdrSize: 8, children: [] }],
      },
      { type: "mdat", start: 900, size: 1_100_000, hdrSize: 8, children: [] },
    ];
    const panel = document.createElement("div");
    renderAtomMap(panel);

    const trak = Array.from(panel.querySelectorAll<HTMLButtonElement>(".atom-block")).find(
      (b) => b.textContent === "trak",
    )!;
    trak.click();
    const crumbLabels = (): (string | null)[] =>
      Array.from(panel.querySelectorAll(".atom-crumbs .crumb")).map((el) => el.textContent);
    expect(crumbLabels()).toEqual(["Whole file", "trak"]);

    // Zoomed in, moov and trak both span the view: neither is a way further in, and clicking adds
    // no crumb.
    const filling = Array.from(panel.querySelectorAll<HTMLButtonElement>(".atom-block.filling"));
    expect(filling.map((b) => b.textContent)).toEqual(["moov", "trak"]);
    filling.forEach((b) => b.click());
    expect(crumbLabels()).toEqual(["Whole file", "trak"]);
  });

  // The legend is a key to what is on the map, so a progressive file gets no row for the fragment
  // index it has none of, nor for the collapsed runs it is far too small to produce.
  it("keys only the families the map actually drew", () => {
    loadFile({ durationSec: 30, samples: samples(600, 30, () => 1000) });
    state.source = { name: "clip.mp4", size: 2_000_000 } as never;
    state.boxes = [
      { type: "ftyp", start: 0, size: 32, hdrSize: 8, children: [] },
      {
        type: "moov",
        start: 32,
        size: 900,
        hdrSize: 8,
        children: [{ type: "trak", start: 40, size: 800, hdrSize: 8, children: [] }],
      },
      { type: "mdat", start: 932, size: 1_100_000, hdrSize: 8, children: [] },
    ];
    const panel = document.createElement("div");
    renderAtomMap(panel);
    const labels = Array.from(panel.querySelectorAll(".legend-label")).map((el) => el.textContent);
    expect(labels).toEqual(["moov", "mdat", "other"]);
  });

  // A fragmented recording is the case those rows are for: thousands of boxes, most of them too
  // narrow to draw one by one.
  it("keys the collapsed runs once there are enough boxes to collapse", () => {
    loadFile({ durationSec: 30, samples: samples(600, 30, () => 1000) });
    state.source = { name: "clip.mp4", size: 2_000_000 } as never;
    state.boxes = Array.from({ length: 400 }, (_, i) => ({
      type: i % 2 === 0 ? "moof" : "mdat",
      start: i * 100,
      size: 100,
      hdrSize: 8,
      children: [],
    }));
    const panel = document.createElement("div");
    renderAtomMap(panel);
    const labels = Array.from(panel.querySelectorAll(".legend-label")).map((el) => el.textContent);
    expect(labels).toContain("N boxes");
    expect(labels).toContain("moof");
  });

  it("offers a hundred sampled timestamps as the seeking test's starting point", () => {
    const panel = document.createElement("div");
    renderSeekTab(panel);
    expect(panel.querySelector<HTMLInputElement>("#seekN")?.value).toBe("100");
  });
});
