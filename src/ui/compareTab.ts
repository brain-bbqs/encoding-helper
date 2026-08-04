// Tab: Encode Test — short-segment A/B comparison with synchronized pixel-level zoom & pan.

import { fetchFile } from "@ffmpeg/util";
import { buildFfmpegArgs, CRF_MAP } from "../lib/cliCommand";
import { gridItem, h, teachBox } from "../lib/dom";
import { ensureFfmpegLoaded, runFfmpegEncode, setFfmpegHandlers } from "../lib/ffmpegEngine";
import { ensureMediabunny } from "../lib/mediabunny";
import { extOf } from "../lib/save";
import { cli, currentVideoInfo, encodeTest, state } from "../lib/state";
import { fmtBytes } from "../lib/format";
import type { TrackInfo, ZoomPanState } from "../lib/types";
import { syncQualityControls } from "./cliControls";
import { fieldNumber, fieldSelect, logLine } from "./formControls";

interface RunUi {
  button: HTMLButtonElement;
  progress: HTMLDivElement;
  note: HTMLDivElement;
  log: HTMLDivElement;
  resultSec: HTMLDivElement;
}

export function renderEncodeTestTab(panel: HTMLElement): void {
  panel.innerHTML = "";
  const vt = state.tracks?.find((t) => t.kind === "video");
  if (!vt || vt.codedWidth == null || vt.codedHeight == null) return;

  const maxDuration = Math.max(1, Math.min(10, state.duration || 10));
  encodeTest.duration = Math.min(Math.max(1, encodeTest.duration || 3), maxDuration);
  encodeTest.startTime = Math.min(
    Math.max(0, encodeTest.startTime),
    Math.max(0, (state.duration || 0) - encodeTest.duration),
  );

  const sec = h("div", "section");
  sec.append(h("h2", null, "Encode Test — A/B Comparison"));
  sec.append(
    teachBox(
      `Encodes a short window of the video at the CRF/preset below via ffmpeg.wasm (byte-matching the CLI ` +
        `command), then decodes the original and the result side-by-side so you can pixel-peep the actual ` +
        `difference before committing to a full re-encode.`,
    ),
  );

  const row1 = h("div", "row");
  row1.append(
    fieldNumber(
      "etStart",
      "Start Time (s)",
      encodeTest.startTime.toFixed(1),
      0,
      Math.max(0, (state.duration || 1) - 1),
      0.5,
    ),
  );
  row1.append(fieldNumber("etDuration", "Duration (s)", encodeTest.duration, 1, maxDuration, 0.5));
  sec.append(row1);

  const row2 = h("div", "row");
  row2.append(
    fieldSelect(
      "etQuality",
      "Quality",
      [
        ["lossless", "Lossless (CRF 0)"],
        ["high", "High (CRF 18)"],
        ["medium", "Medium (CRF 25)"],
        ["low", "Low (CRF 32)"],
        ["custom", "Custom CRF"],
      ],
      cli.quality,
    ),
  );
  const etCrfField = fieldNumber("etCrf", "Custom CRF", cli.crf, 0, 51, 1);
  etCrfField.style.display = cli.quality === "custom" ? "" : "none";
  row2.append(etCrfField);
  row2.append(
    fieldSelect(
      "etPreset",
      "x264 Preset",
      ["ultrafast", "superfast", "veryfast", "faster", "fast", "medium", "slow", "slower", "veryslow"].map(
        (p) => [p, p] as [string, string],
      ),
      cli.preset,
    ),
  );
  sec.append(row2);

  const runBtn = h("button", "btn", "Run Comparison");
  runBtn.type = "button";
  sec.append(runBtn);
  const progress = h("div", "progress-wrap");
  progress.style.display = "none";
  progress.append(h("div", "fill"));
  sec.append(progress);
  const note = h("div", "progress-label");
  sec.append(note);
  const log = h("div", "log-console");
  log.style.display = "none";
  sec.append(log);
  panel.append(sec);

  const resultSec = h("div", "section");
  resultSec.style.display = "none";
  panel.append(resultSec);

  document.getElementById("etStart")?.addEventListener("input", (e) => {
    encodeTest.startTime = parseFloat((e.target as HTMLInputElement).value) || 0;
  });
  document.getElementById("etDuration")?.addEventListener("input", (e) => {
    encodeTest.duration = parseFloat((e.target as HTMLInputElement).value) || 1;
  });
  document.getElementById("etQuality")?.addEventListener("change", (e) => {
    cli.quality = (e.target as HTMLSelectElement).value as typeof cli.quality;
    syncQualityControls();
  });
  document.getElementById("etCrf")?.addEventListener("input", (e) => {
    cli.crf = parseInt((e.target as HTMLInputElement).value, 10) || 0;
    syncQualityControls();
  });
  document.getElementById("etPreset")?.addEventListener("change", (e) => {
    cli.preset = (e.target as HTMLSelectElement).value as typeof cli.preset;
    syncQualityControls();
  });
  runBtn.addEventListener("click", () => void runEncodeTest(vt, { button: runBtn, progress, note, log, resultSec }));
}

