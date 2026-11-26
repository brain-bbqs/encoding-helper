// The Compare Quality tab: a sweep of the encoder settings, laid out as a grid, with the square you
// pick shown against the original in the A/B window below it.
//
// The settings ranking is a table's job, but whether the winner still looks acceptable is only ever
// a question for the eye, and that is the window under the grid. Trying one setting on its own
// (which this tab used to offer as a mode) is the Reencode with FFmpeg tab's job now, beside the
// command that setting comes to.

import { errorMessage } from "@brain-bbqs/utils";
import { buildFfmpegArgs, describeScale, formatCliCommand, isDownscale } from "../lib/cliCommand";
import { button, h } from "@brain-bbqs/ui";
import { cmdBlock, section } from "../lib/dom";
import {
  claimEncoder,
  encoderBusy,
  holdsEncoder,
  releaseEncoder,
  throwIfAbandoned,
  throwIfStopped,
  type EncoderRun,
} from "../lib/encoderRun";
import { describeFrameRate } from "../lib/format";
import { FRAME_RATE_INFO, RESOLUTION_INFO, SCALER_INFO, X264_PRESET_INFO } from "../lib/explainers";
import { matrixCache, measurementKey, videoChecksum } from "../lib/matrixCache";
import {
  bestReductionCell,
  buildMatrixCombos,
  describeSettings,
  evictBeyondBudget,
  fpsForFraction,
  hasRun,
  heldBytes,
  isUnmeasured,
  makeMatrixCells,
  MATRIX_FPS_FRACTIONS,
  MATRIX_PRESETS,
  MATRIX_QUALITIES,
  MATRIX_RETAINED_BYTES,
  MATRIX_SCALERS,
  MATRIX_SCALES,
  matrixCliState,
  matrixProgress,
} from "../lib/qualityMatrix";
import { drainWithPool } from "../lib/ffmpegPool";
import { cli, currentVideoInfo, sampledEncode, state, videoTrackInfo } from "../lib/state";
import { estimateForWindows, type SizeEstimate, windowsSeconds } from "../lib/sizeEstimate";
import type { MatrixCell, MatrixCombo, MatrixQuality, SampleWindow, Scaler, TrackInfo, X264Preset } from "../lib/types";
import { loadEncodedIntoAB, onAbDisplaced } from "./abPanel";
import { fieldHead, finishFill, logLine } from "./formControls";
import { renderMatrixSummary, renderMatrixTable } from "./matrixPanel";
import {
  acquireWorkers,
  dropWholeFileInput,
  encodeWindows,
  endRunUi,
  onRunPress,
  prepareRun,
  reportRunFailure,
  runControls,
  runWindows,
  sampleFields,
  startRunUi,
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
// shared state) so it survives the full-panel rebuild loading another file triggers: without it,
// every renderCompareTab() call would start the details closed again, forcibly collapsing it out
// from under whoever had it open.
let matrixSettingsOpen = false;

/** What the ticked axes come to, as the settings bar says it: the factors, and the runs they multiply to. */
function axisCountLabel(): string {
  const { qualities, presets, scales, scalers, fpsFractions } = sampledEncode.matrix;
  // The three outer axes are left out at one value each, where they multiply the sweep by one and
  // saying so would only make the bar longer.
  const counts = [qualities.length, presets.length];
  if (scales.length > 1) counts.push(scales.length);
  if (scalers.length > 1 && scales.some((s) => isDownscale(s))) counts.push(scalers.length);
  if (fpsFractions.length > 1) counts.push(fpsFractions.length);
  // The product is what the run costs, which is the number the factors are read for; a single
  // axis is its own product, so it is left to stand alone.
  const squares = counts.reduce((product, n) => product * n, 1);
  const total = `${squares} run${squares === 1 ? "" : "s"}`;
  return counts.length > 1 ? `${counts.join(" × ")} = ${total}` : total;
}

export function renderCompareTab(panel: HTMLElement): void {
  panel.innerHTML = "";
  const vt = videoTrackInfo();
  if (!vt || vt.codedWidth == null || vt.codedHeight == null) return;

  const sec = section("Compare Encoding Quality");

  sec.append(sampleFields("et"));

  const { nodes: runNodes, ui: runUi } = runControls(runActionLabel());
  const matrixSec = h("div", "section matrix-section");
  matrixSec.style.display = "none";
  const resultSec = h("div", "section");
  resultSec.style.display = "none";
  const cmdSec = h("div", "section");
  cmdSec.style.display = "none";
  const ui: MatrixUi = { ...runUi, matrixSec, resultSec, cmdSec };
  ui.syncRunAction = () => {
    ui.runButton.textContent = runActionLabel();
  };

  // Which values the sweep spans is a decision most runs never revisit, so the five tick lists fold
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
    axisCount.textContent = axisCountLabel();
  };
  // See resetStaleMatrix for why an axis change has to do more than recount.
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
      sampledEncode.matrix.qualities,
      (values) => {
        sampledEncode.matrix.qualities = values as MatrixQuality[];
        onAxisChange();
      },
    ),
  );
  axisRow.append(
    axisCheckboxes(
      "x264 presets",
      MATRIX_PRESETS.map((p) => ({ value: p, label: p })),
      sampledEncode.matrix.presets,
      (values) => {
        sampledEncode.matrix.presets = values as X264Preset[];
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
      sampledEncode.matrix.scales.map(String),
      (values) => {
        sampledEncode.matrix.scales = values.map(Number);
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
      sampledEncode.matrix.scalers,
      (values) => {
        sampledEncode.matrix.scalers = values as Scaler[];
        onAxisChange();
      },
      SCALER_INFO,
    ),
  );
  outerRow.append(
    axisCheckboxes(
      "Frame rates",
      MATRIX_FPS_FRACTIONS.map((f) => ({ value: String(f), label: describeFpsFraction(f) })),
      sampledEncode.matrix.fpsFractions.map(String),
      (values) => {
        sampledEncode.matrix.fpsFractions = values.map(Number);
        onAxisChange();
      },
      FRAME_RATE_INFO,
    ),
  );
  refreshAxisCount();
  // One "select all" for the whole sweep rather than one per list: it ticks every value on every
  // axis, for the runs that want the full grid rather than the defaults.
  const selectAll = button("axis-select-all", "select all");
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
  selectAllRow.append(selectAll);
  axisSettings.append(selectAllRow, axisRow, outerRow);
  sec.append(axisSettings);
  sec.append(...runNodes);
  panel.append(sec);
  panel.append(matrixSec);
  panel.append(resultSec);
  panel.append(cmdSec);

  // A single run started on the other tab takes the A/B window over, so no square is showing here
  // anymore and the command under it is no longer the command for what is on screen.
  onAbDisplaced(resultSec, () => {
    sampledEncode.matrix.selectedKey = null;
    repaintMatrix(vt, ui);
  });

  // Drawn from the state rather than only from a run, so a grid and the square showing in the A/B
  // window survive the panel being rebuilt.
  repaintMatrix(vt, ui);

  onRunPress(ui, () => {
    // A grid with holes in it is what the one button offers to fill: sweeping the whole thing
    // again would re-encode everything that already worked.
    const unmeasured = unmeasuredCells();
    return unmeasured.length ? retryCells(unmeasured, vt, ui) : runMatrix(vt, ui);
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
  // The same ⓘ the dropdown carries, since the sweep is over exactly what the dropdown sets.
  field.append(fieldHead(label, info));
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

/** The squares a sweep left without a size: the ones that failed, and the ones Stop never reached. */
function unmeasuredCells(): MatrixCell[] {
  return sampledEncode.matrix.cells.filter(isUnmeasured);
}

/**
 * Drops a grid that Stop or a failed square left with holes once the ticked axes no longer describe
 * it, so the run button offers a fresh sweep instead of resuming into a shape the checkboxes are not
 * asking for anymore.
 *
 * A finished grid (nothing left unmeasured) is left alone even once the axes move on: comparing it
 * while lining up the next sweep is the reason the table is drawn from the cells rather than from
 * the checkboxes in the first place (see matrixAxes), and "Run Matrix" already rebuilds it correctly
 * once pressed. It is only the half-run grid, offered back as something to resume, that has to match
 * what is ticked or it is resuming into the wrong shape.
 */
function resetStaleMatrix(ui: MatrixUi, vt: TrackInfo): void {
  const matrix = sampledEncode.matrix;
  if (matrix.running || encoderBusy() || !unmeasuredCells().length) return;
  const combos = tickedCombos();
  const keys = new Set(combos.map((c) => c.key));
  if (combos.length === matrix.cells.length && matrix.cells.every((c) => keys.has(c.combo.key))) return;
  matrix.cells = [];
  matrix.selectedKey = null;
  repaintMatrix(vt, ui);
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
 * the in-browser core (which then replaces itself: see `guarded` in createFfmpegWorker), and the point of running the
 * grid is to find out what this file and this browser can actually do.
 */
async function runMatrix(vt: TrackInfo, ui: MatrixUi): Promise<void> {
  const matrix = sampledEncode.matrix;
  const combos = tickedCombos();
  if (!combos.length) {
    ui.note.textContent = "Tick at least one quality level and one preset first.";
    return;
  }
  // Taken before the file is read to sample it, which for a URL can be seconds of reading: nothing
  // else may start encoding in that gap.
  const run = claimEncoder("Compare Quality", true, ui.note);
  if (!run) return;
  matrix.cells = makeMatrixCells(combos);
  matrix.selectedKey = null;
  await encodeCells(run, matrix.cells, vt, ui, true);
}

/**
 * Fixes the stretches a fresh sweep covers.
 *
 * Fixed here rather than read per encode, so a square retried after the fields have been moved
 * still covers the seconds the rest of the grid was measured over. Sampled once for the whole
 * sweep for the same reason squared: two squares measured over different stretches of video are
 * not comparable, which is the only thing the grid is for.
 */
async function sampleSweep(run: EncoderRun): Promise<void> {
  const matrix = sampledEncode.matrix;
  matrix.windows = await sweepWindows(run);
  sampledEncode.sampled = matrix.windows;
  matrix.segmentStart = matrix.windows[0]?.startSeconds ?? sampledEncode.startTime;
  matrix.segmentLength = sampledEncode.duration;
}

/**
 * The stretches this sweep will cover.
 *
 * Where the fields still describe the stretches already in hand, those are what a run covers, as
 * they always have been. Where they do not (nothing sampled yet this session, or a duration or a
 * count that has moved), an earlier run of this same file at these same fields gets its stretches
 * taken up again instead of a fresh random draw, because its measurements were made over them and
 * two squares measured over different seconds are not comparable. Without this, a reloaded page
 * would sample somewhere else and every cached measurement of the file would be unreachable.
 */
async function sweepWindows(run: EncoderRun): Promise<SampleWindow[]> {
  const checksum = await fileChecksum();
  // A file loaded meanwhile took the encoder from this run, and the fields and file read below are
  // the next file's. A Stop alone waits for the stretches to be fixed (encodeCells acts on it right
  // after), so the squares it leaves unreached are later run over the stretches the fields asked for.
  throwIfAbandoned(run);
  const fresh = runWindows();
  // windowsForRun hands the stretches already in hand straight back when they still fit what the
  // fields ask for, so anything else is a fresh random draw, which is exactly when an earlier
  // run's stretches are worth taking up instead.
  const remembered =
    fresh !== sampledEncode.sampled && checksum
      ? await matrixCache.recallWindows(checksum, sampledEncode.duration, sampledEncode.segments)
      : null;
  throwIfAbandoned(run);
  const windows = remembered ?? fresh;
  if (checksum) matrixCache.rememberWindows(checksum, sampledEncode.duration, sampledEncode.segments, windows);
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
 * A square read back holds no output (only the numbers were kept), so it behaves exactly like one
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
    markMeasured(cell, measurement, null, true);
  }
  const reused = queue.length - remaining.length;
  if (reused) {
    logLine(ui.log, `Read ${reused} of ${queue.length} squares back from earlier runs of this file`, "info");
  }
  return remaining;
}

/** Remembers what a square just measured, so a later sweep of this file need not measure it again. */
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

/** What a square read before a retry put it back in line. */
type CellOutcome = Pick<MatrixCell, "status" | "error">;

/** The queue a sweep's cores are working through, with the sweep and what each square it retries
 * read before it was put back in line. */
interface ActiveQueue {
  run: EncoderRun;
  cells: MatrixCell[];
  retried: Map<MatrixCell, CellOutcome>;
}

/**
 * The queue the sweep in progress is working through, or null whenever no core will take another
 * square from it.
 *
 * Held so a square can be retried *during* a sweep. drainWithPool (lib/ffmpegPool) reads
 * `queue.length` on every pass: appending to the live queue puts the square at the back of the run that is already going,
 * which is what clicking a failed square while the sweep is still working now does.
 */
let activeQueue: ActiveQueue | null = null;

/** Lets go of `run`'s queue, unless a later sweep's has taken its place. */
function forgetQueue(run: EncoderRun): void {
  if (activeQueue?.run === run) activeQueue = null;
}

/**
 * A failed or skipped square clicked: put at the back of the queue a sweep's cores are still
 * working through, or else run on its own.
 *
 * On its own it takes the encoder like any run, so it is refused, saying why, while another run has
 * it. That includes this tab's own sweep once its cores have left the queue (while the winner goes
 * into the A/B window, say), and one that has been stopped: nothing would take the square from the
 * queue then, and it would sit there queued.
 */
function retryCell(cell: MatrixCell, vt: TrackInfo, ui: MatrixUi): void {
  if (activeQueue && !activeQueue.run.stopped) queueRetry(cell, activeQueue, ui, () => renderMatrixSection(vt, ui));
  else void retryCells([cell], vt, ui);
}

/** Puts a failed square back in the running sweep's queue, to be re-encoded when it is reached. */
function queueRetry(cell: MatrixCell, queue: ActiveQueue, ui: MatrixUi, repaint: () => void): void {
  if (!isUnmeasured(cell)) return;
  markPending(cell, queue.retried);
  queue.cells.push(cell);
  logLine(ui.log, `Queued a retry of ${describeSettings(cell.combo)}`, "info");
  repaint();
}

/** Runs the squares that never produced a size, in place, keeping everything the sweep measured. */
async function retryCells(cells: MatrixCell[], vt: TrackInfo, ui: MatrixUi): Promise<void> {
  const run = claimEncoder("Compare Quality", true, ui.note);
  if (!run) return;
  await encodeCells(run, cells, vt, ui, false);
}

/** Puts a square back in line to be encoded, clearing what its last attempt failed with, and keeps
 * that in `retried` for a run that ends without measuring it. */
function markPending(cell: MatrixCell, retried: Map<MatrixCell, CellOutcome>): void {
  retried.set(cell, { status: cell.status, error: cell.error });
  cell.status = "pending";
  cell.error = null;
}

/**
 * Settles the squares a run leaves in line, since no run will take them once it has ended.
 *
 * A square a retry put back in line goes back to what it read before, so a retry that never
 * reaches it leaves it as it was: a failed square still failed, and saying what with. The rest of
 * `queue` is a fresh sweep's squares, which had nothing before it, so they are skipped, which
 * offers them to run later.
 */
function settleUnreached(queue: MatrixCell[], retried: Map<MatrixCell, CellOutcome>): void {
  for (const [cell, before] of retried) {
    if (cell.status === "pending") Object.assign(cell, before);
  }
  for (const cell of queue) {
    if (cell.status === "pending") cell.status = "skipped";
  }
}

/** Writes a square's measurement onto it, whether just encoded or read back from the cache. */
function markMeasured(
  cell: MatrixCell,
  measured: { bytes: number; segmentSeconds: number | null; elapsedMs: number | null },
  blobs: Blob[] | null,
  fromCache: boolean,
): void {
  cell.status = "done";
  cell.bytes = measured.bytes;
  cell.segmentSeconds = measured.segmentSeconds;
  cell.elapsedMs = measured.elapsedMs;
  cell.blobs = blobs;
  cell.fromCache = fromCache;
  cell.error = null;
}

/** The line under the bar once a sweep ends: nothing when every square encoded, else what did not. */
function sweepNote(progress: ReturnType<typeof matrixProgress>): string {
  return progress.failed || progress.skipped
    ? `${progress.done} of ${progress.total} encoded` +
        (progress.failed ? `, ${progress.failed} failed` : "") +
        (progress.skipped ? `, ${progress.skipped} skipped` : "")
    : "";
}

/**
 * Encodes each of `queue` in turn, filling its square in as it goes, then puts the grid's largest
 * reduction in the A/B window.
 *
 * Shared by the sweep and by a retry, so a square encoded on the second attempt is measured exactly
 * as its neighbours were. A `fresh` sweep samples its stretches first, over squares that are new; a
 * retry keeps the stretches the grid was measured over, and puts its squares back in line.
 *
 * `run` already holds the encoder, taken by the caller before anything was awaited, and is given
 * back here when the run ends.
 */
async function encodeCells(
  run: EncoderRun,
  queue: MatrixCell[],
  vt: TrackInfo,
  ui: MatrixUi,
  fresh: boolean,
): Promise<void> {
  const matrix = sampledEncode.matrix;
  matrix.running = true;
  const retried = new Map<MatrixCell, CellOutcome>();
  if (!fresh) for (const cell of queue) markPending(cell, retried);
  activeQueue = { run, cells: queue, retried };
  const fill = startRunUi(ui);
  const repaint = (): void => renderMatrixSection(vt, ui);
  repaint();

  let inputs: RunInputs | null = null;
  try {
    if (fresh) await sampleSweep(run);
    // Read back before anything is loaded: a grid the cache can answer in full is a run that never
    // starts an encoder, which is the difference between a sweep and a table appearing.
    const checksum = await fileChecksum();
    throwIfStopped(run);
    const pending = checksum ? await applyCachedMeasurements(queue, checksum, ui) : queue;
    throwIfStopped(run);
    // A retry queued mid-run joins what is actually being encoded, not what was asked for.
    activeQueue = { run, cells: pending, retried };
    repaint();

    // The bar alone for the whole run, however many cores are filling it: it counts finished
    // squares and the in-flight fractions between them.
    //
    // No line of words beside it. Naming the combinations in flight ran to a paragraph that
    // rewrote itself every few seconds and shifted the grid below it down the page as it wrapped,
    // and counting them instead still left a line restating what the bar and the squares already
    // say: the squares themselves mark which ones are encoding, in the place the eye is already
    // on. The note is kept for what the bar cannot say: loading, stopping, and what a finished
    // sweep failed or skipped.
    const inFlight = new Map<string, number>();
    const showProgress = (): void => {
      // A stopped run leaves the bar where it got to instead of creeping on as the last cores
      // unwind: the figures it would show are of a sweep that is no longer happening.
      if (run.stopped) return;
      const finished = queue.filter(hasRun).length;
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
      const workers = acquireWorkers(run, pending.length);
      await workers[0].load();
      const prepared = await prepareRun(run, matrixWindows(), workers, ui);
      inputs = prepared;
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
            const encoded = await encodeWindows(
              run,
              matrixCliState(cli, cell.combo),
              prepared,
              [worker],
              ui,
              (fraction) => {
                inFlight.set(cell.combo.key, fraction);
                showProgress();
              },
            );
            const elapsedMs = performance.now() - startedAt;
            markMeasured(
              cell,
              { bytes: encoded.bytes, segmentSeconds: windowsSeconds(encoded.measured), elapsedMs },
              encoded.blobs,
              false,
            );
            rememberMeasurement(checksum, cell);
          } catch (err) {
            if (run.stopped) {
              // A core terminated by Stop rejects whatever it was running, so the square was never
              // measured: one a retry put back in line reads what it did before (see
              // settleUnreached), and a new one is skipped, as the ones never reached are.
              Object.assign(cell, retried.get(cell) ?? { status: "skipped", error: null });
            } else {
              cell.status = "failed";
              cell.error = errorMessage(err);
              logLine(ui.log, `${describeSettings(cell.combo)}: ${cell.error}`, "error");
            }
          }
          inFlight.delete(cell.combo.key);
          // Nothing more is measured once the run is stopped, and after a file load the grid below
          // is the next file's, so there is nothing of this run's left to evict or show.
          if (run.stopped) return;
          evictBeyondBudget(matrix.cells, MATRIX_RETAINED_BYTES, matrix.selectedKey);
          repaint();
          showProgress();
        },
        () => run.stopped,
      );
    }
    // No core takes another square from here on, so a retry clicked from now is a run of its own,
    // which this one, still holding the encoder while the winner loads, refuses.
    forgetQueue(run);
    if (run.stopped) {
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
        await selectMatrixCell(run, best, vt, ui);
      } catch (err) {
        // Stop pressed while the winner was being encoded again for the window: the run was
        // stopped, and says so, rather than reading as a winner the browser could not show.
        throwIfStopped(run);
        // The sweep measured everything it was asked to; only the preview of the winner failed,
        // which is a browser that will not decode what ffmpeg just wrote. Reporting that as the
        // run failing would throw away a grid full of good measurements.
        console.error("[encoding-helper] could not show the best square:", err);
        logLine(ui.log, "Encoded fine, but could not be shown: " + errorMessage(err), "warn");
      }
    }
    finishFill(fill);
    ui.note.textContent = sweepNote(matrixProgress(matrix.cells));
  } catch (err) {
    reportRunFailure(run, err, ui);
  } finally {
    // Whichever way the run ended, so that one stopped, or failing, before it reaches a square
    // leaves none of them queued either.
    forgetQueue(run);
    settleUnreached(queue, retried);
    // A file loaded or Reset mid-run has already stopped this run, terminating its cores, and taken
    // the encoder back; the grid is the next file's by then, so all this run has left to hand back
    // is its own controls.
    if (holdsEncoder(run)) await dropWholeFileInput(inputs);
    const current = releaseEncoder(run);
    if (current) matrix.running = false;
    endRunUi(ui);
    if (current) repaint();
  }
}

