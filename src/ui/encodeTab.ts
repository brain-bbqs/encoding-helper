// Tab: Reencode with FFmpeg — everything about running one setting on this file, in the order the
// question is actually asked: build the command, try it on a few sampled seconds, then run it over
// the whole video (here in the page, or by copying the command and running ffmpeg natively).
//
// The three belong on one page because they are one decision. Trying a setting on five seconds is
// only useful next to the command that setting comes to, and the whole-file encode is that same
// command over the whole file rather than a separate feature.

import { CRF_MAP, isDownscale } from "../lib/cliCommand";
import { cmdBlock, h, section, teachBox } from "../lib/dom";
import { REENCODE_INTRO, SCALER_INFO, X264_PRESET_INFO } from "../lib/explainers";
import { cliSettings } from "../lib/qualityMatrix";
import { cli, encodeTest, state } from "../lib/state";
import type { SampleWindow, TrackInfo, VideoInfo } from "../lib/types";
import { loadEncodedIntoAB } from "./abPanel";
import { inBrowserEncodeSection } from "./inBrowserEncode";
import {
  bindResolutionControls,
  parseScaler,
  refreshCliCommand,
  resolutionFields,
  scalerOptions,
  syncQualityControls,
} from "./cliControls";
import { fieldNumber, fieldSelect, finishFill } from "./formControls";
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

/** A labelled checkbox in a field of its own, the input handed back for the caller to listen to. */
function checkField(id: string, label: string, checked: boolean): { field: HTMLDivElement; input: HTMLInputElement } {
  const field = h("div", "field");
  const labelEl = h("label");
  const input = h("input");
  input.type = "checkbox";
  input.id = id;
  input.checked = checked;
  labelEl.append(input, document.createTextNode(label));
  field.append(labelEl);
  return { field, input };
}

