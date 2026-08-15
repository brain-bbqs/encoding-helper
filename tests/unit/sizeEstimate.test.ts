import { describe, expect, it } from "vitest";
import {
  describeSavings,
  estimateSizeSavings,
  fmtChangeFactor,
  fmtPct,
  fmtSignedChange,
  pickSampleWindows,
  windowsForRun,
  type SizeEstimateInput,
} from "../../src/lib/sizeEstimate";
import type { SampleInfo } from "../../src/lib/types";

/** One frame, presented at `ctsSec` and `size` bytes long. */
function sample(ctsSec: number, size: number): SampleInfo {
  return { offset: 0, size, cts: 0, dts: 0, ctsSec, dtsSec: ctsSec, is_sync: false, duration: 1 };
}

/** `count` evenly-spaced frames across `durationSec`, sized by `size(ctsSec)`. */
function evenSamples(count: number, durationSec: number, size: (ctsSec: number) => number): SampleInfo[] {
  return Array.from({ length: count }, (_, i) => {
    const ctsSec = (durationSec * i) / count;
    return sample(ctsSec, size(ctsSec));
  });
}

const BASE: SizeEstimateInput = {
  originalTotalBytes: 1_000_000,
  totalSeconds: 100,
  segmentStartSeconds: 0,
  segmentSeconds: 10,
  encodedSegmentBytes: 50_000,
};

