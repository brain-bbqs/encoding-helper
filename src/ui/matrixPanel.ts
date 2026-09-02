// The matrix-mode results grid under Compare Quality: one square per swept combination, filled in as
// the sweep reaches it.
//
// A grid rather than a ranked list, because the axes are not interchangeable: reading down a column
// shows what CRF costs at a fixed effort, reading across a row shows what the preset buys at a fixed
// quality, and a list sorted by size hides both. The winner is marked in place instead of being
// lifted out for the same reason — what makes it useful is the squares around it.
//
// Resolution and the kernel it resamples with stack as blocks of rows rather than widening the
// table, so every block is the same width and reads exactly like the grid did before they existed.

import { h } from "../lib/dom";
import { fmtBytes, fmtRate } from "../lib/format";
import { isDownscale } from "../lib/cliCommand";
import { comboKey, describeSettings, matrixAxes } from "../lib/qualityMatrix";
import { fmtChangeFactor, fmtPct, type SizeEstimate } from "../lib/sizeEstimate";
import type { MatrixCell, Scaler } from "../lib/types";

interface MatrixTableOptions {
  cells: MatrixCell[];
  /** The winning cell's key, marked ★ in place. */
  bestKey?: string | null;
  /** The cell currently loaded in the A/B window, outlined. */
  selectedKey?: string | null;
  /** What a cell's encode projects the whole file to; null when the file cannot support one. */
  estimate?: (cell: MatrixCell) => SizeEstimate | null;
  /** Called when a finished cell is clicked, to load it into the A/B window. */
  onSelect?: (cell: MatrixCell) => void;
  /** Called when a failed cell is clicked, to encode that combination again. */
  onRetry?: (cell: MatrixCell) => void;
  /** Names a resolution over the block of rows run at it, e.g. "50% (512×384)". Falls back to the
   * bare percentage, since only the caller knows the source's dimensions. */
  scaleLabel?: (scale: number) => string;
}

/** An encode's wall-clock cost, at the precision a table column can carry. */
export function fmtElapsed(ms: number): string {
  if (ms < 10_000) return (ms / 1000).toFixed(1) + "s";
  if (ms < 60_000) return Math.round(ms / 1000) + "s";
  return Math.floor(ms / 60_000) + "m " + Math.round((ms % 60_000) / 1000) + "s";
}

/** What a square says: the headline, the lines under it, and the tooltip spelling them all out. */
interface CellFace {
  main: string;
  /** The same change as a factor, naming the larger of the two files, on its own line: the
   * percentage crowds together at the deep end, where the squares worth finding are. Empty for a
   * square with nothing measured yet. */
  factor: string;
  sub: string;
  /** The tooltip, where there is something to say that the face cannot: what pressing the square
   * will cost, why it failed. Empty where the face already says everything. */
  title: string;
  /** The square's accessible name: what a reader who cannot see the face is told instead, so it
   * names the settings and spells the figures out. */
  label: string;
  /** Nothing measured yet, so the headline is drawn as a placeholder rather than a figure. */
  pending: boolean;
  /** The encode came out larger than the source, which is a result but not a saving. */
  grew: boolean;
}

/** A finished square: the change it came to, what that projects to, and what it cost to find out. */
function doneFace(cell: MatrixCell, bytes: number, est: SizeEstimate | null): CellFace {
  const change = est ? (est.ratio - 1 >= 0 ? "+" : "−") + fmtPct(Math.abs(est.ratio - 1)) : fmtBytes(bytes);
  const sub = [est ? fmtBytes(est.projectedTotalBytes) : fmtBytes(bytes)];
  // ↺ against the time, since the time is the figure the mark is about: the bytes are the same
  // bytes this encode produces whenever it is run, and the seconds are of a run that already
  // happened, on a machine that may not have been this busy.
  if (cell.elapsedMs != null) sub.push((cell.fromCache ? "↺ " : "") + fmtElapsed(cell.elapsedMs));
  return {
    main: change,
    factor: est ? fmtChangeFactor(est.ratio) : "",
    sub: sub.join(" · "),
    // The square's own face carries the change, the factor, the projected size and the time, so the
    // tooltip is left with the one thing it cannot show: what pressing it will cost.
    title: cell.blobs ? "" : releasedNote(cell),
    label:
      `${describeSettings(cell.combo)} — segment ${fmtBytes(bytes)}` +
      (est ? ` (${fmtChangeFactor(est.ratio)}), file ≈ ${fmtBytes(est.projectedTotalBytes)}` : "") +
      (cell.elapsedMs != null ? `, ${fmtElapsed(cell.elapsedMs)}` : "") +
      (cell.blobs ? "" : ". " + releasedNote(cell)),
    pending: false,
    grew: est != null && est.savedFraction < 0,
  };
}

