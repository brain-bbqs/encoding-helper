// Tab: Compare Quality — short-segment A/B comparison with synchronized pixel-level zoom & pan.
//
// Two modes share the one encoder and the one A/B window. A *single* run encodes the segment at the
// settings in the dropdowns, which is the tab's original job. *Matrix* mode runs the cartesian
// product of those same two dropdowns and lays the results out as a grid, then loads the largest
// reduction into the A/B window — the settings ranking is a table's job, but whether the winner
// still looks acceptable is only ever a question for the eye, and that is the window below it.

import { fetchFile } from "@ffmpeg/util";
import { buildFfmpegArgs, isDownscale, scaledDimensions } from "../lib/cliCommand";
import { gridItem, h, infoIcon, teachBox } from "../lib/dom";
import {
  MATRIX_MODE_TEACH,
  RESOLUTION_INFO,
  SCALER_INFO,
  UPSCALE_VIEW_INFO,
  X264_PRESET_INFO,
} from "../lib/explainers";
import {
  deleteFfmpegFile,
  ensureFfmpegInput,
  ensureFfmpegLoaded,
  parseFfmpegTimeSeconds,
  runFfmpegArgs,
  setFfmpegHandlers,
} from "../lib/ffmpegEngine";
import { ensureMediabunny } from "../lib/mediabunny";
import {
  bestReductionCell,
  buildMatrixCombos,
  cliSettings,
  describeSettings,
  DEFAULT_MATRIX_PRESETS,
  evictBeyondBudget,
  makeMatrixCells,
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
import { parseScale, parseScaler, scaleOptions, scalerOptions, syncQualityControls } from "./cliControls";
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

  // Resolution sits outside both mode blocks because it applies to either whole: a sweep runs at
  // one resolution, and comparing two of them means comparing two grids (see buildMatrixCombos).
  const resRow = h("div", "row");
  resRow.append(
    fieldSelect("etScale", "Resolution", scaleOptions(currentVideoInfo()), String(cli.scale), RESOLUTION_INFO),
  );
  const etScalerField = fieldSelect("etScaler", "Scaler", scalerOptions(), cli.scaler, SCALER_INFO);
  etScalerField.style.display = isDownscale(cli.scale) ? "" : "none";
  resRow.append(etScalerField);
  sec.append(resRow);

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
  // Which values the sweep spans is a decision most runs never revisit, so the two tick lists fold
  // away behind a bar carrying what they currently come to. <details> rather than a hand-rolled
  // toggle: it opens on click, on Enter, and for a page search hitting text inside it.
  const axisSettings = h("details", "matrix-settings");
  const axisSummary = h("summary");
  axisSummary.append(h("span", "matrix-settings-gear", "⚙"), h("span", null, "Settings to sweep"));
  const axisCount = h("span", "matrix-settings-count");
  const refreshAxisCount = (): void => {
    const { qualities, presets } = encodeTest.matrix;
    axisCount.textContent = `${qualities.length} × ${presets.length}`;
  };
  axisSummary.append(axisCount);
  axisSettings.append(axisSummary);
  const axisRow = h("div", "row");
  axisRow.append(
    axisCheckboxes(
      "Quality levels",
      MATRIX_QUALITIES.map((q) => ({ value: q, label: q })),
      encodeTest.matrix.qualities,
      (values) => {
        encodeTest.matrix.qualities = values as MatrixQuality[];
        refreshAxisCount();
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
        refreshAxisCount();
      },
      X264_PRESET_INFO,
    ),
  );
  refreshAxisCount();
  axisSettings.append(axisRow);
  matrixControls.append(axisSettings);
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
  };
  applyMode();

  document.getElementById("etStart")?.addEventListener("input", (e) => {
    encodeTest.startTime = parseFloat((e.target as HTMLInputElement).value) || 0;
  });
  document.getElementById("etDuration")?.addEventListener("input", (e) => {
    encodeTest.duration = parseFloat((e.target as HTMLInputElement).value) || 1;
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
  document.getElementById("etScale")?.addEventListener("change", (e) => {
    cli.scale = parseScale((e.target as HTMLSelectElement).value);
    syncQualityControls();
  });
  document.getElementById("etScaler")?.addEventListener("change", (e) => {
    cli.scaler = parseScaler((e.target as HTMLSelectElement).value);
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

/** What the source is called inside the core's filesystem, keeping its extension so ffmpeg can
 * still tell what it is being handed. */
function inputNameFor(source: SourceBytes): string {
  return "et_in" + extOf(source.name);
}

/**
 * Encodes the chosen segment at `cliState` and hands back the result. Shared by both modes, so a
 * matrix square and a single run are the same encode with the same trim.
 *
 * The input is left in the core's filesystem afterwards rather than deleted: a sweep encodes the
 * same seconds two dozen times over, and writing the whole file across to the worker again for each
 * set of settings would be the slowest part of it. The caller drops it when its run is over.
 */
async function encodeSegment(
  cliState: CliState,
  source: SourceBytes,
  segment: { start: number; length: number },
  ui: RunUi,
  onFraction: (fraction: number) => void,
): Promise<Blob> {
  const info = currentVideoInfo();
  if (!info) throw new Error("No video track loaded");
  const inputName = inputNameFor(source);
  const outputName = "et_out.mp4";
  const args = buildFfmpegArgs(cliState, info, inputName, outputName);
  // Trim after -i (not before) so the cut is frame-accurate rather than snapped to the nearest
  // preceding keyframe — the two sides need to show the same content, not just start "close enough."
  const iIdx = args.indexOf("-i");
  args.splice(iIdx + 2, 0, "-ss", String(segment.start), "-t", String(segment.length));
  setFfmpegHandlers((msg) => {
    logLine(ui.log, msg, "info");
    // Progress is taken from the status lines rather than from the core's own progress events,
    // which are a fraction of the whole input: a 3-second segment of a 30-second file would
    // creep to 10% and stop there, looking like it gave up rather than finished.
    const at = parseFfmpegTimeSeconds(msg);
    if (at == null || !(segment.length > 0)) return;
    onFraction(Math.min(1, Math.max(0, at / segment.length)));
  }, null);
  // Written only if this core does not already hold it, so a sweep pays for it once — and pays
  // again only after a crash, the replaced core starting with an empty filesystem.
  await ensureFfmpegInput(inputName, source.data);
  logLine(ui.log, "$ ffmpeg " + args.join(" "), "success");
  const { data } = await runFfmpegArgs(args, outputName);
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
  let source: SourceBytes | null = null;
  try {
    await ensureFfmpegLoaded();
    ui.note.textContent = "Writing input to virtual filesystem…";
    source = await readSource();
    ui.note.textContent = "Encoding test segment…";
    const segment = { start: encodeTest.startTime, length: encodeTest.duration };
    const blob = await encodeSegment(cli, source, segment, ui, (fraction) => {
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
    // The run is over, so the copy of the video inside the core goes: it is the size of the file
    // itself, and the next run writes whatever is loaded then.
    if (source) await deleteFfmpegFile(inputNameFor(source));
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
  const combos = buildMatrixCombos(matrix.qualities, matrix.presets, { scale: cli.scale, scaler: cli.scaler });
  if (!combos.length) {
    ui.note.textContent = "Tick at least one quality level and one preset first.";
    return;
  }
  matrix.cells = makeMatrixCells(combos);
  // Fixed here rather than read per encode, so a square retried after the fields have been moved
  // still covers the seconds the rest of the grid was measured over.
  matrix.segmentStart = encodeTest.startTime;
  matrix.segmentLength = encodeTest.duration;
  matrix.selectedKey = null;
  await encodeCells(matrix.cells, vt, ui);
}

/** Runs the squares that failed, in place, keeping everything the sweep already measured. */
async function retryCells(cells: MatrixCell[], vt: TrackInfo, ui: RunUi): Promise<void> {
  if (encodeTest.running || !cells.length) return;
  for (const cell of cells) {
    cell.status = "pending";
    cell.error = null;
  }
  await encodeCells(cells, vt, ui);
}

/**
 * Encodes each of `queue` in turn, filling its square in as it goes, then puts the grid's largest
 * reduction in the A/B window.
 *
 * Shared by the sweep and by a retry, so a square encoded on the second attempt is measured exactly
 * as its neighbours were.
 */
async function encodeCells(queue: MatrixCell[], vt: TrackInfo, ui: RunUi): Promise<void> {
  const matrix = encodeTest.matrix;
  const segment = { start: matrix.segmentStart, length: matrix.segmentLength };
  matrix.cancelRequested = false;
  matrix.running = true;
  const fill = startRunUi(ui, true);
  const repaint = (): void => renderMatrixSection(ui.matrixSec, vt, ui);
  repaint();

  let source: SourceBytes | null = null;
  try {
    ui.note.textContent = "Loading ffmpeg.wasm…";
    await ensureFfmpegLoaded();
    ui.note.textContent = "Writing input to virtual filesystem…";
    source = await readSource();

    for (let i = 0; i < queue.length; i++) {
      const cell = queue[i];
      if (stopRequested()) {
        cell.status = "skipped";
        continue;
      }
      cell.status = "running";
      repaint();
      const label = `${i + 1}/${queue.length}: ${describeSettings(cell.combo)}`;
      const showProgress = (fraction: number): void => {
        // One bar for the whole run: a combination's own progress is a fraction of its share.
        const overall = ((i + fraction) / queue.length) * 100;
        if (fill) fill.style.width = overall.toFixed(1) + "%";
        ui.note.textContent = `Encoding ${label} — ${(fraction * 100).toFixed(0)}%`;
      };
      showProgress(0);
      const startedAt = performance.now();
      try {
        const blob = await encodeSegment(matrixCliState(cli, cell.combo), source, segment, ui, showProgress);
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
    // A retry that did not beat what is already showing leaves the A/B window alone.
    if (best.combo.key !== matrix.selectedKey) {
      ui.note.textContent = `Loading the best reduction (${describeSettings(best.combo)}) into the A/B window…`;
      await selectMatrixCell(best, vt, ui);
    }
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
    // The run is over, so the copy of the video inside the core goes with it.
    if (source) await deleteFfmpegFile(inputNameFor(source));
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
  const matrix = encodeTest.matrix;
  const segment = { start: matrix.segmentStart, length: matrix.segmentLength };
  let blob = cell.blob;
  if (!blob) {
    ui.note.textContent = `Re-encoding ${describeSettings(cell.combo)} for the A/B window…`;
    const source = await readSource();
    try {
      blob = await encodeSegment(matrixCliState(cli, cell.combo), source, segment, ui, () => {});
    } finally {
      await deleteFfmpegFile(inputNameFor(source));
    }
    cell.blob = blob;
    cell.bytes = blob.size;
  }
  // The A/B window compares against the seconds the grid was measured over, which the start and
  // duration fields may have been moved off since.
  syncSegmentToMatrix();
  matrix.selectedKey = cell.combo.key;
  await loadEncodedIntoAB(blob, cell.combo, vt, ui.resultSec);
  renderMatrixSection(ui.matrixSec, vt, ui);
}

/** Puts the segment fields back to the stretch the sweep covered, so the A/B window's original side
 * shows the same seconds as the encode beside it. */
function syncSegmentToMatrix(): void {
  const matrix = encodeTest.matrix;
  if (!(matrix.segmentLength > 0)) return;
  encodeTest.startTime = matrix.segmentStart;
  encodeTest.duration = matrix.segmentLength;
  const startField = document.getElementById("etStart") as HTMLInputElement | null;
  if (startField) startField.value = matrix.segmentStart.toFixed(1);
  const durationField = document.getElementById("etDuration") as HTMLInputElement | null;
  if (durationField) durationField.value = String(matrix.segmentLength);
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
  const busy = matrix.running || encodeTest.running;
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
      onSelect: busy ? undefined : (cell) => void selectMatrixCell(cell, vt, ui),
      onRetry: busy ? undefined : (cell) => void retryCells([cell], vt, ui),
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

  const actions = h("div", "compare-run-buttons");
  // One press for a grid full of failures, since retrying them one square at a time is the same
  // work with more clicking. A single failure is one click on the square itself.
  const failed = matrix.cells.filter((c) => c.status === "failed");
  if (failed.length > 1 && !busy) {
    const retry = h("button", "btn sm sec", `Retry ${failed.length} failed`);
    retry.type = "button";
    retry.addEventListener("click", () => void retryCells(failed, vt, ui));
    actions.append(retry);
  }
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
    actions.append(apply);
  }
  if (actions.children.length) sec.append(actions);
}

// Halts the previous run's playback loop, so a fresh comparison does not leave one decoding frames
// into the canvases it just replaced.
let stopActivePlayback: (() => void) | null = null;

/** The facts above the panes: which seconds were encoded, at what settings, and what they came to.
 * The resolution row appears only when it is not the source's, since a row reading "100%" over
 * every comparison would say nothing. */
function compareSummaryGrid(settings: EncodeSettings, srcWidth: number, srcHeight: number): HTMLDivElement {
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
  );
  if (isDownscale(settings.scale)) {
    const out = scaledDimensions(srcWidth, srcHeight, settings.scale);
    g.append(
      gridItem(
        "Resolution",
        `${srcWidth}×${srcHeight} → ${out.width}×${out.height} ` +
          `(${Math.round(settings.scale * 100)}%, ${settings.scaler})`,
      ),
    );
  }
  g.append(gridItem("Encoded Segment Size", fmtBytes(encodeTest.encodedSize)));
  return g;
}

function renderCompareResult(resultSec: HTMLDivElement, vt: TrackInfo): void {
  stopActivePlayback?.();
  resultSec.innerHTML = "";
  resultSec.style.display = "block";
  resultSec.append(h("h2", null, "Side-by-Side"));

  // The settings the loaded encode was made with, which in matrix mode is the winning square's
  // rather than whatever the dropdowns happen to say.
  const settings = encodeTest.activeCombo ?? cliSettings(cli);
  const srcWidth = vt.codedWidth ?? 0;
  const srcHeight = vt.codedHeight ?? 0;
  // A downscaled encode is drawn back at the source's geometry, so the two panes stay one
  // coordinate system: the same zoom shows the same part of the frame on each side, and the pixel
  // grid keeps measuring source pixels rather than two different things per pane.
  const downscaled = isDownscale(settings.scale);
  const encSize = scaledDimensions(srcWidth, srcHeight, settings.scale);
  resultSec.append(compareSummaryGrid(settings, srcWidth, srcHeight));

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
  const encLabel = h(
    "span",
    "pane-label",
    `Encoded (${settings.quality === "custom" ? "CRF " + settings.crf : settings.quality}, ${settings.preset}` +
      (downscaled ? `, ${encSize.width}×${encSize.height}` : "") +
      ")",
  );
  // Restated whenever the view switches, since which of the two is on screen changes what the pane
  // is actually showing you.
  const syncEncLabel = (): void => {
    if (!downscaled) return;
    encLabel.title =
      `Encoded at ${encSize.width}×${encSize.height} and drawn back at ${srcWidth}×${srcHeight} ` +
      (encodeTest.upscaleSmoothing
        ? `with smoothing, which is closer to how a player would show it, at the cost of interpolating in ` +
          `detail the encode does not contain.`
        : `one block per encoded pixel, so nothing is interpolated in that the encode does not contain.`);
  };
  syncEncLabel();
  encPane.append(encLabel);
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
  // How the downscaled side is drawn back up is a genuine choice, not a default worth hiding:
  // blocks show exactly which pixels survived, smoothing shows what a player would put on screen.
  // Only offered when something is actually being drawn back up.
  const viewSelect = h("select", "compare-view-select");
  viewSelect.id = "etUpscaleView";
  viewSelect.setAttribute("aria-label", "How the downscaled encode is drawn");
  for (const [value, label] of [
    ["blocks", "Blocks (nearest)"],
    ["smooth", "Smooth"],
  ]) {
    const opt = h("option", null, label);
    opt.value = value;
    if ((value === "smooth") === encodeTest.upscaleSmoothing) opt.selected = true;
    viewSelect.append(opt);
  }
  if (downscaled) {
    const viewWrap = h("div", "compare-view");
    viewWrap.append(h("span", "compare-view-label", "Downscaled view"), viewSelect, infoIcon(UPSCALE_VIEW_INFO));
    controls.append(viewWrap);
  }
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

  // `target` is the geometry to draw into when it is not the frame's own: only a downscaled encode
  // has one, and it is the source's size. Whether that redraw interpolates is the viewer's call
  // (see the Downscaled view control); it makes no difference when the frame is already the right
  // size, since then nothing is being resampled.
  const drawFrame = (
    canvas: HTMLCanvasElement,
    frame: { canvas: HTMLCanvasElement | OffscreenCanvas } | null,
    target?: { width: number; height: number } | null,
  ): void => {
    if (!frame) return;
    const width = target?.width || frame.canvas.width;
    const height = target?.height || frame.canvas.height;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = encodeTest.upscaleSmoothing;
    ctx.drawImage(frame.canvas, 0, 0, width, height);
  };
  const drawAt = async (relT: number): Promise<void> => {
    if (!encodeTest.originalSink || !encodeTest.encodedSink) return;
    const [originalFrame, encodedFrame] = await Promise.all([
      encodeTest.originalSink.getCanvas(encodeTest.startTime + relT),
      encodeTest.encodedSink.getCanvas(Math.min(relT, Math.max(0, encodeTest.segDuration - 0.001))),
    ]);
    drawFrame(origCanvas, originalFrame);
    drawFrame(encCanvas, encodedFrame, downscaled ? { width: srcWidth, height: srcHeight } : null);
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

  viewSelect.addEventListener("change", () => {
    encodeTest.upscaleSmoothing = viewSelect.value === "smooth";
    syncEncLabel();
    // Redraw where the playhead already is, so the switch shows on the frame being looked at
    // rather than only on the next one.
    void drawAt((parseFloat(scrub.value) / 1000) * encodeTest.duration);
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
