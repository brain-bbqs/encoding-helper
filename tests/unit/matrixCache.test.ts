import { IDBDatabase, IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChunkedSource } from "../../src/lib/chunkedSource";
import {
  MATRIX_CACHE_MAX_BYTES,
  measurementCap,
  measurementKey,
  openMatrixCache,
  videoChecksum,
  type MatrixCache,
  type MatrixCacheOptions,
} from "../../src/lib/matrixCache";
import type { SampleWindow } from "../../src/lib/types";

const MIB = 1024 * 1024;
const DB_NAME = "test-matrix-cache";

/** A loaded file of exactly these bytes. jsdom's Blob cannot be read as an ArrayBuffer, so the one
 * read the checksum makes is answered here rather than through a File. */
function sourceOf(bytes: Uint8Array): ChunkedSource {
  const source = new ChunkedSource();
  source.size = bytes.length;
  source.readChunk = (offset, size) =>
    Promise.resolve(bytes.slice(offset, Math.min(offset + size, bytes.length)).buffer as ArrayBuffer);
  return source;
}

/** A file too big to hold in a test, recording where it was read from. */
function hugeSource(size: number, reads: number[]): ChunkedSource {
  const source = new ChunkedSource();
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

/** A cache on the test database. A second one over the same name is the same store as a reloaded
 * page sees it. */
function open(options: MatrixCacheOptions = {}): MatrixCache {
  return openMatrixCache({ dbName: DB_NAME, ...options });
}

/** A clock that moves one tick per reading, so "least recently used" is exactly the write order. */
function ticker(): () => number {
  let at = 0;
  return () => ++at;
}

function measurement(bytes: number) {
  return { bytes, segmentSeconds: 10.02, elapsedMs: 4200 };
}

async function readOne(cache: MatrixCache, key: string) {
  return (await cache.readMeasurements([key])).get(key) ?? null;
}

/** The keys in the store, read straight out of IndexedDB so the reading does not touch them. */
function storedKeys(store: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const keys = db.transaction(store).objectStore(store).getAllKeys();
      keys.onerror = () => reject(keys.error);
      keys.onsuccess = () => {
        db.close();
        resolve(keys.result as string[]);
      };
    };
  });
}

const WINDOWS: SampleWindow[] = [
  { startSeconds: 0, seconds: 5 },
  { startSeconds: 12.5, seconds: 5 },
];

const ARGS = ["-y", "-i", "in.mp4", "-crf", "25", "-preset", "veryfast", "out.mp4"];

