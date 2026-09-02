// Sample-table fixtures: frames evenly spread across a duration, sized however a test needs.

import type { SampleInfo } from "../../src/lib/types";

/** One frame, presented at `ctsSec` and `size` bytes long. */
export function sample(ctsSec: number, size: number, isSync = false): SampleInfo {
  return { size, cts: 0, dts: 0, ctsSec, is_sync: isSync };
}

/** `count` evenly-spaced frames across `durationSec`, sized by `sizeAt` (a number, or a function of
 * the frame's index and time) and marked as keyframes where `isSyncAt` says. */
export function evenSamples(
  count: number,
  durationSec: number,
  sizeAt: number | ((i: number, ctsSec: number) => number),
  isSyncAt: (i: number) => boolean = () => false,
): SampleInfo[] {
  return Array.from({ length: count }, (_, i) => {
    const ctsSec = (durationSec * i) / count;
    return sample(ctsSec, typeof sizeAt === "number" ? sizeAt : sizeAt(i, ctsSec), isSyncAt(i));
  });
}
