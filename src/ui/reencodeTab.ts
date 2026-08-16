// Tab: Reencode — the two in-browser engines (fast / mediabunny-WebCodecs and exact /
// ffmpeg.wasm). Both process the whole video, using the settings from the FFmpeg CLI tab, and write
// the result straight to disk.

import { fetchFile } from "@ffmpeg/util";
import { buildFfmpegArgs } from "../lib/cliCommand";
import { h, teachBox } from "../lib/dom";
import { ensureFfmpegLoaded, runFfmpegEncode, setFfmpegHandlers } from "../lib/ffmpegEngine";
import { prepareMediabunnyConversion } from "../lib/fastEngine";
import { ensureMediabunny } from "../lib/mediabunny";
import { downloadBlob, extOf, pickSaveTarget } from "../lib/save";
import { cli, currentVideoInfo, state } from "../lib/state";
import type { VideoInfo } from "../lib/types";
import { showReencodeResult } from "./cliControls";
import { clearLog, engineBox, logLine, type EngineBox } from "./formControls";

export function renderReencodeTab(panel: HTMLElement): void {
  panel.innerHTML = "";
  const info = currentVideoInfo();
  if (!info) return;

  const sec = h("div", "section");
  sec.append(h("h2", null, "Reencode In-Browser"));
  sec.append(
    teachBox(
      `Runs the settings from the <b>Reencode &amp; CLI</b> tab over the <b>whole video</b>, here in the page, ` +
        `and saves the result to a file you choose. Nothing is uploaded: the frames are decoded and reencoded ` +
        `locally. Pick where to save when prompted, or the file lands in your downloads folder.` +
        `<p>Two engines, differing in fidelity rather than in what they produce:</p>` +
        `<ul>` +
        `<li><b>Fast</b> uses the browser's hardware encoder through WebCodecs. Quick, but WebCodecs exposes ` +
        `only a target bitrate or quality preset, so it approximates the CRF you asked for.</li>` +
        `<li><b>Exact</b> runs the literal ffmpeg command, compiled to WebAssembly. Byte-for-byte what the CLI ` +
        `would give you, at the cost of a ~30 MB download and single-threaded speed.</li>` +
        `</ul>` +
        `<p>For a full-length recording or a whole dataset, copy the command from the ` +
        `<b>Reencode &amp; CLI</b> tab and run ffmpeg natively instead; these engines are bounded by what the ` +
        `browser tab can hold in memory.</p>`,
    ),
  );

  const fastBox = engineBox(
    "fast",
    "Fast (WebCodecs / mediabunny)",
    "Hardware-accelerated. No CRF control: WebCodecs only exposes target bitrate / quality presets, so this is an approximation, not a byte-match of the CLI command.",
  );
  sec.append(fastBox.el);
  const exactBox = engineBox(
    "exact",
    "Exact (ffmpeg.wasm)",
    "Runs the literal command from the Reencode &amp; CLI tab. Lazy-loads ~30 MB on first use and runs single-threaded (no COOP/COEP needed on static hosting), so it is slower than realtime but byte-for-byte matches the CLI.",
  );
  sec.append(exactBox.el);
  panel.append(sec);

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
    showReencodeResult(box, "fast", state.source.size, outSize);
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
    const target = await pickSaveTarget(baseName + ".exact.mp4");
    if (target && target.kind === "stream") {
      await target.writable.write(blob);
      await target.writable.close();
    } else {
      downloadBlob(blob, baseName + ".exact.mp4");
    }
    showReencodeResult(box, "exact", state.source.size, blob.size);
  } catch (err) {
    console.error("[encoding-helper] exact encode failed:", err);
    box.note.textContent = "Failed: " + (err instanceof Error ? err.message : String(err));
    logLine(box.log, String(err instanceof Error ? err.message : err), "error");
  } finally {
    box.button.disabled = false;
    box.progress.style.display = "none";
  }
}