/** Why a finished square holds no video to show, which decides what clicking it will cost. */
function releasedNote(cell: MatrixCell): string {
  return cell.fromCache
    ? "Its figures are cached from an earlier run; selecting it encodes it."
    : "Its output was released; selecting it re-encodes it.";
}

function cellFace(cell: MatrixCell, est: SizeEstimate | null): CellFace {
  if (cell.status === "done" && cell.bytes != null) return doneFace(cell, cell.bytes, est);
  const settings = describeSettings(cell.combo);
  if (cell.status === "running") {
    const text = `${settings} — encoding now`;
    return {
      main: "…",
      factor: "",
      sub: "encoding",
      title: text,
      label: text,
      pending: true,
      grew: false,
    };
  }
  if (cell.status === "failed") {
    const text = `${settings} — ${cell.error ?? "failed"}. Click to try it again.`;
    return {
      main: "✕",
      factor: "",
      sub: "retry",
      title: text,
      label: text,
      pending: false,
      grew: false,
    };
  }
  const skipped = cell.status === "skipped";
  const text = `${settings} — ${skipped ? "not run. Click to encode it." : "queued"}`;
  return {
    main: "–",
    factor: "",
    sub: skipped ? "run it" : "queued",
    title: text,
    label: text,
    pending: true,
    grew: false,
  };
}

/**
 * The grid itself: quality down the side, preset across the top, and one block of rows per output
 * the sweep produced.
 *
 * Both outer axes stack rather than widen. Resolution and kernel are properties of the *output*,
 * not of the encoder settings the columns describe, so they belong to a block of rows rather than
 * to a second tier of columns: a kernel spread across the header would double the table's width for
 * a value that says nothing about any individual column, and push the far columns off the screen on
 * exactly the runs that need reading most. Stacked, every block is the same width and reads down a
 * column as CRF at a fixed effort, whatever the sweep covered.
 *
 * The block titles only appear once there is more than one, so the common grid is the same
 * two-axis table it has always been rather than one captioned "100%" throughout.
 */
export function renderMatrixTable(opts: MatrixTableOptions): HTMLElement {
  const { qualities, presets, scales, scalers, fpsValues } = matrixAxes(opts.cells);
  const byKey = new Map(opts.cells.map((c) => [c.combo.key, c]));
  const width = Math.max(1, presets.length);
  // One block per output actually encoded. Nothing is resampled at the source resolution, so it
  // contributes one block whatever kernels were ticked, and no square anywhere goes unfilled.
  const blocks = fpsValues.flatMap((fps) =>
    scales.flatMap((scale) =>
      (isDownscale(scale) ? scalers : scalers.slice(0, 1)).map((scaler) => ({ scale, scaler, fps })),
    ),
  );

  const wrap = h("div", "scroll-x");
  const table = h("table", "data matrix-table");
  const thead = h("thead");
  // The two axes are named once each, over the columns and over the row heads, rather than crammed
  // into one corner cell with a slash between them.
  const axisRow = h("tr");
  axisRow.append(h("th", "matrix-corner"));
  const presetLabel = h("th", "matrix-axis-label", "Preset");
  presetLabel.colSpan = width;
  axisRow.append(presetLabel);
  const headRow = h("tr");
  headRow.append(h("th", "matrix-corner", "Quality"));
  presets.forEach((p) => headRow.append(h("th", null, p)));
  thead.append(axisRow, headRow);
  table.append(thead);

  const tbody = h("tbody");
  blocks.forEach((block, i) => {
    // Consecutive blocks are shaded apart as well as titled, so which one a square belongs to is
    // answerable from the square rather than by scrolling up to the nearest heading.
    const band = i % 2 === 1 ? " matrix-band" : "";
    if (blocks.length > 1) tbody.append(blockTitleRow(block, scalers.length > 1, width, band, opts));
    for (const quality of qualities) {
      const row = h("tr", blocks.length > 1 ? "matrix-scale-row" + band : null);
      const first = byKey.get(comboKey(quality, presets[0], block.scale, block.scaler, block.fps));
      row.append(h("th", "matrix-row-head", `${quality} (CRF ${first?.combo.crf ?? "?"})`));
      for (const preset of presets) {
        const cell = byKey.get(comboKey(quality, preset, block.scale, block.scaler, block.fps));
        const td = h("td", "matrix-td");
        if (cell) td.append(renderCell(cell, opts));
        row.append(td);
      }
      tbody.append(row);
    }
  });
  table.append(tbody);
  wrap.append(table);
  return wrap;
}

