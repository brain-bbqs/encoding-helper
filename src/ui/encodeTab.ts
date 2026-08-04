// Tab: Re-encode & CLI — the CLI Command Builder plus the two in-browser re-encode engines (fast /
// mediabunny-WebCodecs and exact / ffmpeg.wasm).

import { fetchFile } from "@ffmpeg/util";
import { buildFfmpegArgs, computeGop } from "../lib/cliCommand";
import { copyToClipboard, h, teachBox } from "../lib/dom";
import { ensureFfmpegLoaded, runFfmpegEncode, setFfmpegHandlers } from "../lib/ffmpegEngine";
import { prepareMediabunnyConversion } from "../lib/fastEngine";
import { ensureMediabunny } from "../lib/mediabunny";
import { downloadBlob, extOf, pickSaveTarget } from "../lib/save";
import { cli, state } from "../lib/state";
import type { VideoInfo } from "../lib/types";
import { refreshCliCommand, showReencodeResult, syncQualityControls } from "./cliControls";
import { engineBox, fieldNumber, fieldSelect, logLine, type EngineBox } from "./formControls";

export function renderEncodeTab(panel: HTMLElement): void {
  panel.innerHTML = "";
  const vt = state.tracks?.find((t) => t.kind === "video");
  if (!vt || vt.codedWidth == null || vt.codedHeight == null) return;
  const info: VideoInfo = { fps: state.fps, width: vt.codedWidth, height: vt.codedHeight };

  const builderSec = h("div", "section");
  builderSec.append(h("h2", null, "CLI Command Builder"));
  builderSec.append(
    teachBox(
      `This mirrors <a href="https://github.com/talmolab/sleap-io" target="_blank" rel="noopener">sleap-io</a>'s ` +
        `<code>reencode</code> baseline &mdash; the shared transcoding target for the BBQS consortium's pose ` +
        `pipelines. Every knob below edits the command live; copy it to run locally, headless, or in batch.`,
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

  // ---- In-browser engines ----
  const engineSec = h("div", "section");
  engineSec.append(h("h2", null, "Re-encode In-Browser"));

  const fastBox = engineBox(
    "fast",
    "Fast (WebCodecs / mediabunny)",
    "Hardware-accelerated. No CRF control &mdash; WebCodecs only exposes target bitrate / quality presets, so this is an approximation, not a byte-match of the CLI command.",
  );
  engineSec.append(fastBox.el);
  const exactBox = engineBox(
    "exact",
    "Exact (ffmpeg.wasm)",
    "Runs the literal command above. Lazy-loads ~30 MB on first use and runs single-threaded (no COOP/COEP needed on static hosting), so it is slower than realtime but byte-for-byte matches the CLI.",
  );
  engineSec.append(exactBox.el);
  panel.append(engineSec);

  fastBox.button.addEventListener("click", () => void runFastEncode(info, fastBox));
  exactBox.button.addEventListener("click", () => void runExactEncode(info, exactBox));

  void ensureMediabunny().then(async (mb) => {
    try {
      const ok = await mb.canEncodeVideo("avc");
      if (!ok) {
        fastBox.button.disabled = true;
        fastBox.note.textContent =
          "This browser cannot hardware-encode H.264 via WebCodecs. Use the Exact (ffmpeg.wasm) engine or the CLI command instead.";
      }
    } catch {
      /* leave enabled; the click handler will surface any error */
    }
  });
}

async function runFastEncode(info: VideoInfo, box: EngineBox): Promise<void> {
  box.button.disabled = true;
  box.progress.style.display = "block";
  const fill = box.progress.querySelector<HTMLDivElement>(".fill");
  if (fill) fill.style.width = "0%";
  box.note.textContent = "Preparing…";
  box.result.innerHTML = "";
  try {
    if (!state.input || !state.source) throw new Error("No video loaded");
    const baseName = (state.source.name || "video").replace(/\.[^.]+$/, "");
    const target = await pickSaveTarget(baseName + ".fast.mp4");
    if (!target) return;
    const { outputTarget, execute } = await prepareMediabunnyConversion(state.input, target, cli, info);
    await execute((ratio) => {
      if (fill) fill.style.width = (ratio * 100).toFixed(0) + "%";
      box.note.textContent = `Encoding… ${(ratio * 100).toFixed(0)}%`;
    });
    let outSize: number;
    const mb = await ensureMediabunny();
    if (target.kind === "stream") {
      outSize = (await target.handle.getFile()).size;
    } else if (outputTarget instanceof mb.BufferTarget && outputTarget.buffer) {
      const blob = new Blob([outputTarget.buffer], { type: "video/mp4" });
      outSize = blob.size;
      downloadBlob(blob, baseName + ".fast.mp4");
    } else {
      outSize = 0;
    }
    showReencodeResult(box, state.source.size, outSize);
  } catch (err) {
    console.error("[encoding-helper] fast encode failed:", err);
    box.note.textContent = "Failed: " + (err instanceof Error ? err.message : String(err));
  } finally {
    box.button.disabled = false;
    box.progress.style.display = "none";
  }
}

async function runExactEncode(info: VideoInfo, box: EngineBox): Promise<void> {
  box.button.disabled = true;
  box.progress.style.display = "block";
  const fill = box.progress.querySelector<HTMLDivElement>(".fill");
  if (fill) fill.style.width = "0%";
  box.note.textContent = "Loading ffmpeg.wasm…";
  box.result.innerHTML = "";
  box.log.innerHTML = "";
  setFfmpegHandlers(
    (msg) => logLine(box.log, msg, "info"),
    (ratio) => {
      const pct = Math.min(1, Math.max(0, ratio)) * 100;
      if (fill) fill.style.width = pct.toFixed(0) + "%";
      box.note.textContent = `Encoding… ${pct.toFixed(0)}%`;
    },
  );
  try {
    if (!state.source) throw new Error("No video loaded");
    await ensureFfmpegLoaded();
    const inputName = "in" + extOf(state.source.name);
    const outputName = "out.reencoded.mp4";
    box.note.textContent = "Writing input to virtual filesystem…";
    const inputData = await fetchFile(state.file ?? state.source.url ?? undefined);
    const args = buildFfmpegArgs(cli, info, inputName, outputName);
    logLine(box.log, "$ ffmpeg " + args.join(" "), "success");
    box.note.textContent = "Encoding (single-threaded — this can take a while)…";
    const { data } = await runFfmpegEncode(args, inputName, inputData, outputName);
    const blob = new Blob([data], { type: "video/mp4" });
    const baseName = (state.source.name || "video").replace(/\.[^.]+$/, "");
    const target = await pickSaveTarget(baseName + ".exact.mp4");
    if (target && target.kind === "stream") {
      await target.writable.write(blob);
      await target.writable.close();
    } else {
      downloadBlob(blob, baseName + ".exact.mp4");
    }
    showReencodeResult(box, state.source.size, blob.size);
  } catch (err) {
    console.error("[encoding-helper] exact encode failed:", err);
    box.note.textContent = "Failed: " + (err instanceof Error ? err.message : String(err));
    logLine(box.log, String(err instanceof Error ? err.message : err), "error");
  } finally {
    box.button.disabled = false;
    box.progress.style.display = "none";
  }
}
