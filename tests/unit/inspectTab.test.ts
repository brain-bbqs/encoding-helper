import { installObserverStub } from "@brain-bbqs/test-utils/vitest";
import { beforeEach, describe, expect, it } from "vitest";
import { evenSamples } from "../fixtures/samples";
import { VIDEO_TRACK as SHARED_VIDEO_TRACK } from "../fixtures/state";
import { resetState, state } from "../../src/lib/state";
import type { CodecInfo, DeclaredBitrate, SampleInfo, TrackInfo } from "../../src/lib/types";
import { renderAtomMap } from "../../src/ui/atomsTab";
import { renderBitrateTimelineSection, renderInspectHead, renderInspectTail } from "../../src/ui/inspectTab";
import { mountInspectToc } from "../../src/ui/inspectToc";
import { renderGopStructure } from "../../src/ui/seekTab";
import { gridItem, gridRows, gridValue } from "./helpers/grid";

/** The shared track, at the 20 fps these tests read their figures against. */
const VIDEO_TRACK: TrackInfo = { ...SHARED_VIDEO_TRACK, packetRate: 20 };

/** `count` frames evenly spread across `durationSec`, sized by `size`. */
function samples(count: number, durationSec: number, size: (i: number) => number): SampleInfo[] {
  return evenSamples(count, durationSec, size, (i) => i % 30 === 0);
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

/** A 30-second clip as a loaded file: the metadata sections only render for one; the map and the
 * seeking test do not care. */
function loadClip(): void {
  loadFile({ durationSec: 30, samples: samples(600, 30, () => 1000) });
  state.source = { name: "clip.mp4", size: 2_000_000 } as never;
}

function chartOf(section: HTMLDivElement | null): SVGSVGElement | null {
  return section?.querySelector<SVGSVGElement>("svg.bitrate-chart") ?? null;
}

/** The card headings in `panel`, in order. */
function headings(panel: HTMLElement): (string | null)[] {
  return Array.from(panel.querySelectorAll("h2")).map((el) => el.textContent);
}

/** Every grid label in `panel`, in order. */
function labelsOf(panel: HTMLElement): (string | null)[] {
  return Array.from(panel.querySelectorAll("label")).map((el) => el.textContent);
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
    expect(gridRows(section!)).toEqual([{ label: "Average", value: "500 kbps", info: true, sm: false }]);
    expect(section!.textContent).toContain("too few frames");
  });

  it("plots a variable-bitrate track", () => {
    loadFile({ durationSec: 30, samples: samples(600, 30, (i) => (i % 30 === 0 ? 20_000 : 1_000)) });
    const section = renderBitrateTimelineSection();
    expect(chartOf(section)).not.toBeNull();
    expect(section!.textContent).toContain("Video Bitrate Over Time");
  });

  // 980,000 bytes over 30 s on average; a second holding a 20,000-byte keyframe carries 39,000
  // bytes, and one without a keyframe 20,000.
  it("heads the plot with the average, the peak and quietest windows and their ratio", () => {
    loadFile({ durationSec: 30, samples: samples(600, 30, (i) => (i % 30 === 0 ? 20_000 : 1_000)) });
    expect(gridRows(renderBitrateTimelineSection()!)).toEqual([
      { label: "Average", value: "261 kbps", info: true, sm: false },
      { label: "Peak Window", value: "312 kbps", info: false, sm: false },
      { label: "Quietest Window", value: "160 kbps", info: false, sm: false },
      { label: "Peak ÷ Average", value: "1.19×", info: true, sm: false },
    ]);
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
    expect(section!.querySelector(".grid")).toBeNull();
    expect(section!.textContent).toContain("constant bitrate");
    expect(section!.textContent).toContain("160 kbps");
  });

  it("takes a constant declaration at its word when there are too few frames to test it", () => {
    loadFile({
      durationSec: 1,
      samples: samples(3, 1, () => 1000),
      declared: { avgBitrate: 24_000, maxBitrate: 24_000 },
    });
    const section = renderBitrateTimelineSection();
    expect(chartOf(section)).toBeNull();
    expect(section!.querySelector(".grid")).toBeNull();
    expect(section!.textContent).toContain("constant bitrate");
    expect(section!.textContent).not.toContain("too few frames");
  });

  // A btrt whose maximum is above its average declares a variable rate, so neither the flat frames
  // nor the declaration are grounds to drop the plot or to question the file.
  it("plots, and questions nothing, under a declaration whose peak sits above its average", () => {
    loadFile({
      durationSec: 30,
      samples: samples(600, 30, () => 1000),
      declared: { avgBitrate: 160_000, maxBitrate: 300_000 },
    });
    const section = renderBitrateTimelineSection();
    expect(chartOf(section)).not.toBeNull();
    expect(section!.textContent).not.toContain("The sample sizes say otherwise");
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
// four renderers share a panel and each one appends to what the last one left.
describe("the Inspect panel", () => {
  beforeEach(() => resetState());

  it("stacks the metadata, the atom map and the GOP/seeking sections in one panel", () => {
    loadClip();
    state.format = "mp4";
    state.boxes = [{ type: "ftyp", start: 0, size: 32, children: [] }];
    state.gopLengths = [30, 30];
    const panel = document.createElement("div");
    // The order main.ts appends them in.
    renderInspectHead(panel);
    renderAtomMap(panel);
    renderGopStructure(panel);
    renderInspectTail(panel);
    // Metadata first, then the map of where the bytes are, then the keyframe structure that map's
    // box order decides (with the seeking test folded into that same card), then the bitrate over
    // time. This clip has no audio track; the order with one is pinned further down.
    expect(headings(panel)).toEqual([
      "Video Container Overview: mp4",
      "Video Track",
      "MP4 Box / Atom Structure",
      "GOP / Keyframe Structure",
      "Video Bitrate Over Time",
    ]);
  });

  // The overview's container explainer names the atom map; its link goes to whatever id the "On
  // this page" nav gives the atom card's heading.
  it("links the overview's mention of the atom map to the atom card", () => {
    const observers = installObserverStub("IntersectionObserver");
    try {
      loadClip();
      state.format = "MP4";
      state.boxes = [{ type: "ftyp", start: 0, size: 32, children: [] }];
      const panel = document.createElement("div");
      renderInspectHead(panel);
      renderAtomMap(panel);
      renderGopStructure(panel);
      renderInspectTail(panel);
      mountInspectToc(panel);
      const link = Array.from(panel.querySelectorAll<HTMLAnchorElement>(".teach a")).find(
        (a) => a.textContent === "Atom Map",
      )!;
      const atomHeading = panel.querySelector(".atom-faststart")!.closest(".section")!.querySelector("h2")!;
      expect(link.getAttribute("href")).toBe("#" + atomHeading.id);
    } finally {
      observers.restore();
    }
  });

  // Faststart is a fact about where moov sits relative to mdat, so it is read against the map that
  // draws them rather than in the file overview.
  it("reports faststart on the atom card, not on the overview", () => {
    loadClip();
    state.format = "MP4";
    state.faststart = true;
    state.boxes = [{ type: "ftyp", start: 0, size: 32, children: [] }];
    const overview = document.createElement("div");
    renderInspectHead(overview);
    expect(overview.textContent).not.toContain("Faststart");
    const atoms = document.createElement("div");
    renderAtomMap(atoms);
    expect(atoms.querySelector(".atom-faststart")?.textContent).toBe("✓ Fast start");
    expect(atoms.querySelector(".atom-faststart .badge")?.className).toBe("badge good");

    state.faststart = false;
    const late = document.createElement("div");
    renderAtomMap(late);
    expect(late.querySelector(".atom-faststart")?.textContent).toBe("✗ Not fast start");
    expect(late.querySelector(".atom-faststart .badge")?.className).toBe("badge bad");
  });

  // The container's own card was folded into the overview, and its explainer names the container,
  // so the grid no longer carries a Type row saying the same thing.
  it("carries the container explainer in the overview card, without a Type row", () => {
    loadClip();
    state.format = "MP4";
    const panel = document.createElement("div");
    renderInspectHead(panel);
    // The heading names the container, which is what the absorbed card's heading did.
    expect(headings(panel)).toEqual(["Video Container Overview: MP4", "Video Track"]);
    expect(panel.textContent).toContain("MPEG-4 Part 14");
    expect(labelsOf(panel)).not.toContain("Type");
  });

  // Every card leads with what it measured; the teaching text reads under it, not in front of it.
  it("puts the overview's figures above the explainers that follow them", () => {
    loadClip();
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
});

// The overview and the two track cards read the loaded file's tags and tracks straight off state,
// so each of their optional rows is driven by loading a track that carries the field.
describe("the overview and track cards", () => {
  beforeEach(() => resetState());

  /** An H.264 explainer with one parsed detail, the shape lib/codecKb resolves for a real track. */
  const AVC_INFO: CodecInfo = {
    family: "H.264",
    fullName: "AVC / MPEG-4 Part 10",
    year: 2003,
    description: "The most widely supported video codec in existence.",
    details: [{ label: "Profile", value: "High" }],
  };

  const AUDIO_TRACK: TrackInfo = {
    kind: "audio",
    codec: "aac",
    codecString: "mp4a.40.2",
    codecInfo: {
      family: "AAC",
      fullName: "Advanced Audio Coding",
      year: 1997,
      description: "The default audio codec paired with H.264.",
      details: [{ label: "Object Type", value: "AAC-LC" }],
    },
    packetRate: null,
    bitrate: 128_000,
    sampleRate: 48_000,
    channels: 2,
  };

  it("renders nothing at all before a file is open", () => {
    loadFile({ durationSec: 30, samples: samples(600, 30, () => 1000) });
    const panel = document.createElement("div");
    renderInspectHead(panel);
    renderInspectTail(panel);
    expect(panel.childElementCount).toBe(0);
  });

  it("lists the file's tags under readable labels, with the raw name kept for the unknown ones", () => {
    loadClip();
    state.tags = { title: "Session 1", raw: { "©too": "Lavf60.16.100", "com.example.custom": "x" } };
    const panel = document.createElement("div");
    renderInspectHead(panel);
    expect(panel.querySelector("h3")?.textContent).toBe("Metadata Tags");
    const labels = labelsOf(panel);
    expect(labels).toContain("Title");
    expect(labels).toContain("Encoding tool");
    expect(labels).toContain("com.example.custom");
    // Only the unknown tag keeps the container's own spelling as its label.
    expect(gridItem(panel, "com.example.custom").querySelector("label")?.classList.contains("raw")).toBe(true);
    expect(gridItem(panel, "Title").querySelector("label")?.classList.contains("raw")).toBe(false);
    expect(gridValue(panel, "Encoding tool")).toBe("Lavf60.16.100");
    expect(panel.textContent).toContain("Hover the ⓘ on any tag");
  });

  // The popover names where the tag's spelling comes from, and reads the encoder signature out of
  // its value where there is one; a tag the knowledge base does not know and whose value says
  // nothing gets no popover.
  it("explains a known tag and its encoder signature in the popover", () => {
    loadClip();
    state.tags = { title: "Session 1", raw: { "©too": "Lavf60.16.100", "com.example.custom": "x" } };
    const panel = document.createElement("div");
    renderInspectHead(panel);
    const pop = gridItem(panel, "Encoding tool").querySelector(".info-pop")!;
    expect(pop.querySelector("code")?.textContent).toBe("©too");
    expect(pop.querySelector(".info-pop-meta")?.textContent).toBe("MP4 / QuickTime atom");
    expect(pop.textContent).toContain("libavformat 60.16.100");
    const titlePop = gridItem(panel, "Title").querySelector(".info-pop")!;
    expect(titlePop.querySelector(".info-pop-meta")?.textContent).toBe("Normalized by mediabunny");
    expect(titlePop.querySelectorAll("p").length).toBe(1);
    expect(gridItem(panel, "com.example.custom").querySelector(".info-pop")).toBeNull();
  });

  it("still explains the value of an unknown tag when it carries an encoder signature", () => {
    loadClip();
    state.tags = { raw: { "x-writer": "HandBrake 1.6.1" } };
    const panel = document.createElement("div");
    renderInspectHead(panel);
    const pop = gridItem(panel, "x-writer").querySelector(".info-pop")!;
    expect(pop.querySelector(".info-pop-meta")).toBeNull();
    expect(pop.textContent).toContain("Written by HandBrake 1.6.1");
  });

  // mediabunny leaves an optional tag as an empty string or an object (an image) rather than
  // omitting it, and neither is a tag worth a row.
  it("shows no tag list when every tag is empty or not a scalar", () => {
    loadClip();
    state.tags = { comment: "", images: [{ data: new Uint8Array(), mimeType: "image/png", kind: "coverFront" }] };
    const panel = document.createElement("div");
    renderInspectHead(panel);
    expect(panel.querySelector("h3")).toBeNull();
    expect(panel.textContent).not.toContain("Metadata Tags");
  });

  it("lists every optional video-track figure the file states", () => {
    loadClip();
    state.tracks = [
      {
        ...VIDEO_TRACK,
        codecInfo: AVC_INFO,
        displayWidth: 853,
        displayHeight: 480,
        rotation: 90,
        chroma: "4:2:2",
        colorSpace: { primaries: "bt709", transfer: "bt709", matrix: "bt709" },
        hdr: true,
      },
    ];
    const panel = document.createElement("div");
    renderInspectHead(panel);
    const values = (label: string): string | null => gridValue(panel, label);
    expect(values("Codec")).toBe("avc1.640020");
    expect(values("Resolution")).toBe("640×480");
    expect(values("Display Size")).toBe("853×480");
    expect(values("Frame Rate")).toBe("20 fps");
    expect(values("Frames")).toBe("600");
    expect(values("Rotation")).toBe("90°");
    expect(values("Profile")).toBe("High");
    expect(values("Chroma")).toBe("4:2:2");
    expect(values("Color Space")).toBe("bt709 / bt709 / bt709");
    expect(values("HDR")).toBe("Yes");
    // The codec explainer sits under the figures, followed by the chroma one for the format stated.
    const teach = Array.from(panel.querySelectorAll(".section")[1]!.querySelectorAll(".teach")).map(
      (el) => el.textContent ?? "",
    );
    expect(teach[0]).toContain("H.264 (2003), AVC / MPEG-4 Part 10");
    expect(teach[1]).toContain("Chroma subsampling");
  });

  // A track that states nothing beyond its size gets no rows for what it does not state, and the
  // chroma explainer says so rather than guessing on the card.
  it("leaves out the rows a plainer video track has nothing to say for", () => {
    loadClip();
    const panel = document.createElement("div");
    renderInspectHead(panel);
    const labels = labelsOf(panel);
    for (const absent of ["Display Size", "Rotation", "Chroma", "Color Space", "HDR"]) {
      expect(labels).not.toContain(absent);
    }
    const videoCard = panel.querySelectorAll(".section")[1]!;
    expect(videoCard.querySelectorAll(".teach").length).toBe(1);
    expect(videoCard.textContent).toContain("This file does not state which it uses");
  });

  it("skips the video card for a track with no known dimensions", () => {
    loadClip();
    state.tracks = [{ ...VIDEO_TRACK, codedWidth: undefined, codedHeight: undefined }];
    const panel = document.createElement("div");
    renderInspectHead(panel);
    expect(headings(panel)).toEqual(["Video Container Overview"]);
  });

  it("describes the first video track when a file carries more than one", () => {
    loadClip();
    state.tracks = [VIDEO_TRACK, { ...VIDEO_TRACK, codedWidth: 1920, codedHeight: 1080 }];
    const panel = document.createElement("div");
    renderInspectHead(panel);
    expect(panel.querySelectorAll("h2").length).toBe(2);
    expect(gridValue(panel, "Resolution")).toBe("640×480");
  });

  it("reports the audio track's figures and codec details after the bitrate card", () => {
    loadClip();
    state.tracks = [VIDEO_TRACK, AUDIO_TRACK];
    const panel = document.createElement("div");
    renderInspectTail(panel);
    expect(headings(panel)).toEqual(["Video Bitrate Over Time", "Audio Track"]);
    expect(gridRows(panel.querySelectorAll(".section")[1]!)).toEqual([
      { label: "Codec", value: "mp4a.40.2", info: false, sm: true },
      { label: "Sample Rate", value: "48,000 Hz", info: false, sm: false },
      { label: "Channels", value: "2", info: false, sm: false },
      { label: "Bitrate", value: "128 kbps", info: true, sm: false },
      { label: "Object Type", value: "AAC-LC", info: false, sm: false },
    ]);
    expect(panel.querySelectorAll(".section")[1]!.querySelector(".teach")?.textContent).toContain(
      "AAC (1997), Advanced Audio Coding",
    );
  });

  // An audio-only file has no bitrate-over-time card to lead with, and a track whose header gives
  // no sample rate or channel count shows a dash rather than a made-up figure.
  it("shows dashes for an audio track that states neither its sample rate nor its channels", () => {
    loadClip();
    state.tracks = [{ ...AUDIO_TRACK, codecString: null, codecInfo: null, sampleRate: undefined, channels: undefined }];
    const panel = document.createElement("div");
    renderInspectTail(panel);
    expect(headings(panel)).toEqual(["Audio Track"]);
    const values = (label: string): string | null => gridValue(panel, label);
    expect(values("Codec")).toBe("aac");
    expect(values("Sample Rate")).toBe("–");
    expect(values("Channels")).toBe("–");
    expect(panel.querySelector(".teach")).toBeNull();
  });

  it("names the video codec by its short id when the file gives no codec string", () => {
    loadClip();
    state.tracks = [{ ...VIDEO_TRACK, codecString: null }];
    const panel = document.createElement("div");
    renderInspectHead(panel);
    expect(gridValue(panel, "Codec")).toBe("avc");
  });

  // An empty codec string names nothing either, so the short id stands in for it as for a missing one.
  it("names the video codec by its short id when the file's codec string is empty", () => {
    loadClip();
    state.tracks = [{ ...VIDEO_TRACK, codecString: "" }];
    const panel = document.createElement("div");
    renderInspectHead(panel);
    expect(gridValue(panel, "Codec")).toBe("avc");
  });

  // The overall bitrate is the whole file's size over its running time (2,000,000 B over 30 s), not
  // the 500 kbps the video track states.
  it("states the file's size, overall bitrate and MIME type in the overview", () => {
    loadClip();
    state.mimeType = "video/mp4";
    const panel = document.createElement("div");
    renderInspectHead(panel);
    expect(gridRows(panel.querySelector(".section .grid")!)).toEqual([
      { label: "File Size", value: "1.9 MB", info: false, sm: false },
      { label: "Duration", value: "30.000 s", info: false, sm: false },
      { label: "Overall Bitrate", value: "533 kbps", info: true, sm: false },
      { label: "MIME Type", value: "video/mp4", info: true, sm: true },
    ]);
  });

  // A file whose header gives no duration has no rate to divide by, so the overview and the bitrate
  // card both show what they have rather than a figure over nothing.
  it("shows dashes for the duration and overall bitrate of a file with no known duration", () => {
    loadClip();
    state.duration = null;
    const panel = document.createElement("div");
    renderInspectHead(panel);
    renderInspectTail(panel);
    const values = (label: string): string | null => gridValue(panel, label);
    expect(values("Duration")).toBe("–");
    expect(values("Overall Bitrate")).toBe("–");
    expect(chartOf(panel.querySelector<HTMLDivElement>(".section:last-child"))).toBeNull();
    expect(values("Average")).toBe("500 kbps");
  });

  it("appends no audio card to a file without an audio track", () => {
    loadClip();
    const panel = document.createElement("div");
    renderInspectTail(panel);
    expect(headings(panel)).toEqual(["Video Bitrate Over Time"]);
  });
});