/** The heading over one block of rows: the resolution it was encoded at, the kernel that got it
 * there when the sweep tried more than one, and the rate where that was swept too. */
function blockTitleRow(
  block: { scale: number; scaler: Scaler; fps: number | null },
  showScaler: boolean,
  width: number,
  band: string,
  opts: MatrixTableOptions,
): HTMLTableRowElement {
  const row = h("tr", "matrix-group-row" + band);
  const th = h("th", "matrix-group-head");
  th.colSpan = width + 1;
  th.append(h("span", "matrix-group-title", opts.scaleLabel?.(block.scale) ?? `${Math.round(block.scale * 100)}%`));
  // The kernel and the rate are footnotes to the resolution rather than peers of it: one only
  // changes how the pixels were resampled, and at the source resolution it changed nothing at all;
  // the other is absent from every block of a sweep that left the rate alone.
  if (showScaler && isDownscale(block.scale)) th.append(h("span", "matrix-group-note", block.scaler));
  if (block.fps != null) th.append(h("span", "matrix-group-note", `${fmtRate(block.fps)} fps`));
  row.append(th);
  return row;
}

/** One square, as a button whether or not it can be pressed yet, so the grid keeps its shape. */
function renderCell(cell: MatrixCell, opts: MatrixTableOptions): HTMLElement {
  const est = opts.estimate?.(cell) ?? null;
  const isBest = opts.bestKey != null && cell.combo.key === opts.bestKey;
  const isSelected = opts.selectedKey != null && cell.combo.key === opts.selectedKey;
  const btn = h(
    "button",
    "matrix-cell" +
      (isBest ? " best" : "") +
      (isSelected ? " selected" : "") +
      (cell.status === "failed" ? " failed" : ""),
  );
  btn.type = "button";

  const face = cellFace(cell, est);
  btn.append(
    h("span", "matrix-change" + (face.grew ? " grew" : "") + (face.pending ? " matrix-pending" : ""), face.main),
  );
  if (face.factor) btn.append(h("span", "matrix-factor", face.factor));
  btn.append(h("span", "matrix-sub", face.sub));
  btn.title = face.title;
  btn.setAttribute("aria-label", face.label);
  if (isBest) btn.append(h("span", "matrix-flag", "★ best"));
  // A finished square loads into the A/B window; one that failed or was never reached is an attempt
  // at the encode.
  const selectable = cell.status === "done" && cell.bytes != null && !!opts.onSelect;
  const retryable = (cell.status === "failed" || cell.status === "skipped") && !!opts.onRetry;
  btn.disabled = !selectable && !retryable;
  btn.setAttribute("aria-pressed", String(isSelected));
  if (selectable) btn.addEventListener("click", () => opts.onSelect?.(cell));
  else if (retryable) btn.addEventListener("click", () => opts.onRetry?.(cell));
  return btn;
}

/** The line above the grid: what the sweep found, or how far along it is. */
export function renderMatrixSummary(
  best: MatrixCell | null,
  estimate?: (cell: MatrixCell) => SizeEstimate | null,
  emptyNote = "No combination has finished yet.",
): HTMLElement {
  const wrap = h("div", "matrix-summary");
  if (!best) {
    wrap.append(h("div", "matrix-summary-sub", emptyNote));
    return wrap;
  }
  const est = estimate?.(best) ?? null;
  const head = h("div", "matrix-summary-head");
  head.append(
    h(
      "span",
      "matrix-summary-figure",
      est ? `${fmtPct(Math.abs(est.savedFraction))} ${est.savedFraction < 0 ? "larger" : "smaller"}` : "Best reduction",
    ),
  );
  // The percentage and the factor say the same thing, and which one lands depends on how deep the
  // reduction is, so the winner carries both.
  if (est) head.append(h("span", "matrix-summary-factor", fmtChangeFactor(est.ratio)));
  wrap.append(head);
  return wrap;
}
