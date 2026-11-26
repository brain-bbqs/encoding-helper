// The Inspect tab: what the loaded file *is*. File overview, video/audio track details, codec
// explainers and metadata tags here; main.ts appends the atom map (atomsTab.ts) and the GOP/seeking
// section (seekTab.ts) into the same panel, between the head and tail cards.

import { fmtBytes } from "@brain-bbqs/utils";
import { slugify } from "../lib/analysisDoc";
import { computeBitrateTimeline, isEffectivelyConstant, type BitrateTimeline } from "../lib/bitrateTimeline";
import { describeContainer } from "../lib/containerKb";
import { escapeHtml, h } from "@brain-bbqs/ui";
import { factGrid, gridItem, section, teachBox } from "../lib/dom";
import {
  AUDIO_BITRATE_INFO,
  BITRATE_TIMELINE_TEACH,
  chromaSubsamplingExplainer,
  codecExplainer,
  constantBitrateNote,
  CONTAINER_PREAMBLE,
  containerExplainer,
  contradictedDeclarationNote,
  METADATA_TAGS_HOVER_HINT,
  MIME_TYPE_INFO,
  METADATA_TAGS_TEACH,
  OVERALL_BITRATE_INFO,
  PEAK_RATIO_INFO,
  TOO_FEW_FRAMES_NOTE,
  VIDEO_AVERAGE_INFO,
} from "../lib/explainers";
import { describeColorSpace, describeFrameCount, describeFrameRate, fmtBits, fmtDur, NO_VALUE } from "../lib/format";
import { describeMetadataTag, describeMetadataTagValue, type MetadataTagInfo } from "../lib/metadataTagKb";
import { declaresConstantBitrate } from "../lib/mp4boxParser";
import { audioTrackInfo, state, videoTrackInfo } from "../lib/state";
import type { CodecInfo, DeclaredBitrate, FactRow, TrackInfo } from "../lib/types";
import { ATOM_MAP_TITLE } from "./atomsTab";
import { renderBitrateChart } from "./bitrateChart";

// The card titles the Full Analysis document heads its matching sections with. They live here, with
// the cards, rather than in analysisTab.ts, which imports this module.
export const METADATA_TAGS_TITLE = "Metadata Tags";
export const VIDEO_TRACK_TITLE = "Video Track";
export const BITRATE_TITLE = "Video Bitrate Over Time";
export const AUDIO_TRACK_TITLE = "Audio Track";

/** How a track's codec is named: the full codec string where the file gives one, else the short id. */
export function codecLabel(track: TrackInfo): string {
  return track.codecString || track.codec;
}

/**
 * Builds the popover for one metadata tag. The tag name comes from the file, so it is escaped
 * before being interpolated; everything else is knowledge-base text.
 */
function metadataTagInfoHtml(key: string, info: MetadataTagInfo | null, value: string): string | null {
  const valueHint = describeMetadataTagValue(value);
  if (!info && !valueHint) return null;
  const head = info
    ? `<b>${info.label}</b> <code>${escapeHtml(key)}</code><br><span class="info-pop-meta">${info.origin}</span>` +
      `<p>${info.description}</p>`
    : "";
  return head + (valueHint ? `<p>${valueHint}</p>` : "");
}

function codecTeachBox(codecInfo: CodecInfo | null, mark: string): HTMLDivElement | null {
  const html = codecExplainer(codecInfo);
  return html ? teachBox(html, mark) : null;
}

// Matches the original's leniency: `raw` (format-specific tags mediabunny doesn't normalize) is
// merged in wholesale regardless of value type, since gridItem/document rendering stringifies
// whatever it's given; every other top-level tag is filtered to plain scalars only.
export function flattenMetadataTags(): Record<string, unknown> {
  const flatTags: Record<string, unknown> = {};
  if (state.tags) {
    for (const [k, v] of Object.entries(state.tags)) {
      if (k === "raw" && v && typeof v === "object") {
        Object.assign(flatTags, v);
      } else if (
        // Object.entries() only yields entries for keys actually present on the object, so an
        // optional MetadataTags field being absent never surfaces here as an explicit undefined
        // value; only its presence with a real (possibly object-typed, or empty-string) value does.
        typeof v !== "object" &&
        v !== ""
      ) {
        flatTags[k] = v;
      }
    }
  }
  return flatTags;
}

/**
 * The overview card's heading, naming the container it is about. The name used to head a card of
 * its own; it stays in the heading rather than in the grid so it is still there when the educational
 * text that also names it is switched off, and so loading another file visibly retitles the card.
 */
export function overviewTitle(): string {
  return state.format ? `Video Container Overview: ${state.format}` : "Video Container Overview";
}

