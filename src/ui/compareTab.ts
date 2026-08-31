// Tab: Compare Quality — a sweep of the encoder settings, laid out as a grid, with the square you
// pick shown against the original in the A/B window below it.
//
// The settings ranking is a table's job, but whether the winner still looks acceptable is only ever
// a question for the eye, and that is the window under the grid. Trying one setting on its own —
// which this tab used to offer as a mode — is the Reencode with FFmpeg tab's job now, beside the
// command that setting comes to.

import { buildFfmpegArgs, describeScale, formatCliCommand, isDownscale } from "../lib/cliCommand";
import { copyToClipboard, h, infoIcon } from "../lib/dom";
import { MATRIX_CACHE_INFO, RESOLUTION_INFO, SCALER_INFO, X264_PRESET_INFO } from "../lib/explainers";
import { matrixCache, measurementKey, videoChecksum } from "../lib/matrixCache";
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
  // One "select all" for the whole sweep rather than one per list: it ticks every value on every
  // axis, for the runs that want the full grid rather than the defaults.
  const selectAll = h("button", "axis-select-all", "select all");
  selectAll.type = "button";
  selectAll.title = "Tick every value on every axis";
  selectAll.addEventListener("click", () => {
    for (const list of axisSettings.querySelectorAll<HTMLDivElement>(".axis-list")) {
      const boxes = list.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
      boxes.forEach((b) => (b.checked = true));
      // One change per list: the listener reads the whole list, so the first box speaks for it.
      boxes[0].dispatchEvent(new Event("change"));
    }
  });
  const selectAllRow = h("div", "row axis-select-all-row");
  selectAllRow.append(reuseCachedToggle(), selectAll);
  axisSettings.append(selectAllRow, axisRow, outerRow);
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
  field.append(head);
  const list = h("div", listClass ? `axis-list ${listClass}` : "axis-list");
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
    list.append(wrap);
  }
  field.append(list);
  return field;
}

/**
 * Whether a sweep may read squares back from earlier runs of this file rather than encoding them.
 *
 * Ticked, since a measurement that has already been made is a measurement, and the whole cost of
 * this tab is making them. It is a tick box rather than nothing at all because "encode it again"
 * is a real request: encoding times are the one figure in the grid that is about this machine on
 * this day rather than about the video, and a file edited under the same name is a file this
 * cannot tell apart on a checksum of a few megabytes.
 */
function reuseCachedToggle(): HTMLLabelElement {
  const wrap = h("label", "axis-option matrix-reuse");
  const box = h("input");
  box.type = "checkbox";
  box.checked = encodeTest.matrix.reuseCached;
  box.addEventListener("change", () => {
    encodeTest.matrix.reuseCached = box.checked;
  });
  wrap.append(box, document.createTextNode(" Reuse earlier measurements"));
  wrap.append(infoIcon(MATRIX_CACHE_INFO, "About reusing earlier measurements"));
  return wrap;
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
  matrix.windows = await sweepWindows();
  encodeTest.sampled = matrix.windows;
  matrix.segmentStart = matrix.windows[0]?.startSeconds ?? encodeTest.startTime;
  matrix.segmentLength = encodeTest.duration;
  matrix.selectedKey = null;
  await encodeCells(matrix.cells, vt, ui);
}

/**
 * The stretches this sweep will cover.
 *
 * Where the fields still describe the stretches already in hand, those are what a run covers, as
 * they always have been. Where they do not — nothing sampled yet this session, or a duration or a
 * count that has moved — an earlier run of this same file at these same fields gets its stretches
 * taken up again instead of a fresh random draw, because its measurements were made over them and
 * two squares measured over different seconds are not comparable. Without this, a reloaded page
 * would sample somewhere else and every cached measurement of the file would be unreachable.
 */
async function sweepWindows(): Promise<SampleWindow[]> {
  const checksum = await fileChecksum();
  const fresh = runWindows();
  // windowsForRun hands the stretches already in hand straight back when they still fit what the
  // fields ask for, so anything else is a fresh random draw — which is exactly when an earlier
  // run's stretches are worth taking up instead.
  const remembered =
    fresh !== encodeTest.sampled && encodeTest.matrix.reuseCached && checksum
      ? await matrixCache.recallWindows(checksum, encodeTest.duration, encodeTest.segments)
      : null;
  const windows = remembered ?? fresh;
  if (checksum) matrixCache.rememberWindows(checksum, encodeTest.duration, encodeTest.segments, windows);
  return windows;
}