/**
 * The run putting a square into the A/B window right now, or null.
 *
 * Getting one there usually means encoding it again (most squares have had their outputs released
 * to stay inside the memory budget), and there is one encoder, so the grid takes no second click
 * while that is in flight, exactly as it takes none during a sweep.
 */
let selecting: EncoderRun | null = null;

/**
 * A square clicked into the A/B window.
 *
 * Encoding it again takes the encoder like any run, so it is taken here, before anything is
 * awaited, and a click while another run has it is refused and says why.
 */
async function chooseMatrixCell(cell: MatrixCell, vt: TrackInfo, ui: MatrixUi): Promise<void> {
  const run = claimEncoder("Compare Quality", false, ui.note);
  if (!run) return;
  ui.runButton.disabled = true;
  try {
    await selectMatrixCell(run, cell, vt, ui);
  } catch (err) {
    reportRunFailure(run, err, ui);
  } finally {
    releaseEncoder(run);
    ui.runButton.disabled = false;
  }
}

/**
 * Puts one square of the grid in the A/B window, re-encoding it if its outputs have been released.
 *
 * The ring moves to the clicked square before any of that happens. A square whose outputs are gone
 * is seconds of encoding away from the window, and a ring left on the square still showing for that
 * long reads as the click having missed rather than as work in progress; it goes back only if the
 * square never makes it, since then the old one really is what the window holds.
 */
