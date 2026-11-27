// The two parsers and the I/O layer are stubbed: what this module does is sequence them, keep the
// drop zone and the address bar in step with where the load got to, and put what came back into
// `state`. That sequencing is what these cases pin down.

import { mountHtml, pickFiles, readIndexHtml } from "@brain-bbqs/test-utils/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChunkedSource } from "../../src/lib/chunkedSource";
import { resetState, state } from "../../src/lib/state";
import { getElements, type AppElements } from "../../src/ui/elements";
import { initFileLoadingUi } from "../../src/ui/fileLoading";
import { flush } from "./helpers/async";
import { setUrl } from "./helpers/url";

const INDEX_HTML = readIndexHtml();

const parseWithMp4Box = vi.hoisted(() => vi.fn());
const loadMediabunnyMetadata = vi.hoisted(() => vi.fn());
const fromUrl = vi.hoisted(() => vi.fn());
// The two mediabunny readers, held here so a test can say which one a load opened, and on what.
const { BlobSource, UrlSource } = vi.hoisted(() => ({
  BlobSource: class BlobSource {
    constructor(public blob: Blob) {}
  },
  UrlSource: class UrlSource {
    constructor(public url: string) {}
  },
}));

vi.mock("../../src/lib/mp4boxParser", () => ({
  parseWithMp4Box,
  extractBoxTree: () => [{ type: "moov", start: 0, size: 100, children: [] }],
  detectFaststart: () => true,
  extractSampleAnalysis: () => ({
    samples: [{ size: 1, ctsSec: 0, is_sync: true }],
    gopLengths: [1],
    hasBFrames: true,
    keyframeTimestampsSec: [0],
  }),
  extractDeclaredBitrate: () => ({ avgBitrate: 500_000, maxBitrate: 500_000 }),
}));

vi.mock("../../src/lib/mediabunnyMeta", () => ({ loadMediabunnyMetadata }));

vi.mock("../../src/lib/mediabunny", () => ({
  ensureMediabunny: () =>
    Promise.resolve({
      ALL_FORMATS: [],
      BlobSource,
      UrlSource,
      Input: class {
        constructor(public options: unknown) {}
        dispose(): void {}
      },
    }),
}));

/** The metadata a successful load comes back with. */
function metadata(over: Record<string, unknown> = {}) {
  return {
    format: "MP4",
    mimeType: "video/mp4",
    duration: 30,
    tags: null,
    tracks: [{ kind: "video", codec: "avc", codecString: "avc1.640020", codecInfo: null, packetRate: 30, bitrate: 1 }],
    videoTrack: { id: 1 },
    fps: 30,
    ...over,
  };
}

function mountApp(): AppElements {
  mountHtml(INDEX_HTML);
  return getElements();
}

function videoFile(name = "clip.mp4"): File {
  return new File([new Uint8Array(1024)], name, { type: "video/mp4" });
}

/** The reader the last load handed to mediabunny's `Input`. */
function mediabunnyReader(): unknown {
  return (state.input as unknown as { options: { source: unknown } }).options.source;
}

let els: AppElements;
let onLoaded: ReturnType<typeof vi.fn>;

beforeEach(() => {
  setUrl("");
  resetState();
  vi.clearAllMocks();
  parseWithMp4Box.mockResolvedValue({ mp4boxFile: {}, info: { videoTracks: [{ id: 1, timescale: 600 }] } });
  loadMediabunnyMetadata.mockResolvedValue(metadata());
  vi.spyOn(ChunkedSource, "fromUrl").mockImplementation(fromUrl);
  els = mountApp();
  onLoaded = vi.fn();
});

afterEach(() => vi.restoreAllMocks());