async function runEncodeTest(vt: TrackInfo, ui: RunUi): Promise<void> {
  if (encodeTest.running) return;
  encodeTest.running = true;
  ui.button.disabled = true;
  ui.progress.style.display = "block";
  const fill = ui.progress.querySelector<HTMLDivElement>(".fill");
  if (fill) fill.style.width = "0%";
  ui.note.textContent = "Loading ffmpeg.wasm…";
  ui.log.innerHTML = "";
  setFfmpegHandlers(
    (msg) => logLine(ui.log, msg, "info"),
    (ratio) => {
      const pct = Math.min(1, Math.max(0, ratio)) * 100;
      if (fill) fill.style.width = pct.toFixed(0) + "%";
      ui.note.textContent = `Encoding test segment… ${pct.toFixed(0)}%`;
    },
  );
  try {
    if (!state.source) throw new Error("No video loaded");
    await ensureFfmpegLoaded();
    const inputName = "et_in" + extOf(state.source.name);
    ui.note.textContent = "Writing input to virtual filesystem…";
    const inputData = await fetchFile(state.file ?? state.source.url ?? undefined);

    const info = currentVideoInfo();
    if (!info) throw new Error("No video track loaded");
    const start = encodeTest.startTime;
    const dur = encodeTest.duration;
    const outputName = "et_out.mp4";
    const args = buildFfmpegArgs(cli, info, inputName, outputName);
    // Trim after -i (not before) so the cut is frame-accurate rather than snapped to the nearest
    // preceding keyframe — the two sides need to show the same content, not just start "close enough."
    const iIdx = args.indexOf("-i");
    args.splice(iIdx + 2, 0, "-ss", String(start), "-t", String(dur));
    logLine(ui.log, "$ ffmpeg " + args.join(" "), "success");
    ui.note.textContent = "Encoding test segment…";
    const { data } = await runFfmpegEncode(args, inputName, inputData, outputName);
    const encodedBlob = new Blob([data], { type: "video/mp4" });

    ui.note.textContent = "Decoding frames…";
    const mb = await ensureMediabunny();
    const encodedInput = new mb.Input({ source: new mb.BlobSource(encodedBlob), formats: mb.ALL_FORMATS });
    const encodedTrack = await encodedInput.getPrimaryVideoTrack();
    if (!encodedTrack) throw new Error("Encoded segment has no video track");
    const encodedDuration = await encodedInput.computeDuration();

    if (!state.videoTrack) throw new Error("No video track loaded");
    encodeTest.originalSink = new mb.CanvasSink(state.videoTrack, { poolSize: 2 });
    encodeTest.encodedSink = new mb.CanvasSink(encodedTrack, { poolSize: 2 });
    encodeTest.encodedInput = encodedInput;
    encodeTest.segDuration = encodedDuration;
    encodeTest.encodedSize = encodedBlob.size;

    renderCompareResult(ui.resultSec, vt);
    ui.note.textContent = "Done.";
  } catch (err) {
    console.error("[encoding-helper] encode test failed:", err);
    ui.note.textContent = "Failed: " + (err instanceof Error ? err.message : String(err));
    logLine(ui.log, String(err instanceof Error ? err.message : err), "error");
  } finally {
    encodeTest.running = false;
    ui.button.disabled = false;
    ui.progress.style.display = "none";
  }
}

