// Projecting what a whole file would cost at the settings the Compare Quality tab just tried.
//
// Compare Quality encodes a few seconds rather than the whole file, because minutes of waiting is a
// bad way to answer "does CRF 28 still look fine?" when a snippet answers it. Size is the other half
// of that question — quality is only ever traded against bytes — and the snippet's own byte count
// cannot answer it alone: it says nothing about what the same stretch costs in the source, and
// nothing about what either comes to across the full running time.
//
// So the projection is a *ratio* measured on the snippet, applied to the source's real size:
//
//   projected total = original total × (encoded snippet ÷ the same stretch of the source)
//
// rather than the snippet's bytes multiplied out by the number of snippets that fit in the file.
// Both halves of the ratio cover the same seconds of the same content, so a snippet taken from an
// expensive stretch (a scene cut, fast motion) is divided by an equally expensive original and lands
// near the ratio a calm stretch would have given, instead of projecting the entire file at the
// busiest moment's rate. The multiplied-out version has no such correction and is wrong by however
// much the chosen seconds differ from the file's average, which on a short snippet is a lot.
//
// What the ratio cannot correct for is the encoder behaving differently elsewhere in the file: CRF
// spends bits per content, and a stretch this snippet never saw may compress on quite different
// terms. That residual is what the band reports, and it is why every number here is an estimate.

import { encodeTest, state } from "./state";
import type { SampleInfo, SampleWindow } from "./types";

/** How the cost of the sampled stretch in the *source* was arrived at. */
type SizeEstimateBasis =
  /** Summed out of the video sample table, so it is this stretch's real bytes, not an average. */
  | "sample-table"
  /** No sample table (or none covering the stretch): the file's bytes spread evenly over its time. */
  | "proportional";

export interface SizeEstimateInput {
  /** The source file's size, container and every track included. */
  originalTotalBytes: number;
  /** The source's full playback duration, in seconds. */
  totalSeconds: number;
  /** Where the encoded stretch starts in the source, in seconds. */
  segmentStartSeconds: number;
  /** How many seconds of playback the encoded stretch actually covers. */
  segmentSeconds: number;
  /**
   * The stretches actually encoded, when there was more than the one above.
   *
   * Sampling the file in several places is the answer to this projection's one real weakness: a
   * single snippet is only as representative as wherever it happened to land, and nothing about the
   * ratio can tell you how badly it missed. Several disjoint stretches are summed on both sides of
   * the ratio, so the projection is made against a fair share of the file rather than one moment of
   * it, and the band narrows accordingly.
   */
  windows?: SampleWindow[];
  /** Bytes ffmpeg produced for that stretch. */
  encodedSegmentBytes: number;
  /** The video track's sample table, when the container was one we could parse. */
  samples?: SampleInfo[] | null;
}

export interface SizeEstimate {
  basis: SizeEstimateBasis;
  originalTotalBytes: number;
  totalSeconds: number;
  segmentSeconds: number;
  /** What the source spends on the sampled stretch, on the same terms as the encoded stretch. */
  originalSegmentBytes: number;
  /** Encoded ÷ original over the stretch. Below 1 the encode shrank it; above 1 it grew. */
  ratio: number;
  /** 1 − ratio: positive when the encode saves bytes, negative when it adds them. */
  savedFraction: number;
  segmentSavedBytes: number;
  projectedTotalBytes: number;
  projectedSavedBytes: number;
  /** A rough band around the projection, or null when the file gives nothing to derive one from. */
  projectedRange: { low: number; high: number } | null;
  /** The share of the file's playback the snippet covers, 0–1. */
  sampledFraction: number;
  /** How many separate stretches were sampled. 1 unless the run asked for more. */
  windowCount: number;
  /**
   * The stretch's video bitrate ÷ the track's average: above 1 it is busier than the file at large,
   * below 1 calmer. Null without a sample table. The projection already corrects for this; it is
   * reported so the reader can see how representative their pick was.
   */
  windowDifficulty: number | null;
}

/** Below this many frames in the window, its summed bytes are noise rather than a local measurement. */
const MIN_WINDOW_SAMPLES = 2;

/** Narrower than this and a band would claim a precision a snippet cannot have. */
const MIN_BAND = 0.03;

