import { describe, expect, it } from "vitest";
import { evenSamples, sample } from "../fixtures/samples";
import { computeBitrateTimeline } from "../../src/lib/bitrateTimeline";
import type { SampleInfo } from "../../src/lib/types";
import { niceAxisMax, renderBitrateChart } from "../../src/ui/bitrateChart";

function samples(count: number, durationSec: number, size: (i: number) => number): SampleInfo[] {
  return evenSamples(count, durationSec, size);
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

  it("keeps a step that is already a power of ten", () => {
    expect(niceAxisMax(400, 4)).toBe(400);
    expect(niceAxisMax(4_000_000, 4)).toBe(4_000_000);
  });
});

describe("renderBitrateChart", () => {
  const timeline = computeBitrateTimeline(
    samples(600, 30, (i) => (i < 300 ? 1_000 : 5_000)),
    30,
  )!;

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

/** The text of every element of `cls` in the chart, in document order. */
function texts(svg: SVGSVGElement, cls: string): (string | null)[] {
  return Array.from(svg.querySelectorAll(cls)).map((el) => el.textContent);
}

/** The vertical tick labels, read bottom to top. */
function yTicks(svg: SVGSVGElement): (string | null)[] {
  return texts(svg, ".tick").filter((_, i) => i % 2 === 1);
}

function xTicks(svg: SVGSVGElement): (string | null)[] {
  return texts(svg, ".tick").filter((_, i) => i % 2 === 0);
}

// The vertical axis picks whichever unit keeps its tick numbers short, and writes only the decimals
// the (already round) step needs.
describe("renderBitrateChart vertical axis", () => {
  // 600 frames over 30 s is 20 fps, so a frame of `bytes` reads as 160 × bytes bps.
  const chartOf = (bytes: (i: number) => number, count = 600, durationSec = 30): SVGSVGElement =>
    renderBitrateChart(computeBitrateTimeline(samples(count, durationSec, bytes), durationSec)!);

  it("reads in megabits once the axis top reaches a million", () => {
    const svg = chartOf(() => 100_000);
    expect(texts(svg, ".axis-title")).toContain("Bitrate (Mbps)");
    expect(yTicks(svg)).toEqual(["0", "5", "10", "15", "20"]);
  });

  it("reads in plain bits per second below a thousand", () => {
    const svg = chartOf(() => 1);
    expect(texts(svg, ".axis-title")).toContain("Bitrate (bps)");
    expect(yTicks(svg)).toEqual(["0", "50", "100", "150", "200"]);
  });

  it("writes one decimal when the step needs it", () => {
    // 1.6 Mbps tops out at 2 Mbps, ticking every half a megabit.
    const svg = chartOf(() => 10_000);
    expect(yTicks(svg)).toEqual(["0.0", "0.5", "1.0", "1.5", "2.0"]);
  });

  it("writes two decimals when the step needs them", () => {
    // A byte every 50 s over 240 windows of 100 s: 0.16 bps, topping out at 0.2 in steps of 0.05.
    const svg = chartOf(() => 1, 480, 24_000);
    expect(yTicks(svg)).toEqual(["0.00", "0.05", "0.10", "0.15", "0.20"]);
  });

  // The average line's label sits above the line unless that would push it off the top of the plot.
  it("drops the average label below its line when the average sits near the top", () => {
    const svg = chartOf(() => 4_900);
    const line = svg.querySelector(".avg-line")!;
    const label = svg.querySelector(".avg-label")!;
    expect(Number(label.getAttribute("y"))).toBeGreaterThan(Number(line.getAttribute("y1")));
  });

  it("keeps the average label above its line when there is room", () => {
    const svg = chartOf((i) => (i < 300 ? 1_000 : 5_000));
    const line = svg.querySelector(".avg-line")!;
    const label = svg.querySelector(".avg-label")!;
    expect(Number(label.getAttribute("y"))).toBeLessThan(Number(line.getAttribute("y1")));
  });
});

// Plain seconds stop being readable at a glance past a minute, so the time axis switches to m:ss
// there; below it, a decimal appears only where the ticks would otherwise round unevenly.
describe("renderBitrateChart time axis", () => {
  const chartOf = (durationSec: number): SVGSVGElement =>
    renderBitrateChart(
      computeBitrateTimeline(
        samples(durationSec * 20, durationSec, () => 1_000),
        durationSec,
      )!,
    );

  it("ticks whole seconds when the quarter marks land on them", () => {
    const svg = chartOf(40);
    expect(xTicks(svg)).toEqual(["0s", "10s", "20s", "30s", "40s"]);
    expect(texts(svg, ".axis-title")).toContain("Playback time");
  });

  it("ticks tenths of a second when the quarter marks fall between them", () => {
    expect(xTicks(chartOf(30))).toEqual(["0.0s", "7.5s", "15.0s", "22.5s", "30.0s"]);
  });

  it("ticks minutes and seconds past a minute", () => {
    const svg = chartOf(120);
    expect(xTicks(svg)).toEqual(["0:00", "0:30", "1:00", "1:30", "2:00"]);
    expect(texts(svg, ".axis-title")).toContain("Playback time (m:ss)");
  });

  it("rolls the minute over rather than printing sixty seconds", () => {
    // 239 s quarters at 59.75 s, which rounds up to a whole minute.
    expect(xTicks(chartOf(239))).toEqual(["0:00", "1:00", "2:00", "2:59", "3:59"]);
  });
});

describe("renderBitrateChart tooltips", () => {
  it("counts a lone frame in the singular", () => {
    // Twenty-four frames over 12 s bin into twelve windows; the last window is left with one frame.
    const frames = Array.from({ length: 23 }, (_, i) => sample(i * 0.5, 1_000));
    frames.push(sample(0.1, 1_000));
    const svg = renderBitrateChart(computeBitrateTimeline(frames, 12)!);
    const titles = texts(svg, ".bin title");
    expect(titles[titles.length - 1]).toContain("1 frame");
    expect(titles[titles.length - 1]).not.toContain("frames");
    expect(titles[0]).toContain("3 frames");
  });
});