/** The whole file's bitrate, every byte of it over its running time, or null before a file is open. */
export function overallBitrate(): number | null {
  return state.duration && state.source ? (state.source.size * 8) / state.duration : null;
}

/** The overview card's figures, which the Full Analysis document states as well. */
export function overviewRows(): FactRow[] {
  return [
    { label: "File Size", value: fmtBytes(state.source?.size) },
    { label: "Duration", value: fmtDur(state.duration) },
    { label: "Overall Bitrate", value: fmtBits(overallBitrate()), info: OVERALL_BITRATE_INFO },
    { label: "MIME Type", value: state.mimeType || NO_VALUE, sm: true, info: MIME_TYPE_INFO },
  ];
}

function renderOverviewSection(): HTMLDivElement {
  const overview = section(overviewTitle());
  overview.append(factGrid(overviewRows()));
  // The figures first, then what they mean: the container-vs-codec distinction, and what this
  // file's container in particular is (a card of its own until it folded in here).
  overview.append(teachBox(CONTAINER_PREAMBLE, "📦"));
  const containerInfo = describeContainer(state.format);
  // The id mountInspectToc slugifies the atom card's own heading into, which is what its entry in
  // the "On this page" nav links to as well.
  if (containerInfo) {
    overview.append(teachBox(containerExplainer(containerInfo, "#" + slugify(ATOM_MAP_TITLE)), "🎥"));
  }

  // Metadata Tags folds into this card rather than getting one of its own: it is more of this same
  // file-overview information, not a separate finding.
  const flatTags = flattenMetadataTags();
  if (Object.keys(flatTags).length) {
    overview.append(h("h3", null, METADATA_TAGS_TITLE));
    const tagsGrid = h("div", "grid");
    for (const [k, v] of Object.entries(flatTags)) {
      const value = String(v);
      const info = describeMetadataTag(k);
      tagsGrid.append(
        gridItem(info ? info.label : k, value, {
          sm: true,
          rawLabel: !info,
          info: metadataTagInfoHtml(k, info, value),
        }),
      );
    }
    overview.append(tagsGrid);
    overview.append(teachBox(METADATA_TAGS_TEACH + " " + METADATA_TAGS_HOVER_HINT, "🏷️"));
  }
  return overview;
}

function renderVideoTrackSection(): HTMLDivElement | null {
  const vt = videoTrackInfo();
  if (!vt || vt.codedWidth == null || vt.codedHeight == null) return null;

  const sec = section(VIDEO_TRACK_TITLE);
  const g = h("div", "grid");
  g.append(
    gridItem("Codec", codecLabel(vt), { sm: true }),
    gridItem("Resolution", `${vt.codedWidth}×${vt.codedHeight}`),
  );
  if (vt.displayWidth !== vt.codedWidth || vt.displayHeight !== vt.codedHeight) {
    g.append(gridItem("Display Size", `${vt.displayWidth}×${vt.displayHeight}`));
  }
  // No Bitrate item: the track's average heads the Video Bitrate Over Time card below, alongside
  // the peak and the spread the single number cannot show.
  g.append(
    gridItem("Frame Rate", describeFrameRate(vt.packetRate)),
    gridItem("Frames", describeFrameCount(state.frameCount)),
  );
  if (vt.rotation) g.append(gridItem("Rotation", vt.rotation + "°"));
  if (vt.codecInfo) vt.codecInfo.details.forEach((d) => g.append(gridItem(d.label, d.value)));
  // Read out of the file rather than assumed, so it sits with the other figures; the teach box
  // below explains what it means (and says nothing about this file when it states nothing).
  if (vt.chroma) g.append(gridItem("Chroma", vt.chroma, { sm: true }));
  if (vt.colorSpace) {
    g.append(gridItem("Color Space", describeColorSpace(vt.colorSpace), { sm: true }));
  }
  if (vt.hdr) g.append(gridItem("HDR", "Yes"));
  sec.append(g);
  const vtCodecBox = codecTeachBox(vt.codecInfo, "🎞️");
  if (vtCodecBox) sec.append(vtCodecBox);
  sec.append(teachBox(chromaSubsamplingExplainer(vt.codedWidth, vt.codedHeight, vt.chroma ?? null), "🎨"));
  return sec;
}

/**
 * Which of its three shapes the bitrate card takes, for the page and the document alike: the rate the
 * container declares constant, where the samples bear it out or are too few to say otherwise; the
 * track's average alone, where there are too few frames to bin; or the measured windows and their
 * plot.
 */
export type BitrateShape =
  | { kind: "declared"; declared: DeclaredBitrate }
  | { kind: "average" }
  | { kind: "timeline"; timeline: BitrateTimeline };

