// The instantaneous-bitrate plot: one step per time window, drawn from a BitrateTimeline.
//
// A single series over time, so it is a step area chart against a zero baseline — the windows are
// buckets rather than sampled instants, and a step says that where a smoothed curve would invent
// values between them. The one reference mark is the track average, dashed, which is what makes the
// plot answer the question the average alone cannot: how far the rate strays from it, and where.
// Colors are CSS variables set in style.css, so the plot follows the light/dark theme.

import { svgEl, svgText } from "../lib/dom";
import type { BitrateTimeline } from "../lib/bitrateTimeline";
import { fmtBits } from "../lib/format";

const W = 600;
const H = 260;
const ML = 64;
const MR = 16;
const MT = 16;
const MB = 40;
const PLOT_W = W - ML - MR;
const PLOT_H = H - MT - MB;
const PLOT_BOTTOM = MT + PLOT_H;
const PLOT_RIGHT = ML + PLOT_W;
const STEPS = 4;

/**
 * The smallest top-of-axis at or above `peak` that divides into `STEPS` round ticks, so the axis
 * reads 0 / 200 / 400 / 600 / 800 rather than 0 / 200 / 400 / 601 / 801.
 */
export function niceAxisMax(peak: number, steps: number): number {
  if (!(peak > 0)) return 1;
  const rawStep = peak / steps;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;
  return step * steps;
}

interface RateUnit {
  divisor: number;
  label: string;
}

function rateUnit(maxBitrate: number): RateUnit {
  if (maxBitrate >= 1e6) return { divisor: 1e6, label: "Mbps" };
  if (maxBitrate >= 1e3) return { divisor: 1e3, label: "kbps" };
  return { divisor: 1, label: "bps" };
}

/** Enough decimals to write the (already round) tick step exactly, and no more. */
function tickDecimals(step: number): number {
  const isWhole = (n: number): boolean => Math.abs(n - Math.round(n)) < 1e-9;
  if (isWhole(step)) return 0;
  if (isWhole(step * 10)) return 1;
  return 2;
}

/**
 * m:ss past a minute, where plain seconds stop being readable at a glance; below that, seconds with
 * a decimal only where the ticks would otherwise round to uneven numbers (7.5s reading as "8s").
 */
function fmtTime(sec: number, durationSec: number): string {
  if (durationSec < 60) {
    const decimals = Number.isInteger(durationSec / STEPS) ? 0 : 1;
    return sec.toFixed(decimals) + "s";
  }
  const m = Math.floor(sec / 60);
  const s = Math.round(sec - m * 60);
  // Rounding 59.7s up must roll the minute over rather than print "0:60".
  return s === 60 ? `${m + 1}:00` : `${m}:${String(s).padStart(2, "0")}`;
}

export function renderBitrateChart(timeline: BitrateTimeline): SVGSVGElement {
  const { bins } = timeline;
  const durationSec = bins[bins.length - 1].endSec;
  const maxY = niceAxisMax(timeline.peakBitrate, STEPS);
  const unit = rateUnit(maxY);
  const xScale = (t: number): number => ML + (t / durationSec) * PLOT_W;
  const yScale = (bps: number): number => PLOT_BOTTOM - (bps / maxY) * PLOT_H;

  const svg = svgEl("svg", {
    viewBox: `0 0 ${W} ${H}`,
    class: "bitrate-chart",
    role: "img",
    "aria-label":
      `Step area chart of video bitrate over time, one step per ${timeline.binSeconds.toFixed(2)} second window. ` +
      `Average ${fmtBits(timeline.averageBitrate)}, peak ${fmtBits(timeline.peakBitrate)}, ` +
      `lowest ${fmtBits(timeline.minBitrate)}.`,
  });

  appendAxes(svg, durationSec, maxY, unit);

  // One horizontal run per window, joined by the vertical jumps between them.
  const steps = bins
    .map(
      (b, i) =>
        `${i === 0 ? "M" : "L"}${xScale(b.startSec)},${yScale(b.bitrate)} L${xScale(b.endSec)},${yScale(b.bitrate)}`,
    )
    .join(" ");
  const baseline = yScale(0);
  svg.append(svgEl("path", { class: "area", d: `${steps} L${PLOT_RIGHT},${baseline} L${ML},${baseline} Z` }));
  svg.append(svgEl("path", { class: "line", d: steps, fill: "none", "stroke-width": 2 }));

  const yAvg = yScale(timeline.averageBitrate);
  svg.append(
    svgEl("line", {
      class: "avg-line",
      x1: ML,
      y1: yAvg,
      x2: PLOT_RIGHT,
      y2: yAvg,
      "stroke-width": 1.5,
      "stroke-dasharray": "5 4",
    }),
  );
  // Sits above its line, except where that would push it off the top of the plot.
  const labelAbove = yAvg - 6 > MT + 8;
  svg.append(
    svgText(
      "avg-label",
      { x: PLOT_RIGHT - 2, y: labelAbove ? yAvg - 6 : yAvg + 14, "font-size": 10, "text-anchor": "end" },
      `average ${fmtBits(timeline.averageBitrate)}`,
    ),
  );

  appendHoverLayer(svg, bins, durationSec, xScale, yScale);
  return svg;
}

