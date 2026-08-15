// CLI preview refresh + quality/preset control syncing, shared by the FFmpeg Command Builder (Reencode
// tab) and the Compare Quality tab — both edit the same `cli` state object.

import { buildFfmpegArgs, computeGop, describeScale, formatCliCommand, SCALE_OPTIONS } from "../lib/cliCommand";
import { gridItem, h } from "../lib/dom";
import { fmtBytes } from "../lib/format";
import { cli, currentVideoInfo, state } from "../lib/state";
import type { EngineBox } from "./formControls";

/** Recomputes the CLI preview from the shared `cli` state; a no-op if no video is loaded. */
export function refreshCliCommand(): void {
  const info = currentVideoInfo();
  if (!info) return;
  const args = buildFfmpegArgs(cli, info);
  const cmdPre = document.getElementById("cmdPre");
  if (cmdPre) cmdPre.textContent = formatCliCommand(args);
  const hint = document.getElementById("gopHint");
  if (hint) {
    const fps = cli.fps || info.fps || 30;
    hint.textContent = `GOP size = round(interval × fps) = round(${cli.keyframeInterval} × ${fps.toFixed(2)}) = ${computeGop(cli, fps)} frames`;
  }
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

// Quality/CRF/preset/resolution controls exist in both the FFmpeg Command Builder ("cli" prefix) and
// the Encode Test tab ("et" prefix), bound to the same `cli` object — this keeps both sets of
// controls (and the CLI preview) showing the same values after either edits.
export function syncQualityControls(): void {
  for (const prefix of ["cli", "et"]) {
    const qSel = document.getElementById(prefix + "Quality") as HTMLSelectElement | null;
    if (qSel) qSel.value = cli.quality;
    const crfField = document.getElementById(prefix + "Crf") as HTMLInputElement | null;
    if (crfField) {
      crfField.value = String(cli.crf);
      if (crfField.parentElement) crfField.parentElement.style.display = cli.quality === "custom" ? "" : "none";
    }
    const presetSel = document.getElementById(prefix + "Preset") as HTMLSelectElement | null;
    if (presetSel) presetSel.value = cli.preset;
    const scaleSel = document.getElementById(prefix + "Scale") as HTMLSelectElement | null;
    if (scaleSel) scaleSel.value = String(cli.scale);
  }
  refreshCliCommand();
}

/**
 * Shows what an in-browser encode came to, and records it: the Full Analysis document reports the
 * last completed encode, and this is the one place both engines pass through on success.
 */
export function showReencodeResult(box: EngineBox, engine: "fast" | "exact", origSize: number, outSize: number): void {
  state.reencodeResult = { engine, originalSize: origSize, encodedSize: outSize };
  const pct = (1 - outSize / origSize) * 100;
  box.result.innerHTML = "";
  const g = h("div", "grid");
  g.append(
    gridItem("Original Size", fmtBytes(origSize)),
    gridItem("Encoded Size", fmtBytes(outSize)),
    gridItem("Change", (pct >= 0 ? "-" : "+") + Math.abs(pct).toFixed(1) + "%"),
  );
  box.result.append(g);
  box.note.textContent = "Done.";
}
