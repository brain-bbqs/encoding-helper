// Tab: Inspect — file overview, video/audio track details, codec explainers, metadata tags.

import { computeBitrateTimeline, isEffectivelyConstant } from "../lib/bitrateTimeline";
import { CONTAINER_PREAMBLE, describeContainer, type ContainerInfo } from "../lib/containerKb";
import { escapeHtml, gridItem, h, teachBox } from "../lib/dom";
import {
  AUDIO_BITRATE_INFO,
  BITRATE_TIMELINE_TEACH,
  chromaSubsamplingExplainer,
  codecExplainer,
  constantBitrateNote,
  containerExplainer,
  contradictedDeclarationNote,
  FASTSTART_EXPLAINER,
  METADATA_TAGS_HOVER_HINT,
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
 * What this particular file's container is, as its own card so it reads as file-specific rather
 * than as part of the general container-vs-codec explainer above it. The heading carries the
 * container name, so loading a different file visibly retitles the card.
 */
function renderContainerDetailSection(info: ContainerInfo | null): HTMLDivElement | null {
  if (!info) return null;
  const sec = h("div", "section");
  sec.append(h("h2", null, `This File's Container: ${info.name}`));
  sec.append(teachBox(containerExplainer(info)));
  return sec;
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

export function codecTeachBox(codecInfo: CodecInfo | null | undefined): HTMLDivElement | null {
  const html = codecExplainer(codecInfo);
  return html ? teachBox(html) : null;
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

function renderOverviewSection(): HTMLDivElement {
  const overview = h("div", "section");
  overview.append(h("h2", null, "Video Container Overview"));
  overview.append(teachBox(CONTAINER_PREAMBLE));
  const fileBitrate = state.duration && state.source ? (state.source.size * 8) / state.duration : null;
  const og = h("div", "grid");
  og.append(
    gridItem("Type", state.format || "–"),
    gridItem("File Size", fmtBytes(state.source?.size)),
    gridItem("Duration", fmtDur(state.duration)),
    gridItem("Overall Bitrate", fmtBits(fileBitrate), { info: OVERALL_BITRATE_INFO }),
    gridItem("MIME Type", state.mimeType || "–", { sm: true, wide: true }),
  );
  overview.append(og);
  const fsBadge = h(
    "span",
    "badge " + (state.faststart ? "good" : "bad"),
    state.faststart ? "✓ Faststart (moov before mdat)" : "✗ Not faststart (moov after mdat)",
  );
  const fsWrap = h("div");
  fsWrap.style.marginTop = "10px";
  fsWrap.append(fsBadge);
  overview.append(fsWrap);
  overview.append(teachBox(FASTSTART_EXPLAINER));
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
  const vtCodecBox = codecTeachBox(vt.codecInfo);
  if (vtCodecBox) sec.append(vtCodecBox);
  sec.append(teachBox(chromaSubsamplingExplainer(vt.codedWidth, vt.codedHeight)));
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
    sec.append(teachBox(constantBitrateNote(declared.avgBitrate)));
    return sec;
  }
  if (!timeline) {
    const g = h("div", "grid");
    g.append(gridItem("Average", fmtBits(vt.bitrate), { info: VIDEO_AVERAGE_INFO }));
    sec.append(g);
    sec.append(teachBox(TOO_FEW_FRAMES_NOTE));
    return sec;
  }

  sec.append(teachBox(BITRATE_TIMELINE_TEACH));
  if (declaresConstant && declared) sec.append(teachBox(contradictedDeclarationNote(declared.avgBitrate, timeline)));
  const g = h("div", "grid");
  g.append(
    gridItem("Average", fmtBits(timeline.averageBitrate), { info: VIDEO_AVERAGE_INFO }),
    gridItem("Peak Window", fmtBits(timeline.peakBitrate)),
    gridItem("Quietest Window", fmtBits(timeline.minBitrate)),
    gridItem("Peak ÷ Average", timeline.peakToAverage.toFixed(2) + "×", { info: PEAK_RATIO_INFO }),
  );
  sec.append(g);
  sec.append(renderBitrateChart(timeline));
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
  const atCodecBox = codecTeachBox(at.codecInfo);
  if (atCodecBox) sec.append(atCodecBox);
  return sec;
}

function renderMetadataTagsSection(): HTMLDivElement | null {
  const flatTags = flattenMetadataTags();
  if (!Object.keys(flatTags).length) return null;

  const sec = h("div", "section");
  sec.append(h("h2", null, "Metadata Tags"));
  sec.append(teachBox(METADATA_TAGS_TEACH + " " + METADATA_TAGS_HOVER_HINT));
  const g = h("div", "grid");
  for (const [k, v] of Object.entries(flatTags)) {
    const value = String(v);
    const info = describeMetadataTag(k);
    g.append(
      gridItem(info ? info.label : k, value, {
        sm: true,
        rawLabel: !info,
        info: metadataTagInfoHtml(k, info, value),
      }),
    );
  }
  sec.append(g);
  return sec;
}

export function renderInspect(panel: HTMLElement): void {
  panel.innerHTML = "";
  if (!state.source) return;

  panel.append(renderOverviewSection());
  const containerSec = renderContainerDetailSection(describeContainer(state.format));
  if (containerSec) panel.append(containerSec);
  const videoSec = renderVideoTrackSection();
  if (videoSec) panel.append(videoSec);
  const bitrateSec = renderBitrateTimelineSection();
  if (bitrateSec) panel.append(bitrateSec);
  const audioSec = renderAudioTrackSection();
  if (audioSec) panel.append(audioSec);
  const tagsSec = renderMetadataTagsSection();
  if (tagsSec) panel.append(tagsSec);
}
