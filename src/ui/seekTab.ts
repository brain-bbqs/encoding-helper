// The GOP/keyframe/B-frame structure and the empirical seeking test that measures it, with a
// keyframe-distance-vs-decode-time scatter plot — one card, the last section of the Inspect tab,
// since how a file seeks is a consequence of its GOP structure rather than a separate thing to
// go and look at.

import { fold, gridItem, h, svgEl, teachBox } from "../lib/dom";
import { GOP_TEACH, SEEK_TEST_INTRO } from "../lib/explainers";
import { fmtMs } from "../lib/format";
import { ensureMediabunny } from "../lib/mediabunny";
import { nearestKeyframeAtOrBefore } from "../lib/mp4boxParser";
import { state } from "../lib/state";
import type { SeekResult } from "../lib/types";

/** Caption for the GOP histogram, shared with the Full Analysis document. */

/**
 * How many timestamps a run samples unless the reader says otherwise. Enough of the file to make the
 * scatter a distribution rather than a handful of points, and still a run of a few seconds.
 */
const DEFAULT_SEEK_SAMPLES = 100;

/** Caption for the seeking scatter plot, shared with the Full Analysis document. */

export function renderSeekTab(panel: HTMLElement): void {
  const gop = state.gopLengths;
  const avgGop = gop.length ? gop.reduce((a, b) => a + b, 0) / gop.length : 0;
  const minGop = gop.length ? Math.min(...gop) : 0;
  const maxGop = gop.length ? Math.max(...gop) : 0;
  const fps = state.fps || 30;

  const sec = h("div", "section");
  sec.append(h("h2", null, "GOP / Keyframe Structure"));
  const g = h("div", "grid");
  g.append(
    gridItem("Total Frames", state.samples.length.toLocaleString()),
    gridItem("Keyframes", state.keyframeDecodeIndices.length.toLocaleString()),
    gridItem("Avg GOP", avgGop.toFixed(1) + " frames (" + (avgGop / fps).toFixed(2) + " s)"),
    gridItem("Min / Max GOP", `${minGop} / ${maxGop} frames`),
  );
  sec.append(g);
  const bBadge = h(
    "span",
    "badge " + (state.hasBFrames ? "info" : "good"),
    state.hasBFrames ? "Uses B-frames (cts ≠ dts)" : "No B-frames",
  );
  const bWrap = h("div");
  bWrap.style.margin = "10px 0";
  bWrap.append(bBadge);
  sec.append(bWrap);

  if (gop.length > 1) sec.append(renderGopHistogram(gop));
  // What a GOP is, under this file's own: the card leads with the measurement, like the others.
  sec.append(teachBox(GOP_TEACH, "🔑"));

  // The seeking test lives in the same card rather than one of its own: what nearest-keyframe
  // distance costs to seek to is the GOP structure's consequence, not a separate finding.
  sec.append(h("h3", null, "Empirical Seeking Test"));
  // Set as a teach box like every other explanation on the page, rather than as bare body text in
  // its own size.
  sec.append(teachBox(SEEK_TEST_INTRO, "⏱️"));
  const controls = h("div", "row");
  controls.style.marginTop = "10px";
  const nField = h("div", "field");
  nField.append(h("label", "field-label", "Sample Count"));
  const nInput = h("input");
  nInput.type = "number";
  nInput.min = "5";
  nInput.max = "200";
  nInput.value = String(DEFAULT_SEEK_SAMPLES);
  nInput.id = "seekN";
  nField.append(nInput);
  controls.append(nField);
  sec.append(controls);
  const runBtn = h("button", "btn", "Run Seeking Test");
  runBtn.type = "button";
  runBtn.id = "runSeekBtn";
  sec.append(runBtn);
  const seekProgress = h("div", "progress-wrap");
  seekProgress.style.display = "none";
  seekProgress.id = "seekProgress";
  seekProgress.append(h("div", "fill"));
  sec.append(seekProgress);
  const seekResultsWrap = h("div", "seek-results");
  seekResultsWrap.id = "seekResultsWrap";
  sec.append(seekResultsWrap);
  panel.append(sec);

  runBtn.addEventListener("click", () => {
    void runSeekingTest(runBtn, seekProgress, seekResultsWrap, parseInt(nInput.value, 10) || DEFAULT_SEEK_SAMPLES);
  });
}

