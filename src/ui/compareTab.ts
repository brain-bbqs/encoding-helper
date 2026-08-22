// Tab: Compare Quality — a sweep of the encoder settings, laid out as a grid, with the square you
// pick shown against the original in the A/B window below it.
//
// The settings ranking is a table's job, but whether the winner still looks acceptable is only ever
// a question for the eye, and that is the window under the grid. Trying one setting on its own —
// which this tab used to offer as a mode — is the Reencode with FFmpeg tab's job now, beside the
// command that setting comes to.

import { buildFfmpegArgs, describeScale, formatCliCommand, isDownscale } from "../lib/cliCommand";
import { copyToClipboard, h, infoIcon, teachBox } from "../lib/dom";
import { RESOLUTION_INFO, SCALER_INFO, X264_PRESET_INFO } from "../lib/explainers";
import {
  bestReductionCell,
  buildMatrixCombos,
  describeSettings,
  evictBeyondBudget,
  makeMatrixCells,
  MATRIX_PRESETS,
  MATRIX_QUALITIES,
  MATRIX_RETAINED_BYTES,
  MATRIX_SCALERS,
  MATRIX_SCALES,
  matrixCliState,
  matrixProgress,
} from "../lib/qualityMatrix";
import { drainWithPool } from "../lib/ffmpegPool";
import { cli, currentVideoInfo, encodeTest, state } from "../lib/state";
import { estimateSizeSavings, type SizeEstimate } from "../lib/sizeEstimate";
import type { MatrixCell, MatrixQuality, SampleWindow, Scaler, TrackInfo, X264Preset } from "../lib/types";
import { loadEncodedIntoAB, onAbDisplaced } from "./abPanel";
import { logLine } from "./formControls";
import { renderMatrixSummary, renderMatrixTable } from "./matrixPanel";
import {
  acquireWorkers,
  dropWholeFileInput,
  encodeWindows,
  endRunUi,
  prepareRun,
  reportRunFailure,
  runControls,
  runWindows,
  sampleFields,
  startRunUi,
  stopRequested,
  syncSampleFields,
  type RunInputs,
  type RunUi,
} from "./segmentRun";

/** The run's controls, plus the three sections a sweep fills in below them. */
interface MatrixUi extends RunUi {
  matrixSec: HTMLDivElement;
  resultSec: HTMLDivElement;
  cmdSec: HTMLDivElement;
}

// Whether the "Settings to sweep" <details> was left open, kept at module scope (rather than in
// shared state) so it survives the full-panel rebuild the Educational toggle triggers — without it,
// every renderCompareTab() call would start the details closed again, forcibly collapsing it out
// from under whoever had it open.
let matrixSettingsOpen = false;

