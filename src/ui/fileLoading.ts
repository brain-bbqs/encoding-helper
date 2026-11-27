// File loading orchestration: drag/drop, file picker, remote URL. Parses the file with both
// mp4box.js (box tree + sample table) and mediabunny (metadata), then hands off to the per-tab
// renderers.
//
// The demos page (ui/demosPage.ts) is a fourth way in and has no controls of its own here: it hands
// a demo's URL to the FileLoader this module returns, which is the same path the URL box takes.

import { errorMessage, fmtBytes } from "@brain-bbqs/utils";
import { readSrcFromUrl, writeSrcToUrl } from "../lib/appUrl";
import { resetIcon } from "@brain-bbqs/ui";
import { ChunkedSource } from "../lib/chunkedSource";
import { ensureMediabunny } from "../lib/mediabunny";
import { loadMediabunnyMetadata } from "../lib/mediabunnyMeta";
import {
  detectFaststart,
  extractBoxTree,
  extractDeclaredBitrate,
  extractSampleAnalysis,
  parseWithMp4Box,
} from "../lib/mp4boxParser";
import { isPickerDismissed } from "../lib/save";
import { resetState, state, stateGeneration } from "../lib/state";
import type { Input } from "mediabunny";
import type { AppElements } from "./elements";

interface FileLoadingCallbacks {
  onLoaded: () => void;
}

/** The two ways in, for anything outside this module that has a file or a URL to open. */
interface FileLoader {
  loadFile(file: File): Promise<void>;
  /** `name` is what the file is called in the app, for a URL whose last segment is not a file name. */
  loadUrl(url: string, name?: string): Promise<void>;
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

/** What a load was asked to open: a File the reader picked or dropped, or a URL to fetch. */
type LoadRequest = { kind: "file"; file: File } | { kind: "url"; url: string; name?: string };

/** Ends a load that a later load or a Reset has replaced. */
class LoadSuperseded extends Error {}

async function loadSource(els: AppElements, callbacks: FileLoadingCallbacks, req: LoadRequest): Promise<void> {
  hideError(els);
  resetState();
  // Taken after this load's own reset: a later load or a Reset resets again, and from then on the
  // page and the state are theirs, so this load leaves both alone, failure message included.
  const generation = stateGeneration();
  const superseded = (): boolean => stateGeneration() !== generation;
  const stillWanted = (): void => {
    if (superseded()) throw new LoadSuperseded();
  };
  // The Input this load opened, until the state takes it over: until then nothing else would ever
  // release it.
  let unclaimed: Input | null = null;
  setLoadingUi(els, "Reading file…");
  try {
    let source: ChunkedSource;
    // What mediabunny reads: the File whenever there is one (picked locally, or a URL that resolved
    // to one), else the URL itself.
    let media: { file: File } | { url: string };
    if (req.kind === "file") {
      source = ChunkedSource.fromFile(req.file);
      media = { file: req.file };
    } else {
      source = await ChunkedSource.fromUrl(req.url, req.name);
      stillWanted();
      media = source.kind === "file" && source.file instanceof File ? { file: source.file } : { url: req.url };
    }
    showMiniLoaded(els, source.name, source.size);

    setLoadingUi(els, "Parsing MP4 structure (mp4box.js)…");
    const { mp4boxFile, info } = await parseWithMp4Box(source, (p) => {
      if (!superseded()) setLoadingUi(els, `Parsing MP4 structure… ${(p * 100).toFixed(0)}%`);
    });
    stillWanted();
    const boxes = extractBoxTree(mp4boxFile);

    if (info.videoTracks.length === 0) {
      throw new Error("No video track found in this file.");
    }
    const videoTrackId = info.videoTracks[0].id;
    const timescale = info.videoTracks[0].timescale;
    const analysis = extractSampleAnalysis(mp4boxFile, videoTrackId, timescale);
    const declaredVideoBitrate = extractDeclaredBitrate(mp4boxFile, videoTrackId);

    setLoadingUi(els, "Reading metadata (mediabunny)…");
    const mb = await ensureMediabunny();
    stillWanted();
    const mbSource = "file" in media ? new mb.BlobSource(media.file) : new mb.UrlSource(media.url);
    unclaimed = new mb.Input({ source: mbSource, formats: mb.ALL_FORMATS });
    const meta = await loadMediabunnyMetadata(unclaimed);
    stillWanted();

    // All in one go, after the last await: the state names a file only once that file has loaded,
    // which is what the demos page reads to decide whether there are tabs to show.
    state.source = source;
    state.file = "file" in media ? media.file : null;
    state.input = unclaimed;
    unclaimed = null;
    state.boxes = boxes;
    state.faststart = detectFaststart(boxes);
    state.samples = analysis.samples;
    state.gopLengths = analysis.gopLengths;
    state.hasBFrames = analysis.hasBFrames;
    state.keyframeTimestampsSec = analysis.keyframeTimestampsSec;
    state.declaredVideoBitrate = declaredVideoBitrate;
    state.videoTrack = meta.videoTrack;
    state.format = meta.format;
    state.mimeType = meta.mimeType;
    state.duration = meta.duration;
    state.tags = meta.tags;
    state.tracks = meta.tracks;
    state.fps = meta.fps || estimateFpsFromSamples();

    els.app.style.display = "block";
    // Only a remote URL can be handed to someone else; a local file leaves the address bar clean.
    writeSrcToUrl(req.kind === "url" ? req.url : null);
    callbacks.onLoaded();
    showMiniLoaded(els, source.name, source.size);
  } catch (err) {
    unclaimed?.dispose();
    if (superseded()) return;
    console.error("[encoding-helper] load failed:", err);
    // The file before this one went at the reset above, and whatever this one got as far as goes
    // here, so the tabs come down too rather than showing either under the error.
    resetState();
    els.app.style.display = "none";
    showError(els, errorMessage(err));
    els.dropZone.classList.remove("collapsed");
  }
}

/**
 * Puts the page back to where it was before a file was loaded.
 *
 * The whole dropzone comes back rather than the file picker alone, so the demo browser and the URL
 * box are reachable again: this is the way back out of a loaded file, not a shortcut to loading
 * another one. The parsed file goes with it: what the tabs were showing is about a file that is no
 * longer open, and the mediabunny inputs behind it hold decoders worth releasing. So does a load
 * still under way, which the reset supersedes: left to finish, it would open a file the reader has
 * just backed out of.
 */
function resetToDropZone(els: AppElements): void {
  hideError(els);
  resetState();
  els.app.style.display = "none";
  els.dropZone.classList.remove("collapsed");
  els.miniName.textContent = "";
  els.miniSize.textContent = "";
  els.urlInput.value = "";
  els.urlRow.style.display = "none";
  // Nothing is loaded, so the address bar should not offer a file to whoever the link is sent to.
  writeSrcToUrl(null);
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
      if (isPickerDismissed(e)) return null;
      console.warn("[encoding-helper] File System Access API failed, falling back:", e);
    }
  }
  return new Promise((resolve) => {
    els.fileInput.onchange = () => resolve(els.fileInput.files?.[0] || null);
    // Emptied first: browsers fire no change event for a pick that matches what the input already
    // holds, so the file opened before a Reset could not be picked again.
    els.fileInput.value = "";
    els.fileInput.click();
  });
}