async function runSeekingTest(
  btn: HTMLButtonElement,
  progress: HTMLDivElement,
  resultsWrap: HTMLDivElement,
  n: number,
): Promise<void> {
  const fill = progress.querySelector<HTMLDivElement>(".fill");
  btn.disabled = true;
  progress.style.display = "block";
  if (fill) fill.style.width = "0%";
  resultsWrap.innerHTML = "";
  try {
    const mb = await ensureMediabunny();
    if (!state.videoTrack) throw new Error("No video track loaded");
    const sink = new mb.CanvasSink(state.videoTrack, { poolSize: 2 });
    const duration = state.duration ?? 0;
    const results: SeekResult[] = [];
    for (let i = 0; i < n; i++) {
      const t = (duration * (i + 0.5)) / n;
      const kf = nearestKeyframeAtOrBefore(state.keyframeTimestampsSec, t);
      const dist = kf != null ? t - kf : null;
      const start = performance.now();
      await sink.getCanvas(t);
      const decodeMs = performance.now() - start;
      results.push({ t, kf, dist, distFrames: dist != null ? Math.round(dist * (state.fps || 30)) : null, decodeMs });
      if (fill) fill.style.width = ((i + 1) / n) * 100 + "%";
    }
    state.seekResults = results;
    renderSeekResults(resultsWrap, results);
  } catch (err) {
    console.error("[encoding-helper] seeking test failed:", err);
    const el = document.getElementById("errorMsg");
    if (el) {
      el.textContent = "Seeking test failed: " + (err instanceof Error ? err.message : String(err));
      el.style.display = "block";
    }
  } finally {
    btn.disabled = false;
    progress.style.display = "none";
  }
}

/**
 * One bar per keyframe interval, tall ones (over 1.5× the average) called out in the warning color
 * since those are the spans a seek lands furthest from a keyframe in. Exported for the Full
 * Analysis document; callers skip it below two intervals, where there is no distribution to show.
 */
export function renderGopHistogram(gopLengths: number[]): HTMLDivElement {
  const avgGop = gopLengths.reduce((a, b) => a + b, 0) / gopLengths.length;
  const maxLen = Math.max(...gopLengths);
  const hist = h("div", "hist");
  gopLengths.forEach((len) => {
    const bar = h("div", "bar" + (len > avgGop * 1.5 ? " tall" : ""));
    bar.style.height = Math.max(2, (len / maxLen) * 90) + "px";
    bar.title = len + " frames";
    hist.append(bar);
  });
  return hist;
}

function renderSeekResults(wrap: HTMLDivElement, results: SeekResult[]): void {
  wrap.innerHTML = "";
  const avgDist = results.reduce((a, r) => a + (r.dist || 0), 0) / results.length;
  const avgDecode = results.reduce((a, r) => a + r.decodeMs, 0) / results.length;
  const maxDecode = Math.max(...results.map((r) => r.decodeMs));
  const g = h("div", "grid");
  g.append(
    gridItem("Avg Keyframe Distance", avgDist.toFixed(3) + " s"),
    gridItem("Avg Decode Time", fmtMs(avgDecode)),
    gridItem("Max Decode Time", fmtMs(maxDecode)),
  );
  wrap.append(g);

  const scatter = renderSeekScatter(results);
  if (scatter) wrap.append(scatter);

  // The summary figures and the scatter above are what a run is read for; a hundred sampled
  // timestamps of raw rows underneath them would bury the next section, so the table folds away
  // behind a bar carrying its row count, like the output console and the sweep settings.
  const { wrap: tableFold, body: tableBody } = fold(
    "Sampled timestamps",
    `${results.length} row${results.length === 1 ? "" : "s"}`,
  );
  const scroll = h("div", "scroll-x");
  const table = h("table", "data");
  const thead = h("thead");
  const headRow = h("tr");
  ["Timestamp", "Nearest Keyframe ≤ t", "Distance", "Distance (frames)", "Decode Time"].forEach((t) =>
    headRow.append(h("th", null, t)),
  );
  thead.append(headRow);
  table.append(thead);
  const tbody = h("tbody");
  results.forEach((r) => {
    const tr = h("tr");
    tr.append(
      h("td", null, r.t.toFixed(3) + "s"),
      h("td", null, r.kf != null ? r.kf.toFixed(3) + "s" : "–"),
      h("td", null, r.dist != null ? r.dist.toFixed(3) + "s" : "–"),
      h("td", null, r.distFrames != null ? String(r.distFrames) : "–"),
      h("td", null, fmtMs(r.decodeMs)),
    );
    tbody.append(tr);
  });
  table.append(tbody);
  scroll.append(table);
  tableBody.append(scroll);
  wrap.append(tableFold);
}

