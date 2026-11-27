// The frame both SVG charts are drawn in: a grid line and a tick label each way per step, then the
// two axes, then their titles. The bitrate chart and the seek scatter differ only in their height,
// left margin, tick text and titles, so the frame is built here once, with its elements and their
// attributes in the same order for both charts.

import { svgEl, svgText } from "@brain-bbqs/ui";

/** How wide both charts' viewBoxes are. Both stylesheets cap the two charts at this width, so at
 * full width a chart is drawn one unit to a pixel. */
export const CHART_WIDTH = 600;

/** How many steps both axes are cut into: five grid lines and five tick labels each way. */
export const AXIS_STEPS = 4;

/** Where a chart's plot sits inside its viewBox. */
export interface ChartGeometry {
  /** The viewBox's height. */
  H: number;
  /** The left margin, which the vertical tick labels and title sit in. */
  ML: number;
  /** The top margin. */
  MT: number;
  plotW: number;
  plotH: number;
}

/** What the frame says: the tick label at step `i` of each axis (0 at the origin), and the titles. */
export interface AxisText {
  xTick: (i: number) => string;
  yTick: (i: number) => string;
  xTitle: string;
  yTitle: string;
}

/** Appends the grid lines, tick labels, the two axes and their titles to `svg`. */
export function appendAxes(svg: SVGSVGElement, geometry: ChartGeometry, text: AxisText): void {
  const { H, ML, MT, plotW, plotH } = geometry;
  const plotBottom = MT + plotH;
  const plotRight = ML + plotW;
  for (let i = 0; i <= AXIS_STEPS; i++) {
    const gx = ML + (plotW * i) / AXIS_STEPS;
    const gy = MT + (plotH * i) / AXIS_STEPS;
    svg.append(svgEl("line", { class: "grid-line", x1: gx, y1: MT, x2: gx, y2: plotBottom, "stroke-width": 1 }));
    svg.append(svgEl("line", { class: "grid-line", x1: ML, y1: gy, x2: plotRight, y2: gy, "stroke-width": 1 }));
    svg.append(svgText("tick", { x: gx, y: plotBottom + 16, "font-size": 10, "text-anchor": "middle" }, text.xTick(i)));
    svg.append(
      svgText(
        "tick",
        { x: ML - 8, y: plotBottom - (plotH * i) / AXIS_STEPS + 3, "font-size": 10, "text-anchor": "end" },
        text.yTick(i),
      ),
    );
  }
  svg.append(svgEl("line", { class: "axis", x1: ML, y1: MT, x2: ML, y2: plotBottom, "stroke-width": 1 }));
  svg.append(
    svgEl("line", { class: "axis", x1: ML, y1: plotBottom, x2: plotRight, y2: plotBottom, "stroke-width": 1 }),
  );
  svg.append(
    svgText("axis-title", { x: ML + plotW / 2, y: H - 4, "font-size": 11, "text-anchor": "middle" }, text.xTitle),
  );
  svg.append(
    svgText(
      "axis-title",
      {
        x: 12,
        y: MT + plotH / 2,
        "font-size": 11,
        "text-anchor": "middle",
        transform: `rotate(-90 12 ${MT + plotH / 2})`,
      },
      text.yTitle,
    ),
  );
}