describe("loading a file", () => {
  it("fills in the state the tabs render from, and shows them", async () => {
    const file = videoFile();
    const loader = initFileLoadingUi(els, { onLoaded });

    await loader.loadFile(file);

    expect(state.source!.name).toBe("clip.mp4");
    expect(state.file).toBe(file);
    expect(mediabunnyReader()).toStrictEqual(new BlobSource(file));
    expect(state.format).toBe("MP4");
    expect(state.duration).toBe(30);
    expect(state.fps).toBe(30);
    expect(state.faststart).toBe(true);
    expect(state.boxes).toHaveLength(1);
    expect(state.samples).toEqual([{ size: 1, ctsSec: 0, is_sync: true }]);
    expect(state.gopLengths).toEqual([1]);
    expect(state.hasBFrames).toBe(true);
    expect(state.keyframeTimestampsSec).toEqual([0]);
    expect(state.declaredVideoBitrate).toEqual({ avgBitrate: 500_000, maxBitrate: 500_000 });
    expect(els.app.style.display).toBe("block");
    expect(onLoaded).toHaveBeenCalledOnce();
  });

  it("shows no size for an empty file rather than a zero", async () => {
    const loader = initFileLoadingUi(els, { onLoaded });
    await loader.loadFile(new File([], "empty.mp4", { type: "video/mp4" }));
    expect(els.miniName.textContent).toBe("empty.mp4");
    expect(els.miniSize.textContent).toBe("");
  });

  it("collapses the drop zone down to the file's name and size", async () => {
    const loader = initFileLoadingUi(els, { onLoaded });
    await loader.loadFile(videoFile());

    expect(els.dropZone.classList.contains("collapsed")).toBe(true);
    expect(els.miniName.textContent).toBe("clip.mp4");
    expect(els.miniSize.textContent).toBe("(1.0 KB)");
  });

  // Read off the name slot as the load reaches the I/O layer, the box parser (before and after it
  // reports progress) and the metadata reader.
  it("names each stage as it goes, including how far the parse has got", async () => {
    const stages: string[] = [];
    const stage = (): number => stages.push(els.miniName.textContent!);
    const fromFile = ChunkedSource.fromFile;
    vi.spyOn(ChunkedSource, "fromFile").mockImplementation((file: File) => {
      stage();
      return fromFile(file);
    });
    parseWithMp4Box.mockImplementation(async (_source: unknown, onProgress: (p: number) => void) => {
      stage();
      onProgress(0.5);
      stage();
      return { mp4boxFile: {}, info: { videoTracks: [{ id: 1, timescale: 600 }] } };
    });
    loadMediabunnyMetadata.mockImplementation(async () => {
      stage();
      return metadata();
    });
    const loader = initFileLoadingUi(els, { onLoaded });

    await loader.loadFile(videoFile());

    expect(stages).toEqual([
      "Reading file…",
      "Parsing MP4 structure (mp4box.js)…",
      "Parsing MP4 structure… 50%",
      "Reading metadata (mediabunny)…",
    ]);
  });

  it("estimates a frame rate from the sample table when mediabunny reports none", async () => {
    loadMediabunnyMetadata.mockResolvedValue(metadata({ fps: null }));
    const loader = initFileLoadingUi(els, { onLoaded });
    await loader.loadFile(videoFile());
    // One sample across thirty seconds.
    expect(state.fps).toBeCloseTo(1 / 30, 5);
  });

  it("has no frame rate to estimate when the file has no duration either", async () => {
    loadMediabunnyMetadata.mockResolvedValue(metadata({ fps: null, duration: null }));
    const loader = initFileLoadingUi(els, { onLoaded });
    await loader.loadFile(videoFile());
    expect(state.fps).toBeNull();
  });

  // A URL is loaded first, so the address has a `src` for the file load to clear.
  it("leaves the address bar clean, since a local file cannot be shared by link", async () => {
    fromUrl.mockResolvedValue(ChunkedSource.fromFile(videoFile("remote.mp4")));
    const loader = initFileLoadingUi(els, { onLoaded });
    await loader.loadUrl("https://example.org/remote.mp4");
    expect(new URL(window.location.href).searchParams.get("src")).toBe("https://example.org/remote.mp4");

    await loader.loadFile(videoFile());

    expect(new URL(window.location.href).searchParams.has("src")).toBe(false);
  });
});