export function initFileLoadingUi(els: AppElements, callbacks: FileLoadingCallbacks): FileLoader {
  // The two ways in this hands back, which the page's own controls below open files through too.
  const loadFile = (file: File): Promise<void> => loadSource(els, callbacks, { kind: "file", file });
  const loadUrl = (url: string, name?: string): Promise<void> => loadSource(els, callbacks, { kind: "url", url, name });

  // Drawn rather than written: the button is the width of its mark in the loaded file's bar, and
  // the mark is the one bbqs-uploader uses for the same "start again" gesture.
  els.resetBtn.append(resetIcon(15));

  els.pickFileBtn.addEventListener("click", () => {
    void pickFile(els).then((file) => {
      if (file) void loadFile(file);
    });
  });
  els.resetBtn.addEventListener("click", (e) => {
    // Keeps the click from reaching the drop zone under it.
    e.stopPropagation();
    resetToDropZone(els);
  });
  els.showUrlBtn.addEventListener("click", () => {
    els.urlRow.style.display = els.urlRow.style.display === "none" ? "flex" : "none";
    if (els.urlRow.style.display === "flex") els.urlInput.focus();
  });
  els.loadUrlBtn.addEventListener("click", () => {
    const url = els.urlInput.value.trim();
    if (url) void loadUrl(url);
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
    if (file) void loadFile(file);
  });

  // A shared link carries ?src=…, so open it the same way the URL box would have.
  const sharedSrc = readSrcFromUrl();
  if (sharedSrc) {
    els.urlRow.style.display = "flex";
    els.urlInput.value = sharedSrc;
    void loadUrl(sharedSrc);
  }

  return { loadFile, loadUrl };
}
