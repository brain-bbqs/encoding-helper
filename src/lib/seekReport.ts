// The seeking test's figures as both the Inspect tab and the Full Analysis document print them, so
// the page and the document cannot drift apart on a column header or a decimal.

import { fmtMs } from "./format";
import { state } from "./state";
import type { SeekResult } from "./types";

/** Column headers of the sampled-timestamps table. */
export const SEEK_TABLE_HEADERS = ["Timestamp", "Nearest Keyframe ≤ t", "Distance", "Distance (frames)", "Decode Time"];

/** One sampled timestamp as the table shows it, in header order. */
export function seekResultRow(r: SeekResult): string[] {
  return [
    r.t.toFixed(3) + "s",
    r.kf != null ? r.kf.toFixed(3) + "s" : "–",
    r.dist != null ? r.dist.toFixed(3) + "s" : "–",
    r.distFrames != null ? String(r.distFrames) : "–",
    fmtMs(r.decodeMs),
  ];
}

/** The three figures a run is summarised by. */
export function seekSummary(results: SeekResult[]): { avgDist: number; avgDecode: number; maxDecode: number } {
  return {
    avgDist: results.reduce((a, r) => a + (r.dist ?? 0), 0) / results.length,
    avgDecode: results.reduce((a, r) => a + r.decodeMs, 0) / results.length,
    maxDecode: Math.max(...results.map((r) => r.decodeMs)),
  };
}

/** The loaded file's GOP lengths with their mean, and the frame rate that mean is read in seconds by. */
export function gopStats(): { gop: number[]; avgGop: number; fps: number } {
  const gop = state.gopLengths;
  const avgGop = gop.length ? gop.reduce((a, b) => a + b, 0) / gop.length : 0;
  return { gop, avgGop, fps: state.fps || 30 };
}

/** The mean GOP as frames and seconds, e.g. "30.0 frames (1.00 s)". */
export function describeAvgGop(avgGop: number, fps: number): string {
  return `${avgGop.toFixed(1)} frames (${(avgGop / fps).toFixed(2)} s)`;
}