export function renderCompareTab(panel: HTMLElement): void {
  panel.innerHTML = "";
  const vt = state.tracks?.find((t) => t.kind === "video");
  if (!vt || vt.codedWidth == null || vt.codedHeight == null) return;

  const sec = h("div", "section");
  sec.append(h("h2", null, "Compare Encoding Quality"));

  sec.append(sampleFields("et"));

  // Which values the sweep spans is a decision most runs never revisit, so the two tick lists fold
  // away behind a bar carrying what they currently come to. <details> rather than a hand-rolled
  // toggle: it opens on click, on Enter, and for a page search hitting text inside it.
  const axisSettings = h("details", "matrix-settings");
  axisSettings.open = matrixSettingsOpen;
  axisSettings.addEventListener("toggle", () => {
    matrixSettingsOpen = axisSettings.open;
  });
  const axisSummary = h("summary");
  axisSummary.append(h("span", "matrix-settings-gear", "⚙"), h("span", null, "Settings to sweep"));
  const axisCount = h("span", "matrix-settings-count");
  const refreshAxisCount = (): void => {
    const { qualities, presets, scales, scalers } = encodeTest.matrix;
    // The two outer axes are left out at one value each, where they multiply the sweep by one and
    // saying so would only make the bar longer.
    const counts = [qualities.length, presets.length];
    if (scales.length > 1) counts.push(scales.length);
    if (scalers.length > 1 && scales.some((s) => isDownscale(s))) counts.push(scalers.length);
    axisCount.textContent = counts.join(" × ");
  };
  // `ui` is only assigned further down, once the sections an axis change needs to repaint exist —
  // but nothing here runs until a checkbox fires, by which point it is. See resetStaleMatrix for why
  // this has to happen at all.
  const onAxisChange = (): void => {
    refreshAxisCount();
    resetStaleMatrix(ui, vt);
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
        onAxisChange();
      },
    ),
  );
  axisRow.append(
    axisCheckboxes(
      "x264 presets",
      MATRIX_PRESETS.map((p) => ({ value: p, label: p })),
      encodeTest.matrix.presets,
      (values) => {
        encodeTest.matrix.presets = values as X264Preset[];
        onAxisChange();
      },
      X264_PRESET_INFO,
    ),
  );
  const outerRow = h("div", "row");
  outerRow.append(
    // The four resolutions as a 2×2 grid rather than a wrapped line: their labels carry pixel
    // dimensions of uneven width, and columns keep them from ragging.
    axisCheckboxes(
      "Resolutions",
      MATRIX_SCALES.map((s) => ({ value: String(s), label: describeScale(s, currentVideoInfo()) })),
      encodeTest.matrix.scales.map(String),
      (values) => {
        encodeTest.matrix.scales = values.map(Number);
        onAxisChange();
      },
      RESOLUTION_INFO,
      "axis-list-grid",
    ),
  );
  outerRow.append(
    axisCheckboxes(
      "Scalers",
      MATRIX_SCALERS.map((s) => ({ value: s, label: s })),
      encodeTest.matrix.scalers,
      (values) => {
        encodeTest.matrix.scalers = values as Scaler[];
        onAxisChange();
      },
      SCALER_INFO,
    ),
  );
  refreshAxisCount();
  axisSettings.append(axisRow, outerRow);
  sec.append(axisSettings);

  const { nodes, ui: runUi } = runControls(runActionLabel());
  sec.append(...nodes);
  panel.append(sec);

  const matrixSec = h("div", "section matrix-section");
  matrixSec.style.display = "none";
  panel.append(matrixSec);

  const resultSec = h("div", "section");
  resultSec.style.display = "none";
  panel.append(resultSec);

  const cmdSec = h("div", "section");
  cmdSec.style.display = "none";
  panel.append(cmdSec);

  const ui: MatrixUi = { ...runUi, matrixSec, resultSec, cmdSec };
  ui.syncRunAction = () => {
    ui.runButton.textContent = runActionLabel();
  };
  // A single run started on the other tab takes the A/B window over, so no square is showing here
  // anymore and the command under it is no longer the command for what is on screen.
  onAbDisplaced(resultSec, () => {
    encodeTest.matrix.selectedKey = null;
    renderMatrixSection(matrixSec, vt, ui);
    renderSelectedCommand(cmdSec);
  });

  // Drawn from the state rather than only from a run, so a grid and the square showing in the A/B
  // window survive the panel being rebuilt.
  renderMatrixSection(matrixSec, vt, ui);
  renderSelectedCommand(cmdSec);

  ui.runButton.addEventListener("click", () => {
    // Disabled here as well as by the run itself, so a second click cannot land in the gap before
    // the run has started.
    ui.runButton.disabled = true;
    // A grid with holes in it is what the one button offers to fill: sweeping the whole thing
    // again would re-encode everything that already worked.
    const unmeasured = unmeasuredCells();
    const run = (): Promise<void> => (unmeasured.length ? retryCells(unmeasured, vt, ui) : runMatrix(vt, ui));
    // A run puts the button back itself when it ends; this is for the presses that never start
    // one, such as a sweep with nothing ticked to sweep.
    void run().finally(() => {
      if (encodeTest.running) return;
      ui.runButton.disabled = false;
      ui.syncRunAction();
    });
  });
}

