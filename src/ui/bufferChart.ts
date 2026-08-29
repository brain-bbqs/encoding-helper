// The playback-buffer plot: how many seconds of video are already downloaded ahead of the playhead,
// across the whole of playback, for one link speed.
//
// It is the picture the low-bandwidth question actually has: a healthy stream climbs away from zero
// and stays there, while a stream the link cannot keep up with sags toward the axis and touches it
// at every freeze. Drawn as an area against zero for that reason — the distance to the baseline is
// the reading, and the baseline is the failure. Stalls are marked where they land rather than left
// to be inferred from the dips. Colors are CSS variables set in style.css, so it follows the theme.

import { svgEl } from "../lib/dom";
import type { PlaybackSimulation } from "../lib/playbackSim";
import { fmtPlaybackTime, niceAxisMax } from "./bitrateChart";

const W = 600;
const H = 260;
const ML = 64;
const MR = 16;
const MT = 16;
const MB = 40;
const PLOT_W = W - ML - MR;
const PLOT_H = H - MT - MB;
const STEPS = 4;

/** Enough decimals to write the (already round) tick step exactly, and no more. */
function tickDecimals(step: number): number {
  if (step >= 1) return 0;
  return step >= 0.1 ? 1 : 2;
}

function text(cls: string, attrs: Record<string, string | number>, content: string): SVGTextElement {
  const el = svgEl("text", { class: cls, ...attrs });
  el.textContent = content;
  return el;
}

/** Seconds, at the precision a buffer level is worth reading to. */
function fmtBuffered(sec: number): string {
  return sec >= 10 ? sec.toFixed(0) + " s" : sec.toFixed(1) + " s";
}

/**
 * Null where there is no shape to draw: a simulation whose buffer never moves off zero (a link so
 * slow that every frame is waited for) has nothing an area chart can say that the stall count has
 * not already said.
 */
export function renderBufferChart(sim: PlaybackSimulation, durationSec: number): SVGSVGElement | null {
  if (sim.buffer.length < 2 || !(durationSec > 0) || !(sim.peakBufferSec > 0)) return null;

  const maxY = niceAxisMax(sim.peakBufferSec, STEPS);
  const xScale = (t: number): number => ML + (Math.min(t, durationSec) / durationSec) * PLOT_W;
  const yScale = (sec: number): number => MT + PLOT_H - (sec / maxY) * PLOT_H;

  const svg = svgEl("svg", {
    viewBox: `0 0 ${W} ${H}`,
    class: "buffer-chart",
    role: "img",
    "aria-label":
      `Area chart of how many seconds of video are buffered ahead of the playhead through playback, ` +
      `at ${(sim.linkBitrateBps / 1e6).toFixed(2)} Mbps. ` +
      (sim.smooth
        ? `The buffer never empties, peaking at ${fmtBuffered(sim.peakBufferSec)}.`
        : `The buffer empties ${sim.stalls.length} time${sim.stalls.length === 1 ? "" : "s"}, ` +
          `stalling playback for ${fmtBuffered(sim.stalledSec)} in total.`),
  });

  const decimals = tickDecimals(maxY / STEPS);
  for (let i = 0; i <= STEPS; i++) {
    const gx = ML + (PLOT_W * i) / STEPS;
    const gy = MT + (PLOT_H * i) / STEPS;
    svg.append(svgEl("line", { class: "grid-line", x1: gx, y1: MT, x2: gx, y2: MT + PLOT_H, "stroke-width": 1 }));
    svg.append(svgEl("line", { class: "grid-line", x1: ML, y1: gy, x2: ML + PLOT_W, y2: gy, "stroke-width": 1 }));
    svg.append(
      text(
        "tick",
        { x: gx, y: MT + PLOT_H + 16, "font-size": 10, "text-anchor": "middle" },
        fmtPlaybackTime((durationSec * i) / STEPS, durationSec),
      ),
    );
    svg.append(
      text(
        "tick",
        { x: ML - 8, y: MT + PLOT_H - (PLOT_H * i) / STEPS + 3, "font-size": 10, "text-anchor": "end" },
        ((maxY * i) / STEPS).toFixed(decimals),
      ),
    );
  }
  svg.append(svgEl("line", { class: "axis", x1: ML, y1: MT, x2: ML, y2: MT + PLOT_H, "stroke-width": 1 }));
  svg.append(
    svgEl("line", { class: "axis", x1: ML, y1: MT + PLOT_H, x2: ML + PLOT_W, y2: MT + PLOT_H, "stroke-width": 1 }),
  );
  svg.append(
    text(
      "axis-title",
      { x: ML + PLOT_W / 2, y: H - 4, "font-size": 11, "text-anchor": "middle" },
      durationSec < 60 ? "Playback time" : "Playback time (m:ss)",
    ),
  );
  svg.append(
    text(
      "axis-title",
      {
        x: 12,
        y: MT + PLOT_H / 2,
        "font-size": 11,
        "text-anchor": "middle",
        transform: `rotate(-90 12 ${MT + PLOT_H / 2})`,
      },
      "Buffered ahead (s)",
    ),
  );

  const line = sim.buffer
    .map((p, i) => `${i === 0 ? "M" : "L"}${xScale(p.mediaSec)},${yScale(p.bufferedSec)}`)
    .join(" ");
  const baseline = yScale(0);
  const lastX = xScale(sim.buffer[sim.buffer.length - 1].mediaSec);
  const firstX = xScale(sim.buffer[0].mediaSec);
  svg.append(svgEl("path", { class: "area", d: `${line} L${lastX},${baseline} L${firstX},${baseline} Z` }));
  svg.append(svgEl("path", { class: "line", d: line, fill: "none", "stroke-width": 2 }));

  // Every freeze marked where it happens, so a dip that reaches the axis is told apart from one
  // that merely came close.
  for (const stall of sim.stalls) {
    const x = xScale(stall.atMediaSec);
    const g = svgEl("g", { class: "stall" });
    const title = svgEl("title");
    title.textContent = `stall at ${fmtPlaybackTime(stall.atMediaSec, durationSec)}  ·  ${fmtBuffered(stall.seconds)} frozen`;
    g.append(title);
    g.append(svgEl("line", { class: "stall-mark", x1: x, y1: MT, x2: x, y2: MT + PLOT_H, "stroke-width": 1.5 }));
    g.append(svgEl("circle", { class: "stall-dot", cx: x, cy: baseline, r: 3.5, "stroke-width": 2 }));
    svg.append(g);
  }

  // Hover layer: one band per plotted point, so the pointer finds a moment anywhere in its column.
  const bandW = Math.max(1, PLOT_W / sim.buffer.length);
  for (const p of sim.buffer) {
    const cx = xScale(p.mediaSec);
    const g = svgEl("g", { class: "bin" });
    const title = svgEl("title");
    title.textContent = `${fmtPlaybackTime(p.mediaSec, durationSec)}  ·  ${fmtBuffered(p.bufferedSec)} buffered`;
    g.append(title);
    g.append(svgEl("rect", { class: "band", x: cx - bandW / 2, y: MT, width: bandW, height: PLOT_H }));
    g.append(svgEl("line", { class: "cross", x1: cx, y1: MT, x2: cx, y2: MT + PLOT_H, "stroke-width": 1 }));
    g.append(svgEl("circle", { class: "dot", cx, cy: yScale(p.bufferedSec), r: 3.5, "stroke-width": 2 }));
    svg.append(g);
  }
  return svg;
}
