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

import type { ChunkedSource } from "./chunkedSource";
import type { SampleWindow } from "./types";

/** What one finished square is worth remembering: everything its table cell is drawn from. */
export interface CachedMeasurement {
  bytes: number;
  /** The output's measured playback length, which the projection is taken over. */
  segmentSeconds: number | null;
  elapsedMs: number | null;
}

/** How many bytes the checksum reads at each of its probes. */
const PROBE_BYTES = 1 << 20;

/** Where the whole cache lives. The version is in the name so a change of shape is a fresh cache
 * rather than a parse of the old one. */
const STORE_KEY = "encodingHelper.matrixCache.v1";

/** How many measurements to keep across every file, oldest use dropped first.
 *
 * A full sweep of every axis is a few hundred squares, so this is several files' worth of complete
 * grids, at roughly a hundred bytes each. localStorage is a handful of megabytes in every browser
 * that has it, and this is the only thing here that grows. */
const MAX_MEASUREMENTS = 4000;

/** How many files' sampled stretches to remember. Small: it is one record per file per pair of
 * sample fields, and it is only useful for a file the reader comes back to. */
const MAX_WINDOW_SETS = 64;

/** How long writes are held back before the store is serialized, so a sweep filling in a square
 * every few seconds is not re-encoding the whole cache as JSON every few seconds. */
const SAVE_DELAY_MS = 500;

interface StoredMeasurement {
  b: number;
  s: number | null;
  ms: number | null;
  /** When it was last written or read, which is what pruning drops on. */
  at: number;
}

interface StoredWindows {
  /** `[startSeconds, seconds]` per stretch, which is half the JSON of the named form. */
  w: [number, number][];
  at: number;
}

interface Store {
  // Optional values because the keys are whatever a previous session left in localStorage, which is
  // not a promise about what is in there now.
  measurements: Record<string, StoredMeasurement | undefined>;
  windows: Record<string, StoredWindows | undefined>;
}

let store: Store | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function emptyStore(): Store {
  return { measurements: {}, windows: {} };
}

/** The store, read off localStorage the first time anything asks for it.
 *
 * Anything unreadable — a full or absent localStorage, a privacy mode that throws on it, JSON left
 * by an older shape — is an empty cache rather than an error: nothing here is data the reader
 * cannot make again by pressing Run Matrix. */
function loaded(): Store {
  if (store) return store;
  try {
    store = readStore(localStorage.getItem(STORE_KEY));
  } catch {
    // Same best-effort handling as the Educational toggle: an unusable localStorage costs the
    // reader a re-run, not the run they are in.
    store = emptyStore();
  }
  return store;
}

/**
 * The store as it was written out, with anything that is not what it claims to be left behind.
 *
 * Checked here, once, rather than trusted on every read: this is bytes off localStorage, which
 * another tab, another version of the app or a hand-edited devtools session may have been at. A
 * measurement missing its size would reach the grid as a square with no number in it.
 */
function readStore(raw: string | null): Store {
  const target = emptyStore();
  const parsed = raw ? (JSON.parse(raw) as { measurements?: unknown; windows?: unknown }) : null;
  if (!parsed) return target;
  for (const [key, value] of recordEntries(parsed.measurements)) {
    const held = value as Partial<StoredMeasurement>;
    if (typeof held.b !== "number") continue;
    target.measurements[key] = { b: held.b, s: asNumber(held.s), ms: asNumber(held.ms), at: asNumber(held.at) ?? 0 };
  }
  for (const [key, value] of recordEntries(parsed.windows)) {
    const held = value as { w?: unknown; at?: unknown };
    const stretches = Array.isArray(held.w) ? (held.w as unknown[]) : [];
    const pairs = stretches.filter(
      (pair): pair is [number, number] => Array.isArray(pair) && pair.length === 2 && pair.every(Number.isFinite),
    );
    if (!pairs.length || pairs.length !== stretches.length) continue;
    target.windows[key] = { w: pairs, at: asNumber(held.at) ?? 0 };
  }
  return target;
}