describe("estimateSizeSavings", () => {
  it("returns null when an input cannot support a projection", () => {
    expect(estimateSizeSavings({ ...BASE, originalTotalBytes: 0 })).toBeNull();
    expect(estimateSizeSavings({ ...BASE, totalSeconds: 0 })).toBeNull();
    expect(estimateSizeSavings({ ...BASE, segmentSeconds: 0 })).toBeNull();
    expect(estimateSizeSavings({ ...BASE, encodedSegmentBytes: 0 })).toBeNull();
    expect(estimateSizeSavings({ ...BASE, totalSeconds: NaN })).toBeNull();
  });

  it("spreads the file evenly over its running time when there is no sample table", () => {
    // 10 s of a 100 s, 1 MB file is 100 KB of source; 50 KB of encode halves it.
    const est = estimateSizeSavings(BASE);
    expect(est).not.toBeNull();
    expect(est!.basis).toBe("proportional");
    expect(est!.originalSegmentBytes).toBe(100_000);
    expect(est!.ratio).toBe(0.5);
    expect(est!.savedFraction).toBe(0.5);
    expect(est!.segmentSavedBytes).toBe(50_000);
    expect(est!.projectedTotalBytes).toBe(500_000);
    expect(est!.projectedSavedBytes).toBe(500_000);
    expect(est!.sampledFraction).toBe(0.1);
    expect(est!.windowDifficulty).toBeNull();
    // Without a sample table there are no windows to measure a spread across.
    expect(est!.projectedRange).toBeNull();
  });

  it("reads the sampled stretch's real cost out of the sample table", () => {
    // 10 s at 30 fps: the first second costs 2000 bytes a frame, the rest 1000.
    const samples = evenSamples(300, 10, (t) => (t < 1 ? 2000 : 1000));
    const est = estimateSizeSavings({
      originalTotalBytes: 330_000,
      totalSeconds: 10,
      segmentStartSeconds: 0,
      segmentSeconds: 1,
      encodedSegmentBytes: 30_000,
      samples,
    });
    expect(est).not.toBeNull();
    expect(est!.basis).toBe("sample-table");
    expect(est!.originalSegmentBytes).toBe(60_000);
    expect(est!.ratio).toBe(0.5);
    // Not 30,000 × 10 = 300,000: the sampled second is nearly twice as expensive as the file's
    // average, and dividing by what the source spends on it is what takes that back out.
    expect(est!.projectedTotalBytes).toBe(165_000);
    expect(est!.windowDifficulty).toBeCloseTo(60_000 / 33_000, 10);
  });

  it("gives the sampled stretch its share of the audio and container bytes", () => {
    // Same video samples as above, inside a file 100,000 bytes larger than its video track.
    const samples = evenSamples(300, 10, (t) => (t < 1 ? 2000 : 1000));
    const est = estimateSizeSavings({
      originalTotalBytes: 430_000,
      totalSeconds: 10,
      segmentStartSeconds: 0,
      segmentSeconds: 1,
      encodedSegmentBytes: 30_000,
      samples,
    });
    // 60,000 bytes of video for that second, plus a tenth of the 100,000 non-video bytes.
    expect(est!.originalSegmentBytes).toBe(70_000);
    expect(est!.basis).toBe("sample-table");
  });

  it("measures a stretch taken from the middle of the file, not from the start", () => {
    const samples = evenSamples(300, 10, (t) => (t >= 5 && t < 6 ? 3000 : 1000));
    const est = estimateSizeSavings({
      originalTotalBytes: 360_000,
      totalSeconds: 10,
      segmentStartSeconds: 5,
      segmentSeconds: 1,
      encodedSegmentBytes: 45_000,
      samples,
    });
    expect(est!.originalSegmentBytes).toBe(90_000);
    expect(est!.ratio).toBe(0.5);
    expect(est!.windowDifficulty).toBeCloseTo(90_000 / 36_000, 10);
  });

  it("falls back to the even spread when the sample table does not cover the stretch", () => {
    const samples = evenSamples(300, 10, () => 1000);
    const est = estimateSizeSavings({
      originalTotalBytes: 300_000,
      totalSeconds: 10,
      // Past the last frame, so summing the window would give zero bytes rather than a measurement.
      segmentStartSeconds: 20,
      segmentSeconds: 1,
      encodedSegmentBytes: 15_000,
      samples,
    });
    expect(est!.basis).toBe("proportional");
    expect(est!.originalSegmentBytes).toBe(30_000);
    expect(est!.windowDifficulty).toBeNull();
  });

  it("bands the projection by how much the file's own windows differ", () => {
    const varying = evenSamples(300, 10, (t) => (t < 1 ? 2000 : 1000));
    const est = estimateSizeSavings({
      originalTotalBytes: 330_000,
      totalSeconds: 10,
      segmentStartSeconds: 0,
      segmentSeconds: 1,
      encodedSegmentBytes: 30_000,
      samples: varying,
    })!;
    expect(est.projectedRange).not.toBeNull();
    expect(est.projectedRange!.low).toBeLessThan(est.projectedTotalBytes);
    expect(est.projectedRange!.high).toBeGreaterThan(est.projectedTotalBytes);

    // A file whose every window costs the same leaves almost nothing for the band to be wide about.
    const flat = evenSamples(300, 10, () => 1000);
    const flatEst = estimateSizeSavings({
      originalTotalBytes: 300_000,
      totalSeconds: 10,
      segmentStartSeconds: 0,
      segmentSeconds: 1,
      encodedSegmentBytes: 15_000,
      samples: flat,
    })!;
    const width = (e: typeof est): number => (e.projectedRange!.high - e.projectedRange!.low) / e.projectedTotalBytes;
    expect(width(flatEst)).toBeLessThan(width(est));
  });

  it("drops the band once the whole file has been encoded", () => {
    const samples = evenSamples(300, 10, (t) => (t < 1 ? 2000 : 1000));
    const est = estimateSizeSavings({
      originalTotalBytes: 330_000,
      totalSeconds: 10,
      segmentStartSeconds: 0,
      segmentSeconds: 10,
      encodedSegmentBytes: 165_000,
      samples,
    })!;
    expect(est.sampledFraction).toBe(1);
    expect(est.projectedRange).toBeNull();
    expect(est.projectedTotalBytes).toBe(165_000);
  });

  it("narrows the band as more of the file is sampled", () => {
    const samples = evenSamples(600, 20, (t) => (Math.floor(t) % 2 === 0 ? 2000 : 1000));
    const forSegment = (segmentSeconds: number): number => {
      const est = estimateSizeSavings({
        originalTotalBytes: 900_000,
        totalSeconds: 20,
        segmentStartSeconds: 0,
        segmentSeconds,
        encodedSegmentBytes: 10_000 * segmentSeconds,
        samples,
      })!;
      return (est.projectedRange!.high - est.projectedRange!.low) / est.projectedTotalBytes;
    };
    expect(forSegment(5)).toBeLessThan(forSegment(1));
  });

  it("reports settings that grew the file rather than clamping them to a saving", () => {
    const est = estimateSizeSavings({ ...BASE, encodedSegmentBytes: 120_000 })!;
    expect(est.ratio).toBe(1.2);
    expect(est.savedFraction).toBeCloseTo(-0.2, 10);
    expect(est.projectedTotalBytes).toBe(1_200_000);
    expect(est.projectedSavedBytes).toBe(-200_000);
    expect(describeSavings(est)).toBe("20% larger");
    expect(fmtSignedChange(est)).toBe("+20%");
  });
});

