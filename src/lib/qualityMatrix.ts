// Matrix mode: sweeping the Compare Quality tab's two dropdowns as a grid instead of one setting at
// a time.
//
// A single A/B run answers "what does *this* setting cost?", which is only half of the question
// anyone actually has: the other half is what the settings either side of it cost, and answering it
// one run at a time means remembering four numbers across four minutes of waiting. The matrix runs
// the cartesian product of the swept settings over the same few seconds of video, so the trade is
// read off one table rather than reconstructed from memory.
//
// Four axes: quality and preset, which every sweep covers, and resolution and its kernel, which
// start at one value each and multiply the sweep when a second is ticked.
//
// "Best" here means the largest byte reduction, and nothing else: no picture-quality metric is
// computed, so a higher CRF wins every time it is offered, and once the resolution axis is ticked
// past one value the smallest resolution wins outright, since it deletes bits faster than any
// setting on the other axes can. That is precisely why the whole grid is kept on screen with the
// winner marked rather than the winner alone — the eye in the A/B window is the quality half of the
// judgement, and the grid is what tells you how much the next row down would have saved.

import { CRF_MAP, DEFAULT_SCALER, isDownscale, SCALE_OPTIONS, SCALER_OPTIONS } from "./cliCommand";
import { fmtRate } from "./format";
import type { CliState, EncodeSettings, MatrixCell, MatrixCombo, MatrixQuality, Scaler, X264Preset } from "./types";

/** The quality dropdown's named entries, best picture first. "custom" is a single arbitrary CRF, so
 * it is not part of a sweep of the typical settings. */
export const MATRIX_QUALITIES: MatrixQuality[] = ["lossless", "high", "medium", "low"];

/**
 * Ticked when the tab first opens: the middle of the quality range.
 *
 * The ends earn their exclusion differently. `lossless` output runs to tens of megabytes over a few
 * seconds of video and mostly answers a question nobody sweeps for, and `low` sits at a CRF high
 * enough that its artifacts rarely survive the A/B eye anyway. Both remain one tick away.
 */
export const DEFAULT_MATRIX_QUALITIES: MatrixQuality[] = ["high", "medium"];

/** The preset dropdown, in x264's own order: fastest (and largest) first. */
export const MATRIX_PRESETS: X264Preset[] = [
  "ultrafast",
  "superfast",
  "veryfast",
  "faster",
  "fast",
  "medium",
  "slow",
  "slower",
  "veryslow",
];

/**
 * Ticked when the tab first opens: every preset up to `fast`.
 *
 * The slow end is left for the user to ask for rather than run by default. In-browser ffmpeg is a
 * single-threaded WebAssembly build, where `medium` onwards can take minutes over a few seconds of
 * video or exhaust the encoder outright (see X264_PRESET_INFO), and a sweep multiplies that by the
 * number of quality levels beside it. They remain one tick away.
 */
export const DEFAULT_MATRIX_PRESETS: X264Preset[] = MATRIX_PRESETS.slice(0, 5);

/** The resolution axis, source first. Same fractions the dropdown offers. */
export const MATRIX_SCALES: number[] = [...SCALE_OPTIONS];

/** The kernel axis, in the dropdown's order. */
export const MATRIX_SCALERS: Scaler[] = [...SCALER_OPTIONS];

/**
 * Ticked to begin with: the source resolution and the first step down from it, resampled with the
 * default kernel.
 *
 * The two outer axes multiply the sweep rather than adding to it, so their defaults stay short.
 * Resolution gets two values because it is the largest lever on file size in the whole tool (see
 * RESOLUTION_INFO), and a sweep that never shows what 75% buys hides its best answer; the deeper
 * drops, which double the sweep again each, stay one tick away.
 */
export const DEFAULT_MATRIX_SCALES: number[] = [1, 0.75];

export const DEFAULT_MATRIX_SCALERS: Scaler[] = [DEFAULT_SCALER];

/**
 * The frame-rate axis, as fractions of the source's own rate: a tick means the same thing whatever
 * file is loaded, the way the resolution axis is a fraction rather than a pixel count. Halving the
 * rate halves the frames there are to encode, which is a lever on size that no CRF reaches — and one
 * with a real cost for anything tracked frame by frame, which is why it is offered rather than
 * assumed.
 */
export const MATRIX_FPS_FRACTIONS: number[] = [1, 0.5, 0.25];

/** Ticked to begin with: the source's own rate, so a sweep costs what it always did. */
export const DEFAULT_MATRIX_FPS_FRACTIONS: number[] = [1];

/** The rate a fraction comes to for a given source, or null where it is the source's own. */
export function fpsForFraction(fraction: number, sourceFps: number | null | undefined): number | null {
  if (fraction >= 1 || !sourceFps || !(sourceFps > 0)) return null;
  return Math.round(sourceFps * fraction * 1000) / 1000;
}

