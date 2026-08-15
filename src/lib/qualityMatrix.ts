// Matrix mode: sweeping the Compare Quality tab's two dropdowns as a grid instead of one setting at
// a time.
//
// A single A/B run answers "what does *this* setting cost?", which is only half of the question
// anyone actually has: the other half is what the settings either side of it cost, and answering it
// one run at a time means remembering four numbers across four minutes of waiting. The matrix runs
// the cartesian product of the quality and preset dropdowns over the same few seconds of video, so
// the trade is read off one table rather than reconstructed from memory.
//
// "Best" here means the largest byte reduction, and nothing else: no picture-quality metric is
// computed, so a higher CRF wins every time it is offered. That is precisely why the whole grid is
// kept on screen with the winner marked rather than the winner alone — the eye in the A/B window is
// the quality half of the judgement, and the grid is what tells you how much the next row down
// would have saved.

import { CRF_MAP, isDownscale } from "./cliCommand";
import type { CliState, EncodeSettings, MatrixCell, MatrixCombo, MatrixQuality, X264Preset } from "./types";

/** The quality dropdown's named entries, best picture first. "custom" is a single arbitrary CRF, so
 * it is not part of a sweep of the typical settings. */
export const MATRIX_QUALITIES: MatrixQuality[] = ["lossless", "high", "medium", "low"];

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
 * Ticked when the tab first opens: every quality, and every preset up to `medium`.
 *
 * The slow end is left for the user to ask for rather than run by default. In-browser ffmpeg is a
 * single-threaded WebAssembly build, where `veryslow` can take minutes over a few seconds of video
 * or exhaust the encoder outright (see X264_PRESET_INFO), and a sweep multiplies that by the number
 * of quality levels beside it. They remain one tick away.
 */
export const DEFAULT_MATRIX_PRESETS: X264Preset[] = MATRIX_PRESETS.slice(0, 6);

/**
 * How many bytes of encoded segments to keep in memory across a sweep.
 *
 * Every finished cell holds its output so clicking it can load the A/B window without re-encoding,
 * but a lossless segment of a large video runs to tens of megabytes and there can be dozens of
 * cells. Past this the largest are dropped (see `evictBeyondBudget`); their measurements stay in the
 * table, and selecting one re-encodes just that combination.
 */
export const MATRIX_RETAINED_BYTES = 192 * 1024 * 1024;

/** Stable identity for a combination, used as the table's cell key and for the best/selected marks. */
export function comboKey(quality: MatrixQuality, preset: X264Preset): string {
  return `${quality}:${preset}`;
}

export function comboCrf(quality: MatrixQuality): number {
  return CRF_MAP[quality];
}

/** e.g. "medium (CRF 25), veryfast" — the same wording the single-run summary uses. The resolution
 * joins it only when it is not the source's, since every square of a sweep shares the one value. */
export function describeSettings(settings: EncodeSettings): string {
  const base = `${settings.quality} (CRF ${settings.crf}), ${settings.preset}`;
  return isDownscale(settings.scale) ? `${base}, ${Math.round(settings.scale * 100)}%` : base;
}

/** What the dropdowns currently come to, for labelling a single (non-matrix) run's encode. */
export function cliSettings(cliState: CliState): EncodeSettings {
  return {
    quality: cliState.quality,
    crf: cliState.quality === "custom" ? cliState.crf : CRF_MAP[cliState.quality],
    preset: cliState.preset,
    scale: cliState.scale,
  };
}

/**
 * The cartesian product of the two axes, quality-major and in dropdown order whatever order the
 * boxes were ticked in, so the table's rows and columns do not depend on how the selection was made.
 *
 * `scale` is carried onto every combination rather than being a third axis: it is the same value
 * for the whole sweep, deliberately. A grid that mixed resolutions could not be read down a column
 * (the cells would no longer be the same picture stored differently), and since `bestReductionCell`
 * ranks on bytes alone the lowest resolution would take the ★ every time, which is not a finding.
 * Sweeping at one resolution and then again at another compares two whole grids instead.
 */
export function buildMatrixCombos(qualities: MatrixQuality[], presets: X264Preset[], scale = 1): MatrixCombo[] {
  const rows = MATRIX_QUALITIES.filter((q) => qualities.includes(q));
  const cols = MATRIX_PRESETS.filter((p) => presets.includes(p));
  const combos: MatrixCombo[] = [];
  for (const quality of rows) {
    for (const preset of cols) {
      combos.push({ key: comboKey(quality, preset), quality, crf: comboCrf(quality), preset, scale });
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
    blob: null,
    error: null,
  }));
}

/** The axes a set of cells actually covers, so a results table is drawn from the run rather than
 * from whatever the checkboxes have been changed to since. */
export function matrixAxes(cells: MatrixCell[]): { qualities: MatrixQuality[]; presets: X264Preset[] } {
  const qualities = MATRIX_QUALITIES.filter((q) => cells.some((c) => c.combo.quality === q));
  const presets = MATRIX_PRESETS.filter((p) => cells.some((c) => c.combo.preset === p));
  return { qualities, presets };
}

/** The `cli` state a combination stands for: everything else about the encode is left as the user
 * set it, since the sweep is over these two fields alone. */
export function matrixCliState(base: CliState, combo: MatrixCombo): CliState {
  return { ...base, quality: combo.quality, crf: combo.crf, preset: combo.preset };
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
  const quality = MATRIX_QUALITIES.indexOf(cell.combo.quality) - MATRIX_QUALITIES.indexOf(best.combo.quality);
  if (quality !== 0) return quality < 0;
  return MATRIX_PRESETS.indexOf(cell.combo.preset) < MATRIX_PRESETS.indexOf(best.combo.preset);
}

/** Bytes of encoded segments currently held in memory. */
export function retainedBytes(cells: MatrixCell[]): number {
  return cells.reduce((sum, c) => sum + (c.blob ? (c.bytes ?? c.blob.size) : 0), 0);
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
    .filter((c) => c.blob != null && c.combo.key !== keepKey)
    .sort((a, b) => (b.bytes ?? 0) - (a.bytes ?? 0));
  const evicted: string[] = [];
  for (const cell of held) {
    if (total <= budgetBytes) break;
    total -= cell.bytes ?? cell.blob?.size ?? 0;
    cell.blob = null;
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