describe("savings wording", () => {
  it("names the direction of the change", () => {
    const est = estimateSizeSavings(BASE)!;
    expect(describeSavings(est)).toBe("50% smaller");
    expect(fmtSignedChange(est)).toBe("-50%");
  });

  it("calls a change too small to matter what it is", () => {
    const est = estimateSizeSavings({ ...BASE, encodedSegmentBytes: 100_200 })!;
    expect(describeSavings(est)).toBe("about the same size");
  });

  it("keeps a decimal place on percentages small enough for one to matter", () => {
    expect(fmtPct(0.0625)).toBe("6.3%");
    expect(fmtPct(0.62)).toBe("62%");
    expect(fmtPct(0.005)).toBe("0.5%");
    expect(fmtPct(1)).toBe("100%");
  });
});

describe("fmtChangeFactor", () => {
  it("states a shrink as a reduction factor", () => {
    expect(fmtChangeFactor(0.5)).toBe("2.0× reduction");
    expect(fmtChangeFactor(0.05)).toBe("20× reduction");
  });

  it("states a growth as an inflation factor", () => {
    expect(fmtChangeFactor(1.3)).toBe("1.3× inflation");
  });

  // Where a percentage flattens out is exactly where the factor separates: 90% and 95% smaller are
  // 10× and 20×, one file twice the size of the other.
  it("keeps the deep end apart, where percentages crowd together", () => {
    expect(fmtChangeFactor(0.1)).toBe("10× reduction");
    expect(fmtChangeFactor(0.05)).toBe("20× reduction");
  });

  it("drops the decimal once the digits before it carry the number", () => {
    expect(fmtChangeFactor(0.09)).toBe("11× reduction");
    expect(fmtChangeFactor(0.4)).toBe("2.5× reduction");
  });

  it("says so plainly when nothing changed", () => {
    expect(fmtChangeFactor(1)).toBe("1× (no change)");
  });

  it("has nothing to state for a ratio no encode could produce", () => {
    expect(fmtChangeFactor(0)).toBe("–");
    expect(fmtChangeFactor(NaN)).toBe("–");
  });
});

describe("pickSampleWindows", () => {
  // One stretch is the same stratified draw with one band, so it can land anywhere in the file.
  it("places a single stretch anywhere in the file", () => {
    const starts = new Set<number>();
    for (let i = 0; i < 40; i++) {
      const [only] = pickSampleWindows(100, 3, 1);
      expect(only.seconds).toBe(3);
      expect(only.startSeconds).toBeGreaterThanOrEqual(0);
      expect(only.startSeconds).toBeLessThanOrEqual(97);
      starts.add(only.startSeconds);
    }
    // Not pinned to one spot, which is the whole difference from a start field.
    expect(starts.size).toBeGreaterThan(1);
  });

  // Stratified, so the stretches cover the file end to end instead of clumping wherever the draws
  // happened to land.
  it("draws one stretch inside each equal band of the file", () => {
    const windows = pickSampleWindows(100, 4, 4);
    expect(windows).toHaveLength(4);
    windows.forEach((w, i) => {
      expect(w.startSeconds).toBeGreaterThanOrEqual(i * 25);
      expect(w.startSeconds).toBeLessThanOrEqual((i + 1) * 25);
      expect(w.seconds).toBe(4);
    });
  });

  it("never runs a stretch off the end of the file", () => {
    for (const w of pickSampleWindows(10, 3, 5)) {
      expect(w.startSeconds + w.seconds).toBeLessThanOrEqual(10.0001);
    }
  });

  it("asks for no more stretches than the file has room for", () => {
    expect(pickSampleWindows(10, 4, 8)).toHaveLength(2);
  });

  it("has nothing to sample from a file with no duration", () => {
    expect(pickSampleWindows(0, 3, 2)).toEqual([]);
  });
});

