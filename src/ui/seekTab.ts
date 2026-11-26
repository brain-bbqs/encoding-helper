// The GOP/keyframe/B-frame structure and the empirical seeking test that measures it, with a
// keyframe-distance-vs-decode-time scatter plot: one card, in the Inspect tab after the atom map
// and before the bitrate and audio cards, since how a file seeks is a consequence of its GOP structure rather than a separate thing to
// go and look at.

import { errorMessage } from "@brain-bbqs/utils";
import { button, h, svgEl } from "@brain-bbqs/ui";
import { badgeEl, dataTable, factGrid, fold, gridItem, section, teachBox } from "../lib/dom";
import { GOP_TEACH, SEEK_TEST_INTRO } from "../lib/explainers";
import { FALLBACK_FPS, fmtMs } from "../lib/format";
import { ensureMediabunny } from "../lib/mediabunny";
import { nearestKeyframeAtOrBefore } from "../lib/mp4boxParser";
import { downloadBlob } from "../lib/save";
import { describeAvgGop, gopStats, SEEK_TABLE_HEADERS, seekResultRow, seekSummary } from "../lib/seekReport";
import { state } from "../lib/state";
import type { Badge, FactRow, SeekResult } from "../lib/types";
import { appendAxes, AXIS_STEPS, CHART_WIDTH } from "./chartAxes";
import { fieldNumber, progressBar } from "./formControls";

/**
 * How many timestamps a run samples unless the reader says otherwise. Enough of the file to make the
 * scatter a distribution rather than a handful of points, and still a run of a few seconds.
 */
const DEFAULT_SEEK_SAMPLES = 100;

// The card's title and the seeking test's, which the Full Analysis document heads its matching
// sections with. They live here, with the card, rather than in analysisTab.ts, which imports this
// module.
export const GOP_TITLE = "GOP / Keyframe Structure";
export const SEEK_TEST_TITLE = "Empirical Seeking Test";

/** Whether the file reorders frames, read off its decode and presentation times. */
export function bFramesBadge(): Badge {
  return state.hasBFrames ? { tone: "info", text: "Uses B-frames (cts ≠ dts)" } : { tone: "good", text: "No B-frames" };
}

/** A seeking run's summary figures. */
export function seekSummaryRows(results: SeekResult[]): FactRow[] {
  const { avgDist, avgDecode, maxDecode } = seekSummary(results);
  return [
    { label: "Avg Keyframe Distance", value: avgDist.toFixed(3) + " s" },
    { label: "Avg Decode Time", value: fmtMs(avgDecode) },
    { label: "Max Decode Time", value: fmtMs(maxDecode) },
  ];
}

export function renderGopStructure(panel: HTMLElement): void {
  const { gop, avgGop, fps } = gopStats();
  const minGop = gop.length ? Math.min(...gop) : 0;
  const maxGop = gop.length ? Math.max(...gop) : 0;

  const sec = section(GOP_TITLE);
  const g = h("div", "grid");
  g.append(
    gridItem("Total Frames", state.samples.length.toLocaleString()),
    gridItem("Keyframes", state.gopLengths.length.toLocaleString()),
    gridItem("Avg GOP", describeAvgGop(avgGop, fps)),
    gridItem("Min / Max GOP", `${minGop} / ${maxGop} frames`),
  );
  sec.append(g);
  const bWrap = h("div");
  bWrap.style.margin = "10px 0";
  bWrap.append(badgeEl(bFramesBadge()));
  sec.append(bWrap);

  if (gop.length > 1) sec.append(renderGopHistogram(gop));
  // What a GOP is, under this file's own: the card leads with the measurement, like the others.
  sec.append(teachBox(GOP_TEACH, "🔑"));

  // The seeking test lives in the same card rather than one of its own: what nearest-keyframe
  // distance costs to seek to is the GOP structure's consequence, not a separate finding.
  sec.append(h("h3", null, SEEK_TEST_TITLE));
  // Set as a teach box like every other explanation on the page, rather than as bare body text in
  // its own size.
  sec.append(teachBox(SEEK_TEST_INTRO, "⏱️"));
  const controls = h("div", "row");
  controls.style.marginTop = "10px";
  const nField = fieldNumber("seekN", "Sample Count", DEFAULT_SEEK_SAMPLES, 5, 200, 1);
  const nInput = nField.querySelector("input")!;
  controls.append(nField);
  sec.append(controls);
  const runBtn = button("btn", "Run Seeking Test");
  runBtn.id = "runSeekBtn";
  sec.append(runBtn);
  const { wrap: seekProgress, fill: seekFill } = progressBar();
  seekProgress.id = "seekProgress";
  sec.append(seekProgress);
  const seekResultsWrap = h("div", "seek-results");
  seekResultsWrap.id = "seekResultsWrap";
  sec.append(seekResultsWrap);
  panel.append(sec);

  runBtn.addEventListener("click", () => {
    const n = parseInt(nInput.value, 10) || DEFAULT_SEEK_SAMPLES;
    void runSeekingTest(runBtn, seekProgress, seekFill, seekResultsWrap, n);
  });
}