function renderCompareResult(resultSec: HTMLDivElement, vt: TrackInfo): void {
  resultSec.innerHTML = "";
  resultSec.style.display = "block";
  resultSec.append(h("h2", null, "Side-by-Side"));

  const g = h("div", "grid");
  g.append(
    gridItem(
      "Segment",
      `${encodeTest.startTime.toFixed(1)}s–${(encodeTest.startTime + encodeTest.duration).toFixed(1)}s`,
    ),
    gridItem(
      "Quality",
      cli.quality === "custom" ? `Custom (CRF ${cli.crf})` : `${cli.quality} (CRF ${CRF_MAP[cli.quality]})`,
    ),
    gridItem("Preset", cli.preset),
    gridItem("Encoded Segment Size", fmtBytes(encodeTest.encodedSize)),
  );
  resultSec.append(g);

  const stage = h("div", "compare-stage");
  const origPane = h("div", "compare-pane");
  origPane.append(h("span", "pane-label", "Original"));
  const origCanvas = h("canvas");
  origCanvas.width = vt.codedWidth ?? 0;
  origCanvas.height = vt.codedHeight ?? 0;
  origPane.append(origCanvas);
  const origGrid = h("div", "pixel-grid");
  origPane.append(origGrid);
  const encPane = h("div", "compare-pane");
  encPane.append(
    h("span", "pane-label", `Encoded (${cli.quality === "custom" ? "CRF " + cli.crf : cli.quality}, ${cli.preset})`),
  );
  const encCanvas = h("canvas");
  encCanvas.width = vt.codedWidth ?? 0;
  encCanvas.height = vt.codedHeight ?? 0;
  encPane.append(encCanvas);
  const encGrid = h("div", "pixel-grid");
  encPane.append(encGrid);
  const ar = `${vt.codedWidth ?? 0} / ${vt.codedHeight ?? 0}`;
  origPane.style.aspectRatio = ar;
  encPane.style.aspectRatio = ar;
  stage.append(origPane, encPane);
  resultSec.append(stage);

  const controls = h("div", "compare-controls");
  const scrub = h("input");
  scrub.type = "range";
  scrub.min = "0";
  scrub.max = "1000";
  scrub.value = "0";
  const scrubLabel = h("span", "progress-label", "0.00s");
  const zoomBtns = h("div", "zoom-buttons");
  const fitBtn = h("button", "btn sm sec", "Fit");
  fitBtn.type = "button";
  const actualBtn = h("button", "btn sm sec", "Actual Size (100%)");
  actualBtn.type = "button";
  zoomBtns.append(fitBtn, actualBtn);
  controls.append(scrub, scrubLabel, zoomBtns);
  resultSec.append(controls);
  resultSec.append(
    h(
      "div",
      "progress-label",
      "Scroll to zoom toward the cursor, drag to pan — both panes move together. Slide to scrub the test segment. A pixel grid appears once zoomed in far enough.",
    ),
  );

  const zoomPan = attachSyncedZoomPan(stage, [origCanvas, encCanvas], [origGrid, encGrid]);
  fitBtn.addEventListener("click", () => zoomPan.fit());
  actualBtn.addEventListener("click", () => zoomPan.actualSize());

  const drawFrame = (
    canvas: HTMLCanvasElement,
    frame: { canvas: HTMLCanvasElement | OffscreenCanvas } | null,
  ): void => {
    if (!frame) return;
    if (canvas.width !== frame.canvas.width || canvas.height !== frame.canvas.height) {
      canvas.width = frame.canvas.width;
      canvas.height = frame.canvas.height;
    }
    canvas.getContext("2d")?.drawImage(frame.canvas, 0, 0);
  };
  const drawAt = async (relT: number): Promise<void> => {
    if (!encodeTest.originalSink || !encodeTest.encodedSink) return;
    const [originalFrame, encodedFrame] = await Promise.all([
      encodeTest.originalSink.getCanvas(encodeTest.startTime + relT),
      encodeTest.encodedSink.getCanvas(Math.min(relT, Math.max(0, encodeTest.segDuration - 0.001))),
    ]);
    drawFrame(origCanvas, originalFrame);
    drawFrame(encCanvas, encodedFrame);
  };
  scrub.addEventListener("input", () => {
    const relT = (parseFloat(scrub.value) / 1000) * encodeTest.duration;
    scrubLabel.textContent = relT.toFixed(2) + "s";
    void drawAt(relT);
  });
  void drawAt(0);
}

