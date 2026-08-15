// Full Analysis — everything the other tabs worked out about the loaded file, gathered into one
// document.
//
// The tabs each answer their own question and drop the answer on the floor when you leave them;
// this is where those answers are collected, in reading order, with the explainer that goes with
// each number rather than behind an ⓘ the reader of a saved file could never click. What the panel
// shows is the document itself, rendered in an iframe from the same HTML the Download button
// writes and the print dialog prints, so there is no "preview" that can disagree with the file.
//
// State-gathering lives here; how a section is drawn lives in lib/analysisDoc.ts. Sections are
// rebuilt on every visit to the tab, since the seeking test and the two encode tabs add to them.

import { buildAnalysisDocument, renderSectionsToMarkdown, type DocumentMeta } from "../lib/analysisDoc";
import { computeBitrateTimeline, isEffectivelyConstant } from "../lib/bitrateTimeline";
import { buildFfmpegArgs, formatCliCommand, isDownscale, scaledDimensions } from "../lib/cliCommand";
import { CONTAINER_PREAMBLE, describeContainer } from "../lib/containerKb";
import { copyToClipboard, h, teachBox } from "../lib/dom";
import {
  ATOM_STRUCTURE_TEACH,
  AUDIO_BITRATE_INFO,
  BITRATE_TIMELINE_TEACH,
  chromaSubsamplingExplainer,
  codecExplainer,
  constantBitrateNote,
  containerExplainer,
  contradictedDeclarationNote,
  FASTSTART_EXPLAINER,
  GOP_TEACH,
  METADATA_TAGS_TEACH,
  OVERALL_BITRATE_INFO,
  PEAK_RATIO_INFO,
  SEEK_TEST_INTRO,
  SIZE_SAVINGS_INTRO,
  sizeEstimateTeach,
  TOO_FEW_FRAMES_NOTE,
  VIDEO_AVERAGE_INFO,
} from "../lib/explainers";
import { fmtBits, fmtBytes, fmtDur, fmtMs, fmtRate } from "../lib/format";
import { describeMetadataTag } from "../lib/metadataTagKb";
import { declaresConstantBitrate } from "../lib/mp4boxParser";
import { bestReductionCell, cliSettings, comboCrf, matrixAxes } from "../lib/qualityMatrix";
import { downloadBlob } from "../lib/save";
import { currentSizeEstimate, describeSavings, fmtSignedChange } from "../lib/sizeEstimate";
import { cli, currentVideoInfo, encodeTest, state } from "../lib/state";
import type { AnalysisBlock, AnalysisSection, TrackInfo } from "../lib/types";
import { renderStaticAtomMap } from "./atomsTab";
import { renderBitrateChart } from "./bitrateChart";
import { flattenMetadataTags } from "./inspectTab";
import { GOP_HISTOGRAM_CAPTION, renderGopHistogram, renderSeekScatter, SEEK_SCATTER_CAPTION } from "./seekTab";

/** Printed in the document so a copy saved to disk still says where it came from. */
const APP_URL = "https://encoding-helper.brain-bbqs.org";

/**
 * The document's content width (its 860px column less the 44px of padding on either side; see
 * ANALYSIS_DOC_CSS). The atom map needs it up front: on the page a ResizeObserver decides which
 * block labels fit, but the document runs no script, so that has to be settled while it is built.
 */
const DOCUMENT_WIDTH_PX = 772;

const PANEL_INTRO =
  "Everything on the other tabs, gathered into one document: the container and track metadata with the " +
  "explainer that goes with each number, the bitrate plot, the atom map, the GOP " +
  "structure, and the <code>ffmpeg</code> command these settings produce. Runs that have to be started by " +
  "hand — the seeking test, Compare Quality, an in-browser reencode — are added to it once you have run " +
  "them, so run those first if you want them in the document. " +
  "<p>Below is the document itself, not a preview of one: <b>Download HTML</b> writes exactly this, in a " +
  "single self-contained file with no external assets, and <b>Save as PDF</b> hands the same thing to the " +
  "browser's print dialog.</p>";

