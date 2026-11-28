// The panel is one iframe holding the document, so the assertions are made against the document
// HTML the panel is built from and the Markdown the two Markdown controls produce, rather than
// against the rendered frame (jsdom runs no layout and loads no srcdoc).

import { installObserverStub, stubClipboard } from "@brain-bbqs/test-utils/vitest";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { evenSamples } from "../fixtures/samples";
import { resetCliDefaults, VIDEO_TRACK } from "../fixtures/state";
import { setEducationalEnabled } from "../../src/lib/educational";
import { buildMatrixCombos, cliSettings, makeMatrixCells } from "../../src/lib/qualityMatrix";
import { cli, sampledEncode, state } from "../../src/lib/state";
import type { BoxNode, SeekResult, TrackInfo } from "../../src/lib/types";
import { renderAnalysisTab } from "../../src/ui/analysisTab";
import { gridRows } from "./helpers/grid";

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
  state.samples = evenSamples(600, 30, 1000, (i) => i % 30 === 0);
  state.gopLengths = Array.from({ length: 20 }, () => 30);
  state.keyframeTimestampsSec = state.samples.filter((s) => s.is_sync).map((s) => s.ctsSec);
  state.boxes = boxes();
  state.faststart = true;
}

/** An A/B comparison loaded over the clip's first `seconds`, whose encode came to `encodedSize`
 * bytes (null while that is unknown). */
