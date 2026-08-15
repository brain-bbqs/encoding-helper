// Tab: Compare Quality — short-segment A/B comparison with synchronized pixel-level zoom & pan.
//
// Two modes share the one encoder and the one A/B window. A *single* run encodes the segment at the
// settings in the dropdowns, which is the tab's original job. *Matrix* mode runs the cartesian
// product of those same two dropdowns and lays the results out as a grid, then loads the largest
// reduction into the A/B window — the settings ranking is a table's job, but whether the winner
// still looks acceptable is only ever a question for the eye, and that is the window below it.

import { fetchFile } from "@ffmpeg/util";
import { buildFfmpegArgs } from "../lib/cliCommand";
import { gridItem, h, infoIcon, teachBox } from "../lib/dom";
import { MATRIX_MODE_TEACH, X264_PRESET_INFO } from "../lib/explainers";
import { ensureFfmpegLoaded, parseFfmpegTimeSeconds, runFfmpegEncode, setFfmpegHandlers } from "../lib/ffmpegEngine";
import { ensureMediabunny } from "../lib/mediabunny";
import {
  bestReductionCell,
  buildMatrixCombos,
  cliSettings,
  describeSettings,
  DEFAULT_MATRIX_PRESETS,
  evictBeyondBudget,
  makeMatrixCells,
  MATRIX_LARGE_RUN,
  MATRIX_PRESETS,
  MATRIX_QUALITIES,
  MATRIX_RETAINED_BYTES,
  matrixCliState,
  matrixProgress,
} from "../lib/qualityMatrix";
import { extOf } from "../lib/save";
import { cli, currentVideoInfo, encodeTest, state } from "../lib/state";
import { fmtBytes } from "../lib/format";
import { currentSizeEstimate, estimateSizeSavings, type SizeEstimate } from "../lib/sizeEstimate";
import type { CliState, EncodeSettings, MatrixCell, MatrixQuality, TrackInfo, X264Preset } from "../lib/types";
import { syncQualityControls } from "./cliControls";
import { fieldNumber, fieldSelect, logLine } from "./formControls";
import { renderMatrixSummary, renderMatrixTable } from "./matrixPanel";
import { renderSavingsDetail, renderSavingsStrip } from "./savingsPanel";
import { attachSyncedZoomPan, ZOOM_BUTTON_STEP, ZOOM_MAX, ZOOM_MIN } from "./zoomPan";

interface RunUi {
  runButton: HTMLButtonElement;
  stopButton: HTMLButtonElement;
  progress: HTMLDivElement;
  note: HTMLDivElement;
  log: HTMLDivElement;
  matrixSec: HTMLDivElement;
  resultSec: HTMLDivElement;
}

