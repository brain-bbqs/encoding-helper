import { beforeEach, describe, expect, it } from "vitest";
import { seekResult } from "../fixtures/seekResult";
import {
  describeAvgGop,
  gopRange,
  gopStats,
  SEEK_TABLE_HEADERS,
  seekResultRow,
  seekSummary,
} from "../../src/lib/seekReport";
import { resetState, state } from "../../src/lib/state";

describe("seekResultRow", () => {
  it("prints one sampled timestamp in header order", () => {
    expect(seekResultRow(seekResult())).toEqual(["1.500s", "1.000s", "0.500s", "15", "12.3 ms"]);
    expect(seekResultRow(seekResult())).toHaveLength(SEEK_TABLE_HEADERS.length);
  });

  it("dashes the columns a timestamp before the first keyframe has no answer for", () => {
    expect(seekResultRow(seekResult({ kf: null, dist: null, distFrames: null }))).toEqual([
      "1.500s",
      "–",
      "–",
      "–",
      "12.3 ms",
    ]);
  });
});

describe("seekSummary", () => {
  it("averages the distances and decode times, and keeps the worst decode", () => {
    const summary = seekSummary([
      seekResult({ dist: 0.5, decodeMs: 10 }),
      seekResult({ dist: 1.5, decodeMs: 30 }),
      seekResult({ dist: 1, decodeMs: 20 }),
    ]);
    expect(summary).toEqual({ avgDist: 1, avgDecode: 20, maxDecode: 30 });
  });

  it("counts a timestamp with no keyframe before it as no distance rather than skipping it", () => {
    const summary = seekSummary([seekResult({ dist: null, decodeMs: 10 }), seekResult({ dist: 1, decodeMs: 10 })]);
    expect(summary.avgDist).toBe(0.5);
  });

  // Nothing to average and no worst decode to name, rather than NaN and -Infinity.
  it("has no figures for a run with no timestamps in it", () => {
    expect(seekSummary([])).toEqual({ avgDist: null, avgDecode: null, maxDecode: null });
  });
});

describe("gopRange", () => {
  it("finds the shortest and the longest GOP", () => {
    expect(gopRange([30, 12, 90, 30])).toEqual({ min: 12, max: 90 });
  });

  it("has no range for a file with no GOPs", () => {
    expect(gopRange([])).toBeNull();
  });

  // One entry per keyframe: an all-intra recording of an hour or so has more than a call can take
  // as arguments, which is what a spread into Math.min and Math.max would make of them.
  it("takes a file with a million keyframes", () => {
    const gop = Array.from({ length: 1_000_000 }, (_, i) => (i % 7) + 1);
    expect(gopRange(gop)).toEqual({ min: 1, max: 7 });
  });
});

describe("gopStats", () => {
  beforeEach(() => resetState());

  it("means the loaded file's GOP lengths at its frame rate", () => {
    state.gopLengths = [30, 30, 60];
    state.fps = 25;
    expect(gopStats()).toEqual({ gop: [30, 30, 60], avgGop: 40, fps: 25 });
  });

  it("reads an unmeasured frame rate as 30, so the mean can still be given in seconds", () => {
    state.gopLengths = [30];
    expect(gopStats().fps).toBe(30);
  });

  it("means nothing to zero rather than NaN when no GOPs were found", () => {
    expect(gopStats().avgGop).toBe(0);
  });
});

describe("describeAvgGop", () => {
  it("gives the mean as frames and the seconds they take", () => {
    expect(describeAvgGop(30, 30)).toBe("30.0 frames (1.00 s)");
    expect(describeAvgGop(48, 24)).toBe("48.0 frames (2.00 s)");
  });
});
