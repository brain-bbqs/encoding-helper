// The matrix-mode results grid under Compare Quality: one square per swept combination, filled in as
// the sweep reaches it.
//
// A grid rather than a ranked list, because the axes are not interchangeable: reading down a column
// shows what CRF costs at a fixed effort, reading across a row shows what the preset buys at a fixed
// quality, and a list sorted by size hides both. The winner is marked in place instead of being
// lifted out for the same reason — what makes it useful is the squares around it.
//
// Resolution and the kernel it resamples with group the rows and the columns rather than adding
// dimensions to each square, so a block of rows at one resolution still reads exactly like the grid
// did before they existed.

import { h, infoIcon } from "../lib/dom";
import { fmtBytes } from "../lib/format";
import { MATRIX_BEST_INFO } from "../lib/explainers";
import { comboKey, describeSettings, matrixAxes } from "../lib/qualityMatrix";
import { fmtPct, type SizeEstimate } from "../lib/sizeEstimate";
import type { MatrixCell } from "../lib/types";

export interface MatrixTableOptions {
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

/** What a square says: the headline, the line under it, and the tooltip spelling both out. */
interface CellFace {
  main: string;
  sub: string;
  title: string;
  /** Nothing measured yet, so the headline is drawn as a placeholder rather than a figure. */
  pending: boolean;
  /** The encode came out larger than the source, which is a result but not a saving. */
  grew: boolean;
}

/** A finished square: the change it came to, what that projects to, and what it cost to find out. */
function doneFace(cell: MatrixCell, est: SizeEstimate | null): CellFace {
  const bytes = cell.bytes ?? 0;
  const change = est ? (est.ratio - 1 >= 0 ? "+" : "−") + fmtPct(Math.abs(est.ratio - 1)) : fmtBytes(bytes);
  const sub = [est ? fmtBytes(est.projectedTotalBytes) : fmtBytes(bytes)];
  if (cell.elapsedMs != null) sub.push(fmtElapsed(cell.elapsedMs));
  return {
    main: change,
    sub: sub.join(" · "),
    title:
      `${describeSettings(cell.combo)} — segment ${fmtBytes(bytes)}` +
      (est ? `, whole file projected at ${fmtBytes(est.projectedTotalBytes)}` : "") +
      (cell.elapsedMs != null ? `, encoded in ${fmtElapsed(cell.elapsedMs)}` : "") +
      (cell.blob ? "" : " (output released; selecting it re-encodes this square)"),
    pending: false,
    grew: est != null && est.savedFraction < 0,
  };
}

function cellFace(cell: MatrixCell, est: SizeEstimate | null): CellFace {
  if (cell.status === "done" && cell.bytes != null) return doneFace(cell, est);
  const settings = describeSettings(cell.combo);
  if (cell.status === "running") {
    return { main: "…", sub: "encoding", title: `${settings} — encoding now`, pending: true, grew: false };
  }
  if (cell.status === "failed") {
    return {
      main: "✕",
      sub: "retry",
      title: `${settings} — ${cell.error ?? "failed"}. Click to try it again.`,
      pending: false,
      grew: false,
    };
  }
  const skipped = cell.status === "skipped";
  return {
    main: "–",
    sub: skipped ? "skipped" : "queued",
    title: `${settings} — ${skipped ? "not run" : "queued"}`,
    pending: true,
    grew: false,
  };
}

/**
 * The grid itself: quality down the side, preset across the top, with resolution grouping the rows
 * and the kernel grouping the columns.
 *
 * The two outer axes only appear once a sweep covers more than one of their values, so the common
 * grid is the same two-axis table it has always been rather than one carrying two headers that say
 * "100%" and "lanczos" over everything. When they do appear they nest outside, so each resolution
 * is a block of rows that still reads down a column as CRF at a fixed effort.
 */
export function renderMatrixTable(opts: MatrixTableOptions): HTMLElement {
  const { qualities, presets, scales, scalers } = matrixAxes(opts.cells);
  const byKey = new Map(opts.cells.map((c) => [c.combo.key, c]));
  const columns = scalers.flatMap((scaler) => presets.map((preset) => ({ scaler, preset })));
  const bodyWidth = Math.max(1, columns.length);

  const wrap = h("div", "scroll-x");
  const table = h("table", "data matrix-table");
  const thead = h("thead");
  // The two axes are named once each, over the columns and over the row heads, rather than crammed
  // into one corner cell with a slash between them.
  const axisRow = h("tr");
  axisRow.append(h("th", "matrix-corner"));
  const presetLabel = h("th", "matrix-axis-label", "Preset");
  presetLabel.colSpan = bodyWidth;
  axisRow.append(presetLabel);
  thead.append(axisRow);
  if (scalers.length > 1) {
    const scalerRow = h("tr");
    scalerRow.append(h("th", "matrix-corner"));
    for (const scaler of scalers) {
      const th = h("th", "matrix-group-head", scaler);
      th.colSpan = Math.max(1, presets.length);
      scalerRow.append(th);
    }
    thead.append(scalerRow);
  }
  const headRow = h("tr");
  headRow.append(h("th", "matrix-corner", "Quality"));
  columns.forEach((c) => headRow.append(h("th", null, c.preset)));
  thead.append(headRow);
  table.append(thead);

  const tbody = h("tbody");
  for (const scale of scales) {
    if (scales.length > 1) {
      const groupRow = h("tr", "matrix-group-row");
      const th = h("th", "matrix-group-head", opts.scaleLabel?.(scale) ?? `${Math.round(scale * 100)}%`);
      th.colSpan = bodyWidth + 1;
      groupRow.append(th);
      tbody.append(groupRow);
    }
    for (const quality of qualities) {
      const row = h("tr");
      const first = byKey.get(comboKey(quality, presets[0], scale, scalers[0]));
      row.append(h("th", "matrix-row-head", `${quality} (CRF ${first?.combo.crf ?? "?"})`));
      for (const column of columns) {
        const cell = byKey.get(comboKey(quality, column.preset, scale, column.scaler));
        const td = h("td", "matrix-td");
        // A square with no combination behind it is the one case the sweep skips on purpose: at the
        // source resolution the kernels are the same encode, so only the first was run.
        if (cell) td.append(renderCell(cell, opts));
        else td.append(sameEncodeMark(scalers[0]));
        row.append(td);
      }
      tbody.append(row);
    }
  }
  table.append(tbody);
  wrap.append(table);
  return wrap;
}

/** Stands in for a square the sweep did not run because it would have repeated another one. */
function sameEncodeMark(ranScaler: string): HTMLElement {
  const span = h("span", "matrix-same", "–");
  span.title = `Nothing is resampled at the source resolution, so this is the ${ranScaler} encode beside it.`;
  return span;
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
  btn.append(h("span", "matrix-sub", face.sub));
  btn.title = face.title;
  if (isBest) btn.append(h("span", "matrix-flag", "★ best"));
  // A finished square loads into the A/B window; a failed one is a second attempt at the encode.
  const selectable = cell.status === "done" && cell.bytes != null && !!opts.onSelect;
  const retryable = cell.status === "failed" && !!opts.onRetry;
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
): HTMLElement {
  const wrap = h("div", "matrix-summary");
  if (!best) {
    wrap.append(h("div", "matrix-summary-sub", "No combination has finished yet."));
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
    infoIcon(MATRIX_BEST_INFO, "About the best reduction"),
  );
  wrap.append(head);
  return wrap;
}