/**
 * How many bytes of encoded segments to keep in memory across a sweep.
 *
 * Every finished cell holds every stretch it was measured over, so clicking it can load the A/B
 * window without re-encoding, but a lossless segment of a large video runs to tens of megabytes,
 * a run samples several of them and there can be dozens of cells. Past this the largest are dropped
 * (see `evictBeyondBudget`); their measurements stay in the table, and selecting one re-encodes just
 * that combination.
 */
export const MATRIX_RETAINED_BYTES = 192 * 1024 * 1024;

/** Stable identity for a combination, used as the table's cell key and for the best/selected marks.
 * All four axes are in it, so two squares that differ only by resolution are still two squares. */
export function comboKey(
  quality: MatrixQuality,
  preset: X264Preset,
  scale = 1,
  scaler: Scaler = DEFAULT_SCALER,
  fps: number | null = null,
): string {
  return `${quality}:${preset}:${scale}:${scaler}:${fps ?? "src"}`;
}

export function comboCrf(quality: MatrixQuality): number {
  return CRF_MAP[quality];
}

/** e.g. "medium (CRF 25), veryfast" — the same wording the single-run summary uses. The resolution
 * and its kernel join it only when something was actually resampled, since at the source's
 * resolution the kernel names a choice that had no effect. */
export function describeSettings(settings: EncodeSettings): string {
  const base = `${settings.quality} (CRF ${settings.crf}), ${settings.preset}`;
  const scaled = isDownscale(settings.scale)
    ? `${base}, ${Math.round(settings.scale * 100)}% ${settings.scaler}`
    : base;
  return settings.fps ? `${scaled}, ${fmtRate(settings.fps)} fps` : scaled;
}

/** What the dropdowns currently come to, for labelling a single (non-matrix) run's encode. */
export function cliSettings(cliState: CliState): EncodeSettings {
  return {
    quality: cliState.quality,
    crf: cliState.quality === "custom" ? cliState.crf : CRF_MAP[cliState.quality],
    preset: cliState.preset,
    scale: cliState.scale,
    scaler: cliState.scaler,
    fps: cliState.fps,
  };
}

/**
 * The cartesian product of all four axes, in dropdown order whatever order the boxes were ticked
 * in, so the table's rows and columns do not depend on how the selection was made.
 *
 * Resolution nests outside quality and the kernel outside preset, so that a sweep at one resolution
 * reads exactly like the two-axis grid did: down a column is still CRF at a fixed effort, across a
 * row is still the preset at a fixed quality, and the resolution groups stack those grids rather
 * than interleaving them.
 *
 * Nothing is resampled at full resolution, so a scale of 1 produces one combination rather than one
 * per kernel: the second would be a byte-for-byte re-run of the first under a different label.
 */
export function buildMatrixCombos(
  qualities: MatrixQuality[],
  presets: X264Preset[],
  // Omitted outer axes mean the plain two-axis grid at the source resolution and rate, not whatever
  // the checkboxes happen to start ticked to.
  scales: number[] = [1],
  scalers: Scaler[] = [DEFAULT_SCALER],
  // Absolute rates, already resolved from the ticked fractions against this file (see
  // fpsForFraction), with null standing for the source's own.
  fpsValues: (number | null)[] = [null],
): MatrixCombo[] {
  const rows = MATRIX_QUALITIES.filter((q) => qualities.includes(q));
  const cols = MATRIX_PRESETS.filter((p) => presets.includes(p));
  const scaleAxis = MATRIX_SCALES.filter((s) => scales.includes(s));
  const scalerAxis = MATRIX_SCALERS.filter((s) => scalers.includes(s));
  const fpsAxis = fpsValues.length ? fpsValues : [null];
  // One output per rate, resolution and kernel — the properties of the file a square produces, and
  // the blocks the grid stacks. At the source resolution every kernel is the same encode, so only
  // the first stands for them.
  const outputs = fpsAxis.flatMap((fps) =>
    scaleAxis.flatMap((scale) =>
      (isDownscale(scale) ? scalerAxis : scalerAxis.slice(0, 1)).map((scaler) => ({ fps, scale, scaler })),
    ),
  );
  const combos: MatrixCombo[] = [];
  for (const { fps, scale, scaler } of outputs) {
    for (const quality of rows) {
      for (const preset of cols) {
        combos.push({
          key: comboKey(quality, preset, scale, scaler, fps),
          quality,
          crf: comboCrf(quality),
          preset,
          scale,
          scaler,
          fps,
        });
      }
    }
  }
  return combos;
}

/** A fresh, unrun cell per combination. */
export function makeMatrixCells(combos: MatrixCombo[]): MatrixCell[] {
  return combos.map((combo) => ({
    combo,
    status: "pending",
    bytes: null,
    segmentSeconds: null,
    elapsedMs: null,
    blobs: null,
    error: null,
  }));
}

/** The axes a set of cells actually covers, so a results table is drawn from the run rather than
 * from whatever the checkboxes have been changed to since. */