/** The source file's bytes, read once and passed down a sweep rather than re-read per combination. */
interface SourceBytes {
  name: string;
  data: Uint8Array;
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
  sec.append(h("h2", null, "Compare Quality: A/B Comparison"));
  sec.append(
    teachBox(`Try changing various reencoding parameters and visualize their effect on rendering a part of the video.`),
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
  row1.append(
    fieldSelect(
      "etMode",
      "Mode",
      [
        ["single", "Single (one setting)"],
        ["matrix", "Matrix (sweep every setting)"],
      ],
      encodeTest.mode,
    ),
  );
  sec.append(row1);

  // Both control blocks stay in the DOM whichever mode is showing, so the shared quality/preset
  // fields keep answering to syncQualityControls() from the Reencode tab while they are hidden.
  const singleControls = h("div", "compare-single-controls");
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
      MATRIX_PRESETS.map((p) => [p, p] as [string, string]),
      cli.preset,
      X264_PRESET_INFO,
    ),
  );
  singleControls.append(row2);
  sec.append(singleControls);

  const matrixControls = h("div", "compare-matrix-controls");
  matrixControls.append(teachBox(MATRIX_MODE_TEACH));
  const axisRow = h("div", "row");
  const countHint = h("div", "field hint matrix-count");
  const refreshCount = (): void => {
    const n = buildMatrixCombos(encodeTest.matrix.qualities, encodeTest.matrix.presets).length;
    countHint.textContent =
      n === 0
        ? "Tick at least one quality and one preset."
        : `${n} combination${n === 1 ? "" : "s"} × ${encodeTest.duration.toFixed(1)}s of video` +
          (n > MATRIX_LARGE_RUN ? " — a long sweep; Stop keeps whatever has finished." : "");
    countHint.classList.toggle("warn-hint", n > MATRIX_LARGE_RUN);
  };
  axisRow.append(
    axisCheckboxes(
      "Quality levels",
      MATRIX_QUALITIES.map((q) => ({ value: q, label: q })),
      encodeTest.matrix.qualities,
      (values) => {
        encodeTest.matrix.qualities = values as MatrixQuality[];
        refreshCount();
      },
    ),
  );
  axisRow.append(
    axisCheckboxes(
      "x264 presets",
      MATRIX_PRESETS.map((p) => ({
        value: p,
        label: p,
        note: DEFAULT_MATRIX_PRESETS.includes(p) ? null : "slow in-browser",
      })),
      encodeTest.matrix.presets,
      (values) => {
        encodeTest.matrix.presets = values as X264Preset[];
        refreshCount();
      },
      X264_PRESET_INFO,
    ),
  );
  matrixControls.append(axisRow, countHint);
  sec.append(matrixControls);

  const buttons = h("div", "compare-run-buttons");
  const runBtn = h("button", "btn", "Run Comparison");
  runBtn.type = "button";
  const stopBtn = h("button", "btn sec", "Stop");
  stopBtn.type = "button";
  stopBtn.style.display = "none";
  buttons.append(runBtn, stopBtn);
  sec.append(buttons);
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

  const matrixSec = h("div", "section");
  matrixSec.style.display = "none";
  panel.append(matrixSec);

  const resultSec = h("div", "section");
  resultSec.style.display = "none";
  panel.append(resultSec);

  const ui: RunUi = { runButton: runBtn, stopButton: stopBtn, progress, note, log, matrixSec, resultSec };

  const applyMode = (): void => {
    const matrix = encodeTest.mode === "matrix";
    singleControls.style.display = matrix ? "none" : "";
    matrixControls.style.display = matrix ? "" : "none";
    runBtn.textContent = matrix ? "Run Matrix" : "Run Comparison";
    refreshCount();
  };
  applyMode();

  document.getElementById("etStart")?.addEventListener("input", (e) => {
    encodeTest.startTime = parseFloat((e.target as HTMLInputElement).value) || 0;
  });
  document.getElementById("etDuration")?.addEventListener("input", (e) => {
    encodeTest.duration = parseFloat((e.target as HTMLInputElement).value) || 1;
    refreshCount();
  });
  document.getElementById("etMode")?.addEventListener("change", (e) => {
    encodeTest.mode = (e.target as HTMLSelectElement).value === "matrix" ? "matrix" : "single";
    applyMode();
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
  runBtn.addEventListener("click", () => {
    if (encodeTest.mode === "matrix") void runMatrix(vt, ui);
    else void runEncodeTest(vt, ui);
  });
  stopBtn.addEventListener("click", () => {
    encodeTest.matrix.cancelRequested = true;
    stopBtn.disabled = true;
    note.textContent = "Stopping after the combination in progress…";
  });
}

/** One axis of the matrix as a tick list, reporting the whole selection on every change. */
function axisCheckboxes(
  label: string,
  options: { value: string; label: string; note?: string | null }[],
  selected: string[],
  onChange: (values: string[]) => void,
  info?: string | null,
): HTMLDivElement {
  const field = h("div", "field");
  const head = h("div", "field-head");
  head.append(h("label", "field-label", label));
  // The same ⓘ the dropdown carries, since the sweep is over exactly what the dropdown sets.
  if (info) head.append(infoIcon(info, `About ${label}`));
  field.append(head);
  const list = h("div", "axis-list");
  const boxes: HTMLInputElement[] = [];
  for (const opt of options) {
    const wrap = h("label", "axis-option");
    const box = h("input");
    box.type = "checkbox";
    box.value = opt.value;
    box.checked = selected.includes(opt.value);
    box.addEventListener("change", () => onChange(boxes.filter((b) => b.checked).map((b) => b.value)));
    boxes.push(box);
    wrap.append(box, document.createTextNode(" " + opt.label));
    if (opt.note) wrap.append(h("span", "axis-note", opt.note));
    list.append(wrap);
  }
  field.append(list);
  return field;
}

/** The file's bytes, as ffmpeg.wasm wants them. Read per run rather than cached: a whole video held
 * in memory between runs is a large thing to keep for a button that may never be pressed again. */
async function readSource(): Promise<SourceBytes> {
  if (!state.source) throw new Error("No video loaded");
  return { name: state.source.name, data: await fetchFile(state.file ?? state.source.url ?? undefined) };
}

/**
 * Encodes the chosen segment at `cliState` and hands back the result. Shared by both modes, so a
 * matrix square and a single run are the same encode with the same trim.
 */
async function encodeSegment(
  cliState: CliState,
  source: SourceBytes,
  ui: RunUi,
  onFraction: (fraction: number) => void,
): Promise<Blob> {
  const info = currentVideoInfo();
  if (!info) throw new Error("No video track loaded");
  const inputName = "et_in" + extOf(source.name);
  const outputName = "et_out.mp4";
  const args = buildFfmpegArgs(cliState, info, inputName, outputName);
  // Trim after -i (not before) so the cut is frame-accurate rather than snapped to the nearest
  // preceding keyframe — the two sides need to show the same content, not just start "close enough."
  const iIdx = args.indexOf("-i");
  args.splice(iIdx + 2, 0, "-ss", String(encodeTest.startTime), "-t", String(encodeTest.duration));
  setFfmpegHandlers((msg) => {
    logLine(ui.log, msg, "info");
    // Progress is taken from the status lines rather than from the core's own progress events,
    // which are a fraction of the whole input: a 3-second segment of a 30-second file would
    // creep to 10% and stop there, looking like it gave up rather than finished.
    const at = parseFfmpegTimeSeconds(msg);
    if (at == null || !(encodeTest.duration > 0)) return;
    onFraction(Math.min(1, Math.max(0, at / encodeTest.duration)));
  }, null);
  logLine(ui.log, "$ ffmpeg " + args.join(" "), "success");
  const { data } = await runFfmpegEncode(args, inputName, source.data, outputName);
  return new Blob([data], { type: "video/mp4" });
}

/** The encoded segment's own playback length, which the size projection is taken over. */
async function segmentDuration(blob: Blob): Promise<number> {
  const mb = await ensureMediabunny();
  const input = new mb.Input({ source: new mb.BlobSource(blob), formats: mb.ALL_FORMATS });
  return await input.computeDuration();
}

/** Puts an encoded segment in the A/B window, against the original, and redraws the comparison. */
async function loadEncodedIntoAB(
  blob: Blob,
  settings: EncodeSettings,
  vt: TrackInfo,
  resultSec: HTMLDivElement,
): Promise<void> {
  const mb = await ensureMediabunny();
  const encodedInput = new mb.Input({ source: new mb.BlobSource(blob), formats: mb.ALL_FORMATS });
  const encodedTrack = await encodedInput.getPrimaryVideoTrack();
  if (!encodedTrack) throw new Error("Encoded segment has no video track");
  const encodedDuration = await encodedInput.computeDuration();
  if (!state.videoTrack) throw new Error("No video track loaded");
  encodeTest.originalSink = new mb.CanvasSink(state.videoTrack, { poolSize: 2 });
  encodeTest.encodedSink = new mb.CanvasSink(encodedTrack, { poolSize: 2 });
  encodeTest.encodedInput = encodedInput;
  encodeTest.segDuration = encodedDuration;
  encodeTest.encodedSize = blob.size;
  encodeTest.activeCombo = settings;
  renderCompareResult(resultSec, vt);
}

/** Readies the progress bar and console for a run, and hands back the bar's fill. */
function startRunUi(ui: RunUi, matrix: boolean): HTMLDivElement | null {
  encodeTest.running = true;
  ui.runButton.disabled = true;
  ui.stopButton.style.display = matrix ? "" : "none";
  ui.stopButton.disabled = false;
  ui.progress.style.display = "block";
  const fill = ui.progress.querySelector<HTMLDivElement>(".fill");
  if (fill) {
    fill.style.width = "0%";
    fill.classList.remove("done");
  }
  ui.log.innerHTML = "";
  return fill;
}

function endRunUi(ui: RunUi): void {
  encodeTest.running = false;
  ui.runButton.disabled = false;
  ui.stopButton.style.display = "none";
}

async function runEncodeTest(vt: TrackInfo, ui: RunUi): Promise<void> {
  if (encodeTest.running) return;
  const fill = startRunUi(ui, false);
  ui.note.textContent = "Loading ffmpeg.wasm…";
  try {
    await ensureFfmpegLoaded();
    ui.note.textContent = "Writing input to virtual filesystem…";
    const source = await readSource();
    ui.note.textContent = "Encoding test segment…";
    const blob = await encodeSegment(cli, source, ui, (fraction) => {
      const pct = fraction * 100;
      if (fill) fill.style.width = pct.toFixed(0) + "%";
      ui.note.textContent = `Encoding test segment… ${pct.toFixed(0)}%`;
    });

    ui.note.textContent = "Decoding frames…";
    // A single run is its own comparison, so nothing in the matrix grid is showing anymore.
    encodeTest.matrix.selectedKey = null;
    renderMatrixSection(ui.matrixSec, vt, ui);
    await loadEncodedIntoAB(blob, cliSettings(cli), vt, ui.resultSec);
    // A full bar, in the colour the app uses for a good outcome, rather than the word "Done." under
    // an empty one: the run either filled the bar or it did not.
    if (fill) {
      fill.style.width = "100%";
      fill.classList.add("done");
    }
    ui.note.textContent = "";
  } catch (err) {
    reportRunFailure(err, ui);
  } finally {
    endRunUi(ui);
  }
}

/**
 * Whether Stop has been pressed, read through a call: the button flips the flag while the sweep is
 * awaiting an encode, which a straight field read (assigned false on the line above) cannot see.
 */
function stopRequested(): boolean {
  return encodeTest.matrix.cancelRequested;
}

/**
 * Encodes the segment once per combination, filling the grid in as it goes, then loads the largest
 * reduction into the A/B window.
 *
 * A failed combination is a result rather than the end of the sweep: the slowest presets can exhaust
 * the in-browser core (which then replaces itself — see resetFfmpeg), and the point of running the
 * grid is to find out what this file and this browser can actually do.
 */
async function runMatrix(vt: TrackInfo, ui: RunUi): Promise<void> {
  if (encodeTest.running) return;
  const matrix = encodeTest.matrix;
  const combos = buildMatrixCombos(matrix.qualities, matrix.presets);
  if (!combos.length) {
    ui.note.textContent = "Tick at least one quality level and one preset first.";
    return;
  }
  matrix.cells = makeMatrixCells(combos);
  matrix.segmentStart = encodeTest.startTime;
  matrix.segmentLength = encodeTest.duration;
  matrix.selectedKey = null;
  matrix.cancelRequested = false;
  matrix.running = true;
  const fill = startRunUi(ui, true);
  const repaint = (): void => renderMatrixSection(ui.matrixSec, vt, ui);
  repaint();

  try {
    ui.note.textContent = "Loading ffmpeg.wasm…";
    await ensureFfmpegLoaded();
    ui.note.textContent = "Writing input to virtual filesystem…";
    const source = await readSource();

    for (let i = 0; i < matrix.cells.length; i++) {
      const cell = matrix.cells[i];
      if (stopRequested()) {
        cell.status = "skipped";
        continue;
      }
      cell.status = "running";
      repaint();
      const label = `${i + 1}/${matrix.cells.length}: ${describeSettings(cell.combo)}`;
      const showProgress = (fraction: number): void => {
        // One bar for the whole sweep: a combination's own progress is a fraction of its share.
        const overall = ((i + fraction) / matrix.cells.length) * 100;
        if (fill) fill.style.width = overall.toFixed(1) + "%";
        ui.note.textContent = `Encoding ${label} — ${(fraction * 100).toFixed(0)}%`;
      };
      showProgress(0);
      const startedAt = performance.now();
      try {
        const blob = await encodeSegment(matrixCliState(cli, cell.combo), source, ui, showProgress);
        cell.elapsedMs = performance.now() - startedAt;
        cell.bytes = blob.size;
        cell.blob = blob;
        cell.status = "done";
        try {
          cell.segmentSeconds = await segmentDuration(blob);
        } catch {
          // The projection falls back to the requested length; the encode itself is still good.
          cell.segmentSeconds = null;
        }
      } catch (err) {
        cell.status = "failed";
        cell.error = err instanceof Error ? err.message : String(err);
        logLine(ui.log, `${describeSettings(cell.combo)}: ${cell.error}`, "error");
      }
      evictBeyondBudget(matrix.cells, MATRIX_RETAINED_BYTES, matrix.selectedKey);
      repaint();
    }

    const best = bestReductionCell(matrix.cells);
    if (!best) {
      ui.note.textContent = "No combination produced an encode. Try faster presets or a shorter segment.";
      ui.progress.style.display = "none";
      return;
    }
    ui.note.textContent = `Loading the best reduction (${describeSettings(best.combo)}) into the A/B window…`;
    await selectMatrixCell(best, vt, ui);
    if (fill) {
      fill.style.width = "100%";
      fill.classList.add("done");
    }
    const progress = matrixProgress(matrix.cells);
    ui.note.textContent =
      progress.failed || progress.skipped
        ? `${progress.done} of ${progress.total} encoded` +
          (progress.failed ? `, ${progress.failed} failed` : "") +
          (progress.skipped ? `, ${progress.skipped} skipped` : "")
        : "";
  } catch (err) {
    reportRunFailure(err, ui);
  } finally {
    matrix.running = false;
    endRunUi(ui);
    repaint();
  }
}

function reportRunFailure(err: unknown, ui: RunUi): void {
  console.error("[encoding-helper] encode test failed:", err);
  ui.note.textContent = "Failed: " + (err instanceof Error ? err.message : String(err));
  logLine(ui.log, String(err instanceof Error ? err.message : err), "error");
  // Nothing to show the length of, so the bar goes rather than freezing wherever it stopped.
  ui.progress.style.display = "none";
}

/** Puts one square of the grid in the A/B window, re-encoding it if its output has been released. */
async function selectMatrixCell(cell: MatrixCell, vt: TrackInfo, ui: RunUi): Promise<void> {
  let blob = cell.blob;
  if (!blob) {
    ui.note.textContent = `Re-encoding ${describeSettings(cell.combo)} for the A/B window…`;
    const source = await readSource();
    blob = await encodeSegment(matrixCliState(cli, cell.combo), source, ui, () => {});
    cell.blob = blob;
    cell.bytes = blob.size;
  }
  encodeTest.matrix.selectedKey = cell.combo.key;
  await loadEncodedIntoAB(blob, cell.combo, vt, ui.resultSec);
  renderMatrixSection(ui.matrixSec, vt, ui);
}

/** What a matrix square projects the whole file to, on the segment that square was encoded from. */
function matrixCellEstimate(cell: MatrixCell): SizeEstimate | null {
  if (cell.bytes == null || !state.source) return null;
  const matrix = encodeTest.matrix;
  return estimateSizeSavings({
    originalTotalBytes: state.source.size,
    totalSeconds: state.duration ?? 0,
    segmentStartSeconds: matrix.segmentStart,
    segmentSeconds: cell.segmentSeconds && cell.segmentSeconds > 0 ? cell.segmentSeconds : matrix.segmentLength,
    encodedSegmentBytes: cell.bytes,
    samples: state.samples,
  });
}

function renderMatrixSection(sec: HTMLDivElement, vt: TrackInfo, ui: RunUi): void {
  const matrix = encodeTest.matrix;
  sec.innerHTML = "";
  if (!matrix.cells.length) {
    sec.style.display = "none";
    return;
  }
  sec.style.display = "block";
  sec.append(h("h2", null, "Matrix Results"));
  const best = bestReductionCell(matrix.cells);
  sec.append(renderMatrixSummary(best, matrixCellEstimate));
  sec.append(
    renderMatrixTable({
      cells: matrix.cells,
      bestKey: best?.combo.key ?? null,
      selectedKey: matrix.selectedKey,
      estimate: matrixCellEstimate,
      // Squares stay unclickable while the sweep runs: loading one can mean re-encoding it, and
      // there is only one encoder.
      onSelect: matrix.running || encodeTest.running ? undefined : (cell) => void selectMatrixCell(cell, vt, ui),
    }),
  );

  const progress = matrixProgress(matrix.cells);
  const legend = [
    `${progress.done} of ${progress.total} encoded`,
    progress.failed ? `${progress.failed} failed` : "",
    progress.skipped ? `${progress.skipped} skipped` : "",
    "★ largest reduction",
    "each square shows the projected whole-file change, the size it projects to, and the encode's own time",
  ].filter(Boolean);
  sec.append(h("div", "matrix-legend", legend.join(" · ")));

  const selected = matrix.cells.find((c) => c.combo.key === matrix.selectedKey);
  if (selected) {
    const apply = h("button", "btn sm sec", "Use these settings in the CLI command");
    apply.type = "button";
    apply.addEventListener("click", () => {
      cli.quality = selected.combo.quality;
      cli.crf = selected.combo.crf;
      cli.preset = selected.combo.preset;
      syncQualityControls();
      apply.textContent = "Applied";
    });
    sec.append(apply);
  }
}

// Halts the previous run's playback loop, so a fresh comparison does not leave one decoding frames
// into the canvases it just replaced.
let stopActivePlayback: (() => void) | null = null;

function renderCompareResult(resultSec: HTMLDivElement, vt: TrackInfo): void {
  stopActivePlayback?.();
  resultSec.innerHTML = "";
  resultSec.style.display = "block";
  resultSec.append(h("h2", null, "Side-by-Side"));

  // The settings the loaded encode was made with, which in matrix mode is the winning square's
  // rather than whatever the dropdowns happen to say.
  const settings = encodeTest.activeCombo ?? cliSettings(cli);
  const g = h("div", "grid");
  g.append(
    gridItem(
      "Segment",
      `${encodeTest.startTime.toFixed(1)}s–${(encodeTest.startTime + encodeTest.duration).toFixed(1)}s`,
    ),
    gridItem(
      "Quality",
      settings.quality === "custom" ? `Custom (CRF ${settings.crf})` : `${settings.quality} (CRF ${settings.crf})`,
    ),
    gridItem("Preset", settings.preset),
    gridItem("Encoded Segment Size", fmtBytes(encodeTest.encodedSize)),
  );
  resultSec.append(g);

  // The size question is half of what the tab is for, so its headline goes above the panes rather
  // than below the controls, where the detail and the caveats follow it.
  const estimate = currentSizeEstimate();
  if (estimate) resultSec.append(h("h3", null, "Estimated Data Savings"), renderSavingsStrip(estimate));

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
    h(
      "span",
      "pane-label",
      `Encoded (${settings.quality === "custom" ? "CRF " + settings.crf : settings.quality}, ${settings.preset})`,
    ),
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
  const playBtn = h("button", "btn sm sec", "Play");
  playBtn.type = "button";
  const zoomBtns = h("div", "zoom-buttons");
  // Wheel zoom is the fast path, but it is unavailable on a trackpad-less mouse or a touch device,
  // so every zoom move is reachable from a button too.
  const zoomOutBtn = h("button", "btn sm sec zoom-step", "−");
  zoomOutBtn.type = "button";
  zoomOutBtn.title = "Zoom out";
  zoomOutBtn.setAttribute("aria-label", "Zoom out");
  const zoomInBtn = h("button", "btn sm sec zoom-step", "+");
  zoomInBtn.type = "button";
  zoomInBtn.title = "Zoom in";
  zoomInBtn.setAttribute("aria-label", "Zoom in");
  const fitBtn = h("button", "btn sm sec", "Fit");
  fitBtn.type = "button";
  const actualBtn = h("button", "btn sm sec", "Actual Size (100%)");
  actualBtn.type = "button";
  zoomBtns.append(zoomOutBtn, zoomInBtn, fitBtn, actualBtn);
  controls.append(playBtn, scrub, scrubLabel, zoomBtns);
  resultSec.append(controls);

  if (estimate) resultSec.append(...renderSavingsDetail(estimate));

  const syncZoomButtons = (scale: number): void => {
    zoomOutBtn.disabled = scale <= ZOOM_MIN;
    zoomInBtn.disabled = scale >= ZOOM_MAX;
  };
  const zoomPan = attachSyncedZoomPan(stage, [origCanvas, encCanvas], [origGrid, encGrid], syncZoomButtons);
  zoomOutBtn.addEventListener("click", () => zoomPan.zoomBy(1 / ZOOM_BUTTON_STEP));
  zoomInBtn.addEventListener("click", () => zoomPan.zoomBy(ZOOM_BUTTON_STEP));
  fitBtn.addEventListener("click", () => zoomPan.fit());
  actualBtn.addEventListener("click", () => zoomPan.actualSize());
  syncZoomButtons(zoomPan.state.scale);

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
  const showTime = (relT: number): void => {
    scrub.value = String((relT / encodeTest.duration) * 1000);
    scrubLabel.textContent = relT.toFixed(2) + "s";
  };

  // Playback decodes both panes per frame, so it is paced off the wall clock and asks for whichever
  // frame the elapsed time lands on: when decoding cannot keep up it drops frames rather than
  // drifting into slow motion, keeping the two sides on the same timeline.
  const frameStep = 1 / (vt.packetRate && vt.packetRate > 0 ? vt.packetRate : 30);
  let playing = false;
  let baseT = 0;
  let baseWall = 0;
  // Bumped on every press of Play, so a loop still awaiting a frame from the run before it neither
  // keeps drawing nor stops the run that replaced it.
  let playRun = 0;
  const rebase = (relT: number): void => {
    baseT = relT;
    baseWall = performance.now();
  };
  const stopPlayback = (): void => {
    playing = false;
    playBtn.textContent = "Play";
  };
  stopActivePlayback = stopPlayback;
  const runPlayback = async (run: number): Promise<void> => {
    try {
      while (playing && run === playRun) {
        const relT = baseT + (performance.now() - baseWall) / 1000;
        if (relT >= encodeTest.duration) {
          showTime(encodeTest.duration);
          await drawAt(encodeTest.duration);
          return;
        }
        showTime(relT);
        await drawAt(relT);
        const nextWall = baseWall + (Math.floor((relT - baseT) / frameStep) + 1) * frameStep * 1000;
        const wait = nextWall - performance.now();
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      }
    } catch (err) {
      // A frame that will not decode ends playback rather than leaving the button stuck on "Pause".
      console.error("[encoding-helper] playback stopped:", err);
    } finally {
      if (run === playRun) stopPlayback();
    }
  };
  playBtn.addEventListener("click", () => {
    if (playing) {
      stopPlayback();
      return;
    }
    const at = (parseFloat(scrub.value) / 1000) * encodeTest.duration;
    // Pressing Play with the playhead parked at the end starts the segment over.
    rebase(at >= encodeTest.duration - frameStep ? 0 : at);
    playing = true;
    playBtn.textContent = "Pause";
    void runPlayback(++playRun);
  });

  scrub.addEventListener("input", () => {
    const relT = (parseFloat(scrub.value) / 1000) * encodeTest.duration;
    scrubLabel.textContent = relT.toFixed(2) + "s";
    // Scrubbing mid-playback moves the playhead instead of fighting the loop for the slider.
    if (playing) rebase(relT);
    void drawAt(relT);
  });
  void drawAt(0);
}