async function selectMatrixCell(run: EncoderRun, cell: MatrixCell, vt: TrackInfo, ui: MatrixUi): Promise<void> {
  const matrix = sampledEncode.matrix;
  const previousKey = matrix.selectedKey;
  matrix.selectedKey = cell.combo.key;
  selecting = run;
  repaintMatrix(vt, ui);
  try {
    let blobs = cell.blobs;
    if (!blobs) {
      // Its outputs were dropped to stay inside the memory budget, so the square is encoded again,
      // over the same stretches the sweep measured, which are usually still cut and waiting. All of
      // them, not just one: the window plays every stretch the square was measured over.
      const workers = acquireWorkers(run, matrixWindows().length);
      const inputs = await prepareRun(run, matrixWindows(), workers, ui);
      let bytes: number;
      try {
        ({ blobs, bytes } = await encodeWindows(run, matrixCliState(cli, cell.combo), inputs, workers, ui, () => {}));
      } finally {
        if (holdsEncoder(run)) await dropWholeFileInput(inputs);
      }
      throwIfStopped(run);
      cell.blobs = blobs;
      cell.bytes = bytes;
    }
    // The Duration field goes back to the length the grid was measured with, which it may have been
    // moved off since. The A/B window draws the original from the windows passed below.
    syncSegmentToMatrix();
    await loadEncodedIntoAB(
      blobs,
      cell.combo,
      vt,
      ui.resultSec,
      { bytes: cell.bytes ?? heldBytes(blobs), windows: matrixCellWindows(cell) },
      run,
    );
  } catch (err) {
    // Unless a file load took the encoder meanwhile, in which case the grid is the next file's.
    if (holdsEncoder(run)) matrix.selectedKey = previousKey;
    throw err;
  } finally {
    if (selecting === run) selecting = null;
    if (holdsEncoder(run)) repaintMatrix(vt, ui);
  }
}