// Scatter plot: keyframe distance (x) vs. decode time (y), one point per sampled timestamp. A
// single series, so no legend is needed — the section title and axis labels already say what's
// plotted. Exported so the Full Analysis document plots the same run rather than only tabulating it.
export function renderSeekScatter(results: SeekResult[]): SVGSVGElement | null {
  const pts = results.filter((r): r is SeekResult & { dist: number } => r.dist != null);
  if (pts.length < 2) return null;
  const W = 600;
  const H = 280;
  const ML = 56;
  const MR = 16;
  const MT = 16;
  const MB = 40;
  const plotW = W - ML - MR;
  const plotH = H - MT - MB;
  const maxX = Math.max(...pts.map((r) => r.dist)) * 1.08 || 1;
  const maxY = Math.max(...pts.map((r) => r.decodeMs)) * 1.08 || 1;
  const xScale = (x: number): number => ML + (x / maxX) * plotW;
  const yScale = (y: number): number => MT + plotH - (y / maxY) * plotH;

  const svg = svgEl("svg", {
    viewBox: `0 0 ${W} ${H}`,
    class: "seek-scatter",
    role: "img",
    "aria-label": "Scatter plot of keyframe distance versus decode time, one point per sampled timestamp",
  });

  const STEPS = 4;
  for (let i = 0; i <= STEPS; i++) {
    const gx = ML + (plotW * i) / STEPS;
    const gy = MT + (plotH * i) / STEPS;
    svg.append(svgEl("line", { class: "grid-line", x1: gx, y1: MT, x2: gx, y2: MT + plotH, "stroke-width": 1 }));
    svg.append(svgEl("line", { class: "grid-line", x1: ML, y1: gy, x2: ML + plotW, y2: gy, "stroke-width": 1 }));
    const xLabel = svgEl("text", {
      class: "tick",
      x: gx,
      y: MT + plotH + 16,
      "font-size": 10,
      "text-anchor": "middle",
    });
    xLabel.textContent = ((maxX * i) / STEPS).toFixed(2);
    svg.append(xLabel);
    const yLabel = svgEl("text", {
      class: "tick",
      x: ML - 8,
      y: MT + plotH - (plotH * i) / STEPS + 3,
      "font-size": 10,
      "text-anchor": "end",
    });
    yLabel.textContent = String(Math.round((maxY * i) / STEPS));
    svg.append(yLabel);
  }
  svg.append(svgEl("line", { class: "axis", x1: ML, y1: MT, x2: ML, y2: MT + plotH, "stroke-width": 1 }));
  svg.append(
    svgEl("line", { class: "axis", x1: ML, y1: MT + plotH, x2: ML + plotW, y2: MT + plotH, "stroke-width": 1 }),
  );

  const xTitle = svgEl("text", {
    class: "axis-title",
    x: ML + plotW / 2,
    y: H - 4,
    "font-size": 11,
    "text-anchor": "middle",
  });
  xTitle.textContent = "Keyframe distance (s)";
  svg.append(xTitle);
  const yTitle = svgEl("text", {
    class: "axis-title",
    x: 12,
    y: MT + plotH / 2,
    "font-size": 11,
    "text-anchor": "middle",
    transform: `rotate(-90 12 ${MT + plotH / 2})`,
  });
  yTitle.textContent = "Decode time (ms)";
  svg.append(yTitle);

  pts.forEach((r) => {
    const cx = xScale(r.dist);
    const cy = yScale(r.decodeMs);
    const g = svgEl("g");
    const title = svgEl("title");
    title.textContent = `t=${r.t.toFixed(2)}s  ·  distance=${r.dist.toFixed(3)}s  ·  decode=${r.decodeMs.toFixed(1)}ms`;
    g.append(title);
    g.append(svgEl("circle", { cx, cy, r: 12, fill: "transparent" }));
    g.append(svgEl("circle", { class: "pt", cx, cy, r: 5, "stroke-width": 2 }));
    svg.append(g);
  });
  return svg;
}
