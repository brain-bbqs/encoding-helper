import { beforeEach, describe, expect, it } from "vitest";
import { describeAvgGop, gopStats, SEEK_TABLE_HEADERS, seekResultRow, seekSummary } from "../../src/lib/seekReport";
import { resetState, state } from "../../src/lib/state";
import type { SeekResult } from "../../src/lib/types";

function result(over: Partial<SeekResult> = {}): SeekResult {
  return { t: 1.5, kf: 1, dist: 0.5, distFrames: 15, decodeMs: 12.34, ...over };
}

describe("seekResultRow", () => {
  it("prints one sampled timestamp in header order", () => {
    expect(seekResultRow(result())).toEqual(["1.500s", "1.000s", "0.500s", "15", "12.3 ms"]);
    expect(seekResultRow(result())).toHaveLength(SEEK_TABLE_HEADERS.length);
  });

  it("dashes the columns a timestamp before the first keyframe has no answer for", () => {
    expect(seekResultRow(result({ kf: null, dist: null, distFrames: null }))).toEqual([
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
      result({ dist: 0.5, decodeMs: 10 }),
      result({ dist: 1.5, decodeMs: 30 }),
      result({ dist: 1, decodeMs: 20 }),
    ]);
    expect(summary).toEqual({ avgDist: 1, avgDecode: 20, maxDecode: 30 });
  });

  it("counts a timestamp with no keyframe before it as no distance rather than skipping it", () => {
    expect(seekSummary([result({ dist: null, decodeMs: 10 }), result({ dist: 1, decodeMs: 10 })]).avgDist).toBe(0.5);
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
