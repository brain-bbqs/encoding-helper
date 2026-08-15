// The matrix-mode results grid under Compare Quality: one square per combination of the quality and
// preset dropdowns, filled in as the sweep reaches it.
//
// A grid rather than a ranked list, because the two axes are not interchangeable: reading down a
// column shows what CRF costs at a fixed effort, reading across a row shows what the preset buys at
// a fixed quality, and a list sorted by size hides both. The winner is marked in place instead of
// being lifted out for the same reason — what makes it useful is the squares around it.

import { h, infoIcon } from "../lib/dom";
import { fmtBytes } from "../lib/format";
import { MATRIX_BEST_INFO } from "../lib/explainers";
import { describeSettings, matrixAxes } from "../lib/qualityMatrix";
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
      sub: "failed",
      title: `${settings} — ${cell.error ?? "failed"}`,
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

/** The grid itself: quality down the side, preset across the top. */
export function renderMatrixTable(opts: MatrixTableOptions): HTMLElement {
  const { qualities, presets } = matrixAxes(opts.cells);
  const byKey = new Map(opts.cells.map((c) => [c.combo.key, c]));

  const wrap = h("div", "scroll-x");
  const table = h("table", "data matrix-table");
  const thead = h("thead");
  const headRow = h("tr");
  headRow.append(h("th", null, "Quality \\ Preset"));
  presets.forEach((p) => headRow.append(h("th", null, p)));
  thead.append(headRow);
  table.append(thead);

  const tbody = h("tbody");
  for (const quality of qualities) {
    const row = h("tr");
    const first = byKey.get(`${quality}:${presets[0]}`);
    row.append(h("th", "matrix-row-head", `${quality} (CRF ${first?.combo.crf ?? "?"})`));
    for (const preset of presets) {
      const cell = byKey.get(`${quality}:${preset}`);
      const td = h("td", "matrix-td");
      if (cell) td.append(renderCell(cell, opts));
      row.append(td);
    }
    tbody.append(row);
  }
  table.append(tbody);
  wrap.append(table);
  return wrap;
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
  btn.append(h("span", "matrix-change" + (face.grew ? " grew" : "") + (face.pending ? " matrix-pending" : ""), face.main));
  btn.append(h("span", "matrix-sub", face.sub));
  btn.title = face.title;
  if (isBest) btn.append(h("span", "matrix-flag", "★ best"));
  const selectable = cell.status === "done" && cell.bytes != null;
  btn.disabled = !selectable || !opts.onSelect;
  btn.setAttribute("aria-pressed", String(isSelected));
  if (selectable && opts.onSelect) btn.addEventListener("click", () => opts.onSelect?.(cell));
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
  wrap.append(h("div", "matrix-summary-sub", `Best reduction: ${describeSettings(best.combo)}. Now in the A/B window.`));
  return wrap;
}
