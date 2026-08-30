// The whole-video encode, run here in the page: the last section of the Reencode with FFmpeg tab.
//
// One engine, ffmpeg.wasm, running the literal command built above it, so what comes out of the
// browser is byte-for-byte what the command would produce on a machine with ffmpeg installed. It is
// a ~30 MB download and single-threaded, which is the price of that guarantee and the reason the
// command above stays the recommendation for a full-length recording or a whole dataset.

import { fetchFile } from "@ffmpeg/util";
import { buildFfmpegArgs } from "../lib/cliCommand";
import { h, teachBox } from "../lib/dom";
import { WHOLE_FILE_ENCODE_INTRO } from "../lib/explainers";
import { ensureFfmpegLoaded, runFfmpegEncode, setFfmpegHandlers } from "../lib/ffmpegEngine";
import { downloadBlob, extOf, pickSaveTarget } from "../lib/save";
import { cli, state } from "../lib/state";
import type { VideoInfo } from "../lib/types";
import { showReencodeResult } from "./cliControls";
import { clearLog, engineBox, logLine, type EngineBox } from "./formControls";

/** The section that encodes the whole file, for the tab that built the command it runs. */
export function inBrowserEncodeSection(info: VideoInfo): HTMLElement {
  const sec = h("div", "section");
  sec.append(h("h2", null, `${encodeVerb()} the Entire File Here`));
  sec.append(teachBox(WHOLE_FILE_ENCODE_INTRO, "💾"));

  const box = engineBox(`${encodeVerb()} and Save`);
  sec.append(box.el);
  box.button.addEventListener("click", () => void runExactEncode(info, box));
  return sec;
}

/**
 * What the button offers to do, named for what actually happens to this file.
 *
 * The output is always an MP4, so a source that is already one comes out in the container it went
 * in: that is a reencode. Anything else (a .mov, say) is being moved into a different container as
 * well as compressed again, which is what "transcode" names.
 */
function encodeVerb(): "Reencode" | "Transcode" {
  return state.format === "MP4" ? "Reencode" : "Transcode";
}

async function runExactEncode(info: VideoInfo, box: EngineBox): Promise<void> {
  box.button.disabled = true;
  box.progress.style.display = "block";
  const fill = box.progress.querySelector<HTMLDivElement>(".fill");
  if (fill) fill.style.width = "0%";
  box.note.textContent = "Loading ffmpeg.wasm…";
  box.result.innerHTML = "";
  clearLog(box.log);
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
    box.note.textContent = "Encoding (single-threaded, so this can take a while)…";
    const { data } = await runFfmpegEncode(args, inputName, inputData, outputName);
    const blob = new Blob([data], { type: "video/mp4" });
    const baseName = (state.source.name || "video").replace(/\.[^.]+$/, "");
    const target = await pickSaveTarget(baseName + ".reencoded.mp4");
    if (target && target.kind === "stream") {
      await target.writable.write(blob);
      await target.writable.close();
    } else {
      downloadBlob(blob, baseName + ".reencoded.mp4");
    }
    showReencodeResult(box, state.source.size, blob.size);
  } catch (err) {
    console.error("[encoding-helper] in-browser encode failed:", err);
    box.note.textContent = "Failed: " + (err instanceof Error ? err.message : String(err));
    logLine(box.log, String(err instanceof Error ? err.message : err), "error");
  } finally {
    box.button.disabled = false;
    box.progress.style.display = "none";
  }
}
