// What a sample run's encode step is handed, without the cutting that produces it in the app.

import type { SampleWindow } from "../../src/lib/types";
import type { RunInputs } from "../../src/ui/segmentRun";

/** Inputs as prepareRun hands them over once the stretches are cut: one snippet per window. */
export function cutInputs(windows: SampleWindow[]): RunInputs {
  return {
    windows,
    names: windows.map((_, i) => `snip${i}.mp4`),
    data: windows.map(() => new Uint8Array(4)),
    preCut: true,
  };
}