// Shared drag state: a single pair of window-level listeners serves every comparison run rather than
// accumulating one pair per re-render.
interface ZoomDrag {
  lastX: number;
  lastY: number;
  zoom: ZoomPanState;
  apply: () => void;
}
let activeZoomDrag: ZoomDrag | null = null;
window.addEventListener("mousemove", (e) => {
  if (!activeZoomDrag) return;
  const d = activeZoomDrag;
  d.zoom.tx += e.clientX - d.lastX;
  d.zoom.ty += e.clientY - d.lastY;
  d.lastX = e.clientX;
  d.lastY = e.clientY;
  d.apply();
});
window.addEventListener("mouseup", () => {
  activeZoomDrag = null;
});
window.addEventListener(
  "touchmove",
  (e) => {
    if (!activeZoomDrag || e.touches.length !== 1) return;
    const d = activeZoomDrag;
    d.zoom.tx += e.touches[0].clientX - d.lastX;
    d.zoom.ty += e.touches[0].clientY - d.lastY;
    d.lastX = e.touches[0].clientX;
    d.lastY = e.touches[0].clientY;
    d.apply();
  },
  { passive: true },
);
window.addEventListener("touchend", () => {
  activeZoomDrag = null;
});

// Pixel grid appears once a source pixel renders at least this many CSS px wide.
const PIXEL_GRID_THRESHOLD = 8;

function attachSyncedZoomPan(stageEl: HTMLDivElement, canvases: HTMLCanvasElement[], grids: HTMLDivElement[]) {
  const zoom: ZoomPanState = { scale: 1, tx: 0, ty: 0 };
  encodeTest.zoom = zoom;

  // The grid overlay is deliberately NOT css-transformed like the canvas — background-size/position
  // are computed fresh in raw CSS px on every change instead, so its hairlines stay a crisp 1
  // screen-px wide at any zoom level rather than fattening along with the content.
  const updateGrids = (): void => {
    canvases.forEach((canvas, i) => {
      const grid = grids[i];
      const paneRect = canvas.parentElement?.getBoundingClientRect();
      if (!paneRect) return;
      const pxW = (paneRect.width / canvas.width) * zoom.scale;
      const pxH = (paneRect.height / canvas.height) * zoom.scale;
      const visible = pxW >= PIXEL_GRID_THRESHOLD && pxH >= PIXEL_GRID_THRESHOLD;
      grid.classList.toggle("visible", visible);
      if (visible) {
        grid.style.backgroundSize = `${pxW}px ${pxH}px`;
        grid.style.backgroundPosition = `${zoom.tx}px ${zoom.ty}px`;
      }
    });
  };

  const apply = (): void => {
    const t = `translate(${zoom.tx}px, ${zoom.ty}px) scale(${zoom.scale})`;
    canvases.forEach((c) => {
      c.style.transform = t;
    });
    updateGrids();
  };

  const setScale = (newScale: number, anchorX: number, anchorY: number): void => {
    zoom.tx = anchorX - (anchorX - zoom.tx) * (newScale / zoom.scale);
    zoom.ty = anchorY - (anchorY - zoom.ty) * (newScale / zoom.scale);
    zoom.scale = newScale;
    apply();
  };

  stageEl.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const rect = canvases[0].getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const newScale = Math.min(50, Math.max(0.2, zoom.scale * factor));
      zoom.tx = cx - (cx - zoom.tx) * (newScale / zoom.scale);
      zoom.ty = cy - (cy - zoom.ty) * (newScale / zoom.scale);
      zoom.scale = newScale;
      apply();
    },
    { passive: false },
  );
  stageEl.addEventListener("mousedown", (e) => {
    activeZoomDrag = { lastX: e.clientX, lastY: e.clientY, zoom, apply };
  });
  stageEl.addEventListener(
    "touchstart",
    (e) => {
      if (e.touches.length === 1)
        activeZoomDrag = { lastX: e.touches[0].clientX, lastY: e.touches[0].clientY, zoom, apply };
    },
    { passive: true },
  );

  return {
    state: zoom,
    fit: (): void => {
      zoom.scale = 1;
      zoom.tx = 0;
      zoom.ty = 0;
      apply();
    },
    // 1 source pixel = 1 CSS px, centered on whatever's currently in the middle of the pane.
    actualSize: (): void => {
      const paneRect = canvases[0].parentElement?.getBoundingClientRect();
      if (!paneRect) return;
      const newScale = canvases[0].width / paneRect.width;
      setScale(newScale, paneRect.width / 2, paneRect.height / 2);
    },
  };
}