beforeEach(() => {
  // A fresh factory per test isolates each test's database contents.
  globalThis.indexedDB = new IDBFactory();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Makes every transaction of `mode` fail before its requests run, the way a full disk or an
 * evicted origin does: each pending request errors and the transaction aborts. */
function abortTransactions(mode: IDBTransactionMode): void {
  const real = IDBDatabase.prototype.transaction;
  vi.spyOn(IDBDatabase.prototype, "transaction").mockImplementation(function (
    this: IDBDatabase,
    names,
    txMode,
    options,
  ) {
    const tx = real.call(this, names, txMode, options);
    if ((txMode ?? "readonly") === mode) queueMicrotask(() => tx.abort());
    return tx;
  });
}

/** Puts a raw record into one of the test database's stores, as a hand-edited devtools session
 * or an earlier version of the app might have. */
function seed(store: string, record: object): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      for (const name of ["measurements", "windows"]) {
        request.result.createObjectStore(name, { keyPath: "key" }).createIndex("lastUsed", "lastUsed");
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).put(record);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
  });
}

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

  // A read that failed says nothing about the next one, so the file is asked about again rather
  // than remembered as unidentifiable.
  it("asks again after a read of the file failed", async () => {
    const source = sourceOf(bytesOf(1, 2, 3));
    const working = source.readChunk;
    source.readChunk = () => Promise.reject(new Error("read failed"));
    await expect(videoChecksum(source)).rejects.toThrow("read failed");
    source.readChunk = working;
    expect(await videoChecksum(source)).toBe(await videoChecksum(sourceOf(bytesOf(1, 2, 3))));
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

describe("measurementCap", () => {
  // The budget is bytes because that is what storage is spent in; what the store enforces is a
  // count, so the two have to line up.
  it("turns the byte budget into millions of squares", () => {
    expect(measurementCap(MATRIX_CACHE_MAX_BYTES)).toBeGreaterThan(2_000_000);
    expect(measurementCap(0)).toBe(1);
  });
});

describe("remembering what a square measured", () => {
  it("hands back every key it has, and says nothing about the rest", async () => {
    const cache = open();
    cache.writeMeasurement("a", measurement(4096));
    cache.writeMeasurement("b", measurement(8192));
    await cache.flush();
    const held = await cache.readMeasurements(["a", "b", "never-run"]);
    expect(held.get("a")).toEqual({ bytes: 4096, segmentSeconds: 10.02, elapsedMs: 4200 });
    expect(held.get("b")?.bytes).toBe(8192);
    expect(held.has("never-run")).toBe(false);
  });

  it("asks for nothing when there is nothing to ask about", async () => {
    expect((await open().readMeasurements([])).size).toBe(0);
  });

  it("still has it after the page is loaded again", async () => {
    const before = open();
    before.writeMeasurement("k", { bytes: 4096, segmentSeconds: null, elapsedMs: null });
    await before.flush();
    expect(await readOne(open(), "k")).toEqual({ bytes: 4096, segmentSeconds: null, elapsedMs: null });
  });

  it("forgets everything when asked to", async () => {
    const cache = open();
    cache.writeMeasurement("k", measurement(4096));
    await cache.flush();
    await cache.clear();
    expect(await readOne(cache, "k")).toBe(null);
    expect(await readOne(open(), "k")).toBe(null);
  });

  // Storage is finite and this is the only thing here that grows, so the budget is what keeps a
  // decade of sweeps from filling it — least-recently-*used*, so what goes is what nobody has come
  // back to rather than what was simply measured first.
  it("keeps the store inside its budget, dropping the squares nothing has looked at", async () => {
    // Three squares' worth, taken from the module's own per-record estimate rather than restated.
    const perRecord = MATRIX_CACHE_MAX_BYTES / measurementCap(MATRIX_CACHE_MAX_BYTES);
    const options = { maxBytes: perRecord * 3, now: ticker() };
    const filling = open(options);
    for (const key of ["k1", "k2", "k3", "k4", "k5"]) filling.writeMeasurement(key, measurement(1));
    await filling.flush();
    // Read, not written: a square only looked at is a square still wanted.
    expect(await readOne(filling, "k1")).not.toBe(null);

    const next = open(options);
    next.writeMeasurement("k6", measurement(1));
    await next.flush();
    expect((await storedKeys("measurements")).sort()).toEqual(["k1", "k5", "k6"]);
  });
});

describe("remembering where a run sampled", () => {
  const checksum = "sabc";

  it("hands the stretches back for the same file and the same fields", async () => {
    const cache = open();
    cache.rememberWindows(checksum, 5, 2, WINDOWS);
    await cache.flush();
    expect(await cache.recallWindows(checksum, 5, 2)).toEqual(WINDOWS);
  });

  it("has nothing for another file, or for fields that have moved", async () => {
    const cache = open();
    cache.rememberWindows(checksum, 5, 2, WINDOWS);
    await cache.flush();
    expect(await cache.recallWindows("sother", 5, 2)).toBe(null);
    expect(await cache.recallWindows(checksum, 3, 2)).toBe(null);
    expect(await cache.recallWindows(checksum, 5, 3)).toBe(null);
  });

  it("still has them after the page is loaded again", async () => {
    const before = open();
    before.rememberWindows(checksum, 5, 2, WINDOWS);
    await before.flush();
    expect(await open().recallWindows(checksum, 5, 2)).toEqual(WINDOWS);
  });

  // A run with no stretches has nothing worth a record: remembering it would hand a later run an
  // empty set to reuse instead of drawing its own.
  it("records nothing for a run that sampled nowhere", async () => {
    const cache = open();
    cache.rememberWindows(checksum, 5, 0, []);
    await cache.flush();
    expect(await cache.recallWindows(checksum, 5, 0)).toBe(null);
    expect(await storedKeys("windows")).toEqual([]);
  });
});

describe("a store that cannot be trusted", () => {
  it("leaves behind a record that is not what it claims to be", async () => {
    const cache = open();
    cache.writeMeasurement("good", measurement(10));
    await cache.flush();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("measurements", "readwrite");
        tx.objectStore("measurements").put({ key: "sizeless", s: 1, ms: 2, lastUsed: 1 });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
    const held = await cache.readMeasurements(["good", "sizeless"]);
    expect(held.get("good")?.bytes).toBe(10);
    expect(held.has("sizeless")).toBe(false);
  });

  // A stretch list with a broken entry is a list that cannot be reused whole, and a partial reuse
  // would measure different seconds from the run it came from.
  it("has no stretches to offer from a record with a malformed one, or none at all", async () => {
    await seed("windows", { key: "sabc:5.000x2", w: [[0, 5], [12.5]], lastUsed: 1 });
    await seed("windows", { key: "sabc:5.000x0", w: [], lastUsed: 1 });
    await seed("windows", { key: "sabc:5.000x1", w: "0+5", lastUsed: 1 });
    const cache = open();
    expect(await cache.recallWindows("sabc", 5, 2)).toBe(null);
    expect(await cache.recallWindows("sabc", 5, 0)).toBe(null);
    expect(await cache.recallWindows("sabc", 5, 1)).toBe(null);
  });

  // A database left at a later version by a newer build of the app cannot be opened at this one:
  // the open fails, and the sweep runs as if there were no cache.
  it("degrades to no cache when the database cannot be opened", async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 2);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
    });
    const cache = open();
    cache.writeMeasurement("k", measurement(4096));
    await expect(cache.flush()).resolves.toBeUndefined();
    expect(await readOne(cache, "k")).toBe(null);
    expect(await cache.recallWindows("sabc", 5, 2)).toBe(null);
  });

  // A write that fails partway is a write that did not happen, and the writes behind it still go.
  it("drops a write whose transaction fails and carries on with the next", async () => {
    const cache = open();
    abortTransactions("readwrite");
    cache.writeMeasurement("lost", measurement(1));
    await expect(cache.flush()).resolves.toBeUndefined();
    vi.restoreAllMocks();
    cache.writeMeasurement("kept", measurement(2));
    await cache.flush();
    expect(await storedKeys("measurements")).toEqual(["kept"]);
  });

  // Touching a record is bookkeeping for eviction, not the read itself: a measurement found is a
  // measurement handed back whether or not its timestamp could be refreshed.
  it("still hands back what it read when refreshing the records fails", async () => {
    const cache = open();
    cache.writeMeasurement("k", measurement(4096));
    cache.rememberWindows("sabc", 5, 2, WINDOWS);
    await cache.flush();
    abortTransactions("readwrite");
    expect(await readOne(cache, "k")).toEqual(measurement(4096));
    // The stretches are handed back only once they are touched, so a failed touch loses them.
    expect(await cache.recallWindows("sabc", 5, 2)).toBe(null);
  });

  // A private window that refuses IndexedDB, or storage turned off: the sweep runs, it just has
  // nothing to read back and nothing to write to.
  it("misses every read and drops every write where there is no IndexedDB", async () => {
    const withoutIdb = globalThis as { indexedDB?: IDBFactory };
    const real = withoutIdb.indexedDB;
    delete withoutIdb.indexedDB;
    try {
      const cache = open();
      cache.writeMeasurement("k", measurement(4096));
      cache.rememberWindows("sabc", 5, 2, WINDOWS);
      await expect(cache.flush()).resolves.toBeUndefined();
      expect(await readOne(cache, "k")).toBe(null);
      expect(await cache.recallWindows("sabc", 5, 2)).toBe(null);
      await expect(cache.clear()).resolves.toBeUndefined();
    } finally {
      withoutIdb.indexedDB = real;
    }
  });
});