/**
 * The loaded file's checksum, or null when there is none to take.
 *
 * A file that cannot be checksummed is a file with no cache: nothing is read back for it and
 * nothing is written under it, which costs the encoding a sweep would have cost anyway.
 */
async function fileChecksum(): Promise<string | null> {
  if (!state.source) return null;
  try {
    return await videoChecksum(state.source);
  } catch (err) {
    console.warn("[encoding-helper] could not identify the video for the measurement cache:", err);
    return null;
  }
}

/** What one square is remembered under: this file, this command, these stretches. */
function cellCacheKey(checksum: string, cell: MatrixCell): string | null {
  const info = currentVideoInfo();
  if (!info) return null;
  return measurementKey(checksum, buildFfmpegArgs(matrixCliState(cli, cell.combo), info), matrixWindows());
}

/**
 * Fills in every square this file has already been measured at, and hands back the rest.
 *
 * A square read back holds no output — only the numbers were kept — so it behaves exactly like one
 * whose output was evicted mid-run: it is in the table, and clicking it encodes that combination to
 * fill the A/B window.
 */
async function applyCachedMeasurements(queue: MatrixCell[], checksum: string, ui: MatrixUi): Promise<MatrixCell[]> {
  const keys = new Map(queue.map((cell) => [cell, cellCacheKey(checksum, cell)]));
  const held = await matrixCache.readMeasurements([...keys.values()].filter((key) => key != null));
  const remaining: MatrixCell[] = [];
  for (const cell of queue) {
    const key = keys.get(cell);
    const measurement = key ? held.get(key) : undefined;
    if (!measurement) {
      remaining.push(cell);
      continue;
    }
    cell.status = "done";
    cell.bytes = measurement.bytes;
    cell.segmentSeconds = measurement.segmentSeconds;
    cell.elapsedMs = measurement.elapsedMs;
    cell.blobs = null;
    cell.fromCache = true;
    cell.error = null;
  }
  const reused = queue.length - remaining.length;
  if (reused) {
    logLine(ui.log, `Read ${reused} of ${queue.length} squares back from earlier runs of this file`, "info");
  }
  return remaining;
}

/** Remembers what a square just measured, so a later sweep of this file need not measure it again.
 * Written whatever the tick box says, so switching the reuse back on finds what the runs it was off
 * for measured. */
function rememberMeasurement(checksum: string | null, cell: MatrixCell): void {
  if (!checksum || cell.bytes == null) return;
  const key = cellCacheKey(checksum, cell);
  if (key) {
    matrixCache.writeMeasurement(key, {
      bytes: cell.bytes,
      segmentSeconds: cell.segmentSeconds,
      elapsedMs: cell.elapsedMs,
    });
  }
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
    // Read back before anything is loaded: a grid the cache can answer in full is a run that never
    // starts an encoder, which is the difference between a sweep and a table appearing.
    const checksum = await fileChecksum();
    const pending = checksum && matrix.reuseCached ? await applyCachedMeasurements(queue, checksum, ui) : queue;
    // A retry queued mid-run joins what is actually being encoded, not what was asked for.
    activeQueue = pending;
    repaint();

    // The bar alone for the whole run, however many cores are filling it: it counts finished
    // squares and the in-flight fractions between them.
    //
    // No line of words beside it. Naming the combinations in flight ran to a paragraph that
    // rewrote itself every few seconds and shifted the grid below it down the page as it wrapped,
    // and counting them instead still left a line restating what the bar and the squares already
    // say: the squares themselves mark which ones are encoding, in the place the eye is already
    // on. The note is kept for what the bar cannot say — loading, stopping, and what a finished
    // sweep failed or skipped.
    const inFlight = new Map<string, number>();
    const showProgress = (): void => {
      // A stopped run leaves the bar where it got to instead of creeping on as the last cores
      // unwind: the figures it would show are of a sweep that is no longer happening.
      if (stopRequested()) return;
      const finished = queue.filter((c) => c.status === "done" || c.status === "failed").length;
      const partial = [...inFlight.values()].reduce((sum, f) => sum + f, 0);
      if (fill) fill.style.width = (((finished + partial) / queue.length) * 100).toFixed(1) + "%";
      // Whatever phase wrote there last ("Loading ffmpeg.wasm…") is over once squares are being
      // encoded, so it goes rather than standing for the rest of the sweep.
      ui.note.textContent = "";
    };

    // Squares read back are squares finished, so the bar starts wherever the cache got it to.
    showProgress();

    if (pending.length) {
      ui.note.textContent = "Loading ffmpeg.wasm…";
      const workers = acquireWorkers(pending.length);
      await workers[0].load();
      inputs = await prepareRun(matrixWindows(), workers, ui);
      if (workers.length > 1) logLine(ui.log, `Encoding on ${workers.length} cores at once`, "info");
      await drainWithPool(
        pending,
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
            cell.blobs = encoded.blobs;
            cell.segmentSeconds = encoded.measured.reduce((sum, w) => sum + w.seconds, 0);
            cell.status = "done";
            cell.fromCache = false;
            rememberMeasurement(checksum, cell);
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
    }
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
      ui.note.textContent = "Loading the best reduction into the A/B window…";
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
    // The writes a sweep issued are settled here rather than left in flight, so a page closed on
    // the last square still has it next time.
    void matrixCache.flush();
    await dropWholeFileInput(inputs);
    activeQueue = null;
    matrix.running = false;
    endRunUi(ui);
    repaint();
  }
}

