// The two parsers and the I/O layer are stubbed: what this module does is sequence them, keep the
// drop zone and the address bar in step with where the load got to, and put what came back into
// `state`. That sequencing is what these cases pin down.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChunkedSource } from "../../src/lib/chunkedSource";
import { resetState, state } from "../../src/lib/state";
import { getElements, type AppElements } from "../../src/ui/elements";
import { initFileLoadingUi } from "../../src/ui/fileLoading";

const INDEX_HTML = readFileSync(resolve(process.cwd(), "index.html"), "utf8");

const parseWithMp4Box = vi.hoisted(() => vi.fn());
const loadMediabunnyMetadata = vi.hoisted(() => vi.fn());
const fromUrl = vi.hoisted(() => vi.fn());

vi.mock("../../src/lib/mp4boxParser", () => ({
  parseWithMp4Box,
  extractBoxTree: () => [{ type: "moov", start: 0, size: 100, children: [] }],
  detectFaststart: () => true,
  extractSampleAnalysis: () => ({
    samples: [{ size: 1, cts: 0, dts: 0, ctsSec: 0, is_sync: true }],
    keyframeDecodeIndices: [0],
    gopLengths: [1],
    hasBFrames: false,
    keyframeTimestampsSec: [0],
  }),
  extractDeclaredBitrate: () => ({ avgBitrate: 500_000, maxBitrate: 500_000 }),
}));

vi.mock("../../src/lib/mediabunnyMeta", () => ({ loadMediabunnyMetadata }));

vi.mock("../../src/lib/mediabunny", () => ({
  ensureMediabunny: () =>
    Promise.resolve({
      ALL_FORMATS: [],
      BlobSource: class {
        constructor(public blob: Blob) {}
      },
      UrlSource: class {
        constructor(public url: string) {}
      },
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

function setUrl(search: string): void {
  window.history.replaceState({}, "", "/encoding-helper/" + search);
}

function mountApp(): AppElements {
  document.body.innerHTML = /<body[^>]*>([\s\S]*)<\/body>/.exec(INDEX_HTML)![1];
  return getElements();
}

function videoFile(name = "clip.mp4"): File {
  return new File([new Uint8Array(1024)], name, { type: "video/mp4" });
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
    const loader = initFileLoadingUi(els, { onLoaded });

    await loader.loadFile(videoFile());

    expect(state.source!.name).toBe("clip.mp4");
    expect(state.file).toBeInstanceOf(File);
    expect(state.format).toBe("MP4");
    expect(state.duration).toBe(30);
    expect(state.fps).toBe(30);
    expect(state.frameCount).toBe(1);
    expect(state.faststart).toBe(true);
    expect(state.boxes).toHaveLength(1);
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

  it("names each stage as it goes, including how far the parse has got", async () => {
    const stages: string[] = [];
    parseWithMp4Box.mockImplementation(async (_source: unknown, onProgress: (p: number) => void) => {
      stages.push(els.miniName.textContent!);
      onProgress(0.5);
      stages.push(els.miniName.textContent!);
      return { mp4boxFile: {}, info: { videoTracks: [{ id: 1, timescale: 600 }] } };
    });
    const loader = initFileLoadingUi(els, { onLoaded });

    await loader.loadFile(videoFile());

    expect(stages).toEqual(["Parsing MP4 structure (mp4box.js)…", "Parsing MP4 structure… 50%"]);
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

  it("leaves the address bar clean, since a local file cannot be shared by link", async () => {
    const loader = initFileLoadingUi(els, { onLoaded });
    await loader.loadFile(videoFile());
    expect(new URL(window.location.href).searchParams.has("src")).toBe(false);
  });
});

describe("loading a URL", () => {
  beforeEach(() => {
    fromUrl.mockImplementation((url: string, name?: string) => {
      const source = ChunkedSource.fromFile(videoFile(name ?? "remote.mp4"));
      source.kind = "url";
      source.url = url;
      source.file = new Blob([new Uint8Array(1024)]);
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

  it("opens what a shared link names, without being asked", async () => {
    setUrl("?src=" + encodeURIComponent("https://example.org/shared.mp4"));
    initFileLoadingUi(els, { onLoaded });
    await vi.waitFor(() => expect(onLoaded).toHaveBeenCalled());

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

  it("ignores a drop carrying nothing", () => {
    initFileLoadingUi(els, { onLoaded });
    const event = new Event("drop", { cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: { files: [] } });
    els.dropZone.dispatchEvent(event);
    expect(state.source).toBeNull();
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

  it("puts the whole page back when the loaded file is closed", async () => {
    const loader = initFileLoadingUi(els, { onLoaded });
    await loader.loadUrl("https://example.org/remote.mp4").catch(() => {});
    els.urlInput.value = "https://example.org/remote.mp4";

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

  it("loads nothing when the reader dismissed the picker", async () => {
    Object.defineProperty(window, "showOpenFilePicker", {
      value: vi.fn().mockRejectedValue(new DOMException("cancelled", "AbortError")),
      configurable: true,
    });
    initFileLoadingUi(els, { onLoaded });

    els.pickFileBtn.click();
    await vi.waitFor(() => expect(window.showOpenFilePicker).toHaveBeenCalled());

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
    vi.spyOn(els.fileInput, "click").mockImplementation(() => {
      Object.defineProperty(els.fileInput, "files", { value: [videoFile("fallback.mp4")], configurable: true });
      els.fileInput.onchange!(new Event("change"));
    });
    initFileLoadingUi(els, { onLoaded });

    els.pickFileBtn.click();
    await vi.waitFor(() => expect(onLoaded).toHaveBeenCalled());

    expect(state.source!.name).toBe("fallback.mp4");
    expect(warn).toHaveBeenCalledOnce();
  });

  it("loads nothing when the hidden file input comes back empty", async () => {
    const click = vi.spyOn(els.fileInput, "click").mockImplementation(() => {
      Object.defineProperty(els.fileInput, "files", { value: [], configurable: true });
      els.fileInput.onchange!(new Event("change"));
    });
    initFileLoadingUi(els, { onLoaded });

    els.pickFileBtn.click();
    await vi.waitFor(() => expect(click).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(state.source).toBeNull();
    expect(onLoaded).not.toHaveBeenCalled();
  });

  it("falls back to the hidden file input where there is no picker", async () => {
    vi.spyOn(els.fileInput, "click").mockImplementation(() => {
      Object.defineProperty(els.fileInput, "files", { value: [videoFile("input.mp4")], configurable: true });
      els.fileInput.onchange!(new Event("change"));
    });
    initFileLoadingUi(els, { onLoaded });

    els.pickFileBtn.click();
    await vi.waitFor(() => expect(onLoaded).toHaveBeenCalled());

    expect(state.source!.name).toBe("input.mp4");
  });
});