/** One axis of the matrix as a tick list, reporting the whole selection on every change. */
function axisCheckboxes(
  label: string,
  options: { value: string; label: string }[],
  selected: string[],
  onChange: (values: string[]) => void,
  info?: string | null,
  listClass?: string,
): HTMLDivElement {
  const field = h("div", "field");
  const head = h("div", "field-head");
  head.append(h("label", "field-label", label));
  // The same ⓘ the dropdown carries, since the sweep is over exactly what the dropdown sets.
  if (info) head.append(infoIcon(info, `About ${label}`));
  // Ticking the whole axis one box at a time is the only multi-click chore these lists have, so
  // each carries a "select all" beside its label.
  const selectAll = h("button", "axis-select-all", "select all");
  selectAll.type = "button";
  selectAll.title = `Tick every ${label} option`;
  head.append(selectAll);
  field.append(head);
  const list = h("div", listClass ? `axis-list ${listClass}` : "axis-list");
  const boxes: HTMLInputElement[] = [];
  selectAll.addEventListener("click", () => {
    boxes.forEach((b) => (b.checked = true));
    onChange(boxes.map((b) => b.value));
  });
  for (const opt of options) {
    const wrap = h("label", "axis-option");
    const box = h("input");
    box.type = "checkbox";
    box.value = opt.value;
    box.checked = selected.includes(opt.value);
    box.addEventListener("change", () => onChange(boxes.filter((b) => b.checked).map((b) => b.value)));
    boxes.push(box);
    wrap.append(box, document.createTextNode(" " + opt.label));
    list.append(wrap);
  }
  field.append(list);
  return field;
}

/** The squares a sweep left without a size: the ones that failed, and the ones Stop never reached. */
function unmeasuredCells(): MatrixCell[] {
  return encodeTest.matrix.cells.filter((c) => c.status === "failed" || c.status === "skipped");
}

/**
 * Drops a grid that Stop or a failed square left with holes once the ticked axes no longer describe
 * it, so the run button offers a fresh sweep instead of resuming into a shape the checkboxes are not
 * asking for anymore.
 *
 * A finished grid — nothing left unmeasured — is left alone even once the axes move on: comparing it
 * while lining up the next sweep is the reason the table is drawn from the cells rather than from
 * the checkboxes in the first place (see matrixAxes), and "Run Matrix" already rebuilds it correctly
 * once pressed. It is only the half-run grid, offered back as something to resume, that has to match
 * what is ticked or it is resuming into the wrong shape.
 */
function resetStaleMatrix(ui: MatrixUi, vt: TrackInfo): void {
  const matrix = encodeTest.matrix;
  if (matrix.running || encodeTest.running || !unmeasuredCells().length) return;
  const combos = buildMatrixCombos(matrix.qualities, matrix.presets, matrix.scales, matrix.scalers);
  const keys = new Set(combos.map((c) => c.key));
  if (combos.length === matrix.cells.length && matrix.cells.every((c) => keys.has(c.combo.key))) return;
  matrix.cells = [];
  matrix.selectedKey = null;
  renderMatrixSection(ui.matrixSec, vt, ui);
  renderSelectedCommand(ui.cmdSec);
  ui.syncRunAction();
}

/** What the run button says, which is what pressing it would do to the grid as it stands. */
function runActionLabel(): string {
  const unmeasured = unmeasuredCells();
  if (!unmeasured.length) return "Run Matrix";
  const failed = unmeasured.filter((c) => c.status === "failed").length;
  return failed === unmeasured.length ? `Retry ${failed} failed` : `Run ${unmeasured.length} unmeasured`;
}

/**
 * Encodes the sampled stretches once per combination, filling the grid in as it goes, then loads
 * the largest reduction into the A/B window.
 *
 * A failed combination is a result rather than the end of the sweep: the slowest presets can exhaust
 * the in-browser core (which then replaces itself — see resetFfmpeg), and the point of running the
 * grid is to find out what this file and this browser can actually do.
 */
async function runMatrix(vt: TrackInfo, ui: MatrixUi): Promise<void> {
  if (encodeTest.running) return;
  const matrix = encodeTest.matrix;
  const combos = buildMatrixCombos(matrix.qualities, matrix.presets, matrix.scales, matrix.scalers);
  if (!combos.length) {
    ui.note.textContent = "Tick at least one quality level and one preset first.";
    return;
  }
  matrix.cells = makeMatrixCells(combos);
  // Fixed here rather than read per encode, so a square retried after the fields have been moved
  // still covers the seconds the rest of the grid was measured over. Sampled once for the whole
  // sweep for the same reason squared: two squares measured over different stretches of video are
  // not comparable, which is the only thing the grid is for.
  matrix.windows = runWindows();
  encodeTest.sampled = matrix.windows;
  matrix.segmentStart = matrix.windows[0]?.startSeconds ?? encodeTest.startTime;
  matrix.segmentLength = encodeTest.duration;
  matrix.selectedKey = null;
  await encodeCells(matrix.cells, vt, ui);
}