export function bitrateShape(): BitrateShape {
  const declared = state.declaredVideoBitrate;
  const timeline = computeBitrateTimeline(state.samples, state.duration ?? 0);
  if (declaresConstantBitrate(declared) && declared && (!timeline || isEffectivelyConstant(timeline))) {
    return { kind: "declared", declared };
  }
  if (!timeline) return { kind: "average" };
  return { kind: "timeline", timeline };
}

/** The one figure the card has when there are too few frames to bin: the track's own average. */
export function trackAverageRow(vt: TrackInfo): FactRow {
  return { label: "Average", value: fmtBits(vt.bitrate), info: VIDEO_AVERAGE_INFO };
}

/** The figures over the plot: the average, the busiest and quietest windows, and how far apart. */
export function bitrateTimelineRows(timeline: BitrateTimeline): FactRow[] {
  return [
    { label: "Average", value: fmtBits(timeline.averageBitrate), info: VIDEO_AVERAGE_INFO },
    { label: "Peak Window", value: fmtBits(timeline.peakBitrate) },
    { label: "Quietest Window", value: fmtBits(timeline.minBitrate) },
    { label: "Peak ÷ Average", value: timeline.peakToAverage.toFixed(2) + "×", info: PEAK_RATIO_INFO },
  ];
}

/**
 * The video track's bitrate over time, and the card carrying the track's average now that the Video
 * Track card above no longer repeats it. The plot is dropped where the container declares the rate
 * constant and the sample sizes agree, since it would only ever be a flat line and the declaration
 * is the more useful thing to say. The declaration alone is not enough to drop it: muxers routinely
 * write the track average into `btrt`'s maximum field as well, so taking that at face value would
 * hide the plot for most ordinary variable-bitrate files. Null only when there is no video track.
 */
export function renderBitrateTimelineSection(): HTMLDivElement | null {
  const vt = videoTrackInfo();
  if (!vt) return null;
  const shape = bitrateShape();

  const sec = section(BITRATE_TITLE);
  if (shape.kind === "declared") {
    sec.append(teachBox(constantBitrateNote(shape.declared.avgBitrate), "📈"));
    return sec;
  }
  if (shape.kind === "average") {
    sec.append(factGrid([trackAverageRow(vt)]));
    sec.append(teachBox(TOO_FEW_FRAMES_NOTE, "📈"));
    return sec;
  }

  const { timeline } = shape;
  sec.append(factGrid(bitrateTimelineRows(timeline)));
  sec.append(renderBitrateChart(timeline));
  sec.append(teachBox(BITRATE_TIMELINE_TEACH, "📈"));
  // Only the page says so: a declaration of constant bitrate that the samples contradict.
  const declared = state.declaredVideoBitrate;
  if (declaresConstantBitrate(declared) && declared) {
    sec.append(teachBox(contradictedDeclarationNote(declared.avgBitrate, timeline), "📈"));
  }
  return sec;
}

/** The audio track's figures and the details its codec string spells out. */
export function audioTrackRows(at: TrackInfo): FactRow[] {
  const rows: FactRow[] = [
    { label: "Codec", value: codecLabel(at), sm: true },
    { label: "Sample Rate", value: at.sampleRate ? at.sampleRate.toLocaleString() + " Hz" : NO_VALUE },
    { label: "Channels", value: at.channels != null ? at.channels : NO_VALUE },
    { label: "Bitrate", value: fmtBits(at.bitrate), info: AUDIO_BITRATE_INFO },
  ];
  if (at.codecInfo) at.codecInfo.details.forEach((d) => rows.push({ label: d.label, value: d.value }));
  return rows;
}

function renderAudioTrackSection(): HTMLDivElement | null {
  const at = audioTrackInfo();
  if (!at) return null;

  const sec = section(AUDIO_TRACK_TITLE);
  sec.append(factGrid(audioTrackRows(at)));
  const atCodecBox = codecTeachBox(at.codecInfo, "🔊");
  if (atCodecBox) sec.append(atCodecBox);
  return sec;
}

/**
 * The file-overview cards: the container and the video track. Split from {@link renderInspectTail}
 * so main.ts can put the atom map and the GOP card (their own modules) between this and the
 * bitrate/audio cards that follow, without Inspect's renderer knowing either exists.
 */
export function renderInspectHead(panel: HTMLElement): void {
  if (!state.source) return;

  panel.append(renderOverviewSection());
  const videoSec = renderVideoTrackSection();
  if (videoSec) panel.append(videoSec);
}

/** The bitrate and audio cards, last on the panel. See {@link renderInspectHead}. */
export function renderInspectTail(panel: HTMLElement): void {
  if (!state.source) return;

  const bitrateSec = renderBitrateTimelineSection();
  if (bitrateSec) panel.append(bitrateSec);
  const audioSec = renderAudioTrackSection();
  if (audioSec) panel.append(audioSec);
}
