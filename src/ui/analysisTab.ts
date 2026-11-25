// Full Analysis: everything the other tabs worked out about the loaded file, gathered into one
// document.
//
// The tabs each answer their own question and drop the answer on the floor when you leave them;
// this is where those answers are collected, in reading order (results and plots only, without the
// "teach" prose the interactive tabs carry, whatever the Educational switch says: a document meant
// to be saved, printed or handed on states what the file is without re-teaching how to read it).
// What the panel shows is the document itself, rendered in an iframe from the same HTML the
// Download button writes and the print dialog prints, so there is no "preview" that can disagree
// with the file.
//
// State-gathering lives here; how a section is drawn lives in lib/analysisDoc.ts. Sections are
// rebuilt on every visit to the tab, since the seeking test and the two encode tabs add to them.

import { fmtBytes } from "@brain-bbqs/utils";
import { buildAnalysisDocument, renderSectionsToMarkdown, type DocumentMeta } from "../lib/analysisDoc";
import { computeBitrateTimeline, isEffectivelyConstant } from "../lib/bitrateTimeline";
import { buildFfmpegArgs, formatCliCommand, isDownscale, scalePercent } from "../lib/cliCommand";
import { button, copyToClipboard, h } from "@brain-bbqs/ui";
import { section, teachBox } from "../lib/dom";
import {
  ANALYSIS_PANEL_INTRO,
  ATOM_MAP_DOC_CAPTION,
  GOP_HISTOGRAM_CAPTION,
  SEEK_SCATTER_CAPTION,
} from "../lib/explainers";
import {
  describeColorSpace,
  describeFrameCount,
  describeFrameRate,
  fmtBits,
  fmtDur,
  fmtMs,
  fmtRate,
  fmtSizeChangePct,
} from "../lib/format";
import { describeMetadataTag } from "../lib/metadataTagKb";
import { declaresConstantBitrate } from "../lib/mp4boxParser";
import {
  bestReductionCell,
  cliSettings,
  comboCrf,
  comboKey,
  describeQuality,
  describeResolutionChange,
  matrixAxes,
} from "../lib/qualityMatrix";
import { baseNameOf, downloadBlob } from "../lib/save";
import { describeAvgGop, gopStats, SEEK_TABLE_HEADERS, seekResultRow, seekSummary } from "../lib/seekReport";
import { currentSizeEstimate, describeSavings, fmtChangeFactor, fmtSignedChange } from "../lib/sizeEstimate";
import { audioTrackInfo, cli, currentVideoInfo, encodeTest, state, videoTrackInfo } from "../lib/state";
import type { AnalysisBlock, AnalysisSection, TrackInfo } from "../lib/types";
import { renderStaticAtomMap } from "./atomsTab";
import { describeSampledStretches } from "./abPanel";
import { renderBitrateChart } from "./bitrateChart";
import { flattenMetadataTags, overallBitrate, overviewTitle } from "./inspectTab";
import { renderGopHistogram, renderSeekScatter } from "./seekTab";

/** Printed in the document so a copy saved to disk still says where it came from. */
const APP_URL = "https://encoding-helper.brain-bbqs.org";

/**
 * The document's content width (its 860px column less the 44px of padding on either side; see
 * ANALYSIS_DOC_CSS). The atom map needs it up front: on the page a ResizeObserver decides which
 * block labels fit, but the document runs no script, so that has to be settled while it is built.
 */
const DOCUMENT_WIDTH_PX = 772;

/** The headline strip under the document title: what the file is, in one line. */
function headlineFacts(): [string, string][] {
  const vt = videoTrackInfo();
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
  const fileBitrate = overallBitrate();
  return {
    title: overviewTitle(),
    blocks: [
      {
        kind: "kv",
        items: [
          ["File Size", fmtBytes(state.source?.size)],
          ["Duration", fmtDur(state.duration)],
          ["Overall Bitrate", fmtBits(fileBitrate)],
          ["MIME Type", state.mimeType || "–"],
        ],
      },
    ],
  };
}