describe("loading a URL", () => {
  // What the real factory hands back for a server that serves ranges: a URL source with no file.
  beforeEach(() => {
    fromUrl.mockImplementation((url: string, name?: string) => {
      const source = ChunkedSource.fromFile(videoFile(name ?? "remote.mp4"));
      source.kind = "url";
      source.url = url;
      source.file = null;
      return Promise.resolve(source);
    });
  });

  it("puts the URL in the address bar, so the loaded file can be handed on", async () => {
    const loader = initFileLoadingUi(els, { onLoaded });
    await loader.loadUrl("https://example.org/remote.mp4");

    expect(fromUrl).toHaveBeenCalledWith("https://example.org/remote.mp4", undefined);
    expect(new URL(window.location.href).searchParams.get("src")).toBe("https://example.org/remote.mp4");
  });

  it("takes the name a caller knows, for an endpoint whose URL does not carry one", async () => {
    const loader = initFileLoadingUi(els, { onLoaded });
    await loader.loadUrl("https://example.org/download/", "session-1.mp4");
    expect(fromUrl).toHaveBeenCalledWith("https://example.org/download/", "session-1.mp4");
  });

  it("has mediabunny read a URL served in ranges over the network, and keeps no file", async () => {
    const loader = initFileLoadingUi(els, { onLoaded });
    await loader.loadUrl("https://example.org/remote.mp4");

    expect(mediabunnyReader()).toStrictEqual(new UrlSource("https://example.org/remote.mp4"));
    expect(state.file).toBeNull();
  });

  // What the real factory hands back for a server that would not promise ranges: the whole file,
  // downloaded.
  it("has mediabunny read a URL that had to be downloaded from the downloaded file, and keeps that file", async () => {
    const downloaded = videoFile("remote.mp4");
    fromUrl.mockResolvedValue(ChunkedSource.fromFile(downloaded));
    const loader = initFileLoadingUi(els, { onLoaded });
    await loader.loadUrl("https://example.org/remote.mp4");

    expect(mediabunnyReader()).toStrictEqual(new BlobSource(downloaded));
    expect(state.file).toBe(downloaded);
  });

  it("opens what a shared link names, without being asked", async () => {
    setUrl("?src=" + encodeURIComponent("https://example.org/shared.mp4"));
    initFileLoadingUi(els, { onLoaded });
    await vi.waitFor(() => expect(onLoaded).toHaveBeenCalled());

    expect(fromUrl).toHaveBeenCalledWith("https://example.org/shared.mp4", undefined);
    expect(els.urlInput.value).toBe("https://example.org/shared.mp4");
    expect(els.urlRow.style.display).toBe("flex");
  });
});

describe("when a load fails", () => {
  it("shows why, and brings the drop zone back", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    parseWithMp4Box.mockRejectedValue(new Error("mp4box could not parse this file"));
    const loader = initFileLoadingUi(els, { onLoaded });

    await loader.loadFile(videoFile());

    expect(els.errorMsg.textContent).toBe("mp4box could not parse this file");
    expect(els.errorMsg.style.display).toBe("block");
    expect(els.dropZone.classList.contains("collapsed")).toBe(false);
    expect(onLoaded).not.toHaveBeenCalled();
  });

  it("says so when the file holds no video track to analyse", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    parseWithMp4Box.mockResolvedValue({ mp4boxFile: {}, info: { videoTracks: [] } });
    const loader = initFileLoadingUi(els, { onLoaded });

    await loader.loadFile(videoFile());

    expect(els.errorMsg.textContent).toBe("No video track found in this file.");
  });

  it("clears the previous failure when the next load starts", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    parseWithMp4Box.mockRejectedValueOnce(new Error("bad file"));
    const loader = initFileLoadingUi(els, { onLoaded });
    await loader.loadFile(videoFile());

    await loader.loadFile(videoFile());

    expect(els.errorMsg.style.display).toBe("none");
  });
});

