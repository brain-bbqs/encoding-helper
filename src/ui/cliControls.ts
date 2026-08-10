// CLI preview refresh + quality/preset control syncing, shared by the FFmpeg Command Builder (Re-encode
// tab) and the Compare Quality tab — both edit the same `cli` state object.

import { buildFfmpegArgs, computeGop, formatCliCommand } from "../lib/cliCommand";
import { gridItem, h } from "../lib/dom";
import { fmtBytes } from "../lib/format";
import { cli, currentVideoInfo } from "../lib/state";
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

// Quality/CRF/preset controls exist in both the FFmpeg Command Builder ("cli" prefix) and the Encode
// Test tab ("et" prefix), bound to the same `cli` object — this keeps both sets of controls (and the
// CLI preview) showing the same values after either edits.
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
  }
  refreshCliCommand();
}

export function showReencodeResult(box: EngineBox, origSize: number, outSize: number): void {
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