function loadComparison(seconds: number, encodedSize: number | null): void {
  sampledEncode.originalSink = {} as never;
  sampledEncode.abSegments = [{ window: { startSeconds: 0, seconds } }] as never;
  sampledEncode.windows = [{ startSeconds: 0, seconds }];
  sampledEncode.encodedSize = encodedSize;
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

/** The label and value of each field in the document's section headed `title`, in order. */
function documentRows(el: HTMLElement, title: string): [string | null, string | null][] {
  const doc = new DOMParser().parseFromString(documentHtml(el), "text/html");
  const sec = Array.from(doc.querySelectorAll("section.section")).find(
    (s) => s.querySelector("h2")?.textContent === title,
  );
  if (!sec) throw new Error(`No "${title}" section in the document`);
  return gridRows(sec).map((row) => [row.label, row.value]);
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

let restoreClipboard: (() => void) | undefined;
/** Puts back the ResizeObserver a test stubbed: the stub is a plain property, which
 * vi.unstubAllGlobals() does not know to undo. */
let restoreObserver: (() => void) | undefined;

afterEach(() => {
  vi.unstubAllGlobals();
  restoreClipboard?.();
  restoreClipboard = undefined;
  restoreObserver?.();
  restoreObserver = undefined;
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

  it("states the results the tabs worked out", () => {
    const el = panel();
    loadClip();
    // Two GOPs either side of 30 frames, so the shortest and longest differ while the mean stays 30.
    state.gopLengths = [20, 40, ...Array.from({ length: 18 }, () => 30)];
    renderAnalysisTab(el);
    const md = markdown(el);

    // 2,000,000 bytes, which over 30 s is 533,333 bits a second.
    expect(md).toContain("| File Size | 1.9 MB |");
    expect(md).toContain("| Overall Bitrate | 533 kbps |");
    expect(md).toContain("| Duration | 30.000 s |");
    expect(md).toContain("| MIME Type | video/mp4 |");
    expect(md).toContain("| Codec | avc1.640020 |");
    expect(md).toContain("| Resolution | 640×480 |");
    expect(md).toContain("| Frame Rate | 30 fps |");
    expect(md).toContain("| Frames | 600 |");
    // The audio track's own figures.
    expect(md).toContain("| Sample Rate | 48,000 Hz |");
    expect(md).toContain("| Channels | 2 |");
    expect(md).toContain("| Bitrate | 128 kbps |");
    expect(md).toContain("| Total Frames | 600 |");
    expect(md).toContain("| Keyframes | 20 |");
    expect(md).toContain("| Avg GOP | 30.0 frames (1.50 s) |");
    expect(md).toContain("| Min / Max GOP | 20 / 40 frames |");
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
    // The count leads, then the three figures the page's card shows.
    expect(documentRows(el, "Empirical Seeking Test")).toEqual([
      ["Timestamps Sampled", "2"],
      ["Avg Keyframe Distance", "0.750 s"],
      ["Avg Decode Time", "20.0 ms"],
      ["Max Decode Time", "30.0 ms"],
    ]);
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
    cli.quality = "custom";
    cli.crf = 28;
    loadComparison(5, 100_000);
    renderAnalysisTab(el);
    const md = markdown(el);

    expect(md).toContain("## Side-by-Side (A/B) Result");
    expect(md).toContain("| Segment | 0.0s–5.0s |");
    expect(md).toContain("| Quality | Custom (CRF 28) |");
    expect(md).toContain("| Encoded Segment Size | 97.7 KB |");
    // The first 5 s hold 100,000 bytes of video and a sixth of the 1,400,000 bytes that are not video,
    // 333,333 in all; the encode is 0.3 of that, which projects 600,000 bytes for the 2,000,000-byte file.
    expect(md).toContain("| Original Segment Size | 325.5 KB |");
    expect(md).toContain("| Segment Change | -70% (original 3.3× larger) |");
    expect(md).toContain("| Original File Size | 1.9 MB |");
    expect(md).toContain("| Projected Full File | 585.9 KB |");
    // Every 5 s window of the clip costs the same, so the band is the narrowest allowed: 3% either side.
    expect(md).toContain("| Projected Range | 568.4 KB – 603.5 KB |");
    expect(md).toContain("| Projected Saving | 70% smaller (≈ 1.3 MB saved) |");
  });

  it("names the winning square's settings, not the builder's, after a sweep", () => {
    const el = panel();
    loadClip();
    loadComparison(5, 100_000);
    sampledEncode.activeCombo = { ...cliSettings(cli), preset: "slow", crf: 30, quality: "low" };
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
    sampledEncode.matrix.cells = cells;
    renderAnalysisTab(el);
    const md = markdown(el);

    expect(md).toContain("## Compare Quality Matrix");
    expect(md).toContain("| Quality | ultrafast | fast |");
    // ★ marks the largest reduction, which is the smallest of the four.
    expect(md.match(/★/g)).toHaveLength(1);
  });

  // At the source resolution every kernel is the same encode, so a sweep over two kernels and a
  // downscale has three outputs: one at 100%, and one per kernel at 50%.
  it("prints the sweep's source-resolution output once, whatever kernels it ticked", () => {
    const el = panel();
    loadClip();
    const cells = makeMatrixCells(buildMatrixCombos(["high"], ["fast"], [1, 0.5], ["lanczos", "bicubic"]));
    cells.forEach((c, i) => {
      c.status = "done";
      c.bytes = 60_000 - i * 10_000;
    });
    sampledEncode.matrix.cells = cells;
    renderAnalysisTab(el);
    expect(markdown(el).match(/^\| \d+%.*$/gm)).toEqual([
      "| 100% | high (CRF 18) | 58.6 KB |",
      "| 50% lanczos | high (CRF 18) | 48.8 KB |",
      "| 50% bicubic | high (CRF 18) | 39.1 KB ★ |",
    ]);
  });

  // The table has no rate column (NV-10 in docs/code-reviews/2026-11-22-code-quality-review.md), so a
  // reduced rate's squares would repeat each quality's row with nothing to tell the copies apart.
  it("prints a sweep's source-rate squares alone, one row per quality, when it also covered a reduced rate", () => {
    const el = panel();
    loadClip();
    const cells = makeMatrixCells(buildMatrixCombos(["high"], ["fast"], [1], ["lanczos"], [null, 15]));
    cells.forEach((c, i) => {
      c.status = "done";
      c.bytes = 60_000 - i * 10_000;
    });
    sampledEncode.matrix.cells = cells;
    renderAnalysisTab(el);
    const table = markdown(el).split("## Compare Quality Matrix")[1];
    expect(table.match(/^\| high.*$/gm)).toEqual(["| high (CRF 18) | 58.6 KB |"]);
  });

  it("leaves a sweep out while none of its squares have finished", () => {
    const el = panel();
    loadClip();
    sampledEncode.matrix.cells = makeMatrixCells(buildMatrixCombos(["high"], ["fast"]));
    renderAnalysisTab(el);
    expect(markdown(el)).not.toContain("## Compare Quality Matrix");
  });

  it("reports an in-browser reencode's result", () => {
    const el = panel();
    loadClip();
    state.reencodeResult = { originalSize: 2_000_000, encodedSize: 1_000_000 };
    renderAnalysisTab(el);
    const md = markdown(el);
    expect(md).toContain("## In-Browser Reencode Result");
    expect(md).toContain("| Original Size | 1.9 MB |");
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
    restoreClipboard = stubClipboard(writeText).restore;

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

  // The page's builders draw their teaching material whether or not the switch shows it; the
  // document states what the file is without it either way, the panel's own intro aside.
  it("writes the same document with the Educational switch on or off, with no teaching material in it", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 0, 1, 12));
    try {
      loadClip();
      state.tags = { title: "Session 1" } as never;
      state.seekResults = [
        { t: 1, kf: 0, dist: 1, distFrames: 20, decodeMs: 10 },
        { t: 2, kf: 1.5, dist: 0.5, distFrames: 10, decodeMs: 30 },
      ];
      loadComparison(5, 100_000);
      const cells = makeMatrixCells(buildMatrixCombos(["high"], ["ultrafast", "fast"]));
      cells.forEach((c, i) => {
        c.status = "done";
        c.bytes = 100_000 - i * 10_000;
      });
      sampledEncode.matrix.cells = cells;
      const write = (): { html: string; md: string } => {
        const el = panel();
        renderAnalysisTab(el);
        return { html: documentHtml(el), md: markdown(el) };
      };

      const on = write();
      setEducationalEnabled(false);
      const off = write();
      expect(off).toEqual(on);
      for (const mark of ['class="teach', 'class="info', "info-btn", "info-pop", "edu"]) {
        expect(on.html).not.toContain(mark);
      }
    } finally {
      setEducationalEnabled(true);
      vi.useRealTimers();
    }
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

  it("spells out the rotation, codec details, color space and HDR a track carries", () => {
    const el = panel();
    loadClip({
      tracks: [
        {
          ...VIDEO_TRACK,
          rotation: 90,
          codecInfo: {
            family: "H.264",
            fullName: "Advanced Video Coding",
            year: 2003,
            description: "The most widely supported video codec.",
            details: [
              { label: "Profile", value: "High" },
              { label: "Level", value: "3.2" },
            ],
          },
          colorSpace: { primaries: "bt709", transfer: "bt709", matrix: "bt709" },
          hdr: true,
        },
      ],
    });
    renderAnalysisTab(el);
    const md = markdown(el);

    expect(md).toContain("| Rotation | 90° |");
    expect(md).toContain("| Profile | High |");
    expect(md).toContain("| Level | 3.2 |");
    expect(md).toContain("| Color Space | bt709 / bt709 / bt709 |");
    expect(md).toContain("| HDR | Yes |");
  });

  // A track shown at the size it is coded at needs no second size; one stretched to another (non-square
  // pixels) gets a row saying what it is shown at.
  it("states the display size only when it differs from the coded one", () => {
    const el = panel();
    loadClip();
    renderAnalysisTab(el);
    expect(markdown(el)).not.toContain("Display Size");

    loadClip({ tracks: [{ ...VIDEO_TRACK, displayWidth: 853, displayHeight: 480 }] });
    renderAnalysisTab(el);
    expect(markdown(el)).toContain("| Display Size | 853×480 |");

    loadClip({ tracks: [{ ...VIDEO_TRACK, displayWidth: 640, displayHeight: 360 }] });
    renderAnalysisTab(el);
    expect(markdown(el)).toContain("| Display Size | 640×360 |");
  });

  it("leaves the frame rate out of the headline when the file does not state one", () => {
    const el = panel();
    loadClip({ tracks: [{ ...VIDEO_TRACK, packetRate: null }] });
    renderAnalysisTab(el);
    const md = markdown(el);
    expect(md).not.toContain("**Frame Rate:**");
    expect(md).toContain("| Frame Rate | – |");
  });

  it("reports a declared constant bitrate as one figure when the samples bear it out", () => {
    const el = panel();
    loadClip();
    // 600 × 1000 bytes over 30 s = 160,000 bps, declared as both the average and the maximum.
    state.declaredVideoBitrate = { avgBitrate: 160_000, maxBitrate: 160_000 };
    renderAnalysisTab(el);
    const md = markdown(el);
    expect(md).toContain("| Declared Bitrate | 160 kbps |");
    expect(md).not.toContain("| Peak Window |");
  });

  // A declaration the sample table contradicts is not what gets drawn: the measured shape is.
  it("measures the samples over a constant-bitrate declaration they contradict", () => {
    const el = panel();
    loadClip();
    state.samples = evenSamples(
      600,
      30,
      (i) => (i % 30 === 0 ? 20_000 : 1000),
      (i) => i % 30 === 0,
    );
    state.declaredVideoBitrate = { avgBitrate: 160_000, maxBitrate: 160_000 };
    renderAnalysisTab(el);
    const md = markdown(el);
    // 980,000 bytes over 30 s on average; a second holding a 20,000-byte keyframe carries 39,000
    // bytes, and one without a keyframe 20,000.
    expect(md).toContain("| Average | 261 kbps |");
    expect(md).toContain("| Peak Window | 312 kbps |");
    expect(md).toContain("| Quietest Window | 160 kbps |");
    expect(md).toContain("| Peak ÷ Average | 1.19× |");
    expect(md).not.toContain("| Declared Bitrate |");
  });

  it("states a constant declaration under the bitrate heading when there are too few frames to test it", () => {
    const el = panel();
    loadClip();
    state.samples = evenSamples(3, 30, 1000, (i) => i === 0);
    state.declaredVideoBitrate = { avgBitrate: 160_000, maxBitrate: 160_000 };
    renderAnalysisTab(el);
    expect(documentRows(el, "Video Bitrate Over Time")).toEqual([["Declared Bitrate", "160 kbps"]]);
  });

  it("falls back to the track average when there are too few frames to bin", () => {
    const el = panel();
    loadClip();
    state.samples = evenSamples(3, 30, 1000, (i) => i === 0);
    renderAnalysisTab(el);
    const md = markdown(el);
    expect(md).toContain("| Average | 500 kbps |");
    expect(md).not.toContain("| Peak Window |");
  });

  it("leaves out the sections a file with no sample table or box tree cannot fill", () => {
    const el = panel();
    loadClip();
    state.samples = [];
    state.boxes = [];
    renderAnalysisTab(el);
    const md = markdown(el);
    expect(md).not.toContain("## GOP / Keyframe Structure");
    expect(md).not.toContain("## MP4 Atom Map");
    expect(md).toContain("## Video Bitrate Over Time");
  });

  it("lists an audio codec's parsed details under its track", () => {
    const el = panel();
    loadClip({
      tracks: [
        VIDEO_TRACK,
        {
          ...AUDIO_TRACK,
          codecInfo: {
            family: "AAC",
            fullName: "Advanced Audio Coding",
            year: 1997,
            description: "The default audio codec of MP4.",
            details: [{ label: "Object Type", value: "AAC-LC" }],
          },
        },
      ],
    });
    renderAnalysisTab(el);
    const md = markdown(el);
    expect(md).toContain("| Codec | mp4a.40.2 |");
    expect(md).toContain("| Object Type | AAC-LC |");
  });

  it("prints dashes for the audio facts a track does not state", () => {
    const el = panel();
    loadClip({
      tracks: [{ kind: "audio", codec: "opus", codecString: null, codecInfo: null, packetRate: 50, bitrate: null }],
    });
    renderAnalysisTab(el);
    const md = markdown(el);
    expect(md).toContain("| Codec | opus |");
    expect(md).toContain("| Sample Rate | – |");
    expect(md).toContain("| Channels | – |");
    expect(md).toContain("| Bitrate | – |");
  });

  // A comparison made at half resolution is not comparable to one made at the source's, so the
  // change is stated; at the source resolution the row would say nothing and is left out.
  it("states the resolution change when the compared encode was downscaled", () => {
    const el = panel();
    loadClip();
    loadComparison(5, 100_000);
    sampledEncode.activeCombo = { ...cliSettings(cli), scale: 0.5, scaler: "bicubic" };
    renderAnalysisTab(el);
    expect(markdown(el)).toContain("| Resolution | 640×480 → 320×240 (50%, bicubic) |");

    sampledEncode.activeCombo = { ...cliSettings(cli), scale: 1 };
    renderAnalysisTab(el);
    const ab = markdown(el).split("## Side-by-Side (A/B) Result")[1];
    expect(ab).not.toContain("| Resolution |");
  });

  it("leaves the resolution change out when the track's coded size is unknown", () => {
    const el = panel();
    loadClip({ tracks: [{ ...VIDEO_TRACK, codedWidth: undefined, codedHeight: undefined }, AUDIO_TRACK] });
    loadComparison(5, 100_000);
    sampledEncode.activeCombo = { ...cliSettings(cli), scale: 0.5 };
    renderAnalysisTab(el);
    const labels = documentRows(el, "Side-by-Side (A/B) Result").map(([label]) => label);
    expect(labels).toContain("Quality");
    expect(labels).not.toContain("Resolution");
  });

  it("leads a sweep over more than one resolution with an output column", () => {
    const el = panel();
    loadClip();
    const cells = makeMatrixCells(buildMatrixCombos(["high"], ["fast"], [1, 0.5], ["lanczos"]));
    cells.forEach((c, i) => {
      c.status = "done";
      c.bytes = 100_000 - i * 10_000;
    });
    sampledEncode.matrix.cells = cells;
    renderAnalysisTab(el);
    const md = markdown(el);

    expect(md).toContain("| Output | Quality | fast |");
    expect(md).toContain("| 100% | high (CRF 18) | 97.7 KB |");
    expect(md).toContain("| 50% lanczos | high (CRF 18) | 87.9 KB ★ |");
  });

  it("dashes the squares of a sweep that never finished, and drops the time of one not clocked", () => {
    const el = panel();
    loadClip();
    const cells = makeMatrixCells(buildMatrixCombos(["high", "low"], ["ultrafast", "fast"]));
    cells.slice(0, 3).forEach((c, i) => {
      c.status = "done";
      c.bytes = 100_000 - i * 10_000;
      c.elapsedMs = i === 0 ? null : 4200;
    });
    sampledEncode.matrix.cells = cells;
    renderAnalysisTab(el);
    const md = markdown(el);

    expect(md).toContain("| high (CRF 18) | 97.7 KB | 87.9 KB / 4.2s |");
    expect(md).toContain("| low (CRF 32) | 78.1 KB / 4.2s ★ | – |");
  });

  it("keeps the preview frame as tall as the document loaded into it", () => {
    const observers = installObserverStub("ResizeObserver");
    restoreObserver = observers.restore;
    const el = panel();
    loadClip();
    renderAnalysisTab(el);
    const frame = el.querySelector<HTMLIFrameElement>("iframe.doc-preview")!;
    const documentElement = { scrollHeight: 900 };
    Object.defineProperty(frame, "contentDocument", {
      value: { body: { scrollHeight: 1200 }, documentElement },
      configurable: true,
    });

    frame.dispatchEvent(new Event("load"));
    expect(frame.style.height).toBe("1200px");
    const [observer] = observers.instances;
    expect(observer.observed).toEqual([documentElement]);

    // The next visit rebuilds the panel, and the observer watching the old frame goes with it.
    renderAnalysisTab(el);
    expect(observer.disconnected).toBe(true);
  });

  it("leaves the frame's height alone when it has no document to measure", () => {
    const el = panel();
    loadClip();
    renderAnalysisTab(el);
    const frame = el.querySelector<HTMLIFrameElement>("iframe.doc-preview")!;
    Object.defineProperty(frame, "contentDocument", { value: null, configurable: true });

    frame.dispatchEvent(new Event("load"));
    expect(frame.style.height).toBe("");
  });

  // The button is a no-op until the frame has a window to print, and it does not fall back to
  // printing the page around the frame.
  it("ignores a print request while the frame has no window", () => {
    const el = panel();
    loadClip();
    renderAnalysisTab(el);
    const frame = el.querySelector<HTMLIFrameElement>("iframe.doc-preview")!;
    Object.defineProperty(frame, "contentWindow", { value: null, configurable: true });
    const pagePrint = vi.spyOn(window, "print").mockImplementation(() => undefined);

    clickButton(el, "Save as PDF");
    expect(pagePrint).not.toHaveBeenCalled();
    pagePrint.mockRestore();
  });

  it("prints placeholders for what a bare file does not say about itself", () => {
    const el = panel();
    loadClip({
      tracks: [{ kind: "video", codec: "avc", codecString: null, codecInfo: null, packetRate: 30, bitrate: null }],
    });
    state.source = { kind: "file", size: 2_000_000 } as never;
    state.format = "";
    state.mimeType = "";
    state.duration = null;
    renderAnalysisTab(el);
    const md = markdown(el);

    expect(md).toContain("# Encoding Helper analysis: video");
    expect(md).toContain("**Container:** –");
    expect(md).toContain("**Video Codec:** avc");
    expect(md).toContain("**Resolution:** ?×?");
    expect(md).toContain("| Duration | – |");
    expect(md).toContain("| MIME Type | – |");
    // No duration to bin the samples over, so the bitrate section falls back to the one figure.
    expect(md).toContain("| Average | – |");
  });

  it("leaves a metadata tag's key bare when nothing is known about it", () => {
    const el = panel();
    loadClip();
    state.tags = { raw: { "com.example.custom": "x" } } as never;
    renderAnalysisTab(el);
    expect(markdown(el)).toContain("| com.example.custom | x |");
  });

  it("notes B-frames, and a keyframe structure no GOP was measured for", () => {
    const el = panel();
    loadClip();
    state.hasBFrames = true;
    state.gopLengths = [];
    renderAnalysisTab(el);
    const md = markdown(el);
    expect(md).toContain("**Uses B-frames (cts ≠ dts)**");
    expect(md).toContain("| Min / Max GOP | – |");
    expect(md).not.toContain("_Chart: GOP length per keyframe interval");
  });

  it("tables a single seek without the scatter plot two would make", () => {
    const el = panel();
    loadClip();
    state.seekResults = [{ t: 1, kf: 0, dist: 1, distFrames: 20, decodeMs: 10 }];
    renderAnalysisTab(el);
    const md = markdown(el);
    expect(md).toContain("| Timestamps Sampled | 1 |");
    expect(md).not.toContain("_Chart: Keyframe distance vs. decode time");
  });

  it("states the comparison without a projection while the encode's size is unknown", () => {
    const el = panel();
    loadClip();
    loadComparison(5, null);
    renderAnalysisTab(el);
    const md = markdown(el);
    expect(md).toContain("| Encoded Segment Size | – |");
    expect(md).not.toContain("| Projected Full File |");
  });

  // One window gives no spread to build a range from; and an encode that came out bigger is
  // reported as bytes added, not saved.
  it("reports bytes added, with no range, when the whole file was encoded and grew", () => {
    const el = panel();
    loadClip();
    loadComparison(30, 3_000_000);
    renderAnalysisTab(el);
    const md = markdown(el);
    expect(md).toContain("| Projected Full File | 2.9 MB |");
    expect(md).toContain("| Projected Saving | 50% larger (≈ 976.6 KB added) |");
    expect(md).not.toContain("| Projected Range |");
  });
});

/** The view tabs over the document, in order. */
function viewTabs(el: HTMLElement): HTMLButtonElement[] {
  return Array.from(el.querySelectorAll<HTMLButtonElement>('[role="tablist"] [role="tab"]'));
}

function viewTab(el: HTMLElement, name: "Rendered" | "Markdown"): HTMLButtonElement {
  const tab = viewTabs(el).find((t) => t.textContent === name);
  if (!tab) throw new Error(`No "${name}" tab in the panel`);
  return tab;
}

/** The tab panel a tab names in aria-controls. */
function controlledPanel(tab: HTMLElement): HTMLElement {
  const id = tab.getAttribute("aria-controls");
  const controlled = id ? document.getElementById(id) : null;
  if (!controlled) throw new Error(`The "${tab.textContent}" tab controls nothing on the page`);
  return controlled;
}

/** Which tab reads as chosen, which one Tab lands on, and which panel is hidden, in tab order. */
function viewState(el: HTMLElement): { selected: (string | null)[]; tabIndex: number[]; hidden: boolean[] } {
  const tabs = viewTabs(el);
  return {
    selected: tabs.map((t) => t.getAttribute("aria-selected")),
    tabIndex: tabs.map((t) => t.tabIndex),
    hidden: tabs.map((t) => controlledPanel(t).hidden),
  };
}

const RENDERED_CHOSEN = { selected: ["true", "false"], tabIndex: [0, -1], hidden: [false, true] };
const MARKDOWN_CHOSEN = { selected: ["false", "true"], tabIndex: [-1, 0], hidden: [true, false] };

function press(target: HTMLElement, key: string): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

/**
 * Gives the panel's frame a stand-in window that behaves as a browser's does: focusing it takes the
 * focus into the frame, and printing fires afterprint on it as the dialog closes. Notes what had
 * the focus at the moment of printing.
 */
function stubFrameWindow(el: HTMLElement): {
  print: Mock<() => void>;
  focusedAtPrint: (Element | null)[];
} {
  const frame = el.querySelector<HTMLIFrameElement>("iframe.doc-preview")!;
  const focusedAtPrint: (Element | null)[] = [];
  const win = new EventTarget();
  const print = vi.fn(() => {
    focusedAtPrint.push(document.activeElement);
    win.dispatchEvent(new Event("afterprint"));
  });
  Object.assign(win, { print, focus: () => frame.focus() });
  Object.defineProperty(frame, "contentWindow", { value: win, configurable: true });
  return { print, focusedAtPrint };
}

describe("the document's Rendered and Markdown views", () => {
  // The choice outlives the panel for the rest of the session, so each test hands the default back.
  afterEach(() => {
    // Drops the frames a test gave a stand-in window, which jsdom would try to close at teardown.
    document.body.innerHTML = "";
    loadClip();
    const el = panel();
    renderAnalysisTab(el);
    viewTab(el, "Rendered").click();
  });

  it("puts a Rendered and a Markdown tab between the actions and the document", () => {
    const el = panel();
    loadClip();
    renderAnalysisTab(el);

    const list = el.querySelector('[role="tablist"]');
    expect(list?.getAttribute("aria-label")).toBe("Document view");
    expect(viewTabs(el).map((t) => t.textContent)).toEqual(["Rendered", "Markdown"]);
    const actions = el.querySelector(".load-actions")!;
    const frame = el.querySelector("iframe.doc-preview")!;
    expect(actions.compareDocumentPosition(list!) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(list!.compareDocumentPosition(frame) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("opens on the rendered document, each tab naming the panel it shows", () => {
    const el = panel();
    loadClip();
    renderAnalysisTab(el);

    expect(viewState(el)).toEqual(RENDERED_CHOSEN);
    for (const tab of viewTabs(el)) {
      const controlled = controlledPanel(tab);
      expect(controlled.getAttribute("role")).toBe("tabpanel");
      expect(controlled.getAttribute("aria-labelledby")).toBe(tab.id);
    }
    const frame = el.querySelector("iframe.doc-preview")!;
    expect(controlledPanel(viewTab(el, "Rendered")).contains(frame)).toBe(true);
  });

  it("shows exactly the Markdown that Copy Markdown copies, as plain text", () => {
    const el = panel();
    loadClip();
    // Markup in a value the file supplies: the raw view must show it as written, not render it.
    state.tags = { title: "<b>Session</b> *1*" } as never;
    renderAnalysisTab(el);
    const writeText = vi.fn().mockResolvedValue(undefined);
    restoreClipboard = stubClipboard(writeText).restore;
    clickButton(el, "Copy Markdown");
    const copied: string = writeText.mock.calls[0][0];

    viewTab(el, "Markdown").click();

    expect(viewState(el)).toEqual(MARKDOWN_CHOSEN);
    const raw = controlledPanel(viewTab(el, "Markdown"));
    expect(raw.textContent).toBe(copied);
    expect(raw.textContent).toBe(markdown(el));
    expect(raw.children).toHaveLength(0);
    expect(raw.textContent).toContain("<b>Session</b>");
  });

  it("moves between the tabs with the arrow keys, Home and End, choosing the one it lands on", () => {
    const el = panel();
    loadClip();
    renderAnalysisTab(el);
    const rendered = viewTab(el, "Rendered");
    const markdownTab = viewTab(el, "Markdown");
    rendered.focus();

    const steps: [from: HTMLElement, key: string, to: HTMLElement, state: typeof RENDERED_CHOSEN][] = [
      [rendered, "ArrowRight", markdownTab, MARKDOWN_CHOSEN],
      // Both arrows wrap around the ends.
      [markdownTab, "ArrowRight", rendered, RENDERED_CHOSEN],
      [rendered, "ArrowLeft", markdownTab, MARKDOWN_CHOSEN],
      [markdownTab, "ArrowLeft", rendered, RENDERED_CHOSEN],
      [rendered, "End", markdownTab, MARKDOWN_CHOSEN],
      [markdownTab, "Home", rendered, RENDERED_CHOSEN],
    ];
    for (const [from, key, to, expected] of steps) {
      const event = press(from, key);
      expect(viewState(el)).toEqual(expected);
      expect(document.activeElement).toBe(to);
      // Home and End would otherwise scroll the page as well.
      expect(event.defaultPrevented).toBe(true);
    }

    const other = press(rendered, "ArrowDown");
    expect(viewState(el)).toEqual(RENDERED_CHOSEN);
    expect(other.defaultPrevented).toBe(false);
  });

  it("keeps the chosen view when the panel is rebuilt on the next visit", () => {
    const el = panel();
    loadClip();
    renderAnalysisTab(el);

    viewTab(el, "Markdown").click();
    renderAnalysisTab(el);
    expect(el.querySelectorAll('[role="tablist"]')).toHaveLength(1);
    expect(viewState(el)).toEqual(MARKDOWN_CHOSEN);

    viewTab(el, "Rendered").click();
    renderAnalysisTab(el);
    expect(viewState(el)).toEqual(RENDERED_CHOSEN);
  });

  it("prints the rendered document whichever view is showing", () => {
    for (const name of ["Markdown", "Rendered"] as const) {
      const el = panel();
      loadClip();
      renderAnalysisTab(el);
      viewTab(el, name).click();
      const { print } = stubFrameWindow(el);

      clickButton(el, "Save as PDF");

      expect(print).toHaveBeenCalledOnce();
    }
  });

  it("hands focus back to Save as PDF once the print from the Markdown view is done", () => {
    const el = panel();
    loadClip();
    renderAnalysisTab(el);
    viewTab(el, "Markdown").click();
    const { print, focusedAtPrint } = stubFrameWindow(el);
    const pdfBtn = Array.from(el.querySelectorAll("button")).find((b) => b.textContent === "Save as PDF")!;

    pdfBtn.focus();
    pdfBtn.click();

    expect(print).toHaveBeenCalledOnce();
    // Still in the frame while it prints, which is what the frame's focus() is there for.
    expect(focusedAtPrint).toEqual([el.querySelector("iframe.doc-preview")]);
    expect(document.activeElement).toBe(pdfBtn);
  });
});