/** The grid lines, tick labels, the two axes and their titles. */
function appendAxes(svg: SVGSVGElement, durationSec: number, maxY: number, unit: RateUnit): void {
  const decimals = tickDecimals(maxY / unit.divisor / STEPS);
  for (let i = 0; i <= STEPS; i++) {
    const gx = ML + (PLOT_W * i) / STEPS;
    const gy = MT + (PLOT_H * i) / STEPS;
    svg.append(svgEl("line", { class: "grid-line", x1: gx, y1: MT, x2: gx, y2: PLOT_BOTTOM, "stroke-width": 1 }));
    svg.append(svgEl("line", { class: "grid-line", x1: ML, y1: gy, x2: PLOT_RIGHT, y2: gy, "stroke-width": 1 }));
    svg.append(
      svgText(
        "tick",
        { x: gx, y: PLOT_BOTTOM + 16, "font-size": 10, "text-anchor": "middle" },
        fmtTime((durationSec * i) / STEPS, durationSec),
      ),
    );
    svg.append(
      svgText(
        "tick",
        { x: ML - 8, y: PLOT_BOTTOM - (PLOT_H * i) / STEPS + 3, "font-size": 10, "text-anchor": "end" },
        ((maxY * i) / STEPS / unit.divisor).toFixed(decimals),
      ),
    );
  }
  svg.append(svgEl("line", { class: "axis", x1: ML, y1: MT, x2: ML, y2: PLOT_BOTTOM, "stroke-width": 1 }));
  svg.append(
    svgEl("line", { class: "axis", x1: ML, y1: PLOT_BOTTOM, x2: PLOT_RIGHT, y2: PLOT_BOTTOM, "stroke-width": 1 }),
  );
  svg.append(
    svgText(
      "axis-title",
      { x: ML + PLOT_W / 2, y: H - 4, "font-size": 11, "text-anchor": "middle" },
      durationSec < 60 ? "Playback time" : "Playback time (m:ss)",
    ),
  );
  svg.append(
    svgText(
      "axis-title",
      {
        x: 12,
        y: MT + PLOT_H / 2,
        "font-size": 11,
        "text-anchor": "middle",
        transform: `rotate(-90 12 ${MT + PLOT_H / 2})`,
      },
      `Bitrate (${unit.label})`,
    ),
  );
}

/**
 * Hover layer: a full-height band per window, so the pointer finds a window anywhere in the column
 * rather than only on the step itself, with the native tooltip carrying its numbers.
 */
function appendHoverLayer(
  svg: SVGSVGElement,
  bins: BitrateTimeline["bins"],
  durationSec: number,
  xScale: (t: number) => number,
  yScale: (bps: number) => number,
): void {
  for (const b of bins) {
    const x = xScale(b.startSec);
    const w = Math.max(1, xScale(b.endSec) - x);
    const cx = x + w / 2;
    const g = svgEl("g", { class: "bin" });
    const title = svgEl("title");
    title.textContent =
      `${fmtTime(b.startSec, durationSec)}–${fmtTime(b.endSec, durationSec)}  ·  ${fmtBits(b.bitrate)}  ·  ` +
      `${b.sampleCount} frame${b.sampleCount === 1 ? "" : "s"}`;
    g.append(title);
    g.append(svgEl("rect", { class: "band", x, y: MT, width: w, height: PLOT_H }));
    g.append(svgEl("line", { class: "cross", x1: cx, y1: MT, x2: cx, y2: PLOT_BOTTOM, "stroke-width": 1 }));
    g.append(svgEl("circle", { class: "dot", cx, cy: yScale(b.bitrate), r: 3.5, "stroke-width": 2 }));
    svg.append(g);
  }
}
