import { describe, expect, it } from "vitest";
import { buildMatrixCombos, comboKey, makeMatrixCells } from "../../src/lib/qualityMatrix";
import { estimateSizeSavings, type SizeEstimate } from "../../src/lib/sizeEstimate";
import type { MatrixCell } from "../../src/lib/types";
import { fmtElapsed, renderMatrixSummary, renderMatrixTable } from "../../src/ui/matrixPanel";

/** A 1 MB, 100 s file whose sampled 10 s encoded down to `bytes`. */
function estimateFor(cell: MatrixCell): SizeEstimate | null {
  if (cell.bytes == null) return null;
  return estimateSizeSavings({
    originalTotalBytes: 1_000_000,
    totalSeconds: 100,
    segmentStartSeconds: 0,
    segmentSeconds: 10,
    encodedSegmentBytes: cell.bytes,
  });
}

/** A two-by-two sweep, with the first two squares finished. */
function cells(): MatrixCell[] {
  const all = makeMatrixCells(buildMatrixCombos(["high", "low"], ["ultrafast", "fast"]));
  all[0].status = "done";
  all[0].bytes = 60_000;
  all[0].elapsedMs = 4200;
  all[1].status = "done";
  all[1].bytes = 40_000;
  all[1].elapsedMs = 12_000;
  return all;
}

function cellButtons(table: HTMLElement): HTMLButtonElement[] {
  return Array.from(table.querySelectorAll<HTMLButtonElement>(".matrix-cell"));
}

describe("fmtElapsed", () => {
  it("keeps a tenth of a second under ten seconds, and drops it above", () => {
    expect(fmtElapsed(4200)).toBe("4.2s");
    expect(fmtElapsed(42_000)).toBe("42s");
    expect(fmtElapsed(95_000)).toBe("1m 35s");
  });
});