/** The headline strip under the document title: what the file is, in one line. */
function headlineFacts(): [string, string][] {
  const vt = state.tracks?.find((t) => t.kind === "video");
  const facts: [string, string][] = [["Container", state.format || "–"]];
  if (vt) {
    facts.push(["Video Codec", vt.codecString || vt.codec]);
    facts.push(["Resolution", `${vt.codedWidth ?? "?"}×${vt.codedHeight ?? "?"}`]);
    if (vt.packetRate != null) facts.push(["Frame Rate", fmtRate(vt.packetRate) + " fps"]);
  }
  facts.push(["Duration", fmtDur(state.duration)], ["File Size", fmtBytes(state.source?.size)]);
  return facts;
}

function documentMeta(): DocumentMeta {
  return {
    fileName: state.source?.name ?? "video",
    generated: new Date().toLocaleString(),
    version: __APP_VERSION__,
    appUrl: APP_URL,
    facts: headlineFacts(),
  };
}

function overviewSection(): AnalysisSection {
  const fileBitrate = state.duration && state.source ? (state.source.size * 8) / state.duration : null;
  return {
    title: "Video Container Overview",
    blocks: [
      { kind: "prose", html: CONTAINER_PREAMBLE },
      {
        kind: "kv",
        items: [
          ["Type", state.format || "–"],
          ["File Size", fmtBytes(state.source?.size)],
          ["Duration", fmtDur(state.duration)],
          ["Overall Bitrate", fmtBits(fileBitrate)],
          ["MIME Type", state.mimeType || "–"],
        ],
      },
      { kind: "prose", html: OVERALL_BITRATE_INFO },
      {
        kind: "badge",
        tone: state.faststart ? "good" : "bad",
        text: state.faststart ? "✓ Faststart (moov before mdat)" : "✗ Not faststart (moov after mdat)",
      },
      { kind: "prose", html: FASTSTART_EXPLAINER },
    ],
  };
}

function containerSection(): AnalysisSection | null {
  const info = describeContainer(state.format);
  if (!info) return null;
  return {
    title: `This File's Container: ${info.name}`,
    blocks: [{ kind: "prose", html: containerExplainer(info) }],
  };
}

function videoTrackSection(vt: TrackInfo): AnalysisSection {
  // No Bitrate item: the track average heads the bitrate section below, with the plot the single
  // number cannot draw — the same split the Inspect tab makes.
  const items: [string, string | number][] = [
    ["Codec", vt.codecString || vt.codec],
    ["Resolution", `${vt.codedWidth ?? "?"}×${vt.codedHeight ?? "?"}`],
  ];
  if (vt.displayWidth !== vt.codedWidth || vt.displayHeight !== vt.codedHeight) {
    items.push(["Display Size", `${vt.displayWidth ?? "?"}×${vt.displayHeight ?? "?"}`]);
  }
  items.push(
    ["Frame Rate", vt.packetRate != null ? fmtRate(vt.packetRate) + " fps" : "–"],
    ["Frames", state.frameCount != null ? state.frameCount.toLocaleString() : "–"],
  );
  if (vt.rotation) items.push(["Rotation", vt.rotation + "°"]);
  if (vt.codecInfo) vt.codecInfo.details.forEach((d) => items.push([d.label, d.value]));
  if (vt.colorSpace) {
    items.push([
      "Color Space",
      [vt.colorSpace.primaries, vt.colorSpace.transfer, vt.colorSpace.matrix].filter(Boolean).join(" / ") || "–",
    ]);
  }
  if (vt.hdr) items.push(["HDR", "Yes"]);

  const blocks: AnalysisBlock[] = [{ kind: "kv", items }];
  const codec = codecExplainer(vt.codecInfo);
  if (codec) blocks.push({ kind: "prose", html: codec });
  if (vt.codedWidth != null && vt.codedHeight != null) {
    blocks.push({ kind: "prose", html: chromaSubsamplingExplainer(vt.codedWidth, vt.codedHeight) });
  }
  return { title: "Video Track", blocks };
}

