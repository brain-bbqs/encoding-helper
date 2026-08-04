// File loading orchestration: drag/drop, file picker, sample video, remote URL — parses the file
// with both mp4box.js (box tree + sample table) and mediabunny (metadata), then hands off to the
// per-tab renderers.

import { ChunkedSource } from "../lib/chunkedSource";
import { fmtBytes } from "../lib/format";
import { ensureMediabunny } from "../lib/mediabunny";
import { loadMediabunnyMetadata } from "../lib/mediabunnyMeta";
import { detectFaststart, extractBoxTree, extractSampleAnalysis, parseWithMp4Box } from "../lib/mp4boxParser";
import { resetState, state } from "../lib/state";
import type { AppElements } from "./elements";

export interface FileLoadingCallbacks {
  onLoaded: () => void;
}

function showError(els: AppElements, msg: string): void {
  els.errorMsg.textContent = msg;
  els.errorMsg.style.display = "block";
}

function hideError(els: AppElements): void {
  els.errorMsg.style.display = "none";
}

function setLoadingUi(els: AppElements, text: string): void {
  els.dropZone.classList.add("collapsed");
  els.miniName.textContent = text;
}

function showMiniLoaded(els: AppElements, name: string, size: number): void {
  els.dropZone.classList.add("collapsed");
  els.miniName.textContent = name;
  els.miniSize.textContent = size ? `(${fmtBytes(size)})` : "";
}

function estimateFpsFromSamples(): number | null {
  if (!state.samples.length || state.duration == null || state.duration <= 0) return null;
  return state.samples.length / state.duration;
}

async function loadSource(
  els: AppElements,
  callbacks: FileLoadingCallbacks,
  kind: "file" | "url",
  payload: File | string,
): Promise<void> {
  hideError(els);
  resetState();
  setLoadingUi(els, "Reading file…");
  try {
    let source: ChunkedSource;
    let fileForMediabunny: File | null = null;
    let urlForMediabunny: string | null = null;
    if (kind === "file") {
      source = ChunkedSource.fromFile(payload as File);
      fileForMediabunny = payload as File;
    } else {
      source = await ChunkedSource.fromUrl(payload as string);
      if (source.kind === "file" && source.file instanceof File) fileForMediabunny = source.file;
      else urlForMediabunny = payload as string;
    }
    state.source = source;
    state.file = fileForMediabunny;
    showMiniLoaded(els, source.name, source.size);

    setLoadingUi(els, "Parsing MP4 structure (mp4box.js)…");
    const { mp4boxFile, info } = await parseWithMp4Box(source, (p) =>
      setLoadingUi(els, `Parsing MP4 structure… ${(p * 100).toFixed(0)}%`),
    );
    state.boxes = extractBoxTree(mp4boxFile);
    state.faststart = detectFaststart(state.boxes);

    if (info.videoTracks.length === 0) {
      throw new Error("No video track found in this file.");
    }
    const videoTrackId = info.videoTracks[0].id;
    state.timescale = info.videoTracks[0].timescale;
    const analysis = extractSampleAnalysis(mp4boxFile, videoTrackId, state.timescale);
    Object.assign(state, analysis);

    setLoadingUi(els, "Reading metadata (mediabunny)…");
    const mb = await ensureMediabunny();
    const mbSource = fileForMediabunny ? new mb.BlobSource(fileForMediabunny) : new mb.UrlSource(urlForMediabunny ?? "");
    const input = new mb.Input({ source: mbSource, formats: mb.ALL_FORMATS });
    const meta = await loadMediabunnyMetadata(input);
    state.input = input;
    state.videoTrack = meta.videoTrack;
    state.audioTrack = meta.audioTrack;
    state.format = meta.format;
    state.mimeType = meta.mimeType;
    state.duration = meta.duration;
    state.tags = meta.tags;
    state.tracks = meta.tracks;
    state.fps = meta.fps || estimateFpsFromSamples();
    state.frameCount = state.samples.length;

    els.app.style.display = "block";
    callbacks.onLoaded();
    showMiniLoaded(els, source.name, source.size);
  } catch (err) {
    console.error("[encoding-helper] load failed:", err);
    showError(els, err instanceof Error ? err.message : String(err));
    els.dropZone.classList.remove("collapsed");
  }
}

async function pickFile(els: AppElements): Promise<File | null> {
  if (window.showOpenFilePicker) {
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [{ description: "Video files", accept: { "video/*": [".mp4", ".m4v", ".mov"] } }],
        multiple: false,
      });
      return await handle.getFile();
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return null;
      console.warn("[encoding-helper] File System Access API failed, falling back:", e);
    }
  }
  return new Promise((resolve) => {
    els.fileInput.onchange = () => resolve(els.fileInput.files?.[0] || null);
    els.fileInput.click();
  });
}

export function initFileLoadingUi(els: AppElements, callbacks: FileLoadingCallbacks): void {
  els.pickFileBtn.addEventListener("click", () => {
    void pickFile(els).then((file) => {
      if (file) void loadSource(els, callbacks, "file", file);
    });
  });
  els.loadAnotherBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    void pickFile(els).then((file) => {
      if (file) void loadSource(els, callbacks, "file", file);
    });
  });
  els.loadSampleBtn.addEventListener("click", () => {
    void (async () => {
      try {
        setLoadingUi(els, "Downloading sample…");
        const resp = await fetch(`${import.meta.env.BASE_URL}mice.mp4`);
        if (!resp.ok) throw new Error("Could not fetch sample video");
        const blob = await resp.blob();
        const file = new File([blob], "mice.mp4", { type: "video/mp4" });
        await loadSource(els, callbacks, "file", file);
      } catch (err) {
        showError(els, err instanceof Error ? err.message : String(err));
      }
    })();
  });
  els.showUrlBtn.addEventListener("click", () => {
    els.urlRow.style.display = els.urlRow.style.display === "none" ? "flex" : "none";
    if (els.urlRow.style.display === "flex") els.urlInput.focus();
  });
  els.loadUrlBtn.addEventListener("click", () => {
    const url = els.urlInput.value.trim();
    if (url) void loadSource(els, callbacks, "url", url);
  });
  els.urlInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") els.loadUrlBtn.click();
  });

  els.dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    els.dropZone.classList.add("dragover");
  });
  els.dropZone.addEventListener("dragleave", () => els.dropZone.classList.remove("dragover"));
  els.dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    els.dropZone.classList.remove("dragover");
    const file = e.dataTransfer?.files[0];
    if (file) void loadSource(els, callbacks, "file", file);
  });
}
