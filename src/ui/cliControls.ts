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
import { RESOLUTION_INFO } from "../lib/explainers";
import { fmtBytes } from "../lib/format";
import { fmtChangeFactor } from "../lib/sizeEstimate";
import { cli, currentVideoInfo, state } from "../lib/state";
import type { Scaler } from "../lib/types";
import { fieldNumber, fieldSelect, type EngineBox } from "./formControls";

/** Recomputes the CLI preview from the shared `cli` state; a no-op if no video is loaded. */
export function refreshCliCommand(): void {
  const info = currentVideoInfo();
  if (!info) return;
  const args = buildFfmpegArgs(cli, info, undefined, encodedFileName(state.format));
  const cmdPre = document.getElementById("cmdPre");
  if (cmdPre) cmdPre.textContent = formatCliCommand(args);
}

/** The resolution dropdown's entries: the fixed ladder, labelled with what each comes out at for
 * the loaded file so the choice is made against real numbers rather than percentages, plus a
 * "Custom %" entry for a value the ladder doesn't offer. */
function scaleOptions(info: { width: number; height: number } | null): [string, string][] {
  return [...SCALE_OPTIONS.map((s) => [String(s), describeScale(s, info)] as [string, string]), ["custom", "Custom %"]];
}

/** Whether a scale is one of the fixed ladder's own values, as opposed to a custom percentage. */
function isPresetScale(scale: number): boolean {
  return SCALE_OPTIONS.includes(scale as (typeof SCALE_OPTIONS)[number]);
}

/** The picked resolution as the dropdown's own value, falling back to the source when a value
 * arrives that is not one of the offered fractions. "custom" is handled by the caller, which seeds
 * `cli.scale` from the remembered custom percentage instead of going through this. */
function parseScale(value: string): number {
  const parsed = parseFloat(value);
  return isPresetScale(parsed) ? parsed : 1;
}

/**
 * The Resolution select and the Custom % field beside it, built together because which one is
 * live depends on the other: kept out of `renderEncodeTab` so that function's branching stays
 * about the form's layout rather than the ladder/custom split.
 */
export function resolutionFields(info: { width: number; height: number } | null): {
  scaleField: HTMLDivElement;
  customField: HTMLDivElement;
} {
  const scaleIsCustom = !isPresetScale(cli.scale);
  const scaleField = fieldSelect(
    "cliScale",
    "Resolution",
    scaleOptions(info),
    scaleIsCustom ? "custom" : String(cli.scale),
    RESOLUTION_INFO,
  );
  const customField = fieldNumber(
    "cliScaleCustom",
    "Custom %",
    scaleIsCustom ? Math.round(cli.scale * 100) : cli.customScale,
    1,
    100,
    1,
  );
  customField.classList.add("field-compact");
  customField.style.display = scaleIsCustom ? "" : "none";
  return { scaleField, customField };
}

/** Wires the Resolution select and Custom % field's `change`/`input` handlers into the shared `cli`
 * state. Call once the fields from `resolutionFields` are in the DOM. */
export function bindResolutionControls(): void {
  document.getElementById("cliScale")?.addEventListener("change", (e) => {
    const v = (e.target as HTMLSelectElement).value;
    cli.scale = v === "custom" ? cli.customScale / 100 : parseScale(v);
    syncQualityControls();
  });
  document.getElementById("cliScaleCustom")?.addEventListener("input", (e) => {
    const pct = parseInt((e.target as HTMLInputElement).value, 10);
    if (!Number.isFinite(pct)) return;
    cli.customScale = Math.min(100, Math.max(1, pct));
    cli.scale = cli.customScale / 100;
    syncQualityControls();
  });
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
  const customScale = !isPresetScale(cli.scale);
  if (scaleSel) scaleSel.value = customScale ? "custom" : String(cli.scale);
  const customField = document.getElementById("cliScaleCustom") as HTMLInputElement | null;
  if (customField) {
    if (customScale) customField.value = String(Math.round(cli.scale * 100));
    if (customField.parentElement) customField.parentElement.style.display = customScale ? "" : "none";
  }
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
