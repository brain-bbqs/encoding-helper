// The seeking test's figures as both the Inspect tab and the Full Analysis document print them, so
// the page and the document cannot drift apart on a column header or a decimal.

import { FALLBACK_FPS, fmtMs, NO_VALUE } from "./format";
import { state } from "./state";
import type { SeekResult } from "./types";

/** Column headers of the sampled-timestamps table. */
export const SEEK_TABLE_HEADERS = ["Timestamp", "Nearest Keyframe ≤ t", "Distance", "Distance (frames)", "Decode Time"];

/** One sampled timestamp as the table shows it, in header order. */
export function seekResultRow(r: SeekResult): string[] {
  return [
    r.t.toFixed(3) + "s",
    r.kf != null ? r.kf.toFixed(3) + "s" : NO_VALUE,
    r.dist != null ? r.dist.toFixed(3) + "s" : NO_VALUE,
    r.distFrames != null ? String(r.distFrames) : NO_VALUE,
    fmtMs(r.decodeMs),
  ];
}

/** The three figures a run is summarised by, none of them for a run with nothing in it. */
export function seekSummary(results: SeekResult[]): {
  avgDist: number | null;
  avgDecode: number | null;
  maxDecode: number | null;
} {
  if (!results.length) return { avgDist: null, avgDecode: null, maxDecode: null };
  return {
    avgDist: results.reduce((a, r) => a + (r.dist ?? 0), 0) / results.length,
    avgDecode: results.reduce((a, r) => a + r.decodeMs, 0) / results.length,
    // A spread is safe here: the field holds a run to two hundred timestamps.
    maxDecode: Math.max(...results.map((r) => r.decodeMs)),
  };
}

/** The loaded file's GOP lengths with their mean, and the frame rate that mean is read in seconds by. */
export function gopStats(): { gop: number[]; avgGop: number; fps: number } {
  const gop = state.gopLengths;
  const avgGop = gop.length ? gop.reduce((a, b) => a + b, 0) / gop.length : 0;
  return { gop, avgGop, fps: state.fps || FALLBACK_FPS };
}

/**
 * The shortest and longest of a file's GOP lengths, or null for a file with none. A loop rather
 * than a spread into Math.min and Math.max: the list has an entry per keyframe, and a spread makes
 * each an argument, which an all-intra recording of an hour or so takes past the engine's limit.
 */
export function gopRange(gop: readonly number[]): { min: number; max: number } | null {
  if (!gop.length) return null;
  let min = gop[0];
  let max = gop[0];
  for (const len of gop) {
    if (len < min) min = len;
    if (len > max) max = len;
  }
  return { min, max };
}

/** The mean GOP as frames and seconds, e.g. "30.0 frames (1.00 s)". */
export function describeAvgGop(avgGop: number, fps: number): string {
  return `${avgGop.toFixed(1)} frames (${(avgGop / fps).toFixed(2)} s)`;
}
