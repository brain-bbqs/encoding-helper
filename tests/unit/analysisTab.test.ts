// The panel is one iframe holding the document, so the assertions are made against the document
// HTML the panel is built from and the Markdown the two Markdown controls produce, rather than
// against the rendered frame (jsdom runs no layout and loads no srcdoc).

import { beforeEach, describe, expect, it, vi } from "vitest";
import { evenSamples } from "../fixtures/samples";
import { resetCliDefaults, VIDEO_TRACK } from "../fixtures/state";
import { buildMatrixCombos, cliSettings, makeMatrixCells } from "../../src/lib/qualityMatrix";
import { cli, encodeTest, state } from "../../src/lib/state";
import type { BoxNode, SeekResult, TrackInfo } from "../../src/lib/types";
import { renderAnalysisTab } from "../../src/ui/analysisTab";

const downloads: { name: string; text: string }[] = [];

vi.mock("../../src/lib/save", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/lib/save")>()),
  downloadBlob: (blob: Blob, filename: string) => {
    // Read synchronously off the parts the caller passed, since a click is not awaited.
    downloads.push({ name: filename, text: (blob as Blob & { __text?: string }).__text ?? "" });
  },
}));

const AUDIO_TRACK: TrackInfo = {
  kind: "audio",
  codec: "aac",
  codecString: "mp4a.40.2",
  codecInfo: null,
  packetRate: 43,
  bitrate: 128_000,
  sampleRate: 48_000,
  channels: 2,
};

/** A progressive file's box tree, which is all the atom map needs to draw one. */
function boxes(): BoxNode[] {
  return [
    { type: "ftyp", start: 0, size: 32, children: [] },
    { type: "moov", start: 32, size: 2000, children: [{ type: "mvhd", start: 40, size: 108, children: [] }] },
    { type: "mdat", start: 2032, size: 1_997_968, children: [] },
  ];
}

/** A 30-second, 600-frame clip with a keyframe every 30 frames, loaded. */
function loadClip(over: { tracks?: TrackInfo[] } = {}): void {
  state.source = { kind: "file", name: "clip.mp4", size: 2_000_000 } as never;
  state.format = "MP4";
  state.mimeType = "video/mp4";
  state.duration = 30;
  state.tracks = over.tracks ?? [VIDEO_TRACK, AUDIO_TRACK];
  state.fps = 20;
  state.frameCount = 600;
  state.samples = evenSamples(600, 30, 1000, (i) => i % 30 === 0);
  state.keyframeDecodeIndices = state.samples.map((s, i) => (s.is_sync ? i : -1)).filter((i) => i >= 0);
  state.gopLengths = Array.from({ length: 20 }, () => 30);
  state.keyframeTimestampsSec = state.samples.filter((s) => s.is_sync).map((s) => s.ctsSec);
  state.boxes = boxes();
  state.faststart = true;
}

function panel(): HTMLElement {
  const el = document.createElement("div");
  document.body.append(el);
  return el;
}

/** The document HTML the panel put in its preview frame. */
function documentHtml(el: HTMLElement): string {
  return el.querySelector<HTMLIFrameElement>("iframe.doc-preview")!.srcdoc;
}

function clickButton(el: HTMLElement, label: string): void {
  const btn = Array.from(el.querySelectorAll("button")).find((b) => b.textContent === label);
  if (!btn) throw new Error(`No "${label}" button in the panel`);
  btn.click();
}

/** The Markdown the Download Markdown button writes. */
function markdown(el: HTMLElement): string {
  downloads.length = 0;
  clickButton(el, "Download Markdown");
  return downloads[0].text;
}

beforeEach(() => {
  resetCliDefaults();
  downloads.length = 0;
  document.body.innerHTML = "";
  // Captured so a click's Blob can be read without awaiting it; jsdom's Blob has no sync reader.
  vi.stubGlobal(
    "Blob",
    class extends Blob {
      __text: string;
      constructor(parts: BlobPart[], options?: BlobPropertyBag) {
        super(parts, options);
        this.__text = parts.map(String).join("");
      }
    },
  );
});