/**
 * The queue the run in progress is working through, or null between runs.
 *
 * Held so a square can be retried *during* a sweep. The loop below reads `queue.length` on every
 * pass: appending to the live queue puts the square at the back of the run that is already going,
 * which is what clicking a failed square while the sweep is still working now does.
 */
let activeQueue: MatrixCell[] | null = null;

/** Puts a failed square back in the running sweep's queue, to be re-encoded when it is reached. */
function queueRetry(cell: MatrixCell, ui: MatrixUi, repaint: () => void): void {
  if (!activeQueue || (cell.status !== "failed" && cell.status !== "skipped")) return;
  cell.status = "pending";
  cell.error = null;
  activeQueue.push(cell);
  logLine(ui.log, `Queued a retry of ${describeSettings(cell.combo)}`, "info");
  repaint();
}

/** Runs the squares that never produced a size, in place, keeping everything the sweep measured. */
async function retryCells(cells: MatrixCell[], vt: TrackInfo, ui: MatrixUi): Promise<void> {
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
async function encodeCells(queue: MatrixCell[], vt: TrackInfo, ui: MatrixUi): Promise<void> {
  const matrix = encodeTest.matrix;
  matrix.running = true;
  activeQueue = queue;
  const fill = startRunUi(ui);
  const repaint = (): void => renderMatrixSection(ui.matrixSec, vt, ui);
  repaint();

  let inputs: RunInputs | null = null;
  try {
    ui.note.textContent = "Loading ffmpeg.wasm…";
    const workers = acquireWorkers(queue.length);
    await workers[0].load();
    inputs = await prepareRun(matrixWindows(), workers, ui);
    if (workers.length > 1) logLine(ui.log, `Encoding on ${workers.length} cores at once`, "info");

    // One bar and one line for the whole run, however many cores are filling it: with several of
    // them there is no single "current" square to report, so the bar counts finished ones and the
    // in-flight fractions between them, and the line names what is being worked on.
    const inFlight = new Map<string, number>();
    const showProgress = (): void => {
      // A stopped run leaves the bar where it got to instead of creeping on as the last cores
      // unwind: the figures it would show are of a sweep that is no longer happening.
      if (stopRequested()) return;
      const finished = queue.filter((c) => c.status === "done" || c.status === "failed").length;
      const partial = [...inFlight.values()].reduce((sum, f) => sum + f, 0);
      if (fill) fill.style.width = (((finished + partial) / queue.length) * 100).toFixed(1) + "%";
      const running = queue.filter((c) => c.status === "running").map((c) => describeSettings(c.combo));
      ui.note.textContent = running.length
        ? `Encoding ${finished + running.length}/${queue.length}: ${running.join(" · ")}`
        : `Encoded ${finished}/${queue.length}`;
    };

    await drainWithPool(
      queue,
      workers,
      async (cell, worker) => {
        cell.status = "running";
        inFlight.set(cell.combo.key, 0);
        repaint();
        showProgress();
        const startedAt = performance.now();
        try {
          const encoded = await encodeWindows(matrixCliState(cli, cell.combo), inputs!, [worker], ui, (fraction) => {
            inFlight.set(cell.combo.key, fraction);
            showProgress();
          });
          cell.elapsedMs = performance.now() - startedAt;
          cell.bytes = encoded.bytes;
          cell.blob = encoded.first;
          cell.segmentSeconds = encoded.measured.reduce((sum, w) => sum + w.seconds, 0);
          cell.status = "done";
        } catch (err) {
          // A core terminated by Stop rejects whatever it was running; the square it was on was
          // never measured, which is what "skipped" already means for the ones never reached.
          cell.status = stopRequested() ? "skipped" : "failed";
          cell.error = cell.status === "failed" ? (err instanceof Error ? err.message : String(err)) : null;
          if (cell.error) logLine(ui.log, `${describeSettings(cell.combo)}: ${cell.error}`, "error");
        }
        inFlight.delete(cell.combo.key);
        evictBeyondBudget(matrix.cells, MATRIX_RETAINED_BYTES, matrix.selectedKey);
        repaint();
        showProgress();
      },
      stopRequested,
    );
    // Whatever Stop left unreached is not pending, it is not going to run.
    for (const cell of queue) {
      if (cell.status === "pending") cell.status = "skipped";
    }
    if (stopRequested()) {
      const stoppedAt = matrixProgress(matrix.cells);
      ui.note.textContent = `Stopped: ${stoppedAt.done} of ${stoppedAt.total} encoded`;
      ui.progress.style.display = "none";
      return;
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
      try {
        await selectMatrixCell(best, vt, ui);
      } catch (err) {
        // The sweep measured everything it was asked to; only the preview of the winner failed,
        // which is a browser that will not decode what ffmpeg just wrote. Reporting that as the
        // run failing would throw away a grid full of good measurements.
        console.error("[encoding-helper] could not show the best square:", err);
        logLine(
          ui.log,
          "Encoded fine, but could not be shown: " + (err instanceof Error ? err.message : String(err)),
          "warn",
        );
      }
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
    await dropWholeFileInput(inputs);
    activeQueue = null;
    matrix.running = false;
    endRunUi(ui);
    repaint();
  }
}

/** Puts one square of the grid in the A/B window, re-encoding it if its output has been released. */
async function selectMatrixCell(cell: MatrixCell, vt: TrackInfo, ui: MatrixUi): Promise<void> {
  const matrix = encodeTest.matrix;
  let blob = cell.blob;
  if (!blob) {
    // Its output was dropped to stay inside the memory budget, so the square is encoded again —
    // over the same stretches the sweep measured, which are usually still cut and waiting.
    ui.note.textContent = `Re-encoding ${describeSettings(cell.combo)} for the A/B window…`;
    const workers = acquireWorkers(1);
    const inputs = await prepareRun(matrixWindows(), workers, ui);
    try {
      blob = (await encodeWindows(matrixCliState(cli, cell.combo), inputs, workers, ui, () => {})).first;
    } finally {
      await dropWholeFileInput(inputs);
    }
    cell.blob = blob;
    cell.bytes = blob.size;
  }
  // The A/B window compares against the seconds the grid was measured over, which the start and
  // duration fields may have been moved off since.
  syncSegmentToMatrix();
  matrix.selectedKey = cell.combo.key;
  await loadEncodedIntoAB(blob, cell.combo, vt, ui.resultSec, {
    bytes: cell.bytes ?? blob.size,
    windows: matrixCellWindows(cell),
  });
  renderMatrixSection(ui.matrixSec, vt, ui);
  renderSelectedCommand(ui.cmdSec);
}

/** The stretches the sweep covered, or the one segment it used before several were asked for. */
function matrixWindows(): SampleWindow[] {
  const matrix = encodeTest.matrix;
  if (matrix.windows.length) return matrix.windows;
  return [{ startSeconds: matrix.segmentStart, seconds: matrix.segmentLength }];
}

/** Puts the segment fields back to the stretch the sweep covered, so the A/B window's original side
 * shows the same seconds as the encode beside it. */
function syncSegmentToMatrix(): void {
  const matrix = encodeTest.matrix;
  if (!(matrix.segmentLength > 0)) return;
  encodeTest.startTime = matrix.segmentStart;
  encodeTest.duration = matrix.segmentLength;
  syncSampleFields();
}

/**
 * The stretches a square was measured over, at the seconds its output actually came to.
 *
 * A trim lands a frame either side of the length asked for, so the stretches are stretched to what
 * this square's output measured, keeping both halves of its ratio on equal terms. Shared with the
 * A/B window below the grid, so the square and the card it opens report the same saving rather
 * than two numbers a fraction of a percent apart.
 */
function matrixCellWindows(cell: MatrixCell): SampleWindow[] {
  const windows = matrixWindows();
  const requested = windows.reduce((sum, w) => sum + w.seconds, 0);
  const measured = cell.segmentSeconds && cell.segmentSeconds > 0 ? cell.segmentSeconds : requested;
  const factor = requested > 0 ? measured / requested : 1;
  return windows.map((w) => ({ startSeconds: w.startSeconds, seconds: w.seconds * factor }));
}

/** What a matrix square projects the whole file to, on the segments that square was encoded from. */
function matrixCellEstimate(cell: MatrixCell): SizeEstimate | null {
  if (cell.bytes == null || !state.source) return null;
  const windows = matrixCellWindows(cell);
  return estimateSizeSavings({
    originalTotalBytes: state.source.size,
    totalSeconds: state.duration ?? 0,
    segmentStartSeconds: windows[0]?.startSeconds ?? encodeTest.matrix.segmentStart,
    segmentSeconds: windows.reduce((sum, w) => sum + w.seconds, 0),
    windows,
    encodedSegmentBytes: cell.bytes,
    samples: state.samples,
  });
}

function renderMatrixSection(sec: HTMLDivElement, vt: TrackInfo, ui: MatrixUi): void {
  const matrix = encodeTest.matrix;
  sec.innerHTML = "";
  if (!matrix.cells.length) {
    sec.style.display = "none";
    return;
  }
  sec.style.display = "block";
  sec.append(h("h2", null, "Matrix Results"));
  const busy = matrix.running || encodeTest.running;
  // Which combination wins is a statement about the whole sweep, so it waits for the whole sweep: a
  // ★ that hops from square to square as the grid fills in names the best of what has finished so
  // far, which is not the question the grid is being run to answer. A square that failed has run —
  // it produced no size, and it is not going to — so it does not hold the ranking up; one Stop left
  // unmeasured does, until the button below has run it.
  const unrun = matrix.cells.some((c) => c.status !== "done" && c.status !== "failed");
  const best = unrun ? null : bestReductionCell(matrix.cells);
  sec.append(
    renderMatrixSummary(
      best,
      matrixCellEstimate,
      busy ? "Ranked once every combination has run." : "Ranked once the unmeasured combinations have run.",
    ),
  );
  sec.append(
    renderMatrixTable({
      scaleLabel: (scale) => describeScale(scale, currentVideoInfo()),
      cells: matrix.cells,
      bestKey: best?.combo.key ?? null,
      selectedKey: matrix.selectedKey,
      estimate: matrixCellEstimate,
      // Loading a square can mean re-encoding it, and there is only one encoder, so that waits for
      // the run to finish. A failed square is different: retrying it mid-run joins the queue the
      // sweep is already working through, rather than asking for a second encode alongside it.
      onSelect: busy ? undefined : (cell) => void selectMatrixCell(cell, vt, ui),
      onRetry: busy
        ? (cell) => queueRetry(cell, ui, () => renderMatrixSection(sec, vt, ui))
        : (cell) => void retryCells([cell], vt, ui),
    }),
  );
}

/**
 * The ffmpeg command for the square currently in the A/B window, at the bottom of the page.
 *
 * A sweep is run to pick a setting, and the setting is only useful once it is applied to the whole
 * file — which is a job for ffmpeg on the machine holding the data, not for a browser tab. So the
 * winner (or whichever square was clicked instead of it) is written out as the command that
 * reproduces it, with everything the sweep does not touch — keyframe interval, B-frames, audio,
 * faststart — taken from the Reencode with FFmpeg tab as it stands.
 */
function renderSelectedCommand(sec: HTMLDivElement): void {
  sec.innerHTML = "";
  const info = currentVideoInfo();
  const selectedKey = encodeTest.matrix.selectedKey;
  const cell = encodeTest.matrix.cells.find((c) => c.combo.key === selectedKey);
  if (!info || !cell) {
    sec.style.display = "none";
    return;
  }
  sec.style.display = "block";
  sec.append(h("h2", null, "Run This Setting with ffmpeg"));
  sec.append(
    teachBox(
      `What the square in the A/B window above — <b>${describeSettings(cell.combo)}</b> — comes to as an ffmpeg ` +
        `command, over the whole file rather than the sampled seconds. Everything the sweep does not vary ` +
        `(keyframe interval, B-frames, audio, faststart) is taken from the <b>Reencode with FFmpeg</b> tab as it ` +
        `is set there now.`,
    ),
  );
  const cmdPre = h("pre", "cmd", formatCliCommand(buildFfmpegArgs(matrixCliState(cli, cell.combo), info)));
  sec.append(cmdPre);
  const copyBtn = h("button", "btn sm", "Copy Command");
  copyBtn.type = "button";
  copyBtn.addEventListener("click", () => copyToClipboard(cmdPre.textContent || "", copyBtn));
  sec.append(copyBtn);
}
