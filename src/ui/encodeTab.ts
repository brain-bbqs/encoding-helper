// Tab: Reencode & CLI — the FFmpeg Command Builder. The in-browser engines that consume these
// settings live in their own tab (reencodeTab.ts).

import { computeGop } from "../lib/cliCommand";
import { copyToClipboard, h, teachBox } from "../lib/dom";
import { cli, state } from "../lib/state";
import type { VideoInfo } from "../lib/types";
import { refreshCliCommand, syncQualityControls } from "./cliControls";
import { fieldNumber, fieldSelect } from "./formControls";

export function renderEncodeTab(panel: HTMLElement): void {
  panel.innerHTML = "";
  const vt = state.tracks?.find((t) => t.kind === "video");
  if (!vt || vt.codedWidth == null || vt.codedHeight == null) return;
  const info: VideoInfo = { fps: state.fps, width: vt.codedWidth, height: vt.codedHeight };

  const builderSec = h("div", "section");
  builderSec.append(h("h2", null, "FFmpeg Command Builder"));
  builderSec.append(
    teachBox(
      `<b>Reencoding</b> means decoding a video back to raw frames and compressing them again. That is what ` +
        `lets you change quality, resolution, frame rate or keyframe spacing, and it is lossy: each pass throws ` +
        `away detail the previous pass kept, so start from the original whenever you can.` +
        `<p><b>Transcoding</b> is the same operation into a <i>different</i> codec (H.265 to H.264, say); the ` +
        `terms are often used interchangeably, but transcoding implies the codec itself changes. Neither is ` +
        `<b>remuxing</b> (<code>ffmpeg -c copy</code>), which lifts the already-compressed frames into a ` +
        `different container untouched, and so is lossless and nearly instant.</p>` +
        `<p>The command below runs <a href="https://ffmpeg.org/download.html" target="_blank" rel="noopener">` +
        `<b>ffmpeg</b></a> on your own machine, which is the way to do this for real work: it is a native ` +
        `multi-threaded build with no 30 MB download and no browser memory ceiling, so it is far faster on a ` +
        `full-length video; it scripts over a whole dataset; and the exact same command reruns later or on a ` +
        `colleague's machine and produces the same bytes. The in-browser engines further down are for judging a ` +
        `setting quickly, not for processing a corpus.</p>` +
        `<p>The settings here mirror ` +
        `<a href="https://io.sleap.ai/latest/cli/#sio-reencode" target="_blank" rel="noopener">sleap-io</a>'s ` +
        `<code>reencode</code> baseline, the shared transcoding target for the BBQS consortium's pose ` +
        `pipelines. Every knob below edits the command live; copy it to run locally, headless, or in batch.</p>`,
    ),
  );

  const form = h("div");
  form.append(
    fieldSelect(
      "cliQuality",
      "Quality",
      [
        ["lossless", "Lossless (CRF 0)"],
        ["high", "High (CRF 18)"],
        ["medium", "Medium (CRF 25) — default"],
        ["low", "Low (CRF 32)"],
        ["custom", "Custom CRF"],
      ],
      cli.quality,
    ),
  );
  const crfField = fieldNumber("cliCrf", "Custom CRF (0=lossless, 51=worst)", cli.crf, 0, 51, 1);
  crfField.style.display = cli.quality === "custom" ? "" : "none";
  form.append(crfField);

  const row1 = h("div", "row");
  row1.append(
    fieldSelect(
      "cliPreset",
      "x264 Preset",
      ["ultrafast", "superfast", "veryfast", "faster", "fast", "medium", "slow", "slower", "veryslow"].map(
        (p) => [p, p + (p === "superfast" ? " — default (sleap-io)" : "")] as [string, string],
      ),
      cli.preset,
    ),
  );
  row1.append(fieldNumber("cliKeyframeInterval", "Keyframe Interval (s)", cli.keyframeInterval, 0.1, 10, 0.1));
  form.append(row1);
  const gopHint = h(
    "div",
    "field hint",
    `GOP size = round(interval × fps) = round(${cli.keyframeInterval} × ${(info.fps || 30).toFixed(2)}) = ${computeGop(cli, info.fps || 30)} frames`,
  );
  gopHint.id = "gopHint";
  form.append(gopHint);

  const row2 = h("div", "row");
  const bfField = h("div", "field");
  const bfLabel = h("label");
  const bfCheck = h("input");
  bfCheck.type = "checkbox";
  bfCheck.id = "cliNoBFrames";
  bfCheck.checked = cli.noBFrames;
  bfLabel.append(bfCheck, document.createTextNode(" Disable B-frames (-bf 0, recommended for seekability)"));
  bfField.append(bfLabel);
  row2.append(bfField);
  const padField = h("div", "field");
  const padLabel = h("label");
  const padCheck = h("input");
  padCheck.type = "checkbox";
  padCheck.id = "cliPad";
  padCheck.checked = cli.pad;
  padLabel.append(padCheck, document.createTextNode(" Pad to even dimensions"));
  padField.append(padLabel);
  row2.append(padField);
  const fsField = h("div", "field");
  const fsLabel = h("label");
  const fsCheck = h("input");
  fsCheck.type = "checkbox";
  fsCheck.id = "cliFaststart";
  fsCheck.checked = cli.faststart;
  fsLabel.append(fsCheck, document.createTextNode(" Faststart (+movflags)"));
  fsField.append(fsLabel);
  row2.append(fsField);
  form.append(row2);

  const row3 = h("div", "row");
  row3.append(
    fieldSelect(
      "cliAudio",
      "Audio",
      [
        ["copy", "Copy (default)"],
        ["strip", "Strip (-an)"],
      ],
      cli.audioMode,
    ),
  );
  row3.append(fieldNumber("cliFps", "FPS override (blank = source)", cli.fps || "", 1, 240, 1));
  form.append(row3);
  builderSec.append(form);

  const cmdPre = h("pre", "cmd");
  cmdPre.id = "cmdPre";
  builderSec.append(cmdPre);
  const copyBtn = h("button", "btn sm", "Copy Command");
  copyBtn.type = "button";
  copyBtn.addEventListener("click", () => copyToClipboard(cmdPre.textContent || "", copyBtn));
  builderSec.append(copyBtn);
  panel.append(builderSec);

  const bindNumber = (id: string, key: "keyframeInterval" | "fps", isFloat: boolean): void => {
    document.getElementById(id)?.addEventListener("input", (e) => {
      const v = (e.target as HTMLInputElement).value;
      const parsed = v === "" ? null : isFloat ? parseFloat(v) : parseInt(v, 10);
      if (key === "keyframeInterval") cli.keyframeInterval = parsed ?? cli.keyframeInterval;
      else cli.fps = parsed;
      refreshCliCommand();
    });
  };
  document.getElementById("cliQuality")?.addEventListener("change", (e) => {
    cli.quality = (e.target as HTMLSelectElement).value as typeof cli.quality;
    syncQualityControls();
  });
  document.getElementById("cliCrf")?.addEventListener("input", (e) => {
    cli.crf = parseInt((e.target as HTMLInputElement).value, 10) || 0;
    syncQualityControls();
  });
  document.getElementById("cliPreset")?.addEventListener("change", (e) => {
    cli.preset = (e.target as HTMLSelectElement).value as typeof cli.preset;
    syncQualityControls();
  });
  bindNumber("cliKeyframeInterval", "keyframeInterval", true);
  document.getElementById("cliNoBFrames")?.addEventListener("change", (e) => {
    cli.noBFrames = (e.target as HTMLInputElement).checked;
    refreshCliCommand();
  });
  document.getElementById("cliPad")?.addEventListener("change", (e) => {
    cli.pad = (e.target as HTMLInputElement).checked;
    refreshCliCommand();
  });
  document.getElementById("cliFaststart")?.addEventListener("change", (e) => {
    cli.faststart = (e.target as HTMLInputElement).checked;
    refreshCliCommand();
  });
  document.getElementById("cliAudio")?.addEventListener("change", (e) => {
    cli.audioMode = (e.target as HTMLSelectElement).value as typeof cli.audioMode;
    refreshCliCommand();
  });
  bindNumber("cliFps", "fps", false);
  refreshCliCommand();
}
