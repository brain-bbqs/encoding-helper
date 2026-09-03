// The file every size-estimate test projects from.

import type { SizeEstimateInput } from "../../src/lib/sizeEstimate";

/** A 1 MB, 100 s file of which the first 10 s were sampled. */
export const MB_FILE_INPUT: Omit<SizeEstimateInput, "encodedSegmentBytes"> = {
  originalTotalBytes: 1_000_000,
  totalSeconds: 100,
  segmentStartSeconds: 0,
  segmentSeconds: 10,
};
