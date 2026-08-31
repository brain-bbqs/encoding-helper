// The estimated-data-savings readout under Compare Quality: a headline strip that goes above the
// panes, and the detail block that follows the comparison.
//
// Two bars on one shared scale rather than two numbers to subtract, because the question the tab is
// really being asked ("is this setting worth it?") is a comparison, and a comparison is what a
// reader takes off a pair of bars at a glance. The projection's range is drawn on the bar it belongs
// to instead of only being spelled out beside it: an estimate from a few seconds of a long file has
// a width, and a bar with a hard end would claim it does not.

import { gridItem, h } from "../lib/dom";
import { fmtBytes, fmtDur } from "../lib/format";
import { describeSavings, fmtChangeFactor, fmtPct, fmtSignedChange, type SizeEstimate } from "../lib/sizeEstimate";

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
    bandEl.title = `Anywhere from ${fmtBytes(band.low)} to ${fmtBytes(band.high)}`;
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
  // Two readings of the one change, side by side: the percentage carries the shallow end, where a
  // factor hugs 1, and the factor carries the deep end, where 90% and 95% smaller read as
  // neighbours but are 10× and 20×.
  figure.append(
    h("div", "savings-headline" + (grew ? " grew" : ""), describeSavings(est)),
    h("div", "savings-factor", fmtChangeFactor(est.ratio)),
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

/**
 * The numbers behind the headline. How the estimate is arrived at, and where it can be wrong, is
 * left to the ⓘ on the figures it bears on rather than spelled out in prose under them; the Full
 * Analysis document, which nobody can hover, still writes it out.
 */
export function renderSavingsDetail(est: SizeEstimate): HTMLElement[] {
  const g = h("div", "grid");
  // Two lines, in the order the estimate is arrived at: what was measured, then what it projects to.
  // Six figures never fit one line anyway, so the break is put where it means something rather than
  // wherever the last card stopped fitting.
  g.append(
    gridItem(
      "Sampled",
      `${fmtDur(est.segmentSeconds)} of ${fmtDur(est.totalSeconds)} (${fmtPct(est.sampledFraction)})` +
        (est.windowCount > 1 ? `, in ${est.windowCount} places` : ""),
      { sm: true },
    ),
    gridItem("Original Segment Size", fmtBytes(est.originalSegmentBytes)),
    gridItem("Segment Change", `${fmtSignedChange(est)} (${fmtChangeFactor(est.ratio)})`),
    h("div", "grid-break"),
    gridItem("Original File Size", fmtBytes(est.originalTotalBytes)),
    gridItem("Projected Full File", fmtBytes(est.projectedTotalBytes)),
  );
  if (est.projectedRange) {
    g.append(
      gridItem("Projected Range", `${fmtBytes(est.projectedRange.low)} – ${fmtBytes(est.projectedRange.high)}`, {
        sm: true,
      }),
    );
  }

  return [h("h3", null, "Estimate Detail"), g];
}