function videoTrackSection(vt: TrackInfo): AnalysisSection {
  // No Bitrate item: the track average heads the bitrate section below, with the plot the single
  // number cannot draw, the same split the Inspect tab makes.
  const items: [string, string | number][] = [
    ["Codec", vt.codecString || vt.codec],
    ["Resolution", `${vt.codedWidth ?? "?"}×${vt.codedHeight ?? "?"}`],
  ];
  if (vt.displayWidth !== vt.codedWidth || vt.displayHeight !== vt.codedHeight) {
    items.push(["Display Size", `${vt.displayWidth ?? "?"}×${vt.displayHeight ?? "?"}`]);
  }
  items.push(["Frame Rate", describeFrameRate(vt.packetRate)], ["Frames", describeFrameCount(state.frameCount)]);
  if (vt.rotation) items.push(["Rotation", vt.rotation + "°"]);
  if (vt.codecInfo) vt.codecInfo.details.forEach((d) => items.push([d.label, d.value]));
  if (vt.colorSpace) items.push(["Color Space", describeColorSpace(vt.colorSpace)]);
  if (vt.hdr) items.push(["HDR", "Yes"]);
  return { title: "Video Track", blocks: [{ kind: "kv", items }] };
}

/** Mirrors the Inspect tab's card, including the two cases where there is no plot to draw. */
function bitrateSection(vt: TrackInfo): AnalysisSection {
  const declared = state.declaredVideoBitrate;
  const declaresConstant = declaresConstantBitrate(declared);
  const timeline = computeBitrateTimeline(state.samples, state.duration ?? 0);

  if (declaresConstant && declared && (!timeline || isEffectivelyConstant(timeline))) {
    return {
      title: "Video Bitrate Over Time",
      blocks: [{ kind: "kv", items: [["Declared Bitrate", fmtBits(declared.avgBitrate)]] }],
    };
  }
  if (!timeline) {
    return {
      title: "Video Bitrate Over Time",
      blocks: [{ kind: "kv", items: [["Average", fmtBits(vt.bitrate)]] }],
    };
  }

  return {
    title: "Video Bitrate Over Time",
    blocks: [
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
    ],
  };
}

function audioTrackSection(at: TrackInfo): AnalysisSection {
  const items: [string, string | number][] = [
    ["Codec", at.codecString || at.codec],
    ["Sample Rate", at.sampleRate ? at.sampleRate.toLocaleString() + " Hz" : "–"],
    ["Channels", at.channels != null ? at.channels : "–"],
    ["Bitrate", fmtBits(at.bitrate)],
  ];
  if (at.codecInfo) at.codecInfo.details.forEach((d) => items.push([d.label, d.value]));
  return { title: "Audio Track", blocks: [{ kind: "kv", items }] };
}

function metadataTagsSection(): AnalysisSection | null {
  const flatTags = flattenMetadataTags();
  if (!Object.keys(flatTags).length) return null;
  return {
    title: "Metadata Tags",
    blocks: [
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
      {
        kind: "badge",
        tone: state.faststart ? "good" : "bad",
        text: state.faststart ? "✓ Fast start" : "✗ Not fast start",
      },
      { kind: "figure", caption: ATOM_MAP_DOC_CAPTION, element: map },
    ],
  };
}