export function matrixAxes(cells: MatrixCell[]): {
  qualities: MatrixQuality[];
  presets: X264Preset[];
  scales: number[];
  scalers: Scaler[];
  fpsValues: (number | null)[];
} {
  const qualities = MATRIX_QUALITIES.filter((q) => cells.some((c) => c.combo.quality === q));
  const presets = MATRIX_PRESETS.filter((p) => cells.some((c) => c.combo.preset === p));
  const scales = MATRIX_SCALES.filter((s) => cells.some((c) => c.combo.scale === s));
  const scalers = MATRIX_SCALERS.filter((s) => cells.some((c) => c.combo.scaler === s));
  // Highest rate first, the source's own ahead of every reduction of it.
  const fpsValues = [...new Set(cells.map((c) => c.combo.fps))].sort((a, b) => (b ?? Infinity) - (a ?? Infinity));
  return { qualities, presets, scales, scalers, fpsValues: fpsValues.length ? fpsValues : [null] };
}

/** The `cli` state a combination stands for: everything else about the encode is left as the user
 * set it, since the sweep is over these four fields alone. */
export function matrixCliState(base: CliState, combo: MatrixCombo): CliState {
  return {
    ...base,
    quality: combo.quality,
    crf: combo.crf,
    preset: combo.preset,
    scale: combo.scale,
    scaler: combo.scaler,
    fps: combo.fps,
  };
}

/**
 * The finished cell whose encode came out smallest, or null before one has.
 *
 * Ties are broken towards the better picture first and the faster preset second, rather than by
 * whichever square happens to come first: of two settings that reach the same size, neither the
 * extra quality nor the saved encoding time is worth giving up.
 */
export function bestReductionCell(cells: MatrixCell[]): MatrixCell | null {
  let best: MatrixCell | null = null;
  for (const cell of cells) {
    if (cell.status !== "done" || cell.bytes == null || !(cell.bytes > 0)) continue;
    if (!best || beatsForReduction(cell, best)) best = cell;
  }
  return best;
}

function beatsForReduction(cell: MatrixCell, best: MatrixCell): boolean {
  if (cell.bytes !== best.bytes) return (cell.bytes ?? 0) < (best.bytes ?? 0);
  // Resolution first among the tie-breaks: of two settings that reach the same size, the one that
  // kept more pixels kept more of the measurement, which no later step can put back.
  if (cell.combo.scale !== best.combo.scale) return cell.combo.scale > best.combo.scale;
  const quality = MATRIX_QUALITIES.indexOf(cell.combo.quality) - MATRIX_QUALITIES.indexOf(best.combo.quality);
  if (quality !== 0) return quality < 0;
  return MATRIX_PRESETS.indexOf(cell.combo.preset) < MATRIX_PRESETS.indexOf(best.combo.preset);
}

/** What one cell's held stretches come to, when the sweep's own figure for them has been lost. */
function heldBytes(blobs: Blob[]): number {
  return blobs.reduce((sum, blob) => sum + blob.size, 0);
}

/** Bytes of encoded segments currently held in memory. */
export function retainedBytes(cells: MatrixCell[]): number {
  return cells.reduce((sum, c) => sum + (c.blobs ? (c.bytes ?? heldBytes(c.blobs)) : 0), 0);
}

/**
 * Drops held outputs, largest first, until the retained total is back inside `budgetBytes`. Returns
 * the keys dropped.
 *
 * Largest first because the big ones free the most per drop and are the least likely to be wanted:
 * the winner is by definition the smallest cell, and a reader chasing "how bad does the cheap
 * setting look?" is not chasing the lossless one. `keepKey` spares the cell currently in the A/B
 * window, which would otherwise have to be re-encoded to keep showing what it is already showing.
 */
export function evictBeyondBudget(cells: MatrixCell[], budgetBytes: number, keepKey?: string | null): string[] {
  let total = retainedBytes(cells);
  if (total <= budgetBytes) return [];
  const held = cells
    .filter((c) => c.blobs != null && c.combo.key !== keepKey)
    .sort((a, b) => (b.bytes ?? 0) - (a.bytes ?? 0));
  const evicted: string[] = [];
  for (const cell of held) {
    if (total <= budgetBytes) break;
    total -= cell.bytes ?? (cell.blobs ? heldBytes(cell.blobs) : 0);
    cell.blobs = null;
    evicted.push(cell.combo.key);
  }
  return evicted;
}

/** How far along a sweep is, for the progress readout and the run summary. */
export function matrixProgress(cells: MatrixCell[]): {
  total: number;
  finished: number;
  done: number;
  failed: number;
  skipped: number;
} {
  const count = (status: MatrixCell["status"]): number => cells.filter((c) => c.status === status).length;
  const done = count("done");
  const failed = count("failed");
  const skipped = count("skipped");
  return { total: cells.length, finished: done + failed + skipped, done, failed, skipped };
}
