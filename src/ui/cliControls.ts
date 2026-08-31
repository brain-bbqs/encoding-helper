// CLI preview refresh + quality/preset control syncing for the FFmpeg Command Builder on the
// Reencode with FFmpeg tab, which is the one place the shared `cli` state object is edited.

import {
  buildFfmpegArgs,
  DEFAULT_SCALER,
  describeScale,
  encodedFileName,
  formatCliCommand,
  isDownscale,
  SCALE_OPTIONS,
  SCALER_OPTIONS,
} from "../lib/cliCommand";
import { gridItem, h } from "../lib/dom";
import { fmtBytes } from "../lib/format";
import { fmtChangeFactor } from "../lib/sizeEstimate";
import { cli, currentVideoInfo, state } from "../lib/state";
import type { Scaler } from "../lib/types";
import type { EngineBox } from "./formControls";

/** Recomputes the CLI preview from the shared `cli` state; a no-op if no video is loaded. */
export function refreshCliCommand(): void {
  const info = currentVideoInfo();
  if (!info) return;
  const args = buildFfmpegArgs(cli, info, undefined, encodedFileName(state.format));
  const cmdPre = document.getElementById("cmdPre");
  if (cmdPre) cmdPre.textContent = formatCliCommand(args);
}

/** The resolution dropdown's entries, labelled with what each comes out at for the loaded file, so
 * the choice is made against real numbers rather than percentages. */
export function scaleOptions(info: { width: number; height: number } | null): [string, string][] {
  return SCALE_OPTIONS.map((s) => [String(s), describeScale(s, info)] as [string, string]);
}

/** The picked resolution as the dropdown's own value, falling back to the source when a value
 * arrives that is not one of the offered fractions. */
export function parseScale(value: string): number {
  const parsed = parseFloat(value);
  return SCALE_OPTIONS.includes(parsed as (typeof SCALE_OPTIONS)[number]) ? parsed : 1;
}

/** The kernel dropdown's entries, each named as the `flags=` value it becomes. */
export function scalerOptions(): [string, string][] {
  return SCALER_OPTIONS.map((s) => [s, s === DEFAULT_SCALER ? `${s} (sharper)` : `${s} (softer)`]);
}

export function parseScaler(value: string): Scaler {
  return SCALER_OPTIONS.includes(value as Scaler) ? (value as Scaler) : DEFAULT_SCALER;
}

// The quality, CRF, preset and resolution controls all bear on each other — a named quality hides
// the CRF field, a full-resolution output hides the kernel — so every one of them refreshes the lot
// rather than only the field it owns, and the command preview with them.
export function syncQualityControls(): void {
  const qSel = document.getElementById("cliQuality") as HTMLSelectElement | null;
  if (qSel) qSel.value = cli.quality;
  const crfField = document.getElementById("cliCrf") as HTMLInputElement | null;
  if (crfField) {
    crfField.value = String(cli.crf);
    if (crfField.parentElement) crfField.parentElement.style.display = cli.quality === "custom" ? "" : "none";
  }
  const presetSel = document.getElementById("cliPreset") as HTMLSelectElement | null;
  if (presetSel) presetSel.value = cli.preset;
  const scaleSel = document.getElementById("cliScale") as HTMLSelectElement | null;
  if (scaleSel) scaleSel.value = String(cli.scale);
  // The kernel only reaches the command when something is being resampled, so at full resolution the
  // field is there but inert rather than gone.
  const scalerSel = document.getElementById("cliScaler") as HTMLSelectElement | null;
  if (scalerSel) {
    scalerSel.value = cli.scaler;
    scalerSel.disabled = !isDownscale(cli.scale);
  }
  refreshCliCommand();
}

/**
 * Shows what an in-browser encode came to, and records it: the Full Analysis document reports the
 * last completed encode, and this is where a finished one passes through.
 */
export function showReencodeResult(box: EngineBox, origSize: number, outSize: number): void {
  state.reencodeResult = { originalSize: origSize, encodedSize: outSize };
  const pct = (1 - outSize / origSize) * 100;
  box.result.innerHTML = "";
  const g = h("div", "grid");
  g.append(
    gridItem("Original Size", fmtBytes(origSize)),
    gridItem("Encoded Size", fmtBytes(outSize)),
    gridItem(
      "Change",
      (pct >= 0 ? "-" : "+") +
        Math.abs(pct).toFixed(1) +
        "%" +
        (origSize > 0 ? ` (${fmtChangeFactor(outSize / origSize)})` : ""),
    ),
  );
  box.result.append(g);
  box.note.textContent = "";
}
