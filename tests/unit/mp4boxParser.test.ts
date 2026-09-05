import type { ISOFile, MP4BoxInfo, MP4BoxSampleEntry } from "mp4box";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChunkedSource } from "../../src/lib/chunkedSource";
import {
  declaresConstantBitrate,
  detectFaststart,
  extractBoxTree,
  extractDeclaredBitrate,
  extractSampleAnalysis,
  nearestKeyframeAtOrBefore,
  parseWithMp4Box,
} from "../../src/lib/mp4boxParser";
import type { BoxNode } from "../../src/lib/types";

// The parser drives mp4box rather than implementing it, so the file object it is handed is a stub:
// what these cases pin down is the feeding loop around it, not mp4box's own box parsing.
const createFile = vi.hoisted(() => vi.fn());
vi.mock("mp4box", () => ({ default: { createFile } }));

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

/** A file mp4box is fed from, of `size` bytes read `chunk` at a time. */
function source(size: number): ChunkedSource {
  return {
    size,
    readChunk: (offset: number, length: number) =>
      Promise.resolve(new ArrayBuffer(Math.max(0, Math.min(length, size - offset)))),
  } as unknown as ChunkedSource;
}

/** The parts of mp4box's file object parseWithMp4Box drives, recording what it was fed. */
function stubMp4BoxFile(over: Partial<ISOFile> = {}): ISOFile & { appended: number[]; flushed: number } {
  const file = {
    appended: [] as number[],
    flushed: 0,
    onReady: undefined,
    onError: undefined,
    appendBuffer(buf: ArrayBuffer & { fileStart: number }) {
      file.appended.push(buf.fileStart);
      file.onReady?.({ videoTracks: [{ id: 1, timescale: 600 }] } as MP4BoxInfo);
      return undefined;
    },
    flush() {
      file.flushed++;
    },
    ...over,
  } as unknown as ISOFile & { appended: number[]; flushed: number };
  return file;
}

describe("parseWithMp4Box", () => {
  beforeEach(() => vi.clearAllMocks());

  it("drip-feeds the whole file and reports how far it has got", async () => {
    const file = stubMp4BoxFile();
    createFile.mockReturnValue(file);
    const progress: number[] = [];

    const result = await parseWithMp4Box(source(5 * 1024 * 1024), (p) => progress.push(p));

    expect(file.appended).toEqual([0, 2 * 1024 * 1024, 4 * 1024 * 1024]);
    expect(file.flushed).toBe(1);
    expect(result.info.videoTracks[0].id).toBe(1);
    expect(progress[progress.length - 1]).toBe(1);
  });

  it("honours the offset mp4box asks to jump to, so a large mdat is not read byte for byte", async () => {
    const file = stubMp4BoxFile();
    file.appendBuffer = (buf: ArrayBuffer & { fileStart: number }) => {
      file.appended.push(buf.fileStart);
      file.onReady?.({ videoTracks: [] } as unknown as MP4BoxInfo);
      // Past the mdat on the first append, then straight on.
      return file.appended.length === 1 ? 9 * 1024 * 1024 : undefined;
    };
    createFile.mockReturnValue(file);

    await parseWithMp4Box(source(10 * 1024 * 1024));

    expect(file.appended).toEqual([0, 9 * 1024 * 1024]);
  });

  it("reports the error mp4box raised as soon as it raises one", async () => {
    const file = stubMp4BoxFile();
    file.appendBuffer = () => {
      file.onError?.("bad box");
      return undefined;
    };
    createFile.mockReturnValue(file);

    await expect(parseWithMp4Box(source(1024))).rejects.toThrow("mp4box parse error: bad box");
  });

  it("says the moov was never found rather than handing back a half-parsed file", async () => {
    const file = stubMp4BoxFile();
    file.appendBuffer = () => undefined;
    createFile.mockReturnValue(file);

    await expect(parseWithMp4Box(source(1024))).rejects.toThrow("moov box not found");
  });

  it("stops when the source runs out early rather than looping on an empty read", async () => {
    const file = stubMp4BoxFile();
    createFile.mockReturnValue(file);
    const empty = { size: 4096, readChunk: () => Promise.resolve(new ArrayBuffer(0)) } as unknown as ChunkedSource;

    await expect(parseWithMp4Box(empty)).rejects.toThrow("moov box not found");
    expect(file.appended).toEqual([]);
  });
});