describe("renderMatrixTable", () => {
  it("lays the axes out as a grid, quality down the side and preset across the top", () => {
    const table = renderMatrixTable({ cells: cells() });
    const headers = Array.from(table.querySelectorAll("thead th")).map((th) => th.textContent);
    expect(headers).toEqual(["", "Preset", "Quality", "ultrafast", "fast"]);
    expect(table.querySelector<HTMLTableCellElement>(".matrix-axis-label")!.colSpan).toBe(2);
    const rowHeads = Array.from(table.querySelectorAll(".matrix-row-head")).map((th) => th.textContent);
    expect(rowHeads).toEqual(["high (CRF 18)", "low (CRF 32)"]);
    expect(cellButtons(table)).toHaveLength(4);
  });

  // Stacked, not widened: the kernel names a block of rows, so the table is the same width whatever
  // the sweep covered and the far columns stay on the screen.
  it("stacks each output as its own block of rows, one preset column wide", () => {
    const swept = makeMatrixCells(buildMatrixCombos(["high"], ["fast"], [1, 0.5], ["lanczos", "bicubic"]));
    const table = renderMatrixTable({ cells: swept, scaleLabel: (s) => `${s * 100}%` });
    // Three blocks: the source resolution, then each kernel at half.
    expect(Array.from(table.querySelectorAll(".matrix-group-title")).map((e) => e.textContent)).toEqual([
      "100%",
      "50%",
      "50%",
    ]);
    // The kernel is only named where it did something.
    expect(Array.from(table.querySelectorAll(".matrix-group-note")).map((e) => e.textContent)).toEqual([
      "lanczos",
      "bicubic",
    ]);
    const headers = Array.from(table.querySelectorAll("thead tr:last-child th")).map((th) => th.textContent);
    expect(headers).toEqual(["Quality", "fast"]);
  });

  it("shades consecutive blocks apart", () => {
    const swept = makeMatrixCells(buildMatrixCombos(["high", "low"], ["fast"], [1, 0.5]));
    const table = renderMatrixTable({ cells: swept });
    const rows = Array.from(table.querySelectorAll("tbody tr"));
    // Title row plus two quality rows per resolution; the second block is banded, the first is not.
    expect(rows.map((r) => r.classList.contains("matrix-band"))).toEqual([false, false, false, true, true, true]);
  });

  it("leaves no square unfilled, each block running the one kernel it names", () => {
    const swept = makeMatrixCells(buildMatrixCombos(["high"], ["fast"], [1, 0.5], ["lanczos", "bicubic"]));
    const table = renderMatrixTable({ cells: swept });
    expect(cellButtons(table)).toHaveLength(3);
    expect(table.querySelectorAll("td:empty")).toHaveLength(0);
  });

  it("keeps the grid two-axis when the sweep covered one resolution and one kernel", () => {
    const table = renderMatrixTable({ cells: cells() });
    expect(table.querySelectorAll(".matrix-group-head")).toHaveLength(0);
  });

  it("shows a finished square's change, projection and encode time", () => {
    const table = renderMatrixTable({ cells: cells(), estimate: estimateFor });
    const first = cellButtons(table)[0];
    // 60 KB against the 100 KB the same 10 s costs in the source.
    expect(first.querySelector(".matrix-change")!.textContent).toBe("−40%");
    // The same change as a factor, on the square itself rather than only in its tooltip.
    expect(first.querySelector(".matrix-factor")!.textContent).toBe("1.7× reduction");
    // 60% of the 1 MB source, i.e. 600,000 bytes.
    expect(first.querySelector(".matrix-sub")!.textContent).toBe("585.9 KB · 4.2s");
  });

  it("reports a square that grew the file as such rather than as a saving", () => {
    const grown = cells();
    grown[0].bytes = 150_000;
    const table = renderMatrixTable({ cells: grown, estimate: estimateFor });
    const change = cellButtons(table)[0].querySelector(".matrix-change")!;
    expect(change.textContent).toBe("+50%");
    expect(change.classList.contains("grew")).toBe(true);
  });

  it("falls back to the segment's own size when the file cannot support a projection", () => {
    const table = renderMatrixTable({ cells: cells() });
    expect(cellButtons(table)[0].querySelector(".matrix-change")!.textContent).toBe("58.6 KB");
  });

  it("marks the best square and outlines the one in the A/B window", () => {
    const table = renderMatrixTable({
      cells: cells(),
      bestKey: comboKey("high", "fast"),
      selectedKey: comboKey("high", "ultrafast"),
    });
    const [ultrafast, fast] = cellButtons(table);
    expect(fast.classList.contains("best")).toBe(true);
    expect(fast.querySelector(".matrix-flag")!.textContent).toBe("★ best");
    expect(ultrafast.classList.contains("best")).toBe(false);
    expect(ultrafast.classList.contains("selected")).toBe(true);
    expect(ultrafast.getAttribute("aria-pressed")).toBe("true");
  });

  it("labels a square being encoded, and leaves it unclickable", () => {
    const pending = cells();
    pending[2].status = "running";
    const table = renderMatrixTable({ cells: pending, onSelect: () => {} });
    const running = cellButtons(table)[2];
    expect(running.querySelector(".matrix-sub")!.textContent).toBe("encoding");
    expect(running.disabled).toBe(true);
  });

  // A square Stop never reached is a hole in the grid, so it offers to fill itself.
  it("offers a square the sweep never reached as one to run", () => {
    const pending = cells();
    pending[3].status = "skipped";
    const ran: string[] = [];
    const table = renderMatrixTable({ cells: pending, onRetry: (c) => ran.push(c.combo.key) });
    const skipped = cellButtons(table)[3];
    expect(skipped.querySelector(".matrix-sub")!.textContent).toBe("run it");
    expect(skipped.disabled).toBe(false);
    skipped.click();
    expect(ran).toEqual([comboKey("low", "fast")]);
  });

  it("shows a failed square with the reason on it", () => {
    const failed = cells();
    failed[2].status = "failed";
    failed[2].error = "ffmpeg.wasm crashed part-way through";
    const table = renderMatrixTable({ cells: failed });
    const button = cellButtons(table)[2];
    expect(button.classList.contains("failed")).toBe(true);
    expect(button.title).toContain("ffmpeg.wasm crashed part-way through");
  });

  it("offers a failed square as a retry, and hands it back when clicked", () => {
    const failed = cells();
    failed[2].status = "failed";
    failed[2].error = "crashed";
    const retried: string[] = [];
    const table = renderMatrixTable({
      cells: failed,
      onSelect: () => {},
      onRetry: (cell) => retried.push(cell.combo.key),
    });
    const button = cellButtons(table)[2];
    expect(button.querySelector(".matrix-sub")!.textContent).toBe("retry");
    expect(button.title).toContain("Click to try it again");
    expect(button.disabled).toBe(false);
    button.click();
    expect(retried).toEqual([comboKey("low", "ultrafast")]);
  });

  it("leaves a failed square unclickable when retrying is not on offer", () => {
    const failed = cells();
    failed[2].status = "failed";
    const table = renderMatrixTable({ cells: failed, onSelect: () => {} });
    expect(cellButtons(table)[2].disabled).toBe(true);
  });

  it("hands the clicked square back, and disables selection when no handler is given", () => {
    const picked: string[] = [];
    const table = renderMatrixTable({ cells: cells(), onSelect: (cell) => picked.push(cell.combo.key) });
    cellButtons(table)[1].click();
    expect(picked).toEqual([comboKey("high", "fast")]);
    expect(cellButtons(renderMatrixTable({ cells: cells() }))[1].disabled).toBe(true);
  });
});

describe("renderMatrixSummary", () => {
  it("says nothing has finished before anything has", () => {
    const summary = renderMatrixSummary(null);
    expect(summary.querySelector(".matrix-summary-sub")!.textContent).toBe("No combination has finished yet.");
    expect(summary.querySelector(".matrix-summary-figure")).toBeNull();
  });

  // The caller says so while the sweep is still running: naming a winner then would only name the
  // best of whatever has finished so far.
  it("takes the caller's word for why there is no winner yet", () => {
    const summary = renderMatrixSummary(null, estimateFor, "Ranked once every combination has run.");
    expect(summary.querySelector(".matrix-summary-sub")!.textContent).toBe("Ranked once every combination has run.");
  });

  it("leads with the winner's saving", () => {
    const summary = renderMatrixSummary(cells()[1], estimateFor);
    expect(summary.querySelector(".matrix-summary-figure")!.textContent).toBe("60% smaller");
    expect(summary.querySelector(".matrix-summary-sub")).toBeNull();
  });
});
