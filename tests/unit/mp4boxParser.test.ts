import type { ISOFile, MP4BoxSampleEntry } from "mp4box";
import { describe, expect, it } from "vitest";
import { declaresConstantBitrate, extractDeclaredBitrate, nearestKeyframeAtOrBefore } from "../../src/lib/mp4boxParser";

describe("nearestKeyframeAtOrBefore", () => {
  const keyframes = [0, 2, 4.5, 10];

  it("returns null when t is before the first keyframe", () => {
    expect(nearestKeyframeAtOrBefore(keyframes, -1)).toBeNull();
  });

  it("returns the exact match when t lands on a keyframe", () => {
    expect(nearestKeyframeAtOrBefore(keyframes, 4.5)).toBe(4.5);
  });

  it("returns the largest keyframe <= t for values in between", () => {
    expect(nearestKeyframeAtOrBefore(keyframes, 3.9)).toBe(2);
  });

  it("returns the last keyframe when t is after all of them", () => {
    expect(nearestKeyframeAtOrBefore(keyframes, 1000)).toBe(10);
  });

  it("returns null for an empty keyframe list", () => {
    expect(nearestKeyframeAtOrBefore([], 5)).toBeNull();
  });

  it("handles a single-keyframe list", () => {
    expect(nearestKeyframeAtOrBefore([3], 3)).toBe(3);
    expect(nearestKeyframeAtOrBefore([3], 2.9)).toBeNull();
    expect(nearestKeyframeAtOrBefore([3], 3.1)).toBe(3);
  });
});

/** Just the moov chain extractDeclaredBitrate walks, as mp4box would have populated it. */
function isoFileWith(traks: { trackId: number; entries: MP4BoxSampleEntry[] }[]): ISOFile {
  return {
    moov: {
      traks: traks.map((t) => ({
        tkhd: { track_id: t.trackId },
        mdia: { minf: { stbl: { stsd: { entries: t.entries } } } },
      })),
    },
  } as ISOFile;
}

describe("extractDeclaredBitrate", () => {
  it("reads the requested track's btrt", () => {
    const file = isoFileWith([
      {
        trackId: 1,
        entries: [{ type: "avc1", btrt: { bufferSizeDB: 0, maxBitrate: 8_000_000, avgBitrate: 5_000_000 } }],
      },
    ]);
    expect(extractDeclaredBitrate(file, 1)).toEqual({ avgBitrate: 5_000_000, maxBitrate: 8_000_000 });
  });

  it("does not mistake another track's btrt for the requested one", () => {
    const file = isoFileWith([
      { trackId: 1, entries: [{ type: "avc1" }] },
      { trackId: 2, entries: [{ type: "mp4a", btrt: { maxBitrate: 128_000, avgBitrate: 128_000 } }] },
    ]);
    expect(extractDeclaredBitrate(file, 1)).toBeNull();
    expect(extractDeclaredBitrate(file, 2)).toEqual({ avgBitrate: 128_000, maxBitrate: 128_000 });
  });

  it("returns null for a track with no btrt, which is the common case", () => {
    expect(extractDeclaredBitrate(isoFileWith([{ trackId: 1, entries: [{ type: "avc1" }] }]), 1)).toBeNull();
  });

  it("returns null for an unknown track id", () => {
    expect(extractDeclaredBitrate(isoFileWith([{ trackId: 1, entries: [] }]), 99)).toBeNull();
  });

  it("returns null when the moov never parsed", () => {
    expect(extractDeclaredBitrate({} as ISOFile, 1)).toBeNull();
  });

  it("takes the first entry that declares rates when a track has several", () => {
    const file = isoFileWith([
      {
        trackId: 1,
        entries: [{ type: "avc1" }, { type: "avc1", btrt: { maxBitrate: 900, avgBitrate: 900 } }],
      },
    ]);
    expect(extractDeclaredBitrate(file, 1)).toEqual({ avgBitrate: 900, maxBitrate: 900 });
  });
});

describe("declaresConstantBitrate", () => {
  it("is true only when the declared average and maximum are the same number", () => {
    expect(declaresConstantBitrate({ avgBitrate: 128_000, maxBitrate: 128_000 })).toBe(true);
    expect(declaresConstantBitrate({ avgBitrate: 128_000, maxBitrate: 200_000 })).toBe(false);
  });

  it("is false without a declaration at all", () => {
    expect(declaresConstantBitrate(null)).toBe(false);
    expect(declaresConstantBitrate(undefined)).toBe(false);
  });

  it("is false for a placeholder declaration of zero, which claims nothing", () => {
    expect(declaresConstantBitrate({ avgBitrate: 0, maxBitrate: 0 })).toBe(false);
  });
});