/** What the ticked fractions come to for the loaded file: absolute rates, the source's own as null. */
function matrixFps(): (number | null)[] {
  return sampledEncode.matrix.fpsFractions.map((f) => fpsForFraction(f, state.fps));
}

/** The combinations the ticked axes currently ask for. */
function tickedCombos(): MatrixCombo[] {
  const m = sampledEncode.matrix;
  return buildMatrixCombos(m.qualities, m.presets, m.scales, m.scalers, matrixFps());
}

/** One tick's label: the source's own rate, or the rate the fraction comes to for this file. */
function describeFpsFraction(fraction: number): string {
  const rate = fpsForFraction(fraction, state.fps);
  if (rate == null) return "Source";
  return `${Math.round(fraction * 100)}% (${describeFrameRate(rate)})`;
}

/** The stretches the sweep covered, or the one segment it used before several were asked for. */
function matrixWindows(): SampleWindow[] {
  const matrix = sampledEncode.matrix;
  if (matrix.windows.length) return matrix.windows;
  return [{ startSeconds: matrix.segmentStart, seconds: matrix.segmentLength }];
}

/** Puts the start and duration back to what the sweep covered, so the Duration field shows the
 * length the grid was measured with. The A/B window's original side follows the windows it is
 * handed, not these. */
function syncSegmentToMatrix(): void {
  const matrix = sampledEncode.matrix;
  if (!(matrix.segmentLength > 0)) return;
  sampledEncode.startTime = matrix.segmentStart;
  sampledEncode.duration = matrix.segmentLength;
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
  const requested = windowsSeconds(windows);
  const measured = cell.segmentSeconds && cell.segmentSeconds > 0 ? cell.segmentSeconds : requested;
  const factor = requested > 0 ? measured / requested : 1;
  return windows.map((w) => ({ startSeconds: w.startSeconds, seconds: w.seconds * factor }));
}

