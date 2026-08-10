// Tab: GOP & Seeking — GOP/keyframe/B-frame structure, plus an empirical seeking test with a
// keyframe-distance-vs-decode-time scatter plot.

import { gridItem, h, svgEl, teachBox } from "../lib/dom";
import { fmtMs } from "../lib/format";
import { ensureMediabunny } from "../lib/mediabunny";
import { nearestKeyframeAtOrBefore } from "../lib/mp4boxParser";
import { state } from "../lib/state";
import type { SeekResult } from "../lib/types";

export function renderSeekTab(panel: HTMLElement): void {
  panel.innerHTML = "";

  const gop = state.gopLengths;
  const avgGop = gop.length ? gop.reduce((a, b) => a + b, 0) / gop.length : 0;
  const minGop = gop.length ? Math.min(...gop) : 0;
  const maxGop = gop.length ? Math.max(...gop) : 0;
  const fps = state.fps || 30;

  const sec = h("div", "section");
  sec.append(h("h2", null, "GOP / Keyframe Structure"));
  // Explainer first, like the Atom Map tab: read what a GOP is before reading this file's numbers.
  sec.append(
    teachBox(
      `The <b>GOP (Group of Pictures)</b> is the span between keyframes (I-frames that decode with no ` +
        `reference to other frames). Shorter GOPs → more, larger keyframes → faster seeking &amp; scrubbing but ` +
        `worse compression. <b>I-frames</b> are self-contained; <b>P-frames</b> reference earlier frames; ` +
        `<b>B-frames</b> reference both earlier <i>and later</i> frames (better compression, but decode order ` +
        `≠ presentation order, which complicates random access). sleap-io's <code>reencode</code> baseline forces ` +
        `a <b>fixed GOP</b> (<code>-g</code> + <code>-keyint_min</code> + <code>-sc_threshold 0</code>) and ` +
        `<b>disables B-frames</b> (<code>-bf 0</code>) specifically to make random-access seeking fast and predictable ` +
        `for pose-estimation pipelines that jump around a video rather than playing it linearly.`,
    ),
  );
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
    state.hasBFrames ? "Uses B-frames (cts ≠ dts)" : "No B-frames (IPPP…)",
  );
  const bWrap = h("div");
  bWrap.style.margin = "10px 0";
  bWrap.append(bBadge);
  sec.append(bWrap);

  if (gop.length > 1) {
    const hist = h("div", "hist");
    const maxLen = Math.max(...gop);
    gop.forEach((len) => {
      const bar = h("div", "bar" + (len > avgGop * 1.5 ? " tall" : ""));
      bar.style.height = Math.max(2, (len / maxLen) * 90) + "px";
      bar.title = len + " frames";
      hist.append(bar);
    });
    sec.append(hist);
    sec.append(h("div", "progress-label", "GOP length per keyframe interval (hover a bar for its frame count)"));
  }

  panel.append(sec);

  const seekSec = h("div", "section");
  seekSec.append(h("h2", null, "Empirical Seeking Test"));
  seekSec.append(
    h(
      "div",
      null,
      "Samples N evenly-spaced timestamps across the video and measures how far back the nearest keyframe is, plus how long it takes to decode that frame.",
    ),
  );
  const controls = h("div", "row");
  controls.style.marginTop = "10px";
  const nField = h("div", "field");
  nField.append(h("label", "field-label", "Sample Count"));
  const nInput = h("input");
  nInput.type = "number";
  nInput.min = "5";
  nInput.max = "200";
  nInput.value = "20";
  nInput.id = "seekN";
  nField.append(nInput);
  controls.append(nField);
  seekSec.append(controls);
  const runBtn = h("button", "btn", "Run Seeking Test");
  runBtn.type = "button";
  runBtn.id = "runSeekBtn";
  seekSec.append(runBtn);
  const seekProgress = h("div", "progress-wrap");
  seekProgress.style.display = "none";
  seekProgress.id = "seekProgress";
  seekProgress.append(h("div", "fill"));
  seekSec.append(seekProgress);
  const seekResultsWrap = h("div");
  seekResultsWrap.id = "seekResultsWrap";
  seekSec.append(seekResultsWrap);
  panel.append(seekSec);

  runBtn.addEventListener("click", () => {
    void runSeekingTest(runBtn, seekProgress, seekResultsWrap, parseInt(nInput.value, 10) || 20);
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
  if (scatter) {
    wrap.append(h("div", "progress-label", "Keyframe distance vs. decode time — hover a point for its timestamp"));
    wrap.append(scatter);
  }

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
      h("td", null, r.kf != null ? r.kf.toFixed(3) + "s" : "—"),
      h("td", null, r.dist != null ? r.dist.toFixed(3) + "s" : "—"),
      h("td", null, r.distFrames != null ? String(r.distFrames) : "—"),
      h("td", null, fmtMs(r.decodeMs)),
    );
    tbody.append(tr);
  });
  table.append(tbody);
  scroll.append(table);
  wrap.append(scroll);
}

// Scatter plot: keyframe distance (x) vs. decode time (y), one point per sampled timestamp. A
// single series, so no legend is needed — the section title and axis labels already say what's
// plotted.
function renderSeekScatter(results: SeekResult[]): SVGSVGElement | null {
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