describe("the drop zone's controls", () => {
  it("draws the reset button's mark rather than writing one", () => {
    initFileLoadingUi(els, { onLoaded });
    expect(els.resetBtn.querySelector("svg")).not.toBeNull();
  });

  it("loads a dropped file", async () => {
    initFileLoadingUi(els, { onLoaded });
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: { files: [videoFile()] } });

    els.dropZone.dispatchEvent(event);
    await vi.waitFor(() => expect(onLoaded).toHaveBeenCalled());

    expect(state.source!.name).toBe("clip.mp4");
    expect(event.defaultPrevented).toBe(true);
  });

  it("marks the zone while something is over it", () => {
    initFileLoadingUi(els, { onLoaded });
    els.dropZone.dispatchEvent(new Event("dragover", { cancelable: true }));
    expect(els.dropZone.classList.contains("dragover")).toBe(true);
    els.dropZone.dispatchEvent(new Event("dragleave"));
    expect(els.dropZone.classList.contains("dragover")).toBe(false);
  });

  // A load started on nothing would fail at once, leaving "Reading file…" in the name slot and the
  // error slot shown; both start out empty.
  it("ignores a drop carrying nothing", () => {
    initFileLoadingUi(els, { onLoaded });
    const event = new Event("drop", { cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: { files: [] } });
    els.dropZone.dispatchEvent(event);
    expect(state.source).toBeNull();
    expect(els.miniName.textContent).toBe("");
    expect(els.errorMsg.style.display).toBe("");
  });

  it("shows and hides the URL box, focusing it when it appears", () => {
    initFileLoadingUi(els, { onLoaded });
    els.showUrlBtn.click();
    expect(els.urlRow.style.display).toBe("flex");
    expect(document.activeElement).toBe(els.urlInput);
    els.showUrlBtn.click();
    expect(els.urlRow.style.display).toBe("none");
  });

  it("loads what the URL box holds, on the button and on Enter", async () => {
    fromUrl.mockResolvedValue(ChunkedSource.fromFile(videoFile("remote.mp4")));
    initFileLoadingUi(els, { onLoaded });

    els.urlInput.value = "  https://example.org/a.mp4  ";
    els.loadUrlBtn.click();
    await vi.waitFor(() => expect(fromUrl).toHaveBeenCalledWith("https://example.org/a.mp4", undefined));

    els.urlInput.value = "https://example.org/b.mp4";
    els.urlInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    await vi.waitFor(() => expect(fromUrl).toHaveBeenCalledWith("https://example.org/b.mp4", undefined));
  });

  it("leaves any other key in the URL box alone", () => {
    initFileLoadingUi(els, { onLoaded });
    els.urlInput.value = "https://example.org/a.mp4";
    els.urlInput.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    expect(fromUrl).not.toHaveBeenCalled();
  });

  it("does nothing for an empty URL box", () => {
    initFileLoadingUi(els, { onLoaded });
    els.urlInput.value = "   ";
    els.loadUrlBtn.click();
    expect(fromUrl).not.toHaveBeenCalled();
  });

  // The tabs and the URL row both start out hidden, so they are shown first for Reset to hide.
  it("puts the whole page back when the loaded file is closed", async () => {
    fromUrl.mockResolvedValue(ChunkedSource.fromFile(videoFile("remote.mp4")));
    const loader = initFileLoadingUi(els, { onLoaded });
    await loader.loadUrl("https://example.org/remote.mp4");
    els.showUrlBtn.click();
    els.urlInput.value = "https://example.org/remote.mp4";
    expect(els.app.style.display).toBe("block");
    expect(els.urlRow.style.display).toBe("flex");

    els.resetBtn.click();

    expect(state.source).toBeNull();
    expect(els.app.style.display).toBe("none");
    expect(els.dropZone.classList.contains("collapsed")).toBe(false);
    expect(els.miniName.textContent).toBe("");
    expect(els.miniSize.textContent).toBe("");
    expect(els.urlInput.value).toBe("");
    expect(els.urlRow.style.display).toBe("none");
    expect(new URL(window.location.href).searchParams.has("src")).toBe(false);
  });

  it("does not re-open the picker the reset just backed out of", () => {
    initFileLoadingUi(els, { onLoaded });
    const onZoneClick = vi.fn();
    els.dropZone.addEventListener("click", onZoneClick);
    els.resetBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onZoneClick).not.toHaveBeenCalled();
  });
});

