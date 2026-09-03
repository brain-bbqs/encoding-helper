import { describe, expect, it } from "vitest";
import { evenSamples, sample } from "../fixtures/samples";
import { computeBitrateTimeline, isEffectivelyConstant, MAX_BINS, MIN_BINS } from "../../src/lib/bitrateTimeline";

describe("computeBitrateTimeline", () => {
  it("returns null with no samples", () => {
    expect(computeBitrateTimeline([], 10)).toBeNull();
  });

  it("returns null when the duration is unknown or degenerate", () => {
    const samples = evenSamples(300, 10, 1000);
    expect(computeBitrateTimeline(samples, 0)).toBeNull();
    expect(computeBitrateTimeline(samples, -1)).toBeNull();
    expect(computeBitrateTimeline(samples, NaN)).toBeNull();
  });

  it("returns null when there are too few frames to bin", () => {
    // Three frames cannot fill even two windows at two frames apiece.
    expect(computeBitrateTimeline(evenSamples(3, 1, 1000), 1)).toBeNull();
  });

  it("bins a constant-size stream into windows all at the same rate", () => {
    // 300 frames of 1000 bytes over 10 s = 30,000 bytes/s = 240,000 bps.
    const timeline = computeBitrateTimeline(evenSamples(300, 10, 1000), 10);
    expect(timeline).not.toBeNull();
    expect(timeline!.bins.length).toBe(MIN_BINS);
    expect(timeline!.binSeconds).toBeCloseTo(10 / MIN_BINS, 10);
    expect(timeline!.averageBitrate).toBeCloseTo(240_000, 3);
    // Windows can differ from the nominal rate by the one frame that lands either side of a
    // boundary, so the busiest and quietest of them are within two frames of each other.
    const oneFrame = (1000 * 8) / timeline!.binSeconds;
    timeline!.bins.forEach((b) => expect(Math.abs(b.bitrate - 240_000)).toBeLessThanOrEqual(oneFrame));
    expect(timeline!.peakBitrate - timeline!.minBitrate).toBeLessThanOrEqual(2 * oneFrame);
  });

  it("covers the whole duration with contiguous windows", () => {
    const timeline = computeBitrateTimeline(evenSamples(600, 30, 500), 30)!;
    expect(timeline.bins[0].startSec).toBe(0);
    expect(timeline.bins[timeline.bins.length - 1].endSec).toBeCloseTo(30, 10);
    timeline.bins.slice(1).forEach((b, i) => expect(b.startSec).toBeCloseTo(timeline.bins[i].endSec, 10));
  });

  it("accounts for every frame exactly once", () => {
    const timeline = computeBitrateTimeline(evenSamples(600, 30, 500), 30)!;
    expect(timeline.bins.reduce((n, b) => n + b.sampleCount, 0)).toBe(600);
  });

  it("puts a frame presented at or past the duration in the last window rather than off the end", () => {
    const samples = [...evenSamples(100, 10, 1000), sample(10, 1000), sample(10.4, 1000)];
    const timeline = computeBitrateTimeline(samples, 10)!;
    expect(timeline.bins.reduce((n, b) => n + b.sampleCount, 0)).toBe(102);
    expect(timeline.bins[timeline.bins.length - 1].sampleCount).toBeGreaterThanOrEqual(2);
  });

  it("finds the peak and the quiet window of a stream whose rate varies", () => {
    // A still first half, then a busy second half costing ten times as much per frame.
    const timeline = computeBitrateTimeline(
      evenSamples(600, 60, (i) => (i < 300 ? 1_000 : 10_000)),
      60,
    )!;
    expect(timeline.peakBitrate).toBeCloseTo(800_000, 3);
    expect(timeline.minBitrate).toBeCloseTo(80_000, 3);
    expect(timeline.averageBitrate).toBeCloseTo(440_000, 3);
    expect(timeline.peakToAverage).toBeCloseTo(800_000 / 440_000, 6);
  });

  it("reports the average across the whole track, matching bytes × 8 ÷ duration", () => {
    const samples = evenSamples(600, 60, (i) => (i % 10 === 0 ? 10_000 : 1_000));
    const totalBits = samples.reduce((n, s) => n + s.size, 0) * 8;
    expect(computeBitrateTimeline(samples, 60)!.averageBitrate).toBeCloseTo(totalBits / 60, 3);
  });

  it("aims for about one window per second between the two bounds", () => {
    // Long enough that ~1/s would exceed MAX_BINS, and dense enough not to be frame-limited.
    const long = computeBitrateTimeline(evenSamples(30_000, 1000, 1000), 1000)!;
    expect(long.bins.length).toBe(MAX_BINS);
    const medium = computeBitrateTimeline(evenSamples(3000, 100, 1000), 100)!;
    expect(medium.bins.length).toBe(100);
    // Short enough that ~1/s would fall under MIN_BINS.
    const short = computeBitrateTimeline(evenSamples(150, 5, 1000), 5)!;
    expect(short.bins.length).toBe(MIN_BINS);
  });

  it("caps the window count so no window holds fewer than two frames", () => {
    // 41 frames over 100 s: ~1/s would be 100 windows, most of them empty or single-frame.
    const timeline = computeBitrateTimeline(evenSamples(41, 100, 1000), 100)!;
    expect(timeline.bins.length).toBe(20);
  });
});

describe("isEffectivelyConstant", () => {
  it("is true for a stream whose windows all carry the same bits", () => {
    expect(isEffectivelyConstant(computeBitrateTimeline(evenSamples(600, 30, 1000), 30)!)).toBe(true);
  });

  it("is false as soon as one window runs well above the average", () => {
    // A single spike a fifth above the average, the rest of the track flat.
    const spiked = evenSamples(600, 30, (i) => (i < 20 ? 1_200 : 1_000));
    expect(isEffectivelyConstant(computeBitrateTimeline(spiked, 30)!)).toBe(false);
  });

  it("is false for an ordinary variable-bitrate shape", () => {
    const varying = evenSamples(600, 60, (i) => (i < 300 ? 1_000 : 10_000));
    expect(isEffectivelyConstant(computeBitrateTimeline(varying, 60)!)).toBe(false);
  });
});