/** Wider than this and the band spans everything, which tells the reader nothing they didn't know. */
const MAX_BAND = 0.6;

/** Fewer windows than this in the file and their spread is not a distribution worth measuring. */
const MIN_SPREAD_WINDOWS = 3;

/** Sums the bytes of every frame presented within [startSec, startSec + lengthSec). */
function windowBytes(samples: SampleInfo[], startSec: number, lengthSec: number): { bytes: number; count: number } {
  const end = startSec + lengthSec;
  let bytes = 0;
  let count = 0;
  for (const s of samples) {
    if (s.ctsSec >= startSec && s.ctsSec < end) {
      bytes += s.size;
      count++;
    }
  }
  return { bytes, count };
}

/**
 * How much the file's own equal-length windows differ from one another, as a coefficient of
 * variation (standard deviation ÷ mean) of their video bytes.
 *
 * This stands in for the projection's error. It is not the same quantity — the projection already
 * divides out how busy the sampled window was — but a file whose windows all cost about the same is
 * one where any window predicts any other, and a file whose windows swing wildly is one where the
 * encoder's behavior swings with them. Null when the file holds too few windows to say.
 */
function windowSpread(samples: SampleInfo[], totalSeconds: number, windowSeconds: number): number | null {
  const count = Math.floor(totalSeconds / windowSeconds);
  if (count < MIN_SPREAD_WINDOWS) return null;
  const bytes = new Array<number>(count).fill(0);
  for (const s of samples) {
    const i = Math.floor(s.ctsSec / windowSeconds);
    if (i >= 0 && i < count) bytes[i] += s.size;
  }
  const mean = bytes.reduce((a, b) => a + b, 0) / count;
  if (!(mean > 0)) return null;
  const variance = bytes.reduce((a, b) => a + (b - mean) * (b - mean), 0) / count;
  return Math.sqrt(variance) / mean;
}

/**
 * Projects the full re-encoded file size from one encoded snippet. Null when the inputs cannot
 * support a projection at all (no duration, no source size, an empty encode).
 */
export function estimateSizeSavings(input: SizeEstimateInput): SizeEstimate | null {
  const { originalTotalBytes, totalSeconds, segmentSeconds, segmentStartSeconds, encodedSegmentBytes } = input;
  if (!(originalTotalBytes > 0) || !(totalSeconds > 0) || !(encodedSegmentBytes > 0)) return null;

  // One window unless the run sampled several; everything below is written against the list, so the
  // two cases are the same arithmetic rather than two code paths.
  const windows: SampleWindow[] = input.windows?.length
    ? input.windows
    : [{ startSeconds: segmentStartSeconds, seconds: segmentSeconds }];
  const sampledSeconds = windowsSeconds(windows);
  if (!(sampledSeconds > 0)) return null;

  const sampledFraction = Math.min(1, sampledSeconds / totalSeconds);
  const samples = input.samples ?? [];
  const totalVideoBytes = samples.reduce((sum, s) => sum + s.size, 0);
  const sampled = windows.reduce(
    (acc, w) => {
      const got = windowBytes(samples, w.startSeconds, w.seconds);
      return { bytes: acc.bytes + got.bytes, count: acc.count + got.count };
    },
    { bytes: 0, count: 0 },
  );

  // Everything that is not video sample data — the audio track, the container's headers and sample
  // index — has no per-frame table to sum, so it is spread evenly over the running time. The
  // encoded snippet carries its own share of both (ffmpeg copies or drops the audio and writes a
  // fresh container either way), so leaving them out of the original side would compare a snippet
  // with audio against a stretch without it.
  const nonVideoBytes = Math.max(0, originalTotalBytes - totalVideoBytes);
  const useSampleTable = totalVideoBytes > 0 && sampled.count >= MIN_WINDOW_SAMPLES && sampled.bytes > 0;
  const basis: SizeEstimateBasis = useSampleTable ? "sample-table" : "proportional";
  const originalSegmentBytes = useSampleTable
    ? sampled.bytes + nonVideoBytes * sampledFraction
    : originalTotalBytes * sampledFraction;
  if (!(originalSegmentBytes > 0)) return null;

  const ratio = encodedSegmentBytes / originalSegmentBytes;
  const projectedTotalBytes = originalTotalBytes * ratio;

  // Measured over windows the size of the ones actually encoded, since that is the unit whose
  // variability the projection is exposed to.
  const spread = useSampleTable ? windowSpread(samples, totalSeconds, sampledSeconds / windows.length) : null;
  // Sampling more of the file leaves less of it to be wrong about, and sampling all of it leaves
  // nothing: at that point the "projection" is the measurement. Spreading the same seconds over
  // several places narrows it further, by the usual √n: one unlucky window is averaged against the
  // others instead of being the whole measurement.
  const band =
    spread == null
      ? null
      : Math.min(
          MAX_BAND,
          Math.max(MIN_BAND, (spread / Math.sqrt(windows.length)) * Math.sqrt(Math.max(0, 1 - sampledFraction))),
        );
  const projectedRange =
    band == null || sampledFraction >= 1
      ? null
      : { low: Math.max(0, projectedTotalBytes * (1 - band)), high: projectedTotalBytes * (1 + band) };

  const windowDifficulty = useSampleTable ? sampled.bytes / sampledSeconds / (totalVideoBytes / totalSeconds) : null;

  return {
    basis,
    originalTotalBytes,
    totalSeconds,
    segmentSeconds: sampledSeconds,
    originalSegmentBytes,
    ratio,
    savedFraction: 1 - ratio,
    segmentSavedBytes: originalSegmentBytes - encodedSegmentBytes,
    projectedTotalBytes,
    projectedSavedBytes: originalTotalBytes - projectedTotalBytes,
    projectedRange,
    sampledFraction,
    windowCount: windows.length,
    windowDifficulty,
  };
}

