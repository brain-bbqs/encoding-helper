// The whole-video encode, run here in the page: the last section of the Reencode with FFmpeg tab.
//
// One engine, ffmpeg.wasm, running the literal command built above it, so what comes out of the
// browser is byte-for-byte what the command would produce on a machine with ffmpeg installed. It is
// a ~30 MB download and single-threaded, which is the price of that guarantee and the reason the
// command above stays the recommendation for a full-length recording or a whole dataset.

import { errorMessage } from "@brain-bbqs/utils";
import { fetchFile } from "@ffmpeg/util";
import { buildFfmpegArgs, encodedFileName } from "../lib/cliCommand";
import { section } from "../lib/dom";
import { claimEncoder, releaseEncoder, RunStopped, throwIfStopped } from "../lib/encoderRun";
import { defaultFfmpegWorker, ensureFfmpegLoaded, runFfmpegEncode, setFfmpegHandlers } from "../lib/ffmpegEngine";
import { baseNameOf, downloadBlob, extOf, pickSaveTarget } from "../lib/save";
import { cli, state } from "../lib/state";
import type { VideoInfo } from "../lib/types";
import { showReencodeResult } from "./cliControls";
import { clearLog, engineBox, type EngineBox, finishFill, logLine, resetProgressFill } from "./formControls";

/** The section that encodes the whole file, for the tab that built the command it runs. */
export function inBrowserEncodeSection(info: VideoInfo): HTMLElement {
  const sec = section(`${encodeVerb()} the Entire File Here`);

  const box = engineBox(`${encodeVerb()} and Save`);
  sec.append(box.el);
  box.button.addEventListener("click", () => void encodeWholeFile(info, box));
  return sec;
}

/**
 * What the button offers to do, named for what actually happens to this file, by the same rule that
 * names the output file, in cliCommand's encodedFileName: an MP4 that comes back an MP4 was
 * reencoded, and any other source changed container on the way, which is a transcode.
 */
function encodeVerb(): "Reencode" | "Transcode" {
  return state.format === "MP4" ? "Reencode" : "Transcode";
}

/**
 * Encodes the whole file with the command built above it, and saves the result.
 *
 * Takes the encoder like every other run (see lib/encoderRun): its core is the pool's first, which
 * a sweep or a sample run would otherwise encode on beside it. It has no Stop of its own; a file
 * load or Reset stops it.
 */
async function encodeWholeFile(info: VideoInfo, box: EngineBox): Promise<void> {
  const run = claimEncoder("Reencode with FFmpeg", false, box.note);
  if (!run) return;
  run.workers.add(defaultFfmpegWorker);
  box.button.disabled = true;
  const fill = resetProgressFill(box.progress);
  box.note.textContent = "Loading ffmpeg.wasm…";
  box.result.innerHTML = "";
  clearLog(box.log);
  setFfmpegHandlers(
    (msg) => logLine(box.log, msg, "info"),
    // The bar is the progress; a percentage spelled out beside it is the same number twice.
    (ratio) => {
      if (fill) fill.style.width = (Math.min(1, Math.max(0, ratio)) * 100).toFixed(0) + "%";
    },
  );
  // The file as it was when the button was pressed: what the output is named, and measured
  // against, is read from these rather than from the state once the encode is done.
  const { source, file, format } = state;
  try {
    if (!source) throw new Error("No video loaded");
    await ensureFfmpegLoaded();
    throwIfStopped(run);
    const inputName = "in" + extOf(source.name);
    const outputName = encodedFileName(format);
    box.note.textContent = "Writing input to virtual filesystem…";
    const inputData = await fetchFile(file ?? source.url ?? undefined);
    throwIfStopped(run);
    const args = buildFfmpegArgs(cli, info, inputName, outputName);
    logLine(box.log, "$ ffmpeg " + args.join(" "), "success");
    box.note.textContent = "Encoding (single-threaded, so this can take a while)…";
    const { data } = await runFfmpegEncode(args, inputName, inputData, outputName);
    throwIfStopped(run);
    const blob = new Blob([data], { type: "video/mp4" });
    const saveName = encodedFileName(format, baseNameOf(source.name));
    const target = await pickSaveTarget(saveName);
    if (target && target.kind === "stream") {
      await target.writable.write(blob);
      await target.writable.close();
    } else {
      downloadBlob(blob, saveName);
    }
    // A full bar, the way a sample run ends, rather than a word under an empty one.
    finishFill(fill);
    // Recorded for Full Analysis only while this file is still the one loaded.
    throwIfStopped(run);
    showReencodeResult(box, source.size, blob.size);
  } catch (err) {
    if (err instanceof RunStopped || run.stopped) {
      box.note.textContent = "Stopped.";
    } else {
      console.error("[encoding-helper] in-browser encode failed:", err);
      const message = errorMessage(err);
      box.note.textContent = "Failed: " + message;
      logLine(box.log, message, "error");
    }
  } finally {
    releaseEncoder(run);
    box.button.disabled = false;
    box.progress.style.display = "none";
  }
}
