import { estimateSizeSavings, type SizeEstimateInput } from "../src/lib/sizeEstimate";
import type { SampleInfo } from "../src/lib/types";
import { renderSavingsDetail, renderSavingsStrip } from "../src/ui/savingsPanel";

/** A 30 fps sample table for `durationSec`, sized by a per-second cost. */
function samples(durationSec: number, bytesAt: (second: number) => number): SampleInfo[] {
  return Array.from({ length: Math.round(durationSec * 30) }, (_, i) => {
    const ctsSec = i / 30;
    return {
      size: bytesAt(Math.floor(ctsSec)) / 30,
      cts: 0,
      dts: 0,
      ctsSec,
      is_sync: false,
    };
  });
}

/** A 3-minute recording that alternates between busy and calm seconds, 3 s of it sampled. */
const VARIABLE: SizeEstimateInput = {
  originalTotalBytes: 200_000_000,
  totalSeconds: 180,
  segmentStartSeconds: 20,
  segmentSeconds: 3,
  encodedSegmentBytes: 1_150_000,
  samples: samples(180, (s) => (s % 7 === 0 ? 2_000_000 : 900_000)),
};

/** No sample table (a container we cannot index), so the source's cost is a flat share of the file. */
const FLAT: SizeEstimateInput = {
  originalTotalBytes: 200_000_000,
  totalSeconds: 180,
  segmentStartSeconds: 20,
  segmentSeconds: 3,
  encodedSegmentBytes: 1_150_000,
};

/** Lossless on an already-compressed source: the settings cost bytes rather than saving them. */
const GREW: SizeEstimateInput = { ...VARIABLE, encodedSegmentBytes: 5_400_000 };

function renderWith(input: SizeEstimateInput, detail = true): HTMLElement {
  const panel = document.createElement("div");
  panel.className = "section";
  const est = estimateSizeSavings(input);
  if (!est) return panel;
  panel.append(renderSavingsStrip(est));
  if (detail) panel.append(...renderSavingsDetail(est));
  return panel;
}

export default {
  title: "Components/Data Savings",
};

export const Measured = {
  name: "Sample table available — projection with a range",
  render: () => renderWith(VARIABLE),
};

export const Proportional = {
  name: "No sample table — flat share of the file, no range",
  render: () => renderWith(FLAT),
};

export const Grew = {
  name: "Settings that grow the file",
  render: () => renderWith(GREW),
};

export const StripOnly = {
  name: "Headline strip, as it sits above the panes",
  render: () => renderWith(VARIABLE, false),
};
