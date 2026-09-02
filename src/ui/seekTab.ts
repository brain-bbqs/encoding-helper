// The GOP/keyframe/B-frame structure and the empirical seeking test that measures it, with a
// keyframe-distance-vs-decode-time scatter plot — one card, the last section of the Inspect tab,
// since how a file seeks is a consequence of its GOP structure rather than a separate thing to
// go and look at.

import { button, dataTable, fold, gridItem, h, section, svgEl, svgText, teachBox } from "../lib/dom";
import { GOP_TEACH, SEEK_TEST_INTRO } from "../lib/explainers";
import { errorMessage, fmtMs } from "../lib/format";
import { ensureMediabunny } from "../lib/mediabunny";
import { nearestKeyframeAtOrBefore } from "../lib/mp4boxParser";
import { downloadBlob } from "../lib/save";
import { describeAvgGop, gopStats, SEEK_TABLE_HEADERS, seekResultRow, seekSummary } from "../lib/seekReport";
import { state } from "../lib/state";
import type { SeekResult } from "../lib/types";
import { progressBar } from "./formControls";

/**
 * How many timestamps a run samples unless the reader says otherwise. Enough of the file to make the
 * scatter a distribution rather than a handful of points, and still a run of a few seconds.
 */
const DEFAULT_SEEK_SAMPLES = 100;

export function renderSeekTab(panel: HTMLElement): void {
  const { gop, avgGop, fps } = gopStats();
  const minGop = gop.length ? Math.min(...gop) : 0;
  const maxGop = gop.length ? Math.max(...gop) : 0;

  const sec = section("GOP / Keyframe Structure");
  const g = h("div", "grid");
  g.append(
    gridItem("Total Frames", state.samples.length.toLocaleString()),
    gridItem("Keyframes", state.keyframeDecodeIndices.length.toLocaleString()),
    gridItem("Avg GOP", describeAvgGop(avgGop, fps)),
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
      results.push({ t, kf, dist, distFrames: dist != null ? Math.round(dist * (state.fps || 30)) : null, decodeMs });
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
  const { avgDist, avgDecode, maxDecode } = seekSummary(results);
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
  // behind a bar, like the output console and the sweep settings. The export button sits where the
  // row count used to, on the right of that bar, rather than inside the folded body: it should be
  // reachable without opening the table it exports.
  const { wrap: tableFold, body: tableBody } = fold("Sampled timestamps");
  const exportBtn = button("btn sec sm", "Export table (TSV)");
  // Stops the click from also toggling the <details> open, which it would otherwise do as it
  // bubbles up through the summary bar.
  exportBtn.addEventListener("click", (e) => {
    e.preventDefault();
    downloadBlob(seekResultsTsv(results), "seek-test.tsv");
  });
  // Reuses the bar's own note slot (pushed to the right by its auto margin) rather than adding a
  // second one, since fold() always renders it even when there is no text to show.
  tableFold.querySelector(".fold-note")?.append(exportBtn);
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
    svg.append(
      svgText(
        "tick",
        { x: gx, y: MT + plotH + 16, "font-size": 10, "text-anchor": "middle" },
        ((maxX * i) / STEPS).toFixed(2),
      ),
    );
    svg.append(
      svgText(
        "tick",
        { x: ML - 8, y: MT + plotH - (plotH * i) / STEPS + 3, "font-size": 10, "text-anchor": "end" },
        String(Math.round((maxY * i) / STEPS)),
      ),
    );
  }
  svg.append(svgEl("line", { class: "axis", x1: ML, y1: MT, x2: ML, y2: MT + plotH, "stroke-width": 1 }));
  svg.append(
    svgEl("line", { class: "axis", x1: ML, y1: MT + plotH, x2: ML + plotW, y2: MT + plotH, "stroke-width": 1 }),
  );

  svg.append(
    svgText(
      "axis-title",
      { x: ML + plotW / 2, y: H - 4, "font-size": 11, "text-anchor": "middle" },
      "Keyframe distance (s)",
    ),
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
      "Decode time (ms)",
    ),
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
