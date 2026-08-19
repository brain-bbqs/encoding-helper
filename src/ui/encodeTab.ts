// Tab: Reencode with FFmpeg — everything about running one setting on this file, in the order the
// question is actually asked: build the command, try it on a few sampled seconds, then run it over
// the whole video (here in the page, or by copying the command and running ffmpeg natively).
//
// The three belong on one page because they are one decision. Trying a setting on five seconds is
// only useful next to the command that setting comes to, and the whole-file encode is that same
// command over the whole file rather than a separate feature.

import { computeGop, isDownscale } from "../lib/cliCommand";
import { copyToClipboard, h, teachBox } from "../lib/dom";
import { RESOLUTION_INFO, SCALER_INFO, X264_PRESET_INFO } from "../lib/explainers";
import { cliSettings } from "../lib/qualityMatrix";
import { cli, encodeTest, state } from "../lib/state";
import type { SampleWindow, TrackInfo, VideoInfo } from "../lib/types";
import { loadEncodedIntoAB } from "./abPanel";
import { renderEducationalToggle } from "./educationalToggle";
import { inBrowserEncodeSection } from "./inBrowserEncode";
import {
  parseScale,
  parseScaler,
  refreshCliCommand,
  scaleOptions,
  scalerOptions,
  syncQualityControls,
} from "./cliControls";
import { fieldNumber, fieldSelect } from "./formControls";
import { samplePicker } from "./samplePicker";
import {
  acquireWorkers,
  dropWholeFileInput,
  encodeWindows,
  endRunUi,
  prepareRun,
  reportRunFailure,
  runControls,
  startRunUi,
  type RunInputs,
  type RunUi,
} from "./segmentRun";

