// The FFmpeg Command Builder's controls on the Reencode with FFmpeg tab, which is the one place the
// shared `cli` state object is edited: the resolution fields, the sync that keeps the controls that
// bear on each other in step, and the command preview under them.

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
import { RESOLUTION_INFO } from "../lib/explainers";
import { cli, currentVideoInfo, state } from "../lib/state";
import type { Scaler } from "../lib/types";
import { fieldNumber, fieldSelect } from "./formControls";

/** Recomputes the CLI preview in `cmdPre` from the shared `cli` state; a no-op if no video is loaded. */
export function refreshCliCommand(cmdPre: HTMLElement): void {
  const info = currentVideoInfo();
  if (!info) return;
  const args = buildFfmpegArgs(cli, info, undefined, encodedFileName(state.format));
  cmdPre.textContent = formatCliCommand(args);
}

/** The resolution dropdown's entries: the fixed ladder, labelled with what each comes out at for
 * the loaded file so the choice is made against real numbers rather than percentages, plus a
 * "Custom %" entry for a value the ladder doesn't offer. */
function scaleOptions(info: { width: number; height: number }): [string, string][] {
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

/** The Resolution field and the Custom % field beside it, each with the control inside it. */
export interface ResolutionFields {
  scaleField: HTMLDivElement;
  scaleSelect: HTMLSelectElement;
  customField: HTMLDivElement;
  customInput: HTMLInputElement;
}

/**
 * The Resolution select and the Custom % field beside it, built together because which one is
 * live depends on the other: kept out of `renderEncodeTab` so that function's branching stays
 * about the form's layout rather than the ladder/custom split. Which of the two shows is left to
 * `syncQualityControls`.
 */
export function resolutionFields(info: { width: number; height: number }): ResolutionFields {
  const scaleIsCustom = !isPresetScale(cli.scale);
  const { field: scaleField, select: scaleSelect } = fieldSelect(
    "cliScale",
    "Resolution",
    scaleOptions(info),
    scaleIsCustom ? "custom" : String(cli.scale),
    RESOLUTION_INFO,
  );
  const { field: customField, input: customInput } = fieldNumber(
    "cliScaleCustom",
    "Custom %",
    scaleIsCustom ? Math.round(cli.scale * 100) : cli.customScale,
    1,
    100,
    1,
  );
  customField.classList.add("field-compact");
  return { scaleField, scaleSelect, customField, customInput };
}

/** Wires the Resolution select and Custom % field's `change`/`input` handlers into the shared `cli`
 * state, calling `sync` after each change so the controls that depend on the scale follow it. */
export function bindResolutionControls(
  { scaleSelect, customInput }: Pick<ResolutionFields, "scaleSelect" | "customInput">,
  sync: () => void,
): void {
  scaleSelect.addEventListener("change", () => {
    const v = scaleSelect.value;
    cli.scale = v === "custom" ? cli.customScale / 100 : parseScale(v);
    sync();
  });
  customInput.addEventListener("input", () => {
    const pct = parseInt(customInput.value, 10);
    if (!Number.isFinite(pct)) return;
    cli.customScale = Math.min(100, Math.max(1, pct));
    cli.scale = cli.customScale / 100;
    sync();
  });
}

/** The kernel dropdown's entries, each named as the `flags=` value it becomes. */
export function scalerOptions(): [string, string][] {
  return SCALER_OPTIONS.map((s) => [s, s === DEFAULT_SCALER ? `${s} (sharper)` : `${s} (softer)`]);
}

export function parseScaler(value: string): Scaler {
  return SCALER_OPTIONS.includes(value as Scaler) ? (value as Scaler) : DEFAULT_SCALER;
}

/** The builder's controls that bear on each other, and the command preview they all feed. */
export interface QualityControls extends ResolutionFields {
  qualitySelect: HTMLSelectElement;
  crfField: HTMLDivElement;
  crfInput: HTMLInputElement;
  presetSelect: HTMLSelectElement;
  scalerSelect: HTMLSelectElement;
  cmdPre: HTMLElement;
}

// The quality, CRF, preset and resolution controls all bear on each other (a named quality hides
// the CRF field, a full-resolution output disables the kernel field), so every one of them refreshes the lot
// rather than only the field it owns, and the command preview with them. Also what puts the freshly
// built builder in that state, so the rules live here alone.
export function syncQualityControls(c: QualityControls): void {
  c.qualitySelect.value = cli.quality;
  c.crfInput.value = String(cli.crf);
  c.crfField.style.display = cli.quality === "custom" ? "" : "none";
  c.presetSelect.value = cli.preset;
  const customScale = !isPresetScale(cli.scale);
  c.scaleSelect.value = customScale ? "custom" : String(cli.scale);
  if (customScale) c.customInput.value = String(Math.round(cli.scale * 100));
  c.customField.style.display = customScale ? "" : "none";
  // The kernel only reaches the command when something is being resampled, so at full resolution the
  // field is there but inert rather than gone.
  c.scalerSelect.value = cli.scaler;
  c.scalerSelect.disabled = !isDownscale(cli.scale);
  refreshCliCommand(c.cmdPre);
}