function recordEntries(value: unknown): [string, unknown][] {
  return value && typeof value === "object" ? Object.entries(value) : [];
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function scheduleSave(): void {
  if (saveTimer != null) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    save();
  }, SAVE_DELAY_MS);
}

/** Writes the store out now rather than at the end of the debounce, for the end of a run — and for
 * tests, which have no interest in waiting half a second to see what a sweep remembered. */
export function flushMatrixCache(): void {
  if (saveTimer != null) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  save();
}

function save(): void {
  if (!store) return;
  prune(store, MAX_MEASUREMENTS);
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    // Out of room (or refused outright). Dropping to a quarter of the cap and trying once more is
    // what makes the cache survive a browser whose storage is mostly spoken for; if that fails too
    // the store stays in memory, where it is still worth having for the rest of the session.
    prune(store, Math.floor(MAX_MEASUREMENTS / 4));
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(store));
    } catch {
      // Nothing further to try.
    }
  }
}

/** Drops the least recently used entries until the store is back inside its caps. */
function prune(target: Store, cap: number): void {
  dropOldest(target.measurements, cap);
  dropOldest(target.windows, MAX_WINDOW_SETS);
}

function dropOldest(entries: Record<string, { at: number } | undefined>, cap: number): void {
  const keys = Object.keys(entries);
  if (keys.length <= cap) return;
  keys
    .sort((a, b) => (entries[a]?.at ?? 0) - (entries[b]?.at ?? 0))
    .slice(0, keys.length - cap)
    .forEach((key) => delete entries[key]);
}

/** Forgets everything, for a reader who wants a sweep measured again from scratch. */
export function clearMatrixCache(): void {
  store = emptyStore();
  flushMatrixCache();
}

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
  return "f" + fnv1a(bytes, 0x811c9dc5) + fnv1a(bytes, 0x01000193);
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

/** The same, over text. */
function hashText(text: string, seed: number): string {
  return fnv1a(new TextEncoder().encode(text), seed);
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
  return `${checksum}:${hashText(text, 0x811c9dc5)}${hashText(text, 0x01000193)}`;
}

/** A square's measurement from an earlier run, or null if it was never made (or has been pruned). */
export function readMeasurement(key: string): CachedMeasurement | null {
  const entry = loaded().measurements[key];
  if (!entry) return null;
  // Touched on the way out, so pruning drops what nobody is coming back to rather than what was
  // simply measured longest ago.
  entry.at = Date.now();
  scheduleSave();
  return { bytes: entry.b, segmentSeconds: entry.s ?? null, elapsedMs: entry.ms ?? null };
}

export function writeMeasurement(key: string, measurement: CachedMeasurement): void {
  loaded().measurements[key] = {
    b: measurement.bytes,
    s: measurement.segmentSeconds,
    ms: measurement.elapsedMs,
    at: Date.now(),
  };
  scheduleSave();
}

/** What a file's sampled stretches are remembered under: the two fields that decide them. */
function windowsKey(checksum: string, seconds: number, count: number): string {
  return `${checksum}:${seconds.toFixed(3)}x${count}`;
}

/**
 * Remembers where a run took its stretches from.
 *
 * The stretches are part of every measurement's key, and they are drawn at random (see
 * pickSampleWindows), so without this a reloaded page would sample somewhere else and hit nothing
 * it had ever measured. Keeping them is what makes the measurements outlive the tab they were made
 * in — and it is the same rule the sweep already follows within a session, where two squares are
 * only comparable if they cover the same seconds.
 */
export function rememberWindows(checksum: string, seconds: number, count: number, windows: SampleWindow[]): void {
  if (!windows.length) return;
  loaded().windows[windowsKey(checksum, seconds, count)] = {
    w: windows.map((w) => [w.startSeconds, w.seconds]),
    at: Date.now(),
  };
  scheduleSave();
}

/** The stretches an earlier run of this file at these fields used, or null if there was none. */
export function recallWindows(checksum: string, seconds: number, count: number): SampleWindow[] | null {
  const entry = loaded().windows[windowsKey(checksum, seconds, count)];
  if (!entry) return null;
  entry.at = Date.now();
  scheduleSave();
  return entry.w.map(([startSeconds, length]) => ({ startSeconds, seconds: length }));
}