/** What a matrix square projects the whole file to, on the segments that square was encoded from. */
function matrixCellEstimate(cell: MatrixCell): SizeEstimate | null {
  if (cell.bytes == null) return null;
  return estimateForWindows(matrixCellWindows(cell), cell.bytes);
}

function renderMatrixSection(vt: TrackInfo, ui: MatrixUi): void {
  const sec = ui.matrixSec;
  const matrix = sampledEncode.matrix;
  sec.innerHTML = "";
  if (!matrix.cells.length) {
    sec.style.display = "none";
    return;
  }
  sec.style.display = "block";
  sec.append(h("h2", null, "Matrix Results"));
  // What this tab has in flight itself. A run on the other tab is not counted: a click during one is
  // refused when it lands, and says why, rather than every square staying disabled until a later
  // repaint happens to notice that run has ended.
  const busy = matrix.running || (selecting != null && holdsEncoder(selecting));
  // Which combination wins is a statement about the whole sweep, so it waits for the whole sweep: a
  // ★ that hops from square to square as the grid fills in names the best of what has finished so
  // far, which is not the question the grid is being run to answer. A square that failed has run
  // (it produced no size, and it is not going to), so it does not hold the ranking up; one Stop left
  // unmeasured does, until the button below has run it.
  const unrun = matrix.cells.some((c) => !hasRun(c));
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
      // this tab's own sweep or square (and is refused, saying why, during the other tab's run: see
      // chooseMatrixCell). A failed square is different during a sweep: retrying it joins the
      // queue the sweep is already working through, rather than asking for a second encode
      // alongside it. Whether there is a queue to join is decided on the click (see retryCell),
      // since the sweep's cores leave it without the grid being drawn again. A square on its way
      // into the A/B window outside a sweep has no queue at all, so the retry waits for it too.
      onSelect: busy ? undefined : (cell) => void chooseMatrixCell(cell, vt, ui),
      onRetry: busy && !matrix.running ? undefined : (cell) => retryCell(cell, vt, ui),
    }),
  );
}

