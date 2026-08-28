import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChunkedSource } from "../../src/lib/chunkedSource";
import {
  clearMatrixCache,
  flushMatrixCache,
  measurementKey,
  readMeasurement,
  recallWindows,
  rememberWindows,
  videoChecksum,
  writeMeasurement,
} from "../../src/lib/matrixCache";
import type { SampleWindow } from "../../src/lib/types";

const MIB = 1024 * 1024;

/** A loaded file of exactly these bytes. jsdom's Blob cannot be read as an ArrayBuffer, so the one
 * read the checksum makes is answered here rather than through a File. */
function sourceOf(bytes: Uint8Array): ChunkedSource {
  const source = new ChunkedSource();
  source.kind = "file";
  source.size = bytes.length;
  source.readChunk = (offset, size) =>
    Promise.resolve(bytes.slice(offset, Math.min(offset + size, bytes.length)).buffer as ArrayBuffer);
  return source;
}

/** A file too big to hold in a test, recording where it was read from. */
function hugeSource(size: number, reads: number[]): ChunkedSource {
  const source = new ChunkedSource();
  source.kind = "file";
  source.size = size;
  source.readChunk = (offset, length) => {
    reads.push(offset);
    return Promise.resolve(new ArrayBuffer(Math.max(0, Math.min(length, size - offset))));
  };
  return source;
}

