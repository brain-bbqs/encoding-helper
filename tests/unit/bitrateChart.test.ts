import { describe, expect, it } from "vitest";
import { computeBitrateTimeline } from "../../src/lib/bitrateTimeline";
import type { SampleInfo } from "../../src/lib/types";
import { niceAxisMax, renderBitrateChart } from "../../src/ui/bitrateChart";

function samples(count: number, durationSec: number, size: (i: number) => number): SampleInfo[] {
  return Array.from({ length: count }, (_, i) => ({
    offset: 0,
    size: size(i),
    cts: 0,
    dts: 0,
    ctsSec: (durationSec * i) / count,
    dtsSec: (durationSec * i) / count,
    is_sync: false,
    duration: 1,
  }));
}

describe("niceAxisMax", () => {
  it("rounds up to a top that divides into round ticks", () => {
    // The sample video's peak: 741,376 over 4 steps would tick 185,344 apiece.
    expect(niceAxisMax(741_376, 4)).toBe(800_000);
    expect(niceAxisMax(240_000, 4)).toBe(400_000);
    expect(niceAxisMax(4_100_000, 4)).toBe(8_000_000);
  });

  it("never lands below the peak it has to fit", () => {
    for (const peak of [1, 7, 99, 1234, 565_109, 12_345_678]) {
      expect(niceAxisMax(peak, 4)).toBeGreaterThanOrEqual(peak);
    }
  });

  it("leaves an axis for a peak of zero rather than dividing by it", () => {
    expect(niceAxisMax(0, 4)).toBe(1);
  });
});

describe("renderBitrateChart", () => {
  const timeline = computeBitrateTimeline(samples(600, 30, (i) => (i < 300 ? 1_000 : 5_000)), 30)!;

  it("draws one hover band per window", () => {
    expect(renderBitrateChart(timeline).querySelectorAll(".bin").length).toBe(timeline.bins.length);
  });

  it("draws the data as one step path plus its filled area", () => {
    const svg = renderBitrateChart(timeline);
    expect(svg.querySelectorAll("path.line").length).toBe(1);
    expect(svg.querySelectorAll("path.area").length).toBe(1);
  });

  it("names what it plots for a screen reader", () => {
    const label = renderBitrateChart(timeline).getAttribute("aria-label") ?? "";
    expect(label).toContain("bitrate over time");
    expect(label).toContain("peak");
  });

  it("gives every window a tooltip carrying its rate and frame count", () => {
    const first = renderBitrateChart(timeline).querySelector(".bin title")?.textContent ?? "";
    expect(first).toContain("kbps");
    expect(first).toContain("frames");
  });
});