/**
 * The stretches a run should cover, reusing the last run's wherever they still answer the question.
 *
 * Two settings are only comparable if they were measured over the same seconds, so re-running at a
 * different CRF keeps the stretches the run before it used; changing their length or how many there
 * are draws fresh ones, the old set no longer being what was asked for. Reuse also means the cut
 * stretches from last time are still sitting in the encoder, so the run has nothing to fetch.
 *
 * `snap` moves a start onto something the source can be cut at (a keyframe), so a stretch can be
 * taken out of the video by copy rather than by decoding up to it.
 */
export function windowsForRun(
  kept: SampleWindow[],
  totalSeconds: number,
  seconds: number,
  count: number,
  snap: (t: number) => number = (t) => t,
): SampleWindow[] {
  const wanted = Math.max(1, count);
  if (kept.length === wanted && kept.every((w) => Math.abs(w.seconds - seconds) < 0.001)) return kept;
  return pickSampleWindows(totalSeconds, seconds, wanted).map((w) => ({
    startSeconds: snap(w.startSeconds),
    seconds: w.seconds,
  }));
}

/**
 * Where to take `count` stretches of `seconds` from a file of `totalSeconds`.
 *
 * Placement is the sampler's, never the reader's: a stretch picked by hand is picked for a reason,
 * and a size measured over a flattering moment is the one number this tab must not produce.
 *
 * The draw is random but *stratified*: the file is cut into as many equal bands as there are
 * stretches and one start is drawn inside each. Purely random starts clump — three uniform draws
 * land in the same half of a file often enough to matter — and clumped samples are the failure the
 * extra encodes were meant to buy their way out of. One stretch is the same rule with a single
 * band, so it lands anywhere in the file.
 */
export function pickSampleWindows(totalSeconds: number, seconds: number, count: number): SampleWindow[] {
  if (!(totalSeconds > 0) || !(seconds > 0)) return [];
  const length = Math.min(seconds, totalSeconds);
  const wanted = Math.min(Math.max(1, count), Math.floor(totalSeconds / length));
  const band = totalSeconds / wanted;
  const windows: SampleWindow[] = [];
  for (let i = 0; i < wanted; i++) {
    // The last band is short of a full window's room unless the file divides evenly, so every start
    // is clamped to leave the whole stretch inside the file.
    const room = Math.max(0, Math.min(band, totalSeconds - i * band) - length);
    const start = Math.min(i * band + Math.random() * room, totalSeconds - length);
    windows.push({ startSeconds: start, seconds: length });
  }
  return windows;
}