/** Mirrors the Inspect tab's card, including the two cases where there is no plot to draw. */
function bitrateSection(vt: TrackInfo): AnalysisSection {
  const declared = state.declaredVideoBitrate;
  const declaresConstant = declaresConstantBitrate(declared);
  const timeline = computeBitrateTimeline(state.samples, state.duration ?? 0);

  if (declaresConstant && declared && (!timeline || isEffectivelyConstant(timeline))) {
    return {
      title: "Video Bitrate Over Time",
      blocks: [
        { kind: "kv", items: [["Declared Bitrate", fmtBits(declared.avgBitrate)]] },
        { kind: "prose", html: constantBitrateNote(declared.avgBitrate) },
      ],
    };
  }
  if (!timeline) {
    return {
      title: "Video Bitrate Over Time",
      blocks: [
        { kind: "kv", items: [["Average", fmtBits(vt.bitrate)]] },
        { kind: "prose", html: TOO_FEW_FRAMES_NOTE },
      ],
    };
  }

  const blocks: AnalysisBlock[] = [{ kind: "prose", html: BITRATE_TIMELINE_TEACH }];
  if (declaresConstant && declared) {
    blocks.push({ kind: "prose", html: contradictedDeclarationNote(declared.avgBitrate, timeline) });
  }
  blocks.push(
    {
      kind: "kv",
      items: [
        ["Average", fmtBits(timeline.averageBitrate)],
        ["Peak Window", fmtBits(timeline.peakBitrate)],
        ["Quietest Window", fmtBits(timeline.minBitrate)],
        ["Peak ÷ Average", timeline.peakToAverage.toFixed(2) + "×"],
      ],
    },
    {
      kind: "figure",
      caption: `Video bitrate per ${timeline.binSeconds.toFixed(2)} s window, against the track average`,
      element: renderBitrateChart(timeline),
    },
    // On the page these two are ⓘ popovers on the fields above; a document has no hover, so they
    // are spelled out under the plot instead.
    { kind: "prose", html: `<b>Average.</b> ${VIDEO_AVERAGE_INFO}<p><b>Peak ÷ Average.</b> ${PEAK_RATIO_INFO}</p>` },
  );
  return { title: "Video Bitrate Over Time", blocks };
}

function audioTrackSection(at: TrackInfo): AnalysisSection {
  const items: [string, string | number][] = [
    ["Codec", at.codecString || at.codec],
    ["Sample Rate", at.sampleRate ? at.sampleRate.toLocaleString() + " Hz" : "–"],
    ["Channels", at.channels != null ? at.channels : "–"],
    ["Bitrate", fmtBits(at.bitrate)],
  ];
  if (at.codecInfo) at.codecInfo.details.forEach((d) => items.push([d.label, d.value]));
  const blocks: AnalysisBlock[] = [{ kind: "kv", items }];
  const codec = codecExplainer(at.codecInfo);
  if (codec) blocks.push({ kind: "prose", html: codec });
  blocks.push({ kind: "prose", html: AUDIO_BITRATE_INFO });
  return { title: "Audio Track", blocks };
}

function metadataTagsSection(): AnalysisSection | null {
  const flatTags = flattenMetadataTags();
  if (!Object.keys(flatTags).length) return null;
  return {
    title: "Metadata Tags",
    blocks: [
      { kind: "prose", html: METADATA_TAGS_TEACH },
      {
        kind: "kv",
        rawLabels: true,
        items: Object.entries(flatTags).map(([k, v]): [string, string] => {
          const info = describeMetadataTag(k);
          return [info ? `${k} (${info.label})` : k, String(v)];
        }),
      },
    ],
  };
}

// The map is the whole of what this section says about the tree. The indented text listing the old
// report printed is gone: it was pages of offsets that only ever restated what the map draws, and a
// fragmented recording turned it into a hundred of them. Each block carries its own offset and size
// as a title instead.
function atomMapSection(): AnalysisSection | null {
  const map = renderStaticAtomMap(state.boxes, DOCUMENT_WIDTH_PX);
  if (!map) return null;
  return {
    title: "MP4 Atom Map",
    blocks: [
      { kind: "prose", html: ATOM_STRUCTURE_TEACH },
      {
        kind: "figure",
        caption:
          "The box tree on its side: left to right across the file, each row one level further in. " +
          "Width is how many boxes a subtree holds, not how many bytes it takes.",
        element: map,
      },
    ],
  };
}

