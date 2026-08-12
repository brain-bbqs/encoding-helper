// Instantaneous bitrate over time, binned out of the video track's sample table.
//
// The Inspect tab reports one bitrate per track, and that number is an average: the track's bytes
// times 8, divided by its duration. The average says nothing about where the bits went. A
// variable-bitrate encode — which is what every CRF encode and every x264 default is — spends them
// where the picture is hard (a keyframe, a scene cut, fast motion) and saves them where it is easy,
// so the rate one second at a time can sit several times above or below the average the whole file
// reports. Every sample's size and presentation time is already in the sample table, so summing
// sizes into time windows recovers that shape exactly, with no decoding.

import type { SampleInfo } from "./types";

/** One time window, and the rate the frames presented inside it worked out to. */
export interface BitrateBin {
  startSec: number;
  endSec: number;
  /** Bits of sample data in this window divided by the window's length, i.e. bits per second. */
  bitrate: number;
  sampleCount: number;
}

export interface BitrateTimeline {
  bins: BitrateBin[];
  binSeconds: number;
  /** Across the whole track, so it matches the single Bitrate figure the track section reports. */
  averageBitrate: number;
  peakBitrate: number;
  minBitrate: number;
  /** Peak ÷ average. 1 means every window carried the same bits; the further above, the burstier. */
  peakToAverage: number;
}

/** Below this many windows a short clip reads as one flat block rather than as a shape. */
export const MIN_BINS = 12;

/** Above this many there are more windows than the plot has pixels to draw them in. */
export const MAX_BINS = 240;

/**
 * A window holding fewer frames than this alternates between one frame's bits and none at all,
 * which plots the frame rate rather than the bitrate.
 */
const MIN_SAMPLES_PER_BIN = 2;

/**
 * How far above the average the busiest window may sit for the rate to still count as unmoving.
 * Not zero: even an encoder holding a rate constant does so across a buffer rather than exactly per
 * window, and a frame landing either side of a window boundary moves a window's total by itself.
 * Set tight, because the cost of the two mistakes is not symmetric — a plot of a nearly flat line
 * is still honest, while suppressing one hides real variation the file has.
 */
export const FLAT_PEAK_RATIO = 1.02;

/** Whether the measured windows are flat enough that a plot of them would say nothing. */
export function isEffectivelyConstant(timeline: BitrateTimeline): boolean {
  return timeline.peakToAverage <= FLAT_PEAK_RATIO;
}

/**
 * Bins `samples` by presentation time into equal windows spanning `durationSec`, roughly one per
 * second of playback within the bounds above. Null when there are too few frames to bin into a
 * shape worth drawing, or when the duration is unknown.
 */
export function computeBitrateTimeline(samples: SampleInfo[], durationSec: number): BitrateTimeline | null {
  if (samples.length === 0 || !(durationSec > 0)) return null;
  const wanted = Math.min(MAX_BINS, Math.max(MIN_BINS, Math.round(durationSec)));
  const binCount = Math.min(wanted, Math.floor(samples.length / MIN_SAMPLES_PER_BIN));
  if (binCount < 2) return null;

  const binSeconds = durationSec / binCount;
  const bytes = new Array<number>(binCount).fill(0);
  const counts = new Array<number>(binCount).fill(0);
  let totalBytes = 0;
  for (const s of samples) {
    // A file whose last frame is presented at exactly the duration, or a hair past it, still
    // belongs to the final window rather than off the end of the array.
    const i = Math.min(binCount - 1, Math.max(0, Math.floor(s.ctsSec / binSeconds)));
    bytes[i] += s.size;
    counts[i] += 1;
    totalBytes += s.size;
  }

  const bins: BitrateBin[] = bytes.map((b, i) => ({
    startSec: i * binSeconds,
    endSec: (i + 1) * binSeconds,
    bitrate: (b * 8) / binSeconds,
    sampleCount: counts[i],
  }));
  const averageBitrate = (totalBytes * 8) / durationSec;
  let peakBitrate = -Infinity;
  let minBitrate = Infinity;
  for (const bin of bins) {
    peakBitrate = Math.max(peakBitrate, bin.bitrate);
    minBitrate = Math.min(minBitrate, bin.bitrate);
  }
  return {
    bins,
    binSeconds,
    averageBitrate,
    peakBitrate,
    minBitrate,
    peakToAverage: averageBitrate > 0 ? peakBitrate / averageBitrate : 1,
  };
}
