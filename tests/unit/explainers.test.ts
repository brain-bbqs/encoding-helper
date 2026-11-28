import { describe, expect, it } from "vitest";
import type { BitrateTimeline } from "../../src/lib/bitrateTimeline";
import {
  ANALYSIS_PANEL_INTRO,
  chromaSubsamplingExplainer,
  codecExplainer,
  constantBitrateNote,
  CONTAINER_KB,
  containerExplainer,
  contradictedDeclarationNote,
} from "../../src/lib/explainers";
import { describeMetadataTagValue as hint } from "../../src/lib/metadataTagKb";
import type { CodecInfo } from "../../src/lib/types";

// Read through the metadata card's own lookup, which takes the first signature that matches and
// feeds it the version it captured.
describe("VALUE_HINTS", () => {
  it("says nothing about a value no encoder signature matches", () => {
    expect(hint("My holiday")).toBeNull();
  });

  it("decodes FFmpeg's muxing and encoding libraries with their versions", () => {
    const lavf = hint("Lavf60.16.100");
    expect(lavf).toContain("<b>libavformat 60.16.100</b>");
    expect(lavf).toContain("FFmpeg");
    expect(hint("Lavc60.31.102 libx264")).toContain("<b>libavcodec 60.31.102</b>");
  });

  // Each version group always participates in the match, so a bare name still comes out as a
  // sentence rather than as "undefined" in the middle of one.
  it("names x264 with its core number, or without one", () => {
    expect(hint("x264 core 164 r3095")).toContain("<b>x264</b> core 164,");
    expect(hint("x264 - core 164")).toContain("<b>x264</b>,");
    expect(hint("Encoded by x264")).toContain("<b>x264</b>, the open source H.264 encoder");
  });

  it("names x265 with its version, or without one", () => {
    expect(hint("x265 3.5")).toBe("Encoded with <b>x265</b> 3.5, the open source H.265/HEVC encoder.");
    expect(hint("x265")).toBe("Encoded with <b>x265</b>, the open source H.265/HEVC encoder.");
  });

  it("names HandBrake and mediabunny either way too", () => {
    expect(hint("HandBrake 1.6.1 2023011000")).toContain("<b>HandBrake</b> 1.6.1,");
    expect(hint("handbrake")).toContain("<b>HandBrake</b>,");
    expect(hint("mediabunny 1.2.0")).toContain("<b>mediabunny</b> 1.2.0,");
    expect(hint("Mediabunny")).toContain("<b>mediabunny</b>,");
  });
});

describe("containerExplainer", () => {
  it("links the Atom Map mention to wherever the map is on the page doing the rendering", () => {
    const text = containerExplainer(CONTAINER_KB.MP4!, "#atom-map");
    expect(text.startsWith("<b>MP4</b> (")).toBe(true);
    expect(text).toContain('<a href="#atom-map"><b>Atom Map</b></a>');
    expect(text).toContain("<b>Video codecs it can carry:</b>");
    expect(text).toContain("<b>Playback:</b>");
  });

  it("leaves a record with no map mention as it is", () => {
    const text = containerExplainer(CONTAINER_KB.WebM!, "#atom-map");
    expect(text).not.toContain("#atom-map");
    expect(text).toContain("<b>WebM</b> (");
  });
});

describe("bitrate notes", () => {
  it("quotes the declared constant rate in the note that stands in for the plot", () => {
    const text = constantBitrateNote(2_500_000);
    expect(text).toContain("<code>btrt</code> box gives the same number, 2.50 Mbps,");
    expect(text).toContain("<b>constant bitrate</b>");
  });

  it("puts the measured span against the declared rate when the two disagree", () => {
    const timeline = { minBitrate: 800_000, peakBitrate: 6_000_000 } as unknown as BitrateTimeline;
    const text = contradictedDeclarationNote(2_500_000, timeline);
    expect(text).toContain("gives 2.50 Mbps as both");
    expect(text).toContain("run from 800 kbps to 6.00 Mbps");
  });
});

describe("codecExplainer", () => {
  const avc: CodecInfo = {
    family: "H.264",
    fullName: "Advanced Video Coding",
    year: 2003,
    description: "The most widely supported video codec.",
    details: [],
  };

  it("has nothing to say about a codec the knowledge base does not know", () => {
    expect(codecExplainer(null)).toBeNull();
    // @ts-expect-error: undefined is outside the type, but the falsy guard turns it away all the same.
    expect(codecExplainer(undefined)).toBeNull();
  });

  it("leads with the family, its year and its long name", () => {
    expect(codecExplainer(avc)).toBe(
      "<b>H.264</b> (2003), Advanced Video Coding. The most widely supported video codec.",
    );
  });

  it("drops the year and the long name when there is none to add", () => {
    expect(codecExplainer({ ...avc, year: null, fullName: "H.264" })).toBe(
      "<b>H.264</b>. The most widely supported video codec.",
    );
  });
});

describe("chromaSubsamplingExplainer", () => {
  const intro = "<b>Chroma subsampling</b>";

  it("spells out the likely format when the file states none", () => {
    const text = chromaSubsamplingExplainer(640, 480, null);
    expect(text.startsWith(intro)).toBe(true);
    expect(text).toContain(
      "This file does not state which it uses (the codec configuration carries no chroma field, and its " +
        "profile allows more than one), but 4:2:0 is what nearly every delivery file is",
    );
    expect(text).toContain("this file is already even in both");
  });

  it("names the odd dimension a 4:2:0 encode would have to pad", () => {
    expect(chromaSubsamplingExplainer(641, 480, "4:2:0")).toContain("<b>odd</b> in width (641×480)");
    expect(chromaSubsamplingExplainer(640, 481, "4:2:0")).toContain("<b>odd</b> in height (640×481)");
    expect(chromaSubsamplingExplainer(641, 481, null)).toContain("<b>odd</b> in width and height (641×481)");
    expect(chromaSubsamplingExplainer(641, 481, null)).toContain("must pad or crop before it can write yuv420p");
  });

  it("does not repeat the format for a file that states 4:2:0", () => {
    const text = chromaSubsamplingExplainer(640, 480, "4:2:0");
    expect(text).not.toContain("does not state");
    expect(text).toContain("4:2:0 needs <b>even</b> width and height");
  });

  it("says monochrome has no colour to subsample", () => {
    const text = chromaSubsamplingExplainer(641, 481, "monochrome");
    expect(text).toContain("Monochrome carries brightness only");
    expect(text).not.toContain("odd");
  });

  it("asks 4:2:2 only for an even width", () => {
    expect(chromaSubsamplingExplainer(640, 481, "4:2:2")).toContain("which this file has.");
    expect(chromaSubsamplingExplainer(641, 480, "4:2:2")).toContain("which this file does not (641px).");
  });

  it("has nothing to add for 4:4:4", () => {
    const text = chromaSubsamplingExplainer(641, 481, "4:4:4");
    expect(text.startsWith(intro)).toBe(true);
    expect(text).not.toContain("<p>");
  });
});

describe("ANALYSIS_PANEL_INTRO", () => {
  it("says what the document holds and which runs join it once they are run", () => {
    expect(ANALYSIS_PANEL_INTRO).toContain(
      "the <code>ffmpeg</code> command these settings produce. It holds results and plots only, with the " +
        "teaching explainers left out. Runs that have to be started by hand (the seeking test, Compare " +
        "Quality, an in-browser reencode) are added to it once you have run them",
    );
  });
});