export function renderEncodeTab(panel: HTMLElement): void {
  panel.innerHTML = "";
  const vt = state.tracks?.find((t) => t.kind === "video");
  if (!vt || vt.codedWidth == null || vt.codedHeight == null) return;
  const info: VideoInfo = { fps: state.fps, width: vt.codedWidth, height: vt.codedHeight };

  const builderSec = section("FFmpeg Command Builder");
  builderSec.append(teachBox(REENCODE_INTRO, "🔁"));

  const form = h("div");
  // Capped rather than left to fill the form: the longest option is a few words, and a select as
  // wide as the page reads as a text field.
  const qualityField = fieldSelect(
    "cliQuality",
    "Quality",
    [
      ["lossless", `Lossless (CRF ${CRF_MAP.lossless})`],
      ["high", `High (CRF ${CRF_MAP.high})`],
      ["medium", `Medium (CRF ${CRF_MAP.medium})`],
      ["low", `Low (CRF ${CRF_MAP.low})`],
      ["custom", "Custom CRF"],
    ],
    cli.quality,
  );
  qualityField.classList.add("field-compact");
  form.append(qualityField);
  const crfField = fieldNumber("cliCrf", "Custom CRF (0=lossless, 51=worst)", cli.crf, 0, 51, 1);
  crfField.classList.add("field-compact");
  crfField.style.display = cli.quality === "custom" ? "" : "none";
  form.append(crfField);

  const row1 = h("div", "row");
  const { scaleField, customField } = resolutionFields(info);
  row1.append(scaleField, customField);
  const cliScalerField = fieldSelect("cliScaler", "Scaler", scalerOptions(), cli.scaler, SCALER_INFO);
  // Shown at every resolution, the way the sweep lists its kernels, but only live where something is
  // being resampled: at full resolution there is nothing for a kernel to do.
  const scalerSelect = cliScalerField.querySelector("select")!;
  scalerSelect.toggleAttribute("disabled", !isDownscale(cli.scale));
  row1.append(cliScalerField);
  const presetField = fieldSelect(
    "cliPreset",
    "x264 Preset",
    ["ultrafast", "superfast", "veryfast", "faster", "fast", "medium", "slow", "slower", "veryslow"],
    cli.preset,
    X264_PRESET_INFO,
  );
  row1.append(presetField);
  const kfField = fieldNumber("cliKeyframeInterval", "Keyframe Interval (s)", cli.keyframeInterval, 0.1, 10, 0.1);
  row1.append(kfField);
  form.append(row1);
  // Content-width rather than a third of the form each: the labels differ in length, so equal
  // shares put them at three arbitrary distances from their boxes.
  const row2 = h("div", "row row-checks");
  const { field: bfField, input: bfCheck } = checkField("cliNoBFrames", " Disable B-frames", cli.noBFrames);
  row2.append(bfField);
  const { field: padField, input: padCheck } = checkField("cliPad", " Pad to even dimensions", cli.pad);
  row2.append(padField);
  const { field: fsField, input: fsCheck } = checkField("cliFaststart", " Faststart", cli.faststart);
  row2.append(fsField);
  form.append(row2);

  const row3 = h("div", "row");
  const audioField = fieldSelect(
    "cliAudio",
    "Audio",
    [
      ["copy", "Copy"],
      ["strip", "Strip (-an)"],
    ],
    cli.audioMode,
  );
  audioField.classList.add("field-compact");
  row3.append(audioField);
  const fpsField = fieldNumber("cliFps", "FPS override (blank = source)", cli.fps || "", 1, 240, 1);
  fpsField.classList.add("field-compact");
  row3.append(fpsField);
  form.append(row3);
  builderSec.append(form);

  const { wrap: cmdWrap, pre: cmdPre } = cmdBlock();
  cmdPre.id = "cmdPre";
  builderSec.append(cmdWrap);
  panel.append(builderSec);

  const bindNumber = (
    input: HTMLInputElement,
    parse: (v: string) => number,
    assign: (parsed: number | null) => void,
  ): void => {
    input.addEventListener("input", () => {
      const v = input.value;
      assign(v === "" ? null : parse(v));
      refreshCliCommand();
    });
  };
  const qualitySelect = qualityField.querySelector("select")!;
  qualitySelect.addEventListener("change", () => {
    cli.quality = qualitySelect.value as typeof cli.quality;
    syncQualityControls();
  });
  const crfInput = crfField.querySelector("input")!;
  crfInput.addEventListener("input", () => {
    cli.crf = parseInt(crfInput.value, 10) || 0;
    syncQualityControls();
  });
  const presetSelect = presetField.querySelector("select")!;
  presetSelect.addEventListener("change", () => {
    cli.preset = presetSelect.value as typeof cli.preset;
    syncQualityControls();
  });
  bindResolutionControls();
  scalerSelect.addEventListener("change", () => {
    cli.scaler = parseScaler(scalerSelect.value);
    syncQualityControls();
  });
  bindNumber(kfField.querySelector("input")!, parseFloat, (parsed) => {
    cli.keyframeInterval = parsed ?? cli.keyframeInterval;
  });
  bfCheck.addEventListener("change", () => {
    cli.noBFrames = bfCheck.checked;
    refreshCliCommand();
  });
  padCheck.addEventListener("change", () => {
    cli.pad = padCheck.checked;
    refreshCliCommand();
  });
  fsCheck.addEventListener("change", () => {
    cli.faststart = fsCheck.checked;
    refreshCliCommand();
  });
  const audioSelect = audioField.querySelector("select")!;
  audioSelect.addEventListener("change", () => {
    cli.audioMode = audioSelect.value as typeof cli.audioMode;
    refreshCliCommand();
  });
  bindNumber(
    fpsField.querySelector("input")!,
    (v) => parseInt(v, 10),
    (parsed) => {
      cli.fps = parsed;
    },
  );
  refreshCliCommand();

  panel.append(sampleRunSection(vt));
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
function sampleRunSection(vt: TrackInfo): HTMLElement {
  const sec = section("Try It on a Sample");
  const picker = samplePicker();
  if (picker) sec.append(picker.el);
  const { nodes, ui } = runControls("Run Comparison");
  sec.append(...nodes);

  // The comparison lands inside this card rather than in one of its own: it is what the run above
  // it produced, and a card that reads "Try It on a Sample" with the sample nowhere in it reads as
  // two unrelated things.
  const resultSec = h("div", "ab-inline");
  resultSec.style.display = "none";
  sec.append(resultSec);

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
  return sec;
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
    encodeTest.startTime = windows[0].startSeconds;
    ui.note.textContent = "Encoding test segment…";
    const { blobs, bytes, measured } = await encodeWindows(cli, inputs, workers, ui, (fraction) => {
      const pct = fraction * 100;
      if (fill) fill.style.width = pct.toFixed(0) + "%";
      ui.note.textContent =
        windows.length > 1
          ? `Encoding ${windows.length} sampled segments… ${pct.toFixed(0)}%`
          : `Encoding test segment… ${pct.toFixed(0)}%`;
    });

    ui.note.textContent = "Decoding frames…";
    await loadEncodedIntoAB(blobs, cliSettings(cli), vt, resultSec, { bytes, windows: measured });
    // A full bar, in the colour the app uses for a good outcome, rather than the word "Done." under
    // an empty one: the run either filled the bar or it did not.
    finishFill(fill);
    ui.note.textContent = "";
  } catch (err) {
    reportRunFailure(err, ui);
  } finally {
    await dropWholeFileInput(inputs);
    endRunUi(ui);
  }
}