async function runSeekingTest(
  btn: HTMLButtonElement,
  progress: HTMLDivElement,
  fill: HTMLDivElement,
  resultsWrap: HTMLDivElement,
  n: number,
): Promise<void> {
  btn.disabled = true;
  progress.style.display = "block";
  fill.style.width = "0%";
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
      const distFrames = dist != null ? Math.round(dist * (state.fps || FALLBACK_FPS)) : null;
      results.push({ t, kf, dist, distFrames, decodeMs });
      fill.style.width = ((i + 1) / n) * 100 + "%";
    }
    state.seekResults = results;
    renderSeekResults(resultsWrap, results);
  } catch (err) {
    console.error("[encoding-helper] seeking test failed:", err);
    const el = document.getElementById("errorMsg");
    if (el) {
      el.textContent = "Seeking test failed: " + errorMessage(err);
      el.style.display = "block";
    }
  } finally {
    btn.disabled = false;
    progress.style.display = "none";
  }
}

/** The histogram's height and its shortest bar, in px; the stylesheet's `.hist` and `.hist .bar`
 * rules give the same two figures. */
export const HIST_HEIGHT_PX = 90;
export const HIST_MIN_BAR_PX = 2;

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
    bar.style.height = Math.max(HIST_MIN_BAR_PX, (len / maxLen) * HIST_HEIGHT_PX) + "px";
    bar.title = len + " frames";
    hist.append(bar);
  });
  return hist;
}

function renderSeekResults(wrap: HTMLDivElement, results: SeekResult[]): void {
  wrap.append(factGrid(seekSummaryRows(results)));

  const scatter = renderSeekScatter(results);
  if (scatter) wrap.append(scatter);

  // The summary figures and the scatter above are what a run is read for; a hundred sampled
  // timestamps of raw rows underneath them would bury the next section, so the table folds away
  // behind a bar, like the output console and the sweep settings. The export button sits where the
  // row count used to, on the right of that bar, rather than inside the folded body: it should be
  // reachable without opening the table it exports.
  const { wrap: tableFold, note: tableNote, body: tableBody } = fold("Sampled timestamps");
  const exportBtn = button("btn sec sm", "Export table (TSV)");
  // Stops the click from also toggling the <details> open, which it would otherwise do as it
  // bubbles up through the summary bar.
  exportBtn.addEventListener("click", (e) => {
    e.preventDefault();
    downloadBlob(seekResultsTsv(results), "seek-test.tsv");
  });
  // The bar's note slot, which its auto margin pushes to the right.
  tableNote.append(exportBtn);
  tableBody.append(dataTable(SEEK_TABLE_HEADERS, results.map(seekResultRow)));
  wrap.append(tableFold);
}

/** The sampled-timestamps table as a TSV blob, same rows and column order as the on-screen table,
 * for a reader who wants the raw run in a spreadsheet rather than scrolled through in the browser.
 * Tab-separated rather than comma-separated: none of the fields can carry a tab, so it needs no
 * quoting rules the way a comma-separated file would over a decimal that never uses one anyway. */
function seekResultsTsv(results: SeekResult[]): Blob {
  const header = [
    "Timestamp (s)",
    "Nearest keyframe <= t (s)",
    "Distance (s)",
    "Distance (frames)",
    "Decode time (ms)",
  ];
  const rows = results.map((r) => [
    r.t.toFixed(3),
    r.kf != null ? r.kf.toFixed(3) : "",
    r.dist != null ? r.dist.toFixed(3) : "",
    r.distFrames != null ? String(r.distFrames) : "",
    r.decodeMs.toFixed(3),
  ]);
  const tsv = [header, ...rows].map((row) => row.join("\t")).join("\n") + "\n";
  return new Blob([tsv], { type: "text/tab-separated-values" });
}

// Scatter plot: keyframe distance (x) vs. decode time (y), one point per sampled timestamp. A
// single series, so no legend is needed: the section title and axis labels already say what's
// plotted. Exported so the Full Analysis document plots the same run rather than only tabulating it.
export function renderSeekScatter(results: SeekResult[]): SVGSVGElement | null {
  const pts = results.filter((r): r is SeekResult & { dist: number } => r.dist != null);
  if (pts.length < 2) return null;
  const W = CHART_WIDTH;
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

  appendAxes(
    svg,
    { H, ML, MT, plotW, plotH },
    {
      xTick: (i) => ((maxX * i) / AXIS_STEPS).toFixed(2),
      yTick: (i) => String(Math.round((maxY * i) / AXIS_STEPS)),
      xTitle: "Keyframe distance (s)",
      yTitle: "Decode time (ms)",
    },
  );

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
