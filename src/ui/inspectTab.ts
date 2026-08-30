// Tab: Inspect — what the loaded file *is*. File overview, video/audio track details, codec
// explainers and metadata tags here; the atom map (atomsTab.ts) and the GOP/seeking sections
// (seekTab.ts) are appended after them into the same panel by main.ts.

import { computeBitrateTimeline, isEffectivelyConstant } from "../lib/bitrateTimeline";
import { describeContainer } from "../lib/containerKb";
import { escapeHtml, gridItem, h, teachBox } from "../lib/dom";
import { renderEducationalToggle } from "./educationalToggle";
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
import { fmtBits, fmtBytes, fmtDur, fmtRate } from "../lib/format";
import { describeMetadataTag, describeMetadataTagValue, type MetadataTagInfo } from "../lib/metadataTagKb";
import { declaresConstantBitrate } from "../lib/mp4boxParser";
import { state } from "../lib/state";
import type { CodecInfo } from "../lib/types";
import { renderBitrateChart } from "./bitrateChart";

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

export function codecTeachBox(codecInfo: CodecInfo | null | undefined, mark: string): HTMLDivElement | null {
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
        // value — only its presence with a real (possibly object-typed, or empty-string) value does.
        typeof v !== "object" &&
        !(typeof v === "string" && v === "")
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
function overviewTitle(): string {
  return state.format ? `Video Container Overview: ${state.format}` : "Video Container Overview";
}

function renderOverviewSection(): HTMLDivElement {
  const overview = h("div", "section");
  const head = h("div", "section-head");
  head.append(h("h2", null, overviewTitle()), renderEducationalToggle());
  overview.append(head);
  const fileBitrate = state.duration && state.source ? (state.source.size * 8) / state.duration : null;
  const og = h("div", "grid overview-grid");
  og.append(
    gridItem("File Size", fmtBytes(state.source?.size)),
    gridItem("Duration", fmtDur(state.duration)),
    gridItem("Overall Bitrate", fmtBits(fileBitrate), { info: OVERALL_BITRATE_INFO }),
    gridItem("MIME Type", state.mimeType || "–", { sm: true, info: MIME_TYPE_INFO }),
  );
  overview.append(og);
  // The figures first, then what they mean: the container-vs-codec distinction, and what this
  // file's container in particular is (a card of its own until it folded in here).
  overview.append(teachBox(CONTAINER_PREAMBLE, "📦"));
  const containerInfo = describeContainer(state.format);
  // The id mountInspectToc slugifies the atom card's own heading into, which is what its entry in
  // the "On this page" nav links to as well.
  if (containerInfo) {
    overview.append(teachBox(containerExplainer(containerInfo, "#mp4-box-atom-structure"), "🎥"));
  }

  // Metadata Tags folds into this card rather than getting one of its own: it is more of this same
  // file-overview information, not a separate finding.
  const flatTags = flattenMetadataTags();
  if (Object.keys(flatTags).length) {
    overview.append(h("h3", null, "Metadata Tags"));
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
  const vt = state.tracks?.find((t) => t.kind === "video");
  if (!vt || vt.codedWidth == null || vt.codedHeight == null) return null;

  const sec = h("div", "section");
  sec.append(h("h2", null, "Video Track"));
  const g = h("div", "grid");
  g.append(
    gridItem("Codec", vt.codecString || vt.codec, { sm: true }),
    gridItem("Resolution", `${vt.codedWidth}×${vt.codedHeight}`),
  );
  if (vt.displayWidth !== vt.codedWidth || vt.displayHeight !== vt.codedHeight) {
    g.append(gridItem("Display Size", `${vt.displayWidth}×${vt.displayHeight}`));
  }
  // No Bitrate item: the track's average heads the Video Bitrate Over Time card below, alongside
  // the peak and the spread the single number cannot show.
  g.append(
    gridItem("Frame Rate", vt.packetRate != null ? fmtRate(vt.packetRate) + " fps" : "–"),
    gridItem("Frames", state.frameCount != null ? state.frameCount.toLocaleString() : "–"),
  );
  if (vt.rotation) g.append(gridItem("Rotation", vt.rotation + "°"));
  if (vt.codecInfo) vt.codecInfo.details.forEach((d) => g.append(gridItem(d.label, d.value)));
  // Read out of the file rather than assumed, so it sits with the other figures; the teach box
  // below explains what it means (and says nothing about this file when it states nothing).
  if (vt.chroma) g.append(gridItem("Chroma", vt.chroma, { sm: true }));
  if (vt.colorSpace) {
    g.append(
      gridItem(
        "Color Space",
        [vt.colorSpace.primaries, vt.colorSpace.transfer, vt.colorSpace.matrix].filter(Boolean).join(" / ") || "–",
        { sm: true },
      ),
    );
  }
  if (vt.hdr) g.append(gridItem("HDR", "Yes"));
  sec.append(g);
  const vtCodecBox = codecTeachBox(vt.codecInfo, "🎞️");
  if (vtCodecBox) sec.append(vtCodecBox);
  sec.append(teachBox(chromaSubsamplingExplainer(vt.codedWidth, vt.codedHeight, vt.chroma ?? null), "🎨"));
  return sec;
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
  const vt = state.tracks?.find((t) => t.kind === "video");
  if (!vt) return null;
  const declared = state.declaredVideoBitrate;
  const declaresConstant = declaresConstantBitrate(declared);
  const timeline = computeBitrateTimeline(state.samples, state.duration ?? 0);

  const sec = h("div", "section");
  sec.append(h("h2", null, "Video Bitrate Over Time"));
  if (declaresConstant && declared && (!timeline || isEffectivelyConstant(timeline))) {
    sec.append(teachBox(constantBitrateNote(declared.avgBitrate), "📈"));
    return sec;
  }
  if (!timeline) {
    const g = h("div", "grid");
    g.append(gridItem("Average", fmtBits(vt.bitrate), { info: VIDEO_AVERAGE_INFO }));
    sec.append(g);
    sec.append(teachBox(TOO_FEW_FRAMES_NOTE, "📈"));
    return sec;
  }

  const g = h("div", "grid");
  g.append(
    gridItem("Average", fmtBits(timeline.averageBitrate), { info: VIDEO_AVERAGE_INFO }),
    gridItem("Peak Window", fmtBits(timeline.peakBitrate)),
    gridItem("Quietest Window", fmtBits(timeline.minBitrate)),
    gridItem("Peak ÷ Average", timeline.peakToAverage.toFixed(2) + "×", { info: PEAK_RATIO_INFO }),
  );
  sec.append(g);
  sec.append(renderBitrateChart(timeline));
  sec.append(teachBox(BITRATE_TIMELINE_TEACH, "📈"));
  if (declaresConstant && declared) {
    sec.append(teachBox(contradictedDeclarationNote(declared.avgBitrate, timeline), "📈"));
  }
  return sec;
}

function renderAudioTrackSection(): HTMLDivElement | null {
  const at = state.tracks?.find((t) => t.kind === "audio");
  if (!at) return null;

  const sec = h("div", "section");
  sec.append(h("h2", null, "Audio Track"));
  const g = h("div", "grid");
  g.append(
    gridItem("Codec", at.codecString || at.codec, { sm: true }),
    gridItem("Sample Rate", at.sampleRate ? at.sampleRate.toLocaleString() + " Hz" : "–"),
    gridItem("Channels", at.channels != null ? at.channels : "–"),
    gridItem("Bitrate", fmtBits(at.bitrate), { info: AUDIO_BITRATE_INFO }),
  );
  if (at.codecInfo) at.codecInfo.details.forEach((d) => g.append(gridItem(d.label, d.value)));
  sec.append(g);
  const atCodecBox = codecTeachBox(at.codecInfo, "🔊");
  if (atCodecBox) sec.append(atCodecBox);
  return sec;
}

/**
 * The file-overview cards: container, this file's container detail, and the video track. Split from
 * {@link renderInspectTail} so main.ts can put the atom map (its own module) between this and the
 * bitrate/audio cards that follow it, without Inspect's renderer knowing the atom map exists.
 */
export function renderInspectHead(panel: HTMLElement): void {
  if (!state.source) return;

  panel.append(renderOverviewSection());
  const videoSec = renderVideoTrackSection();
  if (videoSec) panel.append(videoSec);
}

/** The bitrate and audio cards, after the atom map. See {@link renderInspectHead}. */
export function renderInspectTail(panel: HTMLElement): void {
  if (!state.source) return;

  const bitrateSec = renderBitrateTimelineSection();
  if (bitrateSec) panel.append(bitrateSec);
  const audioSec = renderAudioTrackSection();
  if (audioSec) panel.append(audioSec);
}