describe("estimateSizeSavings over several windows", () => {
  const base = {
    originalTotalBytes: 1_000_000,
    totalSeconds: 100,
    segmentStartSeconds: 0,
    segmentSeconds: 10,
  };

  it("sums the sampled seconds and reports how many places they came from", () => {
    const est = estimateSizeSavings({
      ...base,
      windows: [
        { startSeconds: 0, seconds: 10 },
        { startSeconds: 50, seconds: 10 },
      ],
      encodedSegmentBytes: 100_000,
    })!;
    expect(est.segmentSeconds).toBe(20);
    expect(est.windowCount).toBe(2);
    expect(est.sampledFraction).toBe(0.2);
  });

  // Sampling a second stretch of the same length averages one unlucky window against another
  // instead of letting it be the whole measurement, so the projection's range tightens.
  it("narrows the band when a run samples more places", () => {
    // Frame sizes climb across the file, so its ten-second windows genuinely differ from each other
    // and there is a spread for the band to be derived from.
    const samples = Array.from({ length: 100 }, (_, i) => ({
      offset: 0,
      size: 1_000 + i * 500,
      cts: i,
      dts: i,
      ctsSec: i,
      dtsSec: i,
      is_sync: i % 10 === 0,
      duration: 1,
    }));
    const width = (r: { low: number; high: number } | null): number => (r ? r.high - r.low : 0);
    const one = estimateSizeSavings({
      ...base,
      windows: [{ startSeconds: 0, seconds: 10 }],
      encodedSegmentBytes: 50_000,
      samples,
    })!;
    const three = estimateSizeSavings({
      ...base,
      windows: [
        { startSeconds: 0, seconds: 10 },
        { startSeconds: 40, seconds: 10 },
        { startSeconds: 80, seconds: 10 },
      ],
      encodedSegmentBytes: 150_000,
      samples,
    })!;
    expect(one.projectedRange).not.toBeNull();
    expect(three.projectedRange).not.toBeNull();
    expect(width(three.projectedRange)).toBeLessThan(width(one.projectedRange));
  });

  it("falls back to the single window when no list is given", () => {
    const est = estimateSizeSavings({ ...base, encodedSegmentBytes: 50_000 })!;
    expect(est.windowCount).toBe(1);
    expect(est.segmentSeconds).toBe(10);
  });
});

describe("windowsForRun", () => {
  const kept = [
    { startSeconds: 10, seconds: 3 },
    { startSeconds: 60, seconds: 3 },
  ];

  // Two settings are only comparable if they were measured over the same seconds, so a re-run at
  // another CRF keeps the last run's stretches (which are also still cut and waiting).
  it("keeps the stretches when the run asks for the same shape", () => {
    expect(windowsForRun(kept, 100, 3, 2)).toBe(kept);
  });

  it("draws fresh ones when the length changes", () => {
    expect(windowsForRun(kept, 100, 5, 2)).not.toBe(kept);
  });

  it("draws fresh ones when the count changes", () => {
    const drawn = windowsForRun(kept, 100, 3, 3);
    expect(drawn).not.toBe(kept);
    expect(drawn).toHaveLength(3);
  });

  // A single stretch is kept for the same reason several are: two settings are only comparable
  // measured over the same seconds, and nothing about the fields says where it should be.
  it("keeps a single stretch across runs too", () => {
    const one = [{ startSeconds: 10, seconds: 3 }];
    expect(windowsForRun(one, 100, 3, 1)).toBe(one);
  });

  it("snaps drawn starts onto what the source can be cut at", () => {
    const snap = (t: number): number => Math.floor(t / 10) * 10;
    for (const w of windowsForRun([], 100, 3, 4, snap)) {
      expect(w.startSeconds % 10).toBe(0);
    }
  });
});