describe("extractBoxTree", () => {
  it("flattens mp4box's tree into the nodes the atom map draws", () => {
    const tree = extractBoxTree({
      boxes: [
        { type: "ftyp", start: 0, size: 32 },
        { type: "moov", start: 32, size: 200, boxes: [{ type: "mvhd", start: 40, size: 108 }] },
      ],
    } as unknown as ISOFile);

    expect(tree).toEqual([
      { type: "ftyp", start: 0, size: 32, children: [] },
      { type: "moov", start: 32, size: 200, children: [{ type: "mvhd", start: 40, size: 108, children: [] }] },
    ]);
  });

  it("names a box mp4box could not identify rather than dropping it", () => {
    expect(extractBoxTree({ boxes: [{}] } as unknown as ISOFile)).toEqual([
      { type: "????", start: 0, size: 0, children: [] },
    ]);
  });
});

describe("detectFaststart", () => {
  const box = (type: string, start: number): BoxNode => ({ type, start, size: 100, children: [] });

  it("is fast start when the moov comes before the payload", () => {
    expect(detectFaststart([box("ftyp", 0), box("moov", 32), box("mdat", 2032)])).toBe(true);
  });

  it("is not fast start when the moov trails the payload", () => {
    expect(detectFaststart([box("ftyp", 0), box("mdat", 32), box("moov", 9000)])).toBe(false);
  });

  it("leaves the question open on a file with no moov or no mdat to compare", () => {
    expect(detectFaststart([box("ftyp", 0), box("mdat", 32)])).toBeNull();
    expect(detectFaststart([box("ftyp", 0), box("moov", 32)])).toBeNull();
    expect(detectFaststart([])).toBeNull();
  });
});

describe("extractSampleAnalysis", () => {
  /** A file whose samples are `entries`, at 600 ticks a second. */
  function fileOfSamples(entries: { size: number; cts: number; dts: number; is_sync: boolean }[]): ISOFile {
    return { getTrackSamplesInfo: () => entries } as unknown as ISOFile;
  }

  /** `count` frames, one every 20 ticks, with a keyframe every `gop` of them. */
  function frames(count: number, gop: number) {
    return Array.from({ length: count }, (_, i) => ({
      size: 1000,
      cts: i * 20,
      dts: i * 20,
      is_sync: i % gop === 0,
    }));
  }

  it("reads the sample table into frames, keyframes and the GOPs between them", () => {
    const analysis = extractSampleAnalysis(fileOfSamples(frames(10, 4)), 1, 600);

    expect(analysis.samples).toHaveLength(10);
    expect(analysis.samples[1]).toEqual({ size: 1000, cts: 20, dts: 20, ctsSec: 20 / 600, is_sync: false });
    expect(analysis.keyframeDecodeIndices).toEqual([0, 4, 8]);
    // The last GOP runs to the end of the file, however short that leaves it.
    expect(analysis.gopLengths).toEqual([4, 4, 2]);
    expect(analysis.keyframeTimestampsSec).toEqual([0, 80 / 600, 160 / 600]);
  });

  it("spots B-frames by a presentation time that is not the decode time", () => {
    expect(extractSampleAnalysis(fileOfSamples(frames(4, 4)), 1, 600).hasBFrames).toBe(false);
    const reordered = frames(4, 4);
    reordered[1].cts = 60;
    reordered[3].cts = 20;
    expect(extractSampleAnalysis(fileOfSamples(reordered), 1, 600).hasBFrames).toBe(true);
  });

  it("lists the keyframes in presentation order, which is what a seek looks them up in", () => {
    const reordered = frames(4, 2);
    // The second keyframe is presented before the frame that decodes ahead of it.
    reordered[1].cts = 60;
    reordered[2].cts = 40;
    const analysis = extractSampleAnalysis(fileOfSamples(reordered), 1, 600);
    expect(analysis.keyframeTimestampsSec).toEqual([0, 40 / 600]);
  });

  it("reads a missing timescale as ticks, rather than dividing by zero", () => {
    expect(extractSampleAnalysis(fileOfSamples(frames(2, 1)), 1, 0).samples[1].ctsSec).toBe(20);
  });

  it("says so when the track has no samples at all", () => {
    expect(() => extractSampleAnalysis(fileOfSamples([]), 1, 600)).toThrow("No samples found");
  });
});
