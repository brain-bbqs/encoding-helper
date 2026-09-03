// The whole-video encode, run here in the page: the last section of the Reencode with FFmpeg tab.
//
// One engine, ffmpeg.wasm, running the literal command built above it, so what comes out of the
// browser is byte-for-byte what the command would produce on a machine with ffmpeg installed. It is
// a ~30 MB download and single-threaded, which is the price of that guarantee and the reason the
// command above stays the recommendation for a full-length recording or a whole dataset.

import { errorMessage } from "../lib/format";
import { fetchFile } from "@ffmpeg/util";
import { buildFfmpegArgs, encodedFileName } from "../lib/cliCommand";
import { section } from "../lib/dom";
import { ensureFfmpegLoaded, runFfmpegEncode, setFfmpegHandlers } from "../lib/ffmpegEngine";
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
  box.button.addEventListener("click", () => void runExactEncode(info, box));
  return sec;
}

/**
 * What the button offers to do, named for what actually happens to this file — the same rule that
 * names the output file, in cliCommand's encodedFileName: an MP4 that comes back an MP4 was
 * reencoded, and any other source changed container on the way, which is a transcode.
 */
function encodeVerb(): "Reencode" | "Transcode" {
  return state.format === "MP4" ? "Reencode" : "Transcode";
}

async function runExactEncode(info: VideoInfo, box: EngineBox): Promise<void> {
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
  try {
    if (!state.source) throw new Error("No video loaded");
    await ensureFfmpegLoaded();
    const inputName = "in" + extOf(state.source.name);
    const outputName = encodedFileName(state.format);
    box.note.textContent = "Writing input to virtual filesystem…";
    const inputData = await fetchFile(state.file ?? state.source.url ?? undefined);
    const args = buildFfmpegArgs(cli, info, inputName, outputName);
    logLine(box.log, "$ ffmpeg " + args.join(" "), "success");
    box.note.textContent = "Encoding (single-threaded, so this can take a while)…";
    const { data } = await runFfmpegEncode(args, inputName, inputData, outputName);
    const blob = new Blob([data], { type: "video/mp4" });
    const saveName = encodedFileName(state.format, baseNameOf(state.source.name));
    const target = await pickSaveTarget(saveName);
    if (target && target.kind === "stream") {
      await target.writable.write(blob);
      await target.writable.close();
    } else {
      downloadBlob(blob, saveName);
    }
    // A full bar, the way a sample run ends, rather than a word under an empty one.
    finishFill(fill);
    showReencodeResult(box, state.source.size, blob.size);
  } catch (err) {
    console.error("[encoding-helper] in-browser encode failed:", err);
    const message = errorMessage(err);
    box.note.textContent = "Failed: " + message;
    logLine(box.log, message, "error");
  } finally {
    box.button.disabled = false;
    box.progress.style.display = "none";
  }
}