/** The seconds a run's stretches add up to. */
export function windowsSeconds(windows: SampleWindow[]): number {
  return windows.reduce((sum, w) => sum + w.seconds, 0);
}

/**
 * The projection for `windows` having encoded to `encodedBytes`, against the loaded file; null
 * before a file is open. `fallbackStart` stands in for the first stretch's start when there is none.
 */
export function estimateForWindows(
  windows: SampleWindow[],
  encodedBytes: number,
  fallbackStart = 0,
): SizeEstimate | null {
  if (!state.source) return null;
  return estimateSizeSavings({
    originalTotalBytes: state.source.size,
    totalSeconds: state.duration ?? 0,
    segmentStartSeconds: windows[0]?.startSeconds ?? fallbackStart,
    segmentSeconds: windowsSeconds(windows),
    windows,
    encodedSegmentBytes: encodedBytes,
    samples: state.samples,
  });
}

/** The estimate for the comparison currently loaded in the Compare Quality tab, or null before one runs. */
export function currentSizeEstimate(): SizeEstimate | null {
  if (encodeTest.encodedSize == null) return null;
  // Every stretch the run covered, not just the one the A/B window is showing: the bytes on the
  // other side of this ratio are all of them added together, so the source side has to cover all
  // of them too. Left as the shown stretch alone, a five-segment run measured five stretches of
  // output against one stretch of source and projected a file about five times too big.
  //
  // The seconds are the measured output durations rather than the requested ones — a trim lands a
  // frame either side of the length asked for, and the ratio is only fair if both halves cover the
  // same seconds — which is what the run stored on each window.
  const windows: SampleWindow[] = encodeTest.windows.length
    ? encodeTest.windows
    : [
        {
          startSeconds: encodeTest.startTime,
          seconds: encodeTest.segDuration > 0 ? encodeTest.segDuration : encodeTest.duration,
        },
      ];
  return estimateForWindows(windows, encodeTest.encodedSize);
}

/** A percentage at a readable precision: tighter below 10%, where a whole point is a big relative move. */
export function fmtPct(fraction: number): string {
  const pct = fraction * 100;
  return (Math.abs(pct) < 10 ? pct.toFixed(1) : pct.toFixed(0)) + "%";
}

/** Under this the two sizes are the same number as far as anyone reading it is concerned. */
const NEGLIGIBLE = 0.005;

/** e.g. "62% smaller", "8.4% larger", "about the same size". */
export function describeSavings(estimate: SizeEstimate): string {
  const saved = estimate.savedFraction;
  if (Math.abs(saved) < NEGLIGIBLE) return "about the same size";
  return saved > 0 ? `${fmtPct(saved)} smaller` : `${fmtPct(-saved)} larger`;
}

/** The change as a signed percentage, e.g. "-62%" or "+8.4%", for a numeric readout. */
export function fmtSignedChange(estimate: SizeEstimate): string {
  const change = estimate.ratio - 1;
  return (change >= 0 ? "+" : "-") + fmtPct(Math.abs(change));
}

/**
 * The same change as a factor, naming which of the two files the factor belongs to, e.g.
 * "original 2.6× larger" or "encoded 1.1× larger".
 *
 * A percentage compresses exactly where the interesting encodes are: 90% and 95% smaller read as
 * neighbours, but one file is twice the size of the other. The factor keeps that distance visible
 * (10× against 20×), which is the form these numbers are usually quoted in anyway. Both are shown,
 * since a percentage is the better feel for the shallow end where a factor hugs 1.
 *
 * It says which side is the larger one rather than calling itself a "reduction": a bare factor
 * leaves the reader to work out which way it points, and the two words for it (reduction against
 * inflation) are the only thing that ever said so.
 */
export function fmtChangeFactor(ratio: number): string {
  if (!Number.isFinite(ratio) || ratio <= 0) return "–";
  if (Math.abs(ratio - 1) < NEGLIGIBLE) return "no size change";
  const inflating = ratio > 1;
  const factor = inflating ? ratio : 1 / ratio;
  // A tenth is meaningful at 2.4× and noise at 24×, where the digits before the point carry it.
  const digits = factor < 10 ? 1 : 0;
  return `${inflating ? "encoded" : "original"} ${factor.toFixed(digits)}× larger`;
}