export function renderEncodeTab(panel: HTMLElement): void {
  panel.innerHTML = "";
  const vt = state.tracks?.find((t) => t.kind === "video");
  if (!vt || vt.codedWidth == null || vt.codedHeight == null) return;
  const info: VideoInfo = { fps: state.fps, width: vt.codedWidth, height: vt.codedHeight };

  const builderSec = h("div", "section");
  const builderHead = h("div", "section-head");
  builderHead.append(h("h2", null, "FFmpeg Command Builder"), renderEducationalToggle());
  builderSec.append(builderHead);
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
        `colleague's machine and produces the same bytes. What runs in the page below is the same ffmpeg, for ` +
        `judging a setting quickly rather than for processing a corpus.</p>` +
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
        ["medium", "Medium (CRF 25), default"],
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
  row1.append(fieldSelect("cliScale", "Resolution", scaleOptions(info), String(cli.scale), RESOLUTION_INFO));
  const cliScalerField = fieldSelect("cliScaler", "Scaler", scalerOptions(), cli.scaler, SCALER_INFO);
  cliScalerField.style.display = isDownscale(cli.scale) ? "" : "none";
  row1.append(cliScalerField);
  row1.append(
    fieldSelect(
      "cliPreset",
      "x264 Preset",
      ["ultrafast", "superfast", "veryfast", "faster", "fast", "medium", "slow", "slower", "veryslow"].map(
        (p) => [p, p + (p === "superfast" ? " (default, sleap-io)" : "")] as [string, string],
      ),
      cli.preset,
      X264_PRESET_INFO,
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
  document.getElementById("cliScale")?.addEventListener("change", (e) => {
    cli.scale = parseScale((e.target as HTMLSelectElement).value);
    syncQualityControls();
  });
  document.getElementById("cliScaler")?.addEventListener("change", (e) => {
    cli.scaler = parseScaler((e.target as HTMLSelectElement).value);
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

  panel.append(...sampleRunSection(vt));
  panel.append(inBrowserEncodeSection(info));
}

/**
 * The command above, run over a few short stretches of the loaded video, with the result shown
 * against the original.
 *
 * A CRF is a number until you have seen what it does to your footage, and what it does depends on
 * the footage: the same 25 that is invisible on a static cage view smears a fast-moving animal.
 * Five seconds encoded here answers that in a few seconds, and the same run measures what the
 * setting would save across the whole file — both questions the command itself cannot answer, and
 * both cheaper to ask here than by encoding a full recording to find out.
 */
function sampleRunSection(vt: TrackInfo): HTMLElement[] {
  const sec = h("div", "section");
  sec.append(h("h2", null, "Try It on a Sample"));
  sec.append(
    teachBox(
      `Encodes three seconds of the video with the command above — the real ffmpeg, compiled to WebAssembly, so ` +
        `the bytes are the bytes it would produce — and shows the result against the same seconds of the ` +
        `original, zoomable to the pixel. Nothing is uploaded and the file on disk is untouched.` +
        `<p>Which three seconds is the question worth asking, so the track below scans the whole recording: ` +
        `slide the band to the stretch that matters, judging it by the frame above it. A run starts at the ` +
        `keyframe at or before the band, since that is where the cut can be made without decoding the file from ` +
        `the beginning.</p>` +
        `<p>One stretch of a fixed length, judged by eye: there is nothing to set here beyond where it comes ` +
        `from. Sampling several places at once to project what a setting saves across the whole file, and ` +
        `sweeping several settings against each other, are the <b>Compare Quality</b> tab's job.</p>`,
    ),
  );
  const picker = samplePicker();
  if (picker) sec.append(picker.el);
  const { nodes, ui } = runControls("Run Comparison");
  sec.append(...nodes);

  const resultSec = h("div", "section");
  resultSec.style.display = "none";

  ui.runButton.addEventListener("click", () => {
    // Disabled here as well as by the run itself, so a second click cannot land in the gap before
    // the run has started.
    ui.runButton.disabled = true;
    const windows = picker ? [picker.window()] : [];
    void runSample(windows, vt, ui, resultSec).finally(() => {
      if (encodeTest.running) return;
      ui.runButton.disabled = false;
    });
  });
  return [sec, resultSec];
}

/** Encodes the picked stretch at whatever the builder currently says, and puts it in the A/B
 * window. */
async function runSample(windows: SampleWindow[], vt: TrackInfo, ui: RunUi, resultSec: HTMLDivElement): Promise<void> {
  // One encoder, one pool: a sweep running on the other tab has both, and its run is the one that
  // was asked for first.
  if (encodeTest.running) {
    ui.note.textContent = "An encode is already running on the Compare Quality tab. Wait for it to finish.";
    return;
  }
  if (!windows.length) {
    ui.note.textContent = "No video loaded to encode.";
    return;
  }
  const fill = startRunUi(ui);
  ui.note.textContent = "Loading ffmpeg.wasm…";
  let inputs: RunInputs | null = null;
  try {
    const workers = acquireWorkers(windows.length);
    await workers[0].load();
    inputs = await prepareRun(windows, workers, ui);
    // The A/B window draws the original from startTime, so it follows the stretch actually shown.
    encodeTest.startTime = windows[0]?.startSeconds ?? encodeTest.startTime;
    ui.note.textContent = "Encoding test segment…";
    const { first, bytes, measured } = await encodeWindows(cli, inputs, workers, ui, (fraction) => {
      const pct = fraction * 100;
      if (fill) fill.style.width = pct.toFixed(0) + "%";
      ui.note.textContent =
        windows.length > 1
          ? `Encoding ${windows.length} sampled segments… ${pct.toFixed(0)}%`
          : `Encoding test segment… ${pct.toFixed(0)}%`;
    });

    ui.note.textContent = "Decoding frames…";
    await loadEncodedIntoAB(first, cliSettings(cli), vt, resultSec, { bytes, windows: measured });
    // A full bar, in the colour the app uses for a good outcome, rather than the word "Done." under
    // an empty one: the run either filled the bar or it did not.
    if (fill) {
      fill.style.width = "100%";
      fill.classList.add("done");
    }
    ui.note.textContent = "";
  } catch (err) {
    reportRunFailure(err, ui);
  } finally {
    await dropWholeFileInput(inputs);
    endRunUi(ui);
  }
}
