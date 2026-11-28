// The whole-video encode, run here in the page: the last section of the Reencode with FFmpeg tab.
//
// One engine, ffmpeg.wasm, running the literal command built above it, so what comes out of the
// browser is byte-for-byte what the command would produce on a machine with ffmpeg installed. It is
// a ~30 MB download and single-threaded, which is the price of that guarantee and the reason the
// command above stays the recommendation for a full-length recording or a whole dataset.

import { errorMessage, fmtBytes } from "@brain-bbqs/utils";
import { fetchFile } from "@ffmpeg/util";
import { buildFfmpegArgs, encodedFileName } from "../lib/cliCommand";
import { h } from "@brain-bbqs/ui";
import { gridItem, section } from "../lib/dom";
import { claimEncoder, releaseEncoder, RunStopped, throwIfStopped } from "../lib/encoderRun";
import { defaultFfmpegWorker, ensureFfmpegLoaded, runFfmpegEncode, setFfmpegHandlers } from "../lib/ffmpegEngine";
import { fmtSizeChangePct } from "../lib/format";
import { baseNameOf, downloadBlob, extOf, pickSaveTarget, type SaveTarget } from "../lib/save";
import { fmtChangeFactor } from "../lib/sizeEstimate";
import { cli, state } from "../lib/state";
import type { VideoInfo } from "../lib/types";
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
 *
 * Where to save is asked first, before anything here awaits: the browser opens its save picker only
 * while the press that asks for it is still the reader's own doing, which an encode of any length
 * outlasts, and asked afterwards it refused and the output fell back to a download.
 */
async function encodeWholeFile(info: VideoInfo, box: EngineBox): Promise<void> {
  const run = claimEncoder("Reencode with FFmpeg", false, box.note);
  if (!run) return;
  run.workers.add(defaultFfmpegWorker);
  box.button.disabled = true;
  resetProgressFill(box.progress, box.fill);
  setFfmpegHandlers(
    (msg) => logLine(box.log, msg, "info"),
    // The bar is the progress; a percentage spelled out beside it is the same number twice.
    (ratio) => {
      box.fill.style.width = (Math.min(1, Math.max(0, ratio)) * 100).toFixed(0) + "%";
    },
  );
  // The file as it was when the button was pressed: what the output is named, and measured
  // against, is read from these rather than from the state once the encode is done.
  const { source, file, format } = state;
  let target: SaveTarget | null = null;
  /** Whether the output has been written out in full to the file the reader picked. */
  let saved = false;
  try {
    if (!source) throw new Error("No video loaded");
    const saveName = encodedFileName(format, baseNameOf(source.name));
    target = await pickSaveTarget(saveName);
    // Dismissed: the reader decided against saving, so there is nothing to encode for. The last
    // encode's note, result and console are left as they were, since Full Analysis still reports it.
    if (!target) return;
    box.result.innerHTML = "";
    clearLog(box.log);
    throwIfStopped(run);
    box.note.textContent = "Loading ffmpeg.wasm…";
    await ensureFfmpegLoaded();
    // Checked before the file is read, which for a URL is a full download. A stop during the load
    // fails the load, so this is the backstop that keeps a stopped encode from reading any of it.
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
    if (target.kind === "stream") {
      await target.writable.write(blob);
      await target.writable.close();
      saved = true;
    } else {
      downloadBlob(blob, saveName);
    }
    // A full bar, the way a sample run ends, rather than a word under an empty one.
    finishFill(box.fill);
    // Recorded for Full Analysis only while this file is still the one loaded.
    throwIfStopped(run);
    showReencodeResult(box, source.size, blob.size);
  } catch (err) {
    // The file picked before the encode is open for writing; one that never got its output is let
    // go of rather than left held open. A stream the browser has already errored refuses, which
    // leaves it no less let go of.
    if (target?.kind === "stream" && !saved) void target.writable.abort().catch(() => {});
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

/**
 * Shows what an in-browser encode came to, and records it: the Full Analysis document reports the
 * last completed encode, and this is where a finished one passes through.
 */
export function showReencodeResult(box: EngineBox, origSize: number, outSize: number): void {
  state.reencodeResult = { originalSize: origSize, encodedSize: outSize };
  box.result.innerHTML = "";
  const g = h("div", "grid");
  g.append(
    gridItem("Original Size", fmtBytes(origSize)),
    gridItem("Encoded Size", fmtBytes(outSize)),
    gridItem(
      "Change",
      fmtSizeChangePct(origSize, outSize) + (origSize > 0 ? ` (${fmtChangeFactor(outSize / origSize)})` : ""),
    ),
  );
  box.result.append(g);
  box.note.textContent = "";
}