/**
 * Whether a square is on its way into the A/B window right now.
 *
 * Getting one there usually means encoding it again — most squares have had their outputs released
 * to stay inside the memory budget — and there is one encoder, so the grid takes no second click
 * while that is in flight, exactly as it takes none during a sweep.
 */
let selecting = false;

/**
 * Puts one square of the grid in the A/B window, re-encoding it if its outputs have been released.
 *
 * The ring moves to the clicked square before any of that happens. A square whose outputs are gone
 * is seconds of encoding away from the window, and a ring left on the square still showing for that
 * long reads as the click having missed rather than as work in progress; it goes back only if the
 * square never makes it, since then the old one really is what the window holds.
 */
async function selectMatrixCell(cell: MatrixCell, vt: TrackInfo, ui: MatrixUi): Promise<void> {
  const matrix = encodeTest.matrix;
  const previousKey = matrix.selectedKey;
  matrix.selectedKey = cell.combo.key;
  selecting = true;
  ui.runButton.disabled = true;
  renderMatrixSection(ui.matrixSec, vt, ui);
  renderSelectedCommand(ui.cmdSec);
  try {
    let blobs = cell.blobs;
    if (!blobs) {
      // Its outputs were dropped to stay inside the memory budget, so the square is encoded again —
      // over the same stretches the sweep measured, which are usually still cut and waiting. All of
      // them, not just one: the window plays every stretch the square was measured over. The bar
      // below says a run is going; the note does not say it again.
      const workers = acquireWorkers(matrixWindows().length);
      const inputs = await prepareRun(matrixWindows(), workers, ui);
      try {
        blobs = (await encodeWindows(matrixCliState(cli, cell.combo), inputs, workers, ui, () => {})).blobs;
      } finally {
        await dropWholeFileInput(inputs);
      }
      cell.blobs = blobs;
      cell.bytes = blobs.reduce((sum, blob) => sum + blob.size, 0);
    }
    const heldBytes = blobs.reduce((sum, blob) => sum + blob.size, 0);
    // The A/B window compares against the seconds the grid was measured over, which the start and
    // duration fields may have been moved off since.
    syncSegmentToMatrix();
    await loadEncodedIntoAB(blobs, cell.combo, vt, ui.resultSec, {
      bytes: cell.bytes ?? heldBytes,
      windows: matrixCellWindows(cell),
    });
  } catch (err) {
    matrix.selectedKey = previousKey;
    throw err;
  } finally {
    selecting = false;
    // A sweep re-enables its own button when it ends; this only undoes the disabling above.
    if (!encodeTest.running) ui.runButton.disabled = false;
    renderMatrixSection(ui.matrixSec, vt, ui);
    renderSelectedCommand(ui.cmdSec);
  }
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
  const sweeping = matrix.running || encodeTest.running;
  const busy = sweeping || selecting;
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
      // whatever is already using it. A failed square is different: retrying it mid-sweep joins the
      // queue the sweep is already working through, rather than asking for a second encode
      // alongside it. There is no queue to join outside a sweep, so a retry then waits its turn.
      onSelect: busy
        ? undefined
        : (cell) => void selectMatrixCell(cell, vt, ui).catch((err) => reportRunFailure(err, ui)),
      onRetry: matrix.running
        ? (cell) => queueRetry(cell, ui, () => renderMatrixSection(sec, vt, ui))
        : busy
          ? undefined
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
  const cmdPre = h("pre", "cmd", formatCliCommand(buildFfmpegArgs(matrixCliState(cli, cell.combo), info)));
  sec.append(cmdPre);
  const copyBtn = h("button", "btn sm", "Copy Command");
  copyBtn.type = "button";
  copyBtn.addEventListener("click", () => copyToClipboard(cmdPre.textContent || "", copyBtn));
  sec.append(copyBtn);
}