function gopSection(): AnalysisSection | null {
  if (!state.samples.length) return null;
  const gop = state.gopLengths;
  const avgGop = gop.length ? gop.reduce((a, b) => a + b, 0) / gop.length : 0;
  const fps = state.fps || 30;
  const blocks: AnalysisBlock[] = [
    { kind: "prose", html: GOP_TEACH },
    {
      kind: "kv",
      items: [
        ["Total Frames", state.samples.length.toLocaleString()],
        ["Keyframes", state.keyframeDecodeIndices.length.toLocaleString()],
        ["Avg GOP", `${avgGop.toFixed(1)} frames (${(avgGop / fps).toFixed(2)} s)`],
        ["Min / Max GOP", gop.length ? `${Math.min(...gop)} / ${Math.max(...gop)} frames` : "–"],
      ],
    },
    {
      kind: "badge",
      tone: state.hasBFrames ? "info" : "good",
      text: state.hasBFrames ? "Uses B-frames (cts ≠ dts)" : "No B-frames (IPPP…)",
    },
  ];
  if (gop.length > 1) {
    blocks.push({ kind: "figure", caption: GOP_HISTOGRAM_CAPTION, element: renderGopHistogram(gop) });
  }
  return { title: "GOP / Keyframe Structure", blocks };
}

function seekingSection(): AnalysisSection | null {
  const results = state.seekResults;
  if (!results || !results.length) return null;
  const avgDist = results.reduce((a, r) => a + (r.dist ?? 0), 0) / results.length;
  const avgDecode = results.reduce((a, r) => a + r.decodeMs, 0) / results.length;
  const maxDecode = Math.max(...results.map((r) => r.decodeMs));
  const blocks: AnalysisBlock[] = [
    { kind: "prose", html: SEEK_TEST_INTRO },
    {
      kind: "kv",
      items: [
        ["Timestamps Sampled", results.length.toLocaleString()],
        ["Avg Keyframe Distance", avgDist.toFixed(3) + " s"],
        ["Avg Decode Time", fmtMs(avgDecode)],
        ["Max Decode Time", fmtMs(maxDecode)],
      ],
    },
  ];
  const scatter = renderSeekScatter(results);
  if (scatter) blocks.push({ kind: "figure", caption: SEEK_SCATTER_CAPTION, element: scatter });
  blocks.push({
    kind: "table",
    headers: ["Timestamp", "Nearest Keyframe ≤ t", "Distance", "Distance (frames)", "Decode Time"],
    rows: results.map((r) => [
      r.t.toFixed(3) + "s",
      r.kf != null ? r.kf.toFixed(3) + "s" : "–",
      r.dist != null ? r.dist.toFixed(3) + "s" : "–",
      r.distFrames != null ? String(r.distFrames) : "–",
      fmtMs(r.decodeMs),
    ]),
  });
  return { title: "Empirical Seeking Test", blocks };
}

function cliCommandSection(): AnalysisSection | null {
  const info = currentVideoInfo();
  if (!info) return null;
  return {
    title: "Reencode CLI Command",
    blocks: [
      {
        kind: "prose",
        html:
          "The command the <b>Reencode &amp; CLI</b> tab's settings come to, as they stood when this document " +
          "was generated. Run it wherever ffmpeg is installed; nothing about it is specific to the browser.",
      },
      { kind: "code", lang: "bash", content: formatCliCommand(buildFfmpegArgs(cli, info)) },
    ],
  };
}