describe("the file picker", () => {
  afterEach(() => Reflect.deleteProperty(window, "showOpenFilePicker"));

  it("loads what the File System Access picker returned", async () => {
    const file = videoFile("picked.mp4");
    Object.defineProperty(window, "showOpenFilePicker", {
      value: vi.fn().mockResolvedValue([{ getFile: () => Promise.resolve(file) }]),
      configurable: true,
    });
    initFileLoadingUi(els, { onLoaded });

    els.pickFileBtn.click();
    await vi.waitFor(() => expect(onLoaded).toHaveBeenCalled());

    expect(state.source!.name).toBe("picked.mp4");
  });

  // A dismissal is the reader's answer rather than the picker failing, so nothing is warned about
  // and the hidden file input is not tried in its place.
  it("loads nothing when the reader dismissed the picker", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    Object.defineProperty(window, "showOpenFilePicker", {
      value: vi.fn().mockRejectedValue(new DOMException("cancelled", "AbortError")),
      configurable: true,
    });
    const click = vi.spyOn(els.fileInput, "click").mockImplementation(() => {});
    initFileLoadingUi(els, { onLoaded });

    els.pickFileBtn.click();
    await vi.waitFor(() => expect(window.showOpenFilePicker).toHaveBeenCalled());
    await flush();

    expect(warn).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
    expect(state.source).toBeNull();
  });

  // A picker that is there but broken (a sandboxed frame, say) is worth noting, not worth losing the
  // file over.
  it("falls back to the hidden file input when the picker fails for any other reason", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    Object.defineProperty(window, "showOpenFilePicker", {
      value: vi.fn().mockRejectedValue(new Error("not allowed in this frame")),
      configurable: true,
    });
    vi.spyOn(els.fileInput, "click").mockImplementation(() => pickFiles(els.fileInput, [videoFile("fallback.mp4")]));
    initFileLoadingUi(els, { onLoaded });

    els.pickFileBtn.click();
    await vi.waitFor(() => expect(onLoaded).toHaveBeenCalled());

    expect(state.source!.name).toBe("fallback.mp4");
    expect(warn).toHaveBeenCalledOnce();
  });

  // As with an empty drop, a load started on nothing would show in the name and error slots.
  it("loads nothing when the hidden file input comes back empty", async () => {
    const click = vi.spyOn(els.fileInput, "click").mockImplementation(() => {
      Object.defineProperty(els.fileInput, "files", { value: [], configurable: true });
      els.fileInput.onchange!(new Event("change"));
    });
    initFileLoadingUi(els, { onLoaded });

    els.pickFileBtn.click();
    await vi.waitFor(() => expect(click).toHaveBeenCalled());
    await flush();

    expect(state.source).toBeNull();
    expect(onLoaded).not.toHaveBeenCalled();
    expect(els.miniName.textContent).toBe("");
    expect(els.errorMsg.style.display).toBe("");
  });

  it("falls back to the hidden file input where there is no picker", async () => {
    vi.spyOn(els.fileInput, "click").mockImplementation(() => pickFiles(els.fileInput, [videoFile("input.mp4")]));
    initFileLoadingUi(els, { onLoaded });

    els.pickFileBtn.click();
    await vi.waitFor(() => expect(onLoaded).toHaveBeenCalled());

    expect(state.source!.name).toBe("input.mp4");
  });
});