function gopSection(): AnalysisSection | null {
  if (!state.samples.length) return null;
  const { gop, avgGop, fps } = gopStats();
  const blocks: AnalysisBlock[] = [
    {
      kind: "kv",
      items: [
        ["Total Frames", state.samples.length.toLocaleString()],
        ["Keyframes", state.keyframeDecodeIndices.length.toLocaleString()],
        ["Avg GOP", describeAvgGop(avgGop, fps)],
        ["Min / Max GOP", gop.length ? `${Math.min(...gop)} / ${Math.max(...gop)} frames` : "–"],
      ],
    },
    {
      kind: "badge",
      tone: state.hasBFrames ? "info" : "good",
      text: state.hasBFrames ? "Uses B-frames (cts ≠ dts)" : "No B-frames",
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
  const { avgDist, avgDecode, maxDecode } = seekSummary(results);
  const blocks: AnalysisBlock[] = [
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
    headers: SEEK_TABLE_HEADERS,
    rows: results.map(seekResultRow),
  });
  return { title: "Empirical Seeking Test", blocks };
}

function cliCommandSection(): AnalysisSection | null {
  const info = currentVideoInfo();
  if (!info) return null;
  return {
    title: "Reencode CLI Command",
    blocks: [{ kind: "code", lang: "bash", content: formatCliCommand(buildFfmpegArgs(cli, info)) }],
  };
}

function compareSection(): AnalysisSection | null {
  if (!encodeTest.originalSink || !encodeTest.abSegments.length) return null;
  // The settings the loaded encode was made with: after a matrix sweep that is the winning square's,
  // which is not what the command builder says.
  const settings = encodeTest.activeCombo ?? cliSettings(cli);
  const items: [string, string | number][] = [
    ["Segment", describeSampledStretches()],
    ["Quality", describeQuality(settings)],
    ["Preset", settings.preset],
    ["Encoded Segment Size", fmtBytes(encodeTest.encodedSize)],
  ];
  // Only when it is not the source's: a resolution row reading "100%" on every document would say
  // nothing, but a comparison made at half resolution is not comparable to one that was not.
  const vt = videoTrackInfo();
  if (isDownscale(settings.scale) && vt?.codedWidth && vt.codedHeight) {
    items.splice(3, 0, ["Resolution", describeResolutionChange(vt.codedWidth, vt.codedHeight, settings)]);
  }

  const est = currentSizeEstimate();
  if (est) {
    items.push(
      ["Original Segment Size", fmtBytes(est.originalSegmentBytes)],
      ["Segment Change", `${fmtSignedChange(est)} (${fmtChangeFactor(est.ratio)})`],
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
  }

  return { title: "Side-by-Side (A/B) Result", blocks: [{ kind: "kv", items }] };
}

/** The last matrix sweep as a table, so the document carries the grid the winner was picked out of. */
function matrixSection(): AnalysisSection | null {
  const cells = encodeTest.matrix.cells.filter((c) => c.status === "done" && c.bytes != null);
  if (!cells.length) return null;
  const best = bestReductionCell(encodeTest.matrix.cells);
  const { qualities, presets, scales, scalers } = matrixAxes(cells);
  const byKey = new Map(cells.map((c) => [c.combo.key, c]));
  // A document has no row groups to nest resolution into, so when the sweep covered more than one
  // it becomes a leading column instead: the same information, in the shape a table can carry.
  const swept = scales.length > 1 || scalers.length > 1;
  const rows: string[][] = [];
  for (const scale of scales) {
    for (const scaler of isDownscale(scale) ? scalers : scalers.slice(0, 1)) {
      for (const quality of qualities) {
        const head = [`${quality} (CRF ${comboCrf(quality)})`];
        if (swept) head.unshift(`${scalePercent(scale)}${isDownscale(scale) ? ` ${scaler}` : ""}`);
        rows.push([
          ...head,
          ...presets.map((preset) => {
            const cell = byKey.get(comboKey(quality, preset, scale, scaler));
            if (!cell) return "–";
            const mark = best && cell.combo.key === best.combo.key ? " ★" : "";
            const took = cell.elapsedMs != null ? ` / ${(cell.elapsedMs / 1000).toFixed(1)}s` : "";
            return `${fmtBytes(cell.bytes)}${took}${mark}`;
          }),
        ]);
      }
    }
  }
  return {
    title: "Compare Quality Matrix",
    blocks: [{ kind: "table", headers: [...(swept ? ["Output"] : []), "Quality", ...presets], rows }],
  };
}

function reencodeSection(): AnalysisSection | null {
  const result = state.reencodeResult;
  if (!result) return null;
  return {
    title: "In-Browser Reencode Result",
    blocks: [
      {
        kind: "kv",
        items: [
          ["Original Size", fmtBytes(result.originalSize)],
          ["Encoded Size", fmtBytes(result.encodedSize)],
          ["Change", fmtSizeChangePct(result.originalSize, result.encodedSize)],
        ],
      },
    ],
  };
}

function buildAnalysisSections(): AnalysisSection[] {
  const vt = videoTrackInfo();
  const at = audioTrackInfo();
  // Same reading order as the Inspect tab: the file overview and its tags, the video track, the box
  // layout, the keyframe structure that layout decides, the bitrate over time, then audio last.
  const sections: (AnalysisSection | null)[] = [
    overviewSection(),
    metadataTagsSection(),
    vt ? videoTrackSection(vt) : null,
    atomMapSection(),
    gopSection(),
    seekingSection(),
    vt ? bitrateSection(vt) : null,
    at ? audioTrackSection(at) : null,
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
  const baseName = baseNameOf(state.source.name);

  const sec = section("Full Analysis");
  sec.append(teachBox(ANALYSIS_PANEL_INTRO, "📄"));

  const actions = h("div", "load-actions");
  const pdfBtn = button("btn", "Save as PDF");
  const htmlBtn = button("btn sec", "Download HTML");
  const mdBtn = button("btn sec", "Download Markdown");
  const copyBtn = button("btn sec", "Copy Markdown");
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