function compareSection(): AnalysisSection | null {
  if (!encodeTest.originalSink || !encodeTest.encodedSink) return null;
  // The settings the loaded encode was made with: after a matrix sweep that is the winning square's,
  // which is not what the dropdowns say.
  const settings = encodeTest.activeCombo ?? cliSettings(cli);
  const items: [string, string | number][] = [
    ["Segment", `${encodeTest.startTime.toFixed(1)}s–${(encodeTest.startTime + encodeTest.duration).toFixed(1)}s`],
    [
      "Quality",
      settings.quality === "custom" ? `Custom (CRF ${settings.crf})` : `${settings.quality} (CRF ${settings.crf})`,
    ],
    ["Preset", settings.preset],
    ["Encoded Segment Size", fmtBytes(encodeTest.encodedSize)],
  ];
  // Only when it is not the source's: a resolution row reading "100%" on every document would say
  // nothing, but a comparison made at half resolution is not comparable to one that was not.
  const vt = state.tracks?.find((t) => t.kind === "video");
  if (isDownscale(settings.scale) && vt?.codedWidth && vt.codedHeight) {
    const out = scaledDimensions(vt.codedWidth, vt.codedHeight, settings.scale);
    items.splice(3, 0, [
      "Resolution",
      `${vt.codedWidth}×${vt.codedHeight} → ${out.width}×${out.height} (${Math.round(settings.scale * 100)}%)`,
    ]);
  }
  const blocks: AnalysisBlock[] = [
    {
      kind: "prose",
      html:
        "Only the segment above was encoded, so its size is not the whole file's — it is what that stretch of " +
        "video costs at these settings, which is what makes two settings comparable without encoding twice.",
    },
  ];

  const est = currentSizeEstimate();
  if (est) {
    items.push(
      ["Original Segment Size", fmtBytes(est.originalSegmentBytes)],
      ["Segment Change", fmtSignedChange(est)],
      ["Original File Size", fmtBytes(est.originalTotalBytes)],
      ["Projected Full File", fmtBytes(est.projectedTotalBytes)],
    );
    if (est.projectedRange) {
      items.push(["Projected Range", `${fmtBytes(est.projectedRange.low)} – ${fmtBytes(est.projectedRange.high)}`]);
    }
    items.push([
      "Projected Saving",
      `${describeSavings(est)} (≈ ${fmtBytes(Math.abs(est.projectedSavedBytes))} ` +
        `${est.savedFraction < 0 ? "added" : "saved"})`,
    ]);
    blocks.push({ kind: "prose", html: SIZE_SAVINGS_INTRO }, { kind: "prose", html: sizeEstimateTeach(est) });
  }

  return { title: "Compare Quality (A/B) Result", blocks: [{ kind: "kv", items }, ...blocks] };
}

/** The last matrix sweep as a table, so the document carries the grid the winner was picked out of. */
function matrixSection(): AnalysisSection | null {
  const cells = encodeTest.matrix.cells.filter((c) => c.status === "done" && c.bytes != null);
  if (!cells.length) return null;
  const best = bestReductionCell(encodeTest.matrix.cells);
  const { qualities, presets } = matrixAxes(cells);
  const byKey = new Map(cells.map((c) => [c.combo.key, c]));
  const rows = qualities.map((quality) => [
    `${quality} (CRF ${comboCrf(quality)})`,
    ...presets.map((preset) => {
      const cell = byKey.get(`${quality}:${preset}`);
      if (!cell || cell.bytes == null) return "–";
      const mark = best && cell.combo.key === best.combo.key ? " ★" : "";
      return `${fmtBytes(cell.bytes)}${cell.elapsedMs != null ? ` / ${(cell.elapsedMs / 1000).toFixed(1)}s` : ""}${mark}`;
    }),
  ]);
  return {
    title: "Compare Quality Matrix",
    blocks: [
      {
        kind: "prose",
        html:
          `Every combination of the quality and preset dropdowns, each encoded over the same ` +
          `${fmtDur(encodeTest.matrix.segmentLength)} of video. Each cell is the encoded segment's size and the ` +
          `time the encode took; ★ marks the largest reduction, which is the comparison above. Size is the only ` +
          `ranking here — no picture-quality metric is computed, so the highest CRF wins nearly every sweep.`,
      },
      { kind: "table", headers: ["Quality", ...presets], rows },
    ],
  };
}

