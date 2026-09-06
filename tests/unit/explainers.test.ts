import { describe, expect, it } from "vitest";
import type { BitrateTimeline } from "../../src/lib/bitrateTimeline";
import {
  chromaSubsamplingExplainer,
  codecExplainer,
  constantBitrateNote,
  CONTAINER_KB,
  containerExplainer,
  contradictedDeclarationNote,
  sizeEstimateTeach,
} from "../../src/lib/explainers";
import { describeMetadataTagValue as hint } from "../../src/lib/metadataTagKb";
import type { SizeEstimate } from "../../src/lib/sizeEstimate";
import type { CodecInfo } from "../../src/lib/types";

// Read through the metadata card's own lookup, which takes the first signature that matches and
// feeds it the version it captured.
describe("VALUE_HINTS", () => {
  it("says nothing about a value no encoder signature matches", () => {
    expect(hint("My holiday")).toBeNull();
  });

  it("decodes FFmpeg's muxing and encoding libraries with their versions", () => {
    expect(hint("Lavf60.16.100")).toContain("<b>libavformat 60.16.100</b>");
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
    expect(text).toContain("This file does not state which it uses");
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

describe("sizeEstimateTeach", () => {
  /** A 1 MB, 100 s file whose first 10 s were sampled and came out at half the size. */
  function estimate(over: Partial<SizeEstimate> = {}): SizeEstimate {
    return {
      basis: "sample-table",
      originalTotalBytes: 1_000_000,
      totalSeconds: 100,
      segmentSeconds: 10,
      originalSegmentBytes: 100_000,
      ratio: 0.5,
      savedFraction: 0.5,
      segmentSavedBytes: 50_000,
      projectedTotalBytes: 500_000,
      projectedSavedBytes: 500_000,
      projectedRange: { low: 450_000, high: 550_000 },
      sampledFraction: 0.1,
      windowCount: 1,
      windowDifficulty: 1,
      ...over,
    };
  }

  it("says the original side was measured out of the sample table", () => {
    const text = sizeEstimateTeach(estimate());
    expect(text).toContain("measured, not assumed");
    expect(text).toContain("fair sample to project from");
    expect(text).toContain("The range is not a confidence interval");
    expect(text).toContain("<b>Why it is still only an estimate.</b>");
  });

  it("says the original side was spread evenly when there was no sample table", () => {
    const text = sizeEstimateTeach(estimate({ basis: "proportional", windowDifficulty: null, projectedRange: null }));
    expect(text).toContain("had to be approximated");
    expect(text).not.toContain("The range is not a confidence interval");
    expect(text).not.toContain("stretch picked here");
  });

  // A busy stretch is quoted to one decimal, a calm one to two, since its ratio sits close to 1.
  it("calls the stretch busy or calm when it sits far from the file's average", () => {
    expect(sizeEstimateTeach(estimate({ windowDifficulty: 1.8182 }))).toContain(
      "a <b>busy</b> one, costing 1.8&times; the source's average rate",
    );
    expect(sizeEstimateTeach(estimate({ windowDifficulty: 0.5 }))).toContain(
      "a <b>calm</b> one, costing 0.50&times; the source's average rate",
    );
  });

  it("calls the stretch a fair sample within fifteen percent either way", () => {
    expect(sizeEstimateTeach(estimate({ windowDifficulty: 1.14 }))).toContain("fair sample");
    expect(sizeEstimateTeach(estimate({ windowDifficulty: 0.86 }))).toContain("fair sample");
  });

  it("says nothing about the stretch for a ratio that measures nothing", () => {
    for (const d of [0, -1, Infinity, NaN]) {
      expect(sizeEstimateTeach(estimate({ windowDifficulty: d }))).not.toContain("stretch picked here");
    }
  });
});
