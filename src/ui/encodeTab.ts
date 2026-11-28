// The Reencode with FFmpeg tab: everything about running one setting on this file, in the order the
// question is actually asked: build the command, try it on a few sampled seconds, then run it over
// the whole video (here in the page, or by copying the command and running ffmpeg natively).
//
// The three belong on one page because they are one decision. Trying a setting on a few seconds is
// only useful next to the command that setting comes to, and the whole-file encode is that same
// command over the whole file rather than a separate feature.

import { CRF_MAP } from "../lib/cliCommand";
import { h } from "@brain-bbqs/ui";
import { cmdBlock, section, teachBox } from "../lib/dom";
import { claimEncoder, holdsEncoder, releaseEncoder } from "../lib/encoderRun";
import { REENCODE_INTRO, SCALER_INFO, X264_PRESET_INFO } from "../lib/explainers";
import { cliSettings, MATRIX_PRESETS } from "../lib/qualityMatrix";
import { cli, currentVideoInfo, sampledEncode, videoTrackInfo } from "../lib/state";
import type { SampleWindow, TrackInfo } from "../lib/types";
import { loadEncodedIntoAB } from "./abPanel";
import { inBrowserEncodeSection } from "./inBrowserEncode";
import {
  bindResolutionControls,
  parseScaler,
  type QualityControls,
  refreshCliCommand,
  resolutionFields,
  scalerOptions,
  syncQualityControls,
} from "./cliControls";
import { clampToField, fieldNumber, fieldSelect, finishFill } from "./formControls";
import { samplePicker } from "./samplePicker";
import {
  acquireWorkers,
  dropWholeFileInput,
  encodeWindows,
  endRunUi,
  onRunPress,
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

/** The builder card's title, which the Full Analysis document heads the command with as well. */
export const COMMAND_BUILDER_TITLE = "FFmpeg Command Builder";

export function renderEncodeTab(panel: HTMLElement): void {
  panel.innerHTML = "";
  const vt = videoTrackInfo();
  const info = currentVideoInfo();
  if (!vt || !info) return;

  const builderSec = section(COMMAND_BUILDER_TITLE);
  builderSec.append(teachBox(REENCODE_INTRO, "🔁"));
  // Made ahead of the fields that rewrite it, and placed under them.
  const { wrap: cmdWrap, pre: cmdPre } = cmdBlock();
  cmdPre.id = "cmdPre";
  const refresh = (): void => refreshCliCommand(cmdPre);

  const form = h("div");
  // Capped rather than left to fill the form: the longest option is a few words, and a select as
  // wide as the page reads as a text field.
  const { field: qualityField, select: qualitySelect } = fieldSelect(
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
  const { field: crfField, input: crfInput } = fieldNumber(
    "cliCrf",
    "Custom CRF (0=lossless, 51=worst)",
    cli.crf,
    0,
    51,
    1,
  );
  crfField.classList.add("field-compact");
  form.append(crfField);

  const row1 = h("div", "row");
  const resolution = resolutionFields(info);
  row1.append(resolution.scaleField, resolution.customField);
  const { field: cliScalerField, select: scalerSelect } = fieldSelect(
    "cliScaler",
    "Scaler",
    scalerOptions(),
    cli.scaler,
    SCALER_INFO,
  );
  // Shown at every resolution, the way the sweep lists its kernels, but only live where something is
  // being resampled (see syncQualityControls): at full resolution there is nothing for a kernel to do.
  row1.append(cliScalerField);
  const { field: presetField, select: presetSelect } = fieldSelect(
    "cliPreset",
    "x264 Preset",
    MATRIX_PRESETS,
    cli.preset,
    X264_PRESET_INFO,
  );
  row1.append(presetField);
  const { field: kfField, input: kfInput } = fieldNumber(
    "cliKeyframeInterval",
    "Keyframe Interval (s)",
    cli.keyframeInterval,
    0.1,
    10,
    0.1,
  );
  row1.append(kfField);
  form.append(row1);
  // Content-width rather than a third of the form each: the labels differ in length, so equal
  // shares put them at three arbitrary distances from their boxes.
  const row2 = h("div", "row row-checks");
  for (const [id, label, key] of [
    ["cliNoBFrames", " Disable B-frames", "noBFrames"],
    ["cliPad", " Pad to even dimensions", "pad"],
    ["cliFaststart", " Faststart", "faststart"],
  ] as const) {
    const { field, input } = checkField(id, label, cli[key]);
    input.addEventListener("change", () => {
      cli[key] = input.checked;
      refresh();
    });
    row2.append(field);
  }
  form.append(row2);

  const row3 = h("div", "row");
  const { field: audioField, select: audioSelect } = fieldSelect(
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
  const { field: fpsField, input: fpsInput } = fieldNumber(
    "cliFps",
    "FPS override (blank = source)",
    cli.fps || "",
    1,
    240,
    1,
  );
  fpsField.classList.add("field-compact");
  row3.append(fpsField);
  form.append(row3);
  builderSec.append(form);
  builderSec.append(cmdWrap);
  panel.append(builderSec);

  const controls: QualityControls = {
    ...resolution,
    qualitySelect,
    crfField,
    crfInput,
    presetSelect,
    scalerSelect,
    cmdPre,
  };
  const sync = (): void => syncQualityControls(controls);

  const bindNumber = (
    input: HTMLInputElement,
    parse: (v: string) => number,
    assign: (parsed: number | null) => void,
  ): void => {
    input.addEventListener("input", () => {
      const v = input.value;
      assign(v === "" ? null : parse(v));
      refresh();
    });
  };
  qualitySelect.addEventListener("change", () => {
    cli.quality = qualitySelect.value as typeof cli.quality;
    sync();
  });
  // The number fields hold what they store to the range they advertise (see clampToField): these
  // are the arguments the sample run and the whole-file encode execute, not only the ones shown.
  crfInput.addEventListener("input", () => {
    cli.crf = clampToField(crfInput, parseInt(crfInput.value, 10) || 0);
    sync();
  });
  presetSelect.addEventListener("change", () => {
    cli.preset = presetSelect.value as typeof cli.preset;
    sync();
  });
  bindResolutionControls(resolution, sync);
  scalerSelect.addEventListener("change", () => {
    cli.scaler = parseScaler(scalerSelect.value);
    sync();
  });
  bindNumber(kfInput, parseFloat, (parsed) => {
    cli.keyframeInterval = parsed == null ? cli.keyframeInterval : clampToField(kfInput, parsed);
  });
  audioSelect.addEventListener("change", () => {
    cli.audioMode = audioSelect.value as typeof cli.audioMode;
    refresh();
  });
  bindNumber(
    fpsInput,
    (v) => parseInt(v, 10),
    (parsed) => {
      cli.fps = parsed == null ? null : clampToField(fpsInput, parsed);
    },
  );
  // The freshly built controls take the state the builder's settings put them in (the CRF field
  // shown or hidden, the kernel live or inert), by the same rules every later change follows.
  sync();

  panel.append(sampleRunSection(vt));
  panel.append(inBrowserEncodeSection(info));
}

/**
 * The command above, run over a short stretch of the loaded video, with the result shown against
 * the original.
 *
 * A CRF is a number until you have seen what it does to your footage, and what it does depends on
 * the footage: the same 25 that is invisible on a static cage view smears a fast-moving animal.
 * A few seconds encoded here answer that in a few seconds, and the same run measures what the
 * setting would save across the whole file: both questions the command itself cannot answer, and
 * both cheaper to ask here than by encoding a full recording to find out.
 */
function sampleRunSection(vt: TrackInfo): HTMLElement {
  const sec = section("Try It on a Sample");
  const picker = samplePicker();
  if (picker) sec.append(picker.el);
  const { nodes, ui } = runControls(() => "Run Comparison");
  sec.append(...nodes);

  // The comparison lands inside this card rather than in one of its own: it is what the run above
  // it produced, and a card that reads "Try It on a Sample" with the sample nowhere in it reads as
  // two unrelated things.
  const resultSec = h("div", "ab-inline");
  resultSec.style.display = "none";
  sec.append(resultSec);

  onRunPress(ui, () => runSample(picker ? [picker.window()] : [], vt, ui, resultSec));
  return sec;
}

/** Encodes the picked stretch at whatever the builder currently says, and puts it in the A/B
 * window. */
async function runSample(windows: SampleWindow[], vt: TrackInfo, ui: RunUi, resultSec: HTMLDivElement): Promise<void> {
  if (!windows.length) {
    ui.note.textContent = "No video loaded to encode.";
    return;
  }
  // One encoder, one pool: whatever run already has them is the one that was asked for first.
  const run = claimEncoder("Reencode with FFmpeg", true, ui.note);
  if (!run) return;
  const fill = startRunUi(ui);
  ui.note.textContent = "Loading ffmpeg.wasm…";
  let inputs: RunInputs | null = null;
  try {
    const workers = acquireWorkers(run, windows.length, ui);
    await workers[0].load();
    inputs = await prepareRun(run, windows, workers, ui);
    // Records where the encoded stretch starts. The A/B window draws the original from the windows
    // passed to it below, not from this.
    sampledEncode.startTime = windows[0].startSeconds;
    ui.note.textContent = "Encoding…";
    // The bar is the progress, as in the whole-file run; a percentage spelled out beside it is the
    // same number twice.
    const { blobs, bytes, measured } = await encodeWindows(run, cli, inputs, workers, ui, (fraction) => {
      fill.style.width = (fraction * 100).toFixed(0) + "%";
    });

    ui.note.textContent = "Decoding frames…";
    await loadEncodedIntoAB(blobs, cliSettings(cli), vt, resultSec, { bytes, windows: measured }, run);
    // A full bar, in the colour the app uses for a good outcome, rather than the word "Done." under
    // an empty one: the run either filled the bar or it did not.
    finishFill(fill);
    ui.note.textContent = "";
  } catch (err) {
    reportRunFailure(run, err, ui);
  } finally {
    // A file loaded or Reset meanwhile has stopped this run and terminated its cores already.
    if (holdsEncoder(run)) await dropWholeFileInput(inputs);
    releaseEncoder(run);
    endRunUi(ui);
  }
}