function reencodeSection(): AnalysisSection | null {
  const result = state.reencodeResult;
  if (!result) return null;
  const pct = (1 - result.encodedSize / result.originalSize) * 100;
  return {
    title: "In-Browser Reencode Result",
    blocks: [
      {
        kind: "kv",
        items: [
          ["Engine", result.engine === "fast" ? "Fast (WebCodecs)" : "Exact (ffmpeg.wasm)"],
          ["Original Size", fmtBytes(result.originalSize)],
          ["Encoded Size", fmtBytes(result.encodedSize)],
          ["Change", (pct >= 0 ? "-" : "+") + Math.abs(pct).toFixed(1) + "%"],
        ],
      },
    ],
  };
}

function buildAnalysisSections(): AnalysisSection[] {
  if (!state.source) return [];
  const vt = state.tracks?.find((t) => t.kind === "video");
  const at = state.tracks?.find((t) => t.kind === "audio");
  const sections: (AnalysisSection | null)[] = [
    overviewSection(),
    containerSection(),
    vt ? videoTrackSection(vt) : null,
    vt ? bitrateSection(vt) : null,
    at ? audioTrackSection(at) : null,
    metadataTagsSection(),
    atomMapSection(),
    gopSection(),
    seekingSection(),
    cliCommandSection(),
    compareSection(),
    matrixSection(),
    reencodeSection(),
  ];
  return sections.filter((s): s is AnalysisSection => s !== null);
}

/**
 * Keeps the preview iframe as tall as the document inside it, so the page scrolls once rather than
 * the document scrolling inside a window of its own. Held at module scope because the panel is
 * rebuilt on every visit and the observer from the previous build has to be dropped with it.
 */
let previewObserver: ResizeObserver | null = null;

function mountPreview(frame: HTMLIFrameElement, html: string): void {
  frame.addEventListener("load", () => {
    const doc = frame.contentDocument;
    if (!doc) return;
    const fit = (): void => {
      frame.style.height = Math.max(doc.body.scrollHeight, doc.documentElement.scrollHeight) + "px";
    };
    fit();
    // Catches the reflow when the window (and so the iframe) changes width, which changes how tall
    // the document is.
    previewObserver = new ResizeObserver(fit);
    previewObserver.observe(doc.documentElement);
  });
  frame.srcdoc = html;
}

export function renderAnalysisTab(panel: HTMLElement): void {
  previewObserver?.disconnect();
  previewObserver = null;
  panel.innerHTML = "";
  if (!state.source) return;

  const sections = buildAnalysisSections();
  const meta = documentMeta();
  const documentHtml = buildAnalysisDocument(sections, meta);
  const baseName = (state.source.name || "video").replace(/\.[^.]+$/, "");

  const sec = h("div", "section");
  sec.append(h("h2", null, "Full Analysis"));
  sec.append(teachBox(PANEL_INTRO));

  const actions = h("div", "load-actions");
  const pdfBtn = h("button", "btn", "Save as PDF");
  pdfBtn.type = "button";
  const htmlBtn = h("button", "btn sec", "Download HTML");
  htmlBtn.type = "button";
  const mdBtn = h("button", "btn sec", "Download Markdown");
  mdBtn.type = "button";
  const copyBtn = h("button", "btn sec", "Copy Markdown");
  copyBtn.type = "button";
  actions.append(pdfBtn, htmlBtn, mdBtn, copyBtn);
  sec.append(actions);
  panel.append(sec);

  const frame = document.createElement("iframe");
  frame.className = "doc-preview";
  frame.id = "analysisDoc";
  frame.title = `Full analysis of ${state.source.name}`;
  panel.append(frame);
  mountPreview(frame, documentHtml);

  // Printing the frame rather than the page: the document in it is already paginated for paper,
  // and it is the same file the Download button writes.
  pdfBtn.addEventListener("click", () => {
    const win = frame.contentWindow;
    if (!win) return;
    win.focus();
    win.print();
  });
  htmlBtn.addEventListener("click", () => {
    downloadBlob(new Blob([documentHtml], { type: "text/html" }), baseName + ".analysis.html");
  });
  mdBtn.addEventListener("click", () => {
    const md = renderSectionsToMarkdown(sections, meta);
    downloadBlob(new Blob([md], { type: "text/markdown" }), baseName + ".analysis.md");
  });
  copyBtn.addEventListener("click", () => {
    copyToClipboard(renderSectionsToMarkdown(sections, meta), copyBtn);
  });
}