describe("renderAnalysisTab", () => {
  it("renders nothing at all before a file is loaded", () => {
    const el = panel();
    renderAnalysisTab(el);
    expect(el.innerHTML).toBe("");
  });

  it("offers the four ways out of the document, over a preview of it", () => {
    const el = panel();
    loadClip();
    renderAnalysisTab(el);

    expect(Array.from(el.querySelectorAll(".load-actions button")).map((b) => b.textContent)).toEqual([
      "Save as PDF",
      "Download HTML",
      "Download Markdown",
      "Copy Markdown",
    ]);
    const frame = el.querySelector<HTMLIFrameElement>("iframe.doc-preview")!;
    expect(frame.title).toBe("Full analysis of clip.mp4");
    expect(frame.srcdoc).toContain("<!doctype html>");
  });

  it("heads the document with what the file is, and says where it came from", () => {
    const el = panel();
    loadClip();
    renderAnalysisTab(el);
    const md = markdown(el);

    expect(md).toContain("# Encoding Helper analysis: clip.mp4");
    expect(md).toContain("https://encoding-helper.brain-bbqs.org");
    expect(md).toContain("**Container:** MP4");
    expect(md).toContain("**Video Codec:** avc1.640020");
    expect(md).toContain("**Resolution:** 640×480");
    expect(md).toContain("**Frame Rate:** 30 fps");
  });

  it("writes the sections the loaded file alone supports, in reading order", () => {
    const el = panel();
    loadClip();
    renderAnalysisTab(el);

    const titles = markdown(el).match(/^## .*$/gm);
    expect(titles).toEqual([
      "## Video Container Overview: MP4",
      "## Video Track",
      "## MP4 Atom Map",
      "## GOP / Keyframe Structure",
      "## Video Bitrate Over Time",
      "## Audio Track",
      "## Reencode CLI Command",
    ]);
  });

  it("leaves out the track sections a file has no track for", () => {
    const el = panel();
    loadClip({ tracks: [] });
    renderAnalysisTab(el);
    const md = markdown(el);
    expect(md).not.toContain("## Video Track");
    expect(md).not.toContain("## Audio Track");
    // Nor the command, which has no resolution to build one from.
    expect(md).not.toContain("## Reencode CLI Command");
  });

  it("states the results and not the teaching prose that goes with them on the tabs", () => {
    const el = panel();
    loadClip();
    renderAnalysisTab(el);
    const md = markdown(el);

    expect(md).toContain("| Total Frames | 600 |");
    expect(md).toContain("| Keyframes | 20 |");
    expect(md).toContain("| Avg GOP | 30.0 frames (1.50 s) |");
    // The GOP explainer is prose, and prose is unconditionally dropped from the document.
    expect(md).not.toContain("group of pictures");
  });

  it("marks a fast-start file as one", () => {
    const el = panel();
    loadClip();
    renderAnalysisTab(el);
    expect(markdown(el)).toContain("✓ Fast start");

    state.faststart = false;
    renderAnalysisTab(el);
    expect(markdown(el)).toContain("✗ Not fast start");
  });

  it("carries the file's metadata tags when it has any", () => {
    const el = panel();
    loadClip();
    state.tags = { title: "Session 1" } as never;
    renderAnalysisTab(el);
    const md = markdown(el);
    expect(md).toContain("## Metadata Tags");
    expect(md).toContain("Session 1");
  });

  it("adds the seeking test's figures once a run has produced some", () => {
    const el = panel();
    loadClip();
    const results: SeekResult[] = [
      { t: 1, kf: 0, dist: 1, distFrames: 20, decodeMs: 10 },
      { t: 2, kf: 1.5, dist: 0.5, distFrames: 10, decodeMs: 30 },
    ];
    state.seekResults = results;
    renderAnalysisTab(el);
    const md = markdown(el);

    expect(md).toContain("## Empirical Seeking Test");
    expect(md).toContain("| Timestamps Sampled | 2 |");
    expect(md).toContain("| Max Decode Time | 30.0 ms |");
    // Every sampled timestamp, as the table on the page prints it.
    expect(md).toContain("| 1.000s |");
    expect(md).toContain("| 2.000s |");
  });

  it("prints the command the builder's settings currently come to", () => {
    const el = panel();
    loadClip();
    cli.quality = "custom";
    cli.crf = 28;
    cli.preset = "veryfast";
    renderAnalysisTab(el);
    const md = markdown(el);
    expect(md).toContain("```bash");
    expect(md).toContain("-crf 28");
    expect(md).toContain("-preset veryfast");
  });

  it("adds the A/B comparison and its projection once one has been run", () => {
    const el = panel();
    loadClip();
    encodeTest.originalSink = {} as never;
    encodeTest.abSegments = [{ window: { startSeconds: 0, seconds: 5 } }] as never;
    encodeTest.windows = [{ startSeconds: 0, seconds: 5 }];
    encodeTest.segDuration = 5;
    encodeTest.encodedSize = 100_000;
    renderAnalysisTab(el);
    const md = markdown(el);

    expect(md).toContain("## Side-by-Side (A/B) Result");
    expect(md).toContain("| Encoded Segment Size | 97.7 KB |");
    expect(md).toContain("| Projected Full File |");
  });

  it("names the winning square's settings, not the builder's, after a sweep", () => {
    const el = panel();
    loadClip();
    encodeTest.originalSink = {} as never;
    encodeTest.abSegments = [{ window: { startSeconds: 0, seconds: 5 } }] as never;
    encodeTest.windows = [{ startSeconds: 0, seconds: 5 }];
    encodeTest.encodedSize = 100_000;
    encodeTest.activeCombo = { ...cliSettings(cli), preset: "slow", crf: 30, quality: "low" };
    renderAnalysisTab(el);
    expect(markdown(el)).toContain("| Preset | slow |");
  });

  it("carries the last sweep as the grid its winner was picked out of", () => {
    const el = panel();
    loadClip();
    const cells = makeMatrixCells(buildMatrixCombos(["high", "low"], ["ultrafast", "fast"]));
    cells.forEach((c, i) => {
      c.status = "done";
      c.bytes = 100_000 - i * 10_000;
      c.elapsedMs = 4200;
    });
    encodeTest.matrix.cells = cells;
    renderAnalysisTab(el);
    const md = markdown(el);

    expect(md).toContain("## Compare Quality Matrix");
    expect(md).toContain("| Quality | ultrafast | fast |");
    // ★ marks the largest reduction, which is the smallest of the four.
    expect(md.match(/★/g)).toHaveLength(1);
  });

  it("leaves a sweep out while none of its squares have finished", () => {
    const el = panel();
    loadClip();
    encodeTest.matrix.cells = makeMatrixCells(buildMatrixCombos(["high"], ["fast"]));
    renderAnalysisTab(el);
    expect(markdown(el)).not.toContain("## Compare Quality Matrix");
  });

  it("reports an in-browser reencode's result", () => {
    const el = panel();
    loadClip();
    state.reencodeResult = { originalSize: 2_000_000, encodedSize: 1_000_000 } as never;
    renderAnalysisTab(el);
    const md = markdown(el);
    expect(md).toContain("## In-Browser Reencode Result");
    expect(md).toContain("| Encoded Size | 976.6 KB |");
    expect(md).toContain("| Change | -50.0% |");
  });

  it("names the downloads after the file they describe", () => {
    const el = panel();
    loadClip();
    renderAnalysisTab(el);

    clickButton(el, "Download HTML");
    clickButton(el, "Download Markdown");
    expect(downloads.map((d) => d.name)).toEqual(["clip.analysis.html", "clip.analysis.md"]);
    expect(downloads[0].text).toContain("<!doctype html>");
    expect(downloads[1].text.startsWith("# Encoding Helper analysis")).toBe(true);
  });

  it("copies the same Markdown it downloads", async () => {
    const el = panel();
    loadClip();
    renderAnalysisTab(el);
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });

    clickButton(el, "Copy Markdown");

    expect(writeText.mock.calls[0][0]).toBe(markdown(el));
  });

  it("prints the document rather than the page around it", () => {
    const el = panel();
    loadClip();
    renderAnalysisTab(el);
    const frame = el.querySelector<HTMLIFrameElement>("iframe.doc-preview")!;
    const print = vi.fn();
    const focus = vi.fn();
    Object.defineProperty(frame, "contentWindow", { value: { print, focus }, configurable: true });

    clickButton(el, "Save as PDF");

    expect(focus).toHaveBeenCalledOnce();
    expect(print).toHaveBeenCalledOnce();
  });

  it("rebuilds the panel from scratch on every visit", () => {
    const el = panel();
    loadClip();
    renderAnalysisTab(el);
    renderAnalysisTab(el);
    expect(el.querySelectorAll("iframe.doc-preview")).toHaveLength(1);
  });

  it("empties the panel when the file it described has been closed", () => {
    const el = panel();
    loadClip();
    renderAnalysisTab(el);
    expect(documentHtml(el)).toContain("clip.mp4");

    state.source = null;
    renderAnalysisTab(el);
    expect(el.innerHTML).toBe("");
  });
});
