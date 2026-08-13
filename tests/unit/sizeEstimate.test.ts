import { describe, expect, it } from "vitest";
import {
  describeSavings,
  estimateSizeSavings,
  fmtPct,
  fmtSignedChange,
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
