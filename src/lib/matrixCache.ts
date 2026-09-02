// Remembering what a sweep measured, so the same combination over the same seconds of the same file
// is never encoded twice.
//
// A sweep is minutes of in-browser encoding for a table of numbers, and those numbers are a function
// of three things alone: the video, the encoder settings, and the stretches that were measured. None
// of the three changes because a checkbox moved or the page was reloaded, so a square that has been
// run once never has to be run again — ticking one more preset onto a finished grid encodes that
// column and reads the rest back, and coming back to the same file tomorrow fills the grid in as
// fast as it can be drawn.
//
// What is kept is the measurement (the bytes, the seconds they cover, how long the encode took) and
// not the encoded video. The outputs run to tens of megabytes a square and are already dropped from
// memory inside a single run to stay inside its budget (see evictBeyondBudget), so a square read
// back from here behaves exactly like one whose output was evicted: its numbers are in the table,
// and putting it in the A/B window encodes that one combination again.
//
// The file is identified by a checksum of its contents rather than by its name, because a name is
// not an identity: two files called `video.mp4` are not the same video, and the same video fetched
// twice is.
//
// IndexedDB rather than localStorage, on the same reasoning as bbqs-uploader's checksum cache: a
// few megabytes is the whole of what localStorage offers, and it is spent synchronously on the main
// thread. Here that ceiling is what would bind — a measurement is small, but the reader who benefits
// most from this is the one sweeping many files over many sittings, and evicting their earliest work
// to stay under five megabytes throws away exactly the runs the cache exists to keep.

import type { ChunkedSource } from "./chunkedSource";
import type { SampleWindow } from "./types";

/** What one finished square is worth remembering: everything its table cell is drawn from. */
interface CachedMeasurement {
  bytes: number;
  /** The output's measured playback length, which the projection is taken over. */
  segmentSeconds: number | null;
  elapsedMs: number | null;
}

const DB_NAME = "encoding-helper.matrix-cache";
const DB_VERSION = 1;
const MEASUREMENTS = "measurements";
const WINDOWS = "windows";
const LAST_USED_INDEX = "lastUsed";

/**
 * How much of the browser's storage the measurements may take up.
 *
 * Hygiene rather than a limit anyone will meet: a measurement is a fifty-character key and four
 * numbers, so this is millions of squares — more than a lifetime of sweeping — and the reader who
 * comes back to a file a year later still finds it. IndexedDB is granted a share of free disk
 * rather than a fixed few megabytes, so the figure costs nothing until it is used.
 */
export const MATRIX_CACHE_MAX_BYTES = 500 * 2 ** 20;

/**
 * What one stored measurement is taken to cost, for turning the budget above into a number of
 * records to keep.
 *
 * A count rather than a running total of real sizes, because these records are all the same shape —
 * unlike the variable-length digests bbqs-uploader's cache weighs — and a count is one indexed
 * lookup where a total is either a scan of every record on open or a second number to keep true.
 */
const MEASUREMENT_BYTES = 200;

/** How many stored measurements a byte budget comes to. */
export function measurementCap(maxBytes: number): number {
  return Math.max(1, Math.floor(maxBytes / MEASUREMENT_BYTES));
}

/**
 * How many files' sampled stretches to remember.
 *
 * One record per file per pair of sample fields, so this is thousands of files: they are negligible
 * against the budget above, and a file whose stretches are forgotten loses every measurement made
 * over them, which is the expensive half of the pair.
 */
const MAX_WINDOW_SETS = 4096;

/** How many writes between checks that the store is still inside its budget. Eviction is not
 * expected to fire at all, so this is a periodic sweep rather than a per-write price. */
const EVICT_EVERY_WRITES = 500;

interface StoredMeasurement {
  key: string;
  b: number;
  s: number | null;
  ms: number | null;
  /** When it was last written or read, which is what eviction drops on. */
  lastUsed: number;
}

interface StoredWindows {
  key: string;
  /** `[startSeconds, seconds]` per stretch. */
  w: [number, number][];
  lastUsed: number;
}

export interface MatrixCacheOptions {
  dbName?: string;
  maxBytes?: number;
  /** Clock override for tests. */
  now?: () => number;
}

