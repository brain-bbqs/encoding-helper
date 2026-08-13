// The estimated-data-savings readout under Compare Quality: a headline strip that goes above the
// panes, and the detail block that follows the comparison.
//
// Two bars on one shared scale rather than two numbers to subtract, because the question the tab is
// really being asked ("is this setting worth it?") is a comparison, and a comparison is what a
// reader takes off a pair of bars at a glance. The projection's range is drawn on the bar it belongs
// to instead of only being spelled out beside it: an estimate from a few seconds of a long file has
// a width, and a bar with a hard end would claim it does not.

import { gridItem, h, teachBox } from "../lib/dom";
import {
  ORIGINAL_SEGMENT_INFO,
  PROJECTED_SIZE_INFO,
  SAMPLED_WINDOW_INFO,
  SIZE_SAVINGS_INTRO,
  sizeEstimateTeach,
} from "../lib/explainers";
import { fmtBytes, fmtDur } from "../lib/format";
import { describeSavings, fmtPct, fmtSignedChange, type SizeEstimate } from "../lib/sizeEstimate";

/** Under this the two projections differ by less than the byte figures beside them would show. */
const NEGLIGIBLE_BYTES = 1024;

/** One bar on the shared scale, optionally carrying the band its value could land anywhere in. */
export function savingsBar(
  label: string,
  bytes: number,
  maxBytes: number,
  fillClass: string,
  band: { low: number; high: number } | null = null,
): HTMLDivElement {
  const row = h("div", "savings-row");
  row.append(h("span", "savings-label", label));
  const track = h("div", "savings-track");
  const fill = h("div", "savings-fill " + fillClass);
  fill.style.width = pct(bytes, maxBytes) + "%";
  track.append(fill);
  if (band) {
    const bandEl = h("div", "savings-band");
    const left = Number(pct(band.low, maxBytes));
    const right = Number(pct(band.high, maxBytes));
    bandEl.style.left = left.toFixed(1) + "%";
    bandEl.style.width = Math.max(0, right - left).toFixed(1) + "%";
    bandEl.title = `Could land anywhere from ${fmtBytes(band.low)} to ${fmtBytes(band.high)}`;
    track.append(bandEl);
  }
  row.append(track, h("span", "savings-value", fmtBytes(bytes)));
  return row;
}

/** A share of the scale, clamped so a projection larger than the original cannot overrun its track. */
function pct(bytes: number, maxBytes: number): string {
  return (maxBytes > 0 ? Math.min(100, Math.max(0, (bytes / maxBytes) * 100)) : 0).toFixed(1);
}

/** The headline figure and the two-bar comparison, shown above the panes. */
export function renderSavingsStrip(est: SizeEstimate): HTMLDivElement {
  const wrap = h("div", "savings");
  const grew = est.savedFraction < 0;
  const figure = h("div", "savings-figure");
  figure.append(h("div", "savings-headline" + (grew ? " grew" : ""), describeSavings(est)));
  const delta = Math.abs(est.projectedSavedBytes);
  const across = `Projected across the whole ${fmtDur(est.totalSeconds)}: `;
  figure.append(
    h(
      "div",
      "savings-sub",
      delta < NEGLIGIBLE_BYTES
        ? across + "no meaningful change"
        : `${across}≈ ${fmtBytes(delta)} ${grew ? "added" : "saved"}`,
    ),
  );

  const bars = h("div", "savings-bars");
  const maxBytes = Math.max(est.originalTotalBytes, est.projectedTotalBytes, est.projectedRange?.high ?? 0);
  bars.append(
    savingsBar("Original file", est.originalTotalBytes, maxBytes, "original"),
    savingsBar("Projected", est.projectedTotalBytes, maxBytes, "projected", est.projectedRange),
  );
  wrap.append(figure, bars);
  return wrap;
}

/** The numbers behind the headline, then how it was arrived at and where it can be wrong. */
export function renderSavingsDetail(est: SizeEstimate): HTMLElement[] {
  const g = h("div", "grid");
  g.append(
    gridItem("Original Segment Size", fmtBytes(est.originalSegmentBytes), { info: ORIGINAL_SEGMENT_INFO }),
    gridItem("Segment Change", fmtSignedChange(est)),
    gridItem("Original File Size", fmtBytes(est.originalTotalBytes)),
    gridItem("Projected Full File", fmtBytes(est.projectedTotalBytes), { info: PROJECTED_SIZE_INFO }),
  );
  if (est.projectedRange) {
    g.append(
      gridItem("Projected Range", `${fmtBytes(est.projectedRange.low)} – ${fmtBytes(est.projectedRange.high)}`, {
        sm: true,
      }),
    );
  }
  g.append(
    gridItem(
      "Sampled",
      `${fmtDur(est.segmentSeconds)} of ${fmtDur(est.totalSeconds)} (${fmtPct(est.sampledFraction)})`,
      { info: SAMPLED_WINDOW_INFO, sm: true },
    ),
  );

  // The method and its limits sit behind a disclosure rather than in the teach box itself: a reader
  // deciding on a CRF needs the headline, and a reader doubting it needs several paragraphs.
  const teach = teachBox(SIZE_SAVINGS_INTRO);
  const more = h("details", "teach-more");
  more.append(h("summary", null, "How this estimate is made, and what it cannot know"));
  const body = h("div");
  body.innerHTML = sizeEstimateTeach(est);
  more.append(body);
  teach.append(more);

  return [h("h3", null, "Estimate Detail"), g, teach];
}