function bytesOf(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

const WINDOWS: SampleWindow[] = [
  { startSeconds: 0, seconds: 5 },
  { startSeconds: 12.5, seconds: 5 },
];

const ARGS = ["-y", "-i", "in.mp4", "-crf", "25", "-preset", "veryfast", "out.mp4"];

/** The module as a freshly loaded page would have it: nothing in memory, everything read back off
 * localStorage. */
async function reloaded(): Promise<typeof import("../../src/lib/matrixCache")> {
  vi.resetModules();
  return await import("../../src/lib/matrixCache");
}

beforeEach(() => {
  vi.useRealTimers();
  clearMatrixCache();
  localStorage.clear();
});

describe("videoChecksum", () => {
  it("is the same for the same bytes, whatever the file is called", async () => {
    const one = sourceOf(bytesOf(1, 2, 3, 4, 5));
    one.name = "clip.mp4";
    const other = sourceOf(bytesOf(1, 2, 3, 4, 5));
    other.name = "the-same-clip-renamed.mp4";
    expect(await videoChecksum(one)).toBe(await videoChecksum(other));
  });

  it("tells two files of the same size apart", async () => {
    const one = await videoChecksum(sourceOf(bytesOf(1, 2, 3, 4, 5)));
    const other = await videoChecksum(sourceOf(bytesOf(1, 2, 3, 4, 6)));
    expect(one).not.toBe(other);
  });

  it("tells two files apart on their size alone", async () => {
    const one = await videoChecksum(sourceOf(bytesOf(1, 2, 3)));
    const other = await videoChecksum(sourceOf(bytesOf(1, 2, 3, 0)));
    expect(one).not.toBe(other);
  });

  // The point of a sampled checksum: a multi-gigabyte recording is identified without being read,
  // let alone held in memory, which is the only way a browser can do this at all.
  it("reads three megabytes of a large file, from its beginning, middle and end", async () => {
    const reads: number[] = [];
    const size = 4 * 1024 * MIB;
    await videoChecksum(hugeSource(size, reads));
    expect(reads).toEqual([0, size / 2 - MIB / 2, size - MIB]);
  });

  // `crypto.subtle` is not exposed on an insecure origin, where the cache is still worth having.
  it("still identifies a file where the browser offers no SubtleCrypto", async () => {
    vi.stubGlobal("crypto", undefined);
    try {
      const one = await videoChecksum(sourceOf(bytesOf(1, 2, 3)));
      expect(await videoChecksum(sourceOf(bytesOf(1, 2, 3)))).toBe(one);
      expect(await videoChecksum(sourceOf(bytesOf(1, 2, 4)))).not.toBe(one);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("takes the same answer for a source it has already read", async () => {
    const reads: number[] = [];
    const source = hugeSource(64 * MIB, reads);
    const first = await videoChecksum(source);
    expect(await videoChecksum(source)).toBe(first);
    expect(reads).toHaveLength(3);
  });
});

describe("measurementKey", () => {
  const checksum = "s0123456789abcdef";

  it("is the same for the same file, command and stretches", () => {
    expect(measurementKey(checksum, ARGS, WINDOWS)).toBe(measurementKey(checksum, ARGS, WINDOWS));
  });

  it("changes with the file", () => {
    expect(measurementKey("sffff", ARGS, WINDOWS)).not.toBe(measurementKey(checksum, ARGS, WINDOWS));
  });

  // Everything the command carries, not just the four swept axes: a grid measured at one keyframe
  // interval is a grid of the wrong numbers once that interval moves.
  it("changes with anything in the command", () => {
    const otherCrf = ARGS.map((arg) => (arg === "25" ? "28" : arg));
    const otherGop = [...ARGS, "-g", "60"];
    expect(measurementKey(checksum, otherCrf, WINDOWS)).not.toBe(measurementKey(checksum, ARGS, WINDOWS));
    expect(measurementKey(checksum, otherGop, WINDOWS)).not.toBe(measurementKey(checksum, ARGS, WINDOWS));
  });

  it("changes with the stretches measured", () => {
    const elsewhere = [WINDOWS[0], { startSeconds: 13, seconds: 5 }];
    expect(measurementKey(checksum, ARGS, elsewhere)).not.toBe(measurementKey(checksum, ARGS, WINDOWS));
    expect(measurementKey(checksum, ARGS, [WINDOWS[0]])).not.toBe(measurementKey(checksum, ARGS, WINDOWS));
  });

  // Stretch boundaries come out of floating-point arithmetic, so they are taken at the millisecond
  // rather than at the last bit: the same seconds are the same seconds.
  it("reads a difference below a millisecond as the same stretch", () => {
    const nudged = WINDOWS.map((w) => ({ startSeconds: w.startSeconds + 1e-6, seconds: w.seconds }));
    expect(measurementKey(checksum, ARGS, nudged)).toBe(measurementKey(checksum, ARGS, WINDOWS));
  });
});

describe("remembering what a square measured", () => {
  it("hands a measurement back under the same key", () => {
    writeMeasurement("k", { bytes: 4096, segmentSeconds: 10.02, elapsedMs: 4200 });
    expect(readMeasurement("k")).toEqual({ bytes: 4096, segmentSeconds: 10.02, elapsedMs: 4200 });
  });

  it("has nothing for a square that was never run", () => {
    expect(readMeasurement("never")).toBe(null);
  });

  it("still has it after the page is loaded again", async () => {
    writeMeasurement("k", { bytes: 4096, segmentSeconds: null, elapsedMs: null });
    flushMatrixCache();
    const cache = await reloaded();
    expect(cache.readMeasurement("k")).toEqual({ bytes: 4096, segmentSeconds: null, elapsedMs: null });
  });

  it("forgets everything when asked to", async () => {
    writeMeasurement("k", { bytes: 4096, segmentSeconds: null, elapsedMs: null });
    clearMatrixCache();
    expect(readMeasurement("k")).toBe(null);
    const cache = await reloaded();
    expect(cache.readMeasurement("k")).toBe(null);
  });

  // localStorage is finite and this is the only thing here that grows, so the cap is what keeps a
  // year of sweeps from filling it — and least-recently-used, so what is dropped is what nobody has
  // come back to rather than what was simply measured first.
  it("keeps the store to its cap, dropping the squares nothing has looked at", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    for (let i = 0; i < 4100; i++) writeMeasurement(`k${i}`, { bytes: i + 1, segmentSeconds: null, elapsedMs: null });
    vi.setSystemTime(new Date("2026-01-02T00:00:00Z"));
    // Read, not written: a square only looked at is a square still wanted.
    readMeasurement("k0");
    flushMatrixCache();
    expect(readMeasurement("k0")?.bytes).toBe(1);
    expect(readMeasurement("k1")).toBe(null);
    expect(readMeasurement("k4099")?.bytes).toBe(4100);
  });
});

describe("remembering where a run sampled", () => {
  const checksum = "sabc";

  it("hands the stretches back for the same file and the same fields", () => {
    rememberWindows(checksum, 5, 2, WINDOWS);
    expect(recallWindows(checksum, 5, 2)).toEqual(WINDOWS);
  });

  it("has nothing for another file, or for fields that have moved", () => {
    rememberWindows(checksum, 5, 2, WINDOWS);
    expect(recallWindows("sother", 5, 2)).toBe(null);
    expect(recallWindows(checksum, 3, 2)).toBe(null);
    expect(recallWindows(checksum, 5, 3)).toBe(null);
  });

  it("still has them after the page is loaded again", async () => {
    rememberWindows(checksum, 5, 2, WINDOWS);
    flushMatrixCache();
    const cache = await reloaded();
    expect(cache.recallWindows(checksum, 5, 2)).toEqual(WINDOWS);
  });
});

describe("a store that cannot be trusted", () => {
  it("starts empty on rubbish rather than throwing", async () => {
    localStorage.setItem("encodingHelper.matrixCache.v1", "{not json");
    const cache = await reloaded();
    expect(cache.readMeasurement("k")).toBe(null);
  });

  it("leaves behind entries that are not what they claim to be", async () => {
    localStorage.setItem(
      "encodingHelper.matrixCache.v1",
      JSON.stringify({
        measurements: { good: { b: 10, s: 1, ms: 2, at: 1 }, sizeless: { s: 1, ms: 2, at: 1 } },
        windows: { good: { w: [[0, 5]], at: 1 }, ragged: { w: [[0]], at: 1 } },
      }),
    );
    const cache = await reloaded();
    expect(cache.readMeasurement("good")?.bytes).toBe(10);
    expect(cache.readMeasurement("sizeless")).toBe(null);
  });

  // A privacy mode that throws on localStorage, or one that is simply full: the sweep in progress
  // still gets its cache, it just does not outlive the tab.
  it("keeps working in memory when localStorage cannot be used at all", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    });
    const cache = await reloaded();
    cache.writeMeasurement("k", { bytes: 7, segmentSeconds: null, elapsedMs: null });
    expect(() => cache.flushMatrixCache()).not.toThrow();
    expect(cache.readMeasurement("k")?.bytes).toBe(7);
    vi.unstubAllGlobals();
  });
});