export interface MatrixCache {
  /** Every one of `keys` that has been measured before, touched so eviction leaves them alone. */
  readMeasurements(keys: string[]): Promise<Map<string, CachedMeasurement>>;
  /** Records what a square measured. Fire-and-forget: `flush` waits for the writes to land. */
  writeMeasurement(key: string, measurement: CachedMeasurement): void;
  /** The stretches an earlier run of this file at these fields used, or null if there was none. */
  recallWindows(checksum: string, seconds: number, count: number): Promise<SampleWindow[] | null>;
  /** Records where a run took its stretches from. Fire-and-forget, as above. */
  rememberWindows(checksum: string, seconds: number, count: number, windows: SampleWindow[]): void;
  /** Settles every write issued so far. */
  flush(): Promise<void>;
  /** Forgets everything, for a reader who wants their sweeps measured again from scratch. */
  clear(): Promise<void>;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
  });
}

/** Drops the least recently used records of one store until it is back inside `keep`. */
async function evictStore(db: IDBDatabase, name: string, keep: number): Promise<void> {
  const counted = await requestToPromise(db.transaction(name, "readonly").objectStore(name).count());
  if (counted <= keep) return;
  let over = counted - keep;
  const tx = db.transaction(name, "readwrite");
  const cursorRequest = tx.objectStore(name).index(LAST_USED_INDEX).openCursor();
  cursorRequest.onsuccess = () => {
    const cursor = cursorRequest.result;
    if (!cursor || over <= 0) return;
    cursor.delete();
    over--;
    cursor.continue();
  };
  await transactionDone(tx);
}

/**
 * Opens the cache.
 *
 * Never throws: a browser with no working IndexedDB (a private window that refuses it, storage
 * turned off) degrades to every read missing and every write going nowhere, which costs the encoding
 * a sweep would have cost anyway.
 */