/** Redraws the grid and the command under it, which change together. */
function repaintMatrix(vt: TrackInfo, ui: MatrixUi): void {
  renderMatrixSection(vt, ui);
  renderSelectedCommand(ui.cmdSec);
}

/**
 * The ffmpeg command for the square currently in the A/B window, at the bottom of the page.
 *
 * A sweep is run to pick a setting, and the setting is only useful once it is applied to the whole
 * file, which is a job for ffmpeg on the machine holding the data, not for a browser tab. So the
 * winner (or whichever square was clicked instead of it) is written out as the command that
 * reproduces it, with everything the sweep does not touch (keyframe interval, B-frames, audio,
 * faststart) taken from the Reencode with FFmpeg tab as it stands.
 */
function renderSelectedCommand(sec: HTMLDivElement): void {
  sec.innerHTML = "";
  const info = currentVideoInfo();
  const selectedKey = sampledEncode.matrix.selectedKey;
  const cell = sampledEncode.matrix.cells.find((c) => c.combo.key === selectedKey);
  if (!info || !cell) {
    sec.style.display = "none";
    return;
  }
  sec.style.display = "block";
  sec.append(h("h2", null, "Run This Setting with ffmpeg"));
  sec.append(cmdBlock(formatCliCommand(buildFfmpegArgs(matrixCliState(cli, cell.combo), info))).wrap);
}
