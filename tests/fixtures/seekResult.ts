// One sampled timestamp of a seeking test run, for the report and the scatter to be fed by hand.

import type { SeekResult } from "../../src/lib/types";

/** A timestamp 0.5 s (15 frames) past its keyframe, decoded in 12.34 ms, with `over` on top. */
export function seekResult(over: Partial<SeekResult> = {}): SeekResult {
  return { t: 1.5, kf: 1, dist: 0.5, distFrames: 15, decodeMs: 12.34, ...over };
}