export function openMatrixCache(options: MatrixCacheOptions = {}): MatrixCache {
  const dbName = options.dbName ?? DB_NAME;
  const cap = measurementCap(options.maxBytes ?? MATRIX_CACHE_MAX_BYTES);
  const now = options.now ?? Date.now;

  let dbPromise: Promise<IDBDatabase> | null = null;
  // Writes are chained rather than issued in parallel, so two squares finishing together cannot
  // interleave into one transaction, and `flush` is the end of the chain.
  let writes: Promise<void> = Promise.resolve();
  // Starts due, so the first write of a session pays for a pass over a store an earlier session may
  // have left over the budget — and the periodic checks after it are the rest of that session's.
  let writesSinceEvict = EVICT_EVERY_WRITES;

  function openDb(): Promise<IDBDatabase> {
    dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        reject(new Error("IndexedDB is not available."));
        return;
      }
      const request = indexedDB.open(dbName, DB_VERSION);
      request.onupgradeneeded = () => {
        for (const name of [MEASUREMENTS, WINDOWS]) {
          const store = request.result.createObjectStore(name, { keyPath: "key" });
          store.createIndex(LAST_USED_INDEX, "lastUsed");
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
    }).catch((err) => {
      // Left unset so a browser that refuses once is asked again rather than written off, and so a
      // failed open cannot be handed out as a resolved database.
      dbPromise = null;
      throw err;
    });
    return dbPromise;
  }

  /** Chains `fn` behind every earlier write; a storage error is a write that did not happen. */
  function enqueue(fn: (db: IDBDatabase) => Promise<void>): Promise<void> {
    writes = writes.then(async () => {
      try {
        await fn(await openDb());
      } catch {
        /* degrade to a dropped write */
      }
    });
    return writes;
  }

  async function evictIfDue(db: IDBDatabase): Promise<void> {
    if (++writesSinceEvict < EVICT_EVERY_WRITES) return;
    writesSinceEvict = 0;
    await evictStore(db, MEASUREMENTS, cap);
    await evictStore(db, WINDOWS, MAX_WINDOW_SETS);
  }

  /** Puts records back with a fresh `lastUsed`, so eviction drops what nobody has come back to
   * rather than what was simply measured longest ago. Issued in one transaction, in one tick. */
  function touch(db: IDBDatabase, name: string, records: { lastUsed: number }[]): Promise<void> {
    if (!records.length) return Promise.resolve();
    const tx = db.transaction(name, "readwrite");
    const store = tx.objectStore(name);
    const stamp = now();
    for (const record of records) {
      record.lastUsed = stamp;
      store.put(record);
    }
    return transactionDone(tx);
  }

  return {
    async readMeasurements(keys) {
      const found = new Map<string, CachedMeasurement>();
      if (!keys.length) return found;
      try {
        const db = await openDb();
        const store = db.transaction(MEASUREMENTS, "readonly").objectStore(MEASUREMENTS);
        // Every get is issued in this tick, so they run as one transaction rather than as one
        // round trip per square.
        const records = await Promise.all(
          keys.map((key) => requestToPromise(store.get(key) as IDBRequest<StoredMeasurement | undefined>)),
        );
        const hits: StoredMeasurement[] = [];
        for (const record of records) {
          // Checked rather than trusted: this is a database another version of the app, or a hand
          // edited devtools session, may have been at. A square with no size in it would reach the
          // grid as a cell with nothing to say.
          if (!record || typeof record.b !== "number") continue;
          found.set(record.key, { bytes: record.b, segmentSeconds: record.s ?? null, elapsedMs: record.ms ?? null });
          hits.push(record);
        }
        await touch(db, MEASUREMENTS, hits);
      } catch {
        /* no cache: every square is encoded, as it was before there was one */
      }
      return found;
    },

    writeMeasurement(key, measurement) {
      void enqueue(async (db) => {
        const record: StoredMeasurement = {
          key,
          b: measurement.bytes,
          s: measurement.segmentSeconds,
          ms: measurement.elapsedMs,
          lastUsed: now(),
        };
        await requestToPromise(db.transaction(MEASUREMENTS, "readwrite").objectStore(MEASUREMENTS).put(record));
        await evictIfDue(db);
      });
    },

    async recallWindows(checksum, seconds, count) {
      try {
        const db = await openDb();
        const key = windowsKey(checksum, seconds, count);
        const record = await requestToPromise(
          db.transaction(WINDOWS, "readonly").objectStore(WINDOWS).get(key) as IDBRequest<StoredWindows | undefined>,
        );
        // Checked rather than trusted, for the same reason a measurement is: this came off a
        // database, not out of the run that wrote it.
        if (!record || !Array.isArray(record.w)) return null;
        const stretches = (record.w as unknown[]).filter(
          (pair): pair is [number, number] => Array.isArray(pair) && pair.length === 2 && pair.every(Number.isFinite),
        );
        if (!stretches.length || stretches.length !== record.w.length) return null;
        await touch(db, WINDOWS, [record]);
        return stretches.map(([startSeconds, length]) => ({ startSeconds, seconds: length }));
      } catch {
        return null;
      }
    },

    rememberWindows(checksum, seconds, count, windows) {
      if (!windows.length) return;
      void enqueue(async (db) => {
        const record: StoredWindows = {
          key: windowsKey(checksum, seconds, count),
          w: windows.map((w) => [w.startSeconds, w.seconds]),
          lastUsed: now(),
        };
        await requestToPromise(db.transaction(WINDOWS, "readwrite").objectStore(WINDOWS).put(record));
      });
    },

    flush() {
      return writes;
    },

    async clear() {
      await enqueue(async (db) => {
        const tx = db.transaction([MEASUREMENTS, WINDOWS], "readwrite");
        tx.objectStore(MEASUREMENTS).clear();
        tx.objectStore(WINDOWS).clear();
        await transactionDone(tx);
      });
    },
  };
}

/** The app's own cache. Opens on first use, so a page that never sweeps never touches storage. */
export const matrixCache = openMatrixCache();

/** What a file's sampled stretches are remembered under: the two fields that decide them. */
function windowsKey(checksum: string, seconds: number, count: number): string {
  return `${checksum}:${seconds.toFixed(3)}x${count}`;
}

/** How many bytes the checksum reads at each of its probes. */
const PROBE_BYTES = 1 << 20;

const checksums = new WeakMap<ChunkedSource, Promise<string>>();

/**
 * A content checksum for the loaded file: its exact byte count, plus a megabyte read from its
 * beginning, its middle and its end.
 *
 * Sampled rather than complete because a complete one cannot be had cheaply in a browser:
 * SubtleCrypto has no streaming digest, so hashing every byte means holding the entire video in
 * memory at once — gigabytes, for a file the page otherwise reads a few seconds of, and over range
 * requests for a file it never downloads at all. Three megabytes and the size tell two videos apart
 * in the only way that matters here, since the ways two files agree on all four (same length, same
 * head, same middle, same tail) are the ways they are the same file. The cost of being wrong is one
 * grid of numbers measured on other video, which pressing Run Matrix again with the reuse of
 * measurements switched off replaces.
 *
 * Computed once per loaded source: it is the same answer every time, and a sweep asks for it once a
 * square.
 */
export function videoChecksum(source: ChunkedSource): Promise<string> {
  const held = checksums.get(source);
  if (held) return held;
  const computing = computeChecksum(source).catch((err) => {
    // A read that failed says nothing about the next one, so the file is left unidentified rather
    // than remembered as unidentifiable.
    checksums.delete(source);
    throw err;
  });
  checksums.set(source, computing);
  return computing;
}

async function computeChecksum(source: ChunkedSource): Promise<string> {
  const parts: Uint8Array[] = [new TextEncoder().encode(`${source.size}:`)];
  for (const offset of probeOffsets(source.size)) {
    parts.push(new Uint8Array(await source.readChunk(offset, PROBE_BYTES)));
  }
  return await digestHex(concat(parts));
}

/** Where the probes are taken from. They overlap on a file smaller than three of them, which reads
 * the whole thing and is the point: a small file is checksummed in full. */
function probeOffsets(size: number): number[] {
  const offsets = [0, Math.max(0, Math.floor(size / 2 - PROBE_BYTES / 2)), Math.max(0, size - PROBE_BYTES)];
  return [...new Set(offsets)];
}

function concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const all = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    all.set(part, at);
    at += part.length;
  }
  return all;
}

/** SHA-256 where the browser offers it, and a pair of FNV-1a passes where it does not — which is an
 * insecure origin, where `crypto.subtle` is simply absent. Both are prefixed, so a cache written
 * under one is never read under the other. */
async function digestHex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  // Typed as always there, absent in fact on an insecure origin, where SubtleCrypto is not exposed.
  const subtle = (globalThis.crypto as Crypto | undefined)?.subtle;
  if (subtle) {
    const digest = await subtle.digest("SHA-256", bytes);
    return "s" + hex(new Uint8Array(digest)).slice(0, 32);
  }
  return "f" + fnv1a64(bytes);
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** FNV-1a over bytes, as eight hex digits. Seeded, so two passes make a 64-bit value out of a
 * 32-bit hash. */
function fnv1a(bytes: Uint8Array, seed: number): string {
  let hash = seed >>> 0;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** Two seeded FNV-1a passes concatenated: a 64-bit value out of a 32-bit hash. */
function fnv1a64(bytes: Uint8Array): string {
  return fnv1a(bytes, 0x811c9dc5) + fnv1a(bytes, 0x01000193);
}

/**
 * What a square is remembered under: the file it was measured on, the command it was measured with,
 * and the stretches it was measured over.
 *
 * The command rather than the four swept axes, because the sweep is not the only thing that decides
 * what ffmpeg is asked for: the keyframe interval, B-frames, audio and the rest come from the
 * Reencode with FFmpeg tab, and a grid measured before one of them moved is a grid of the wrong
 * numbers afterwards. Passing the built args in means every one of them is in the key, and any
 * later addition to the command builder is too, without this having to be told about it.
 */
export function measurementKey(checksum: string, args: string[], windows: SampleWindow[]): string {
  const stretches = windows.map((w) => `${w.startSeconds.toFixed(3)}+${w.seconds.toFixed(3)}`).join(",");
  const text = `${args.join(" ")}|${stretches}`;
  return `${checksum}:${fnv1a64(new TextEncoder().encode(text))}`;
}
