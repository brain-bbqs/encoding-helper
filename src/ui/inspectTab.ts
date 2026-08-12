// Tab: Inspect — file overview, video/audio track details, codec explainers, metadata tags.

import { computeBitrateTimeline, isEffectivelyConstant, type BitrateTimeline } from "../lib/bitrateTimeline";
import { CONTAINER_PREAMBLE, describeContainer, type ContainerInfo } from "../lib/containerKb";
import { escapeHtml, gridItem, h, teachBox } from "../lib/dom";
import { fmtBits, fmtBytes, fmtDur, fmtRate } from "../lib/format";
import { describeMetadataTag, describeMetadataTagValue, type MetadataTagInfo } from "../lib/metadataTagKb";
import { declaresConstantBitrate } from "../lib/mp4boxParser";
import { state } from "../lib/state";
import type { CodecInfo } from "../lib/types";
import { renderBitrateChart } from "./bitrateChart";

/** Explainer for the Overview's whole-file bitrate, which is not the same as any track's bitrate. */
const OVERALL_BITRATE_INFO =
  "<b>Bitrate</b> is how many bits of file it takes to store one second of playback, so it is the main lever " +
  "on both file size and quality. This one is <b>overall</b> because it is measured across the entire file: " +
  "file size &times; 8 &divide; duration, counting the video track, the audio track, and the container's own " +
  "overhead (headers, the sample index, metadata) together. The per-track bitrates in the Video Track and " +
  "Audio Track sections below cover only their own packets, so they add up to slightly less than this number. " +
  "<p>It is also an average. Unless the encoder was told to hold a constant bitrate, the instantaneous rate " +
  "rises on keyframes and busy scenes and falls on still ones, which is what the <b>Video Bitrate Over " +
  "Time</b> card further down plots.</p>";

const VIDEO_BITRATE_INFO =
  "Average bitrate of the video track alone: the total size of its packets &times; 8 &divide; duration. " +
  "Compare it with <b>Overall Bitrate</b> in the Overview, which also counts the audio track and the " +
  "container overhead. Lowering it (a higher CRF, in the Reencode tab) is what shrinks the file, at the " +
  "cost of visible compression artifacts. The <b>Video Bitrate Over Time</b> card below takes this same " +
  "measurement one short window at a time, so it shows where in the video those bits actually went.";

const BITRATE_TIMELINE_TEACH =
  "This is the <b>Video Track</b> bitrate above, measured one window at a time instead of once across the " +
  "whole track: the bits of every frame presented in that window, divided by the window's length. No " +
  "decoding is involved, since the size and timestamp of every frame is already listed in the container's " +
  "sample table. " +
  "<p>A <b>variable bitrate</b> encoder (which is what a CRF encode is, and what x264 does by default) " +
  "targets a constant <i>quality</i> and lets the rate go wherever that costs. It spends bits on keyframes, " +
  "scene cuts and fast motion and saves them on still shots, so the line moves even though the average is a " +
  "single number. A run well above the average is the part of the video that is expensive to store; a flat " +
  "line means the rate was held constant instead.</p>" +
  "<p>The peak matters separately from the average: a stream is only smooth to play over a network that can " +
  "carry its <i>peaks</i>, not its mean, which is why streaming encoders are usually given a ceiling " +
  "(<code>-maxrate</code>) as well as a target.</p>";

const PEAK_RATIO_INFO =
  "The busiest window's bitrate divided by the track average. <b>1&times;</b> would mean every window " +
  "carried exactly the same bits; the further above 1, the burstier the encode, and the more bandwidth " +
  "headroom playback needs beyond the average.";

/** Explains why the plot is absent: the container says the rate is constant, and it turned out to be. */
function constantBitrateNote(avgBitrate: number): string {
  return (
    `The container declares this track <b>constant bitrate</b>: its <code>btrt</code> box gives the same ` +
    `number, ${escapeHtml(fmtBits(avgBitrate))}, as both the track's average and its maximum rate. Its sample ` +
    `sizes bear that out, every window of playback carrying the same bits as every other, so there is no ` +
    `variation over time for a plot to show. ` +
    `<p>That is the trade a constant bitrate makes: the rate is predictable, which is what fixed-bandwidth ` +
    `delivery and older broadcast pipelines need, but quality is not. A hard scene gets no more bits than ` +
    `its share and visibly degrades, while an easy one cannot give its unused share back. A ` +
    `<b>variable bitrate</b> encode (any CRF encode, including the Reencode tab's) inverts that: it holds ` +
    `quality steady and lets the rate move, which is what this card plots for such a file.</p>`
  );
}

/**
 * Shown when the container declares a constant rate but the sample sizes disagree. Worth saying
 * rather than quietly ignoring, because the declaration is wrong here for a reason worth knowing.
 */
function contradictedDeclarationNote(avgBitrate: number, timeline: BitrateTimeline): string {
  return (
    `<b>Note:</b> this file's <code>btrt</code> box gives ${escapeHtml(fmtBits(avgBitrate))} as both the ` +
    `track's average and its maximum rate, which read literally would mean a constant bitrate. The sample ` +
    `sizes say otherwise: the windows below run from ${escapeHtml(fmtBits(timeline.minBitrate))} to ` +
    `${escapeHtml(fmtBits(timeline.peakBitrate))}. Muxers commonly write the computed average into both ` +
    `fields whatever the encoder was doing (ffmpeg does), so that declaration is not evidence of a constant ` +
    `rate on its own, and the sample table is the measurement that settles it.`
  );
}

const AUDIO_BITRATE_INFO =
  "Average bitrate of the audio track alone. Speech stays clean at low rates, while music needs more; for " +
  "AAC, roughly 128 kbps stereo is transparent for most listeners. This is separate from the video bitrate, " +
  "and both are included in the Overview's <b>Overall Bitrate</b>.";

const METADATA_TAGS_TEACH =
  "<b>Metadata tags</b> are descriptive labels stored beside the media data. They never affect playback or " +
  "quality, and most are written automatically by whatever tool produced the file. The names below are the " +
  "container's own, which is why some look cryptic: MP4 and QuickTime use four-character atom names where a " +
  "leading <code>©</code> (byte <code>0xA9</code>) marks a text atom, so <code>©too</code> is the encoding " +
  "<i>tool</i> and <code>©nam</code> is the title. MP3 uses ID3v2 frame ids such as <code>TIT2</code>, WAVE " +
  "uses RIFF <code>INFO</code> chunk ids such as <code>ISFT</code>, and Ogg, FLAC and Matroska use plain " +
  "words such as <code>ENCODER</code>. Hover the ⓘ on any tag for what it means.";

/**
 * What this particular file's container is, as its own card so it reads as file-specific rather
 * than as part of the general container-vs-codec explainer above it. The heading carries the
 * container name, so loading a different file visibly retitles the card.
 */
function renderContainerDetailSection(info: ContainerInfo | null): HTMLDivElement | null {
  if (!info) return null;
  const sec = h("div", "section");
  sec.append(h("h2", null, `This File's Container: ${info.name}`));
  sec.append(
    teachBox(
      `<b>${info.name}</b> (${info.fullName}; ${info.extensions}). ${info.description}` +
        `<p><b>Video codecs it can carry:</b> ${info.video}<br>` +
        `<b>Audio codecs:</b> ${info.audio}<br>` +
        `<b>Playback:</b> ${info.support}</p>`,
    ),
  );
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
  if (!codecInfo) return null;
  const detailsStr = codecInfo.details.length
    ? "<br>" + codecInfo.details.map((d) => `<b>${d.label}:</b> ${String(d.value)}`).join(" &nbsp;&middot;&nbsp; ")
    : "";
  const yearStr = codecInfo.year ? ` (${codecInfo.year})` : "";
  const nameStr = codecInfo.fullName && codecInfo.fullName !== codecInfo.family ? `, ${codecInfo.fullName}` : "";
  return teachBox(`<b>${codecInfo.family}</b>${yearStr}${nameStr}. ${codecInfo.description}${detailsStr}`);
}

// Matches the original's leniency: `raw` (format-specific tags mediabunny doesn't normalize) is
// merged in wholesale regardless of value type, since gridItem/report rendering stringifies
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
  overview.append(
    teachBox(
      `<b>Faststart</b> means the <code>moov</code> atom (the index describing every sample) sits before ` +
        `<code>mdat</code> (the actual frame bytes). A browser or CDN can then start playback after downloading ` +
        `just the first few KB, instead of the whole file. See the <b>Atom Map</b> tab for the byte-level layout.`,
    ),
  );
  return overview;
}

function chromaSubsamplingExplainer(width: number, height: number): string {
  const evenW = width % 2 === 0;
  const evenH = height % 2 === 0;
  const fitText =
    evenW && evenH
      ? "<b>already even</b> in both dimensions."
      : `<b>odd</b> in ${!evenW ? "width" : ""}${!evenW && !evenH ? " and " : ""}${!evenH ? "height" : ""} (${width}×${height}), so an encoder must pad or crop before it can write yuv420p.`;
  return (
    `<b>Chroma subsampling (yuv420p)</b> halves the horizontal &amp; vertical resolution of the color ` +
    `channels while keeping full-resolution luma. The human eye is far less sensitive to color detail ` +
    `than brightness, so this cuts data ~2&times; with minimal visible loss. It requires <b>even</b> width ` +
    `and height so every 2&times;2 luma block maps to one chroma sample. This file is ${fitText}`
  );
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
  g.append(
    gridItem("Frame Rate", vt.packetRate != null ? fmtRate(vt.packetRate) + " fps" : "–"),
    gridItem("Frames", state.frameCount != null ? state.frameCount.toLocaleString() : "–"),
    gridItem("Bitrate", fmtBits(vt.bitrate), { info: VIDEO_BITRATE_INFO }),
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
 * The video track's bitrate over time — except where the container declares the rate constant and
 * the sample sizes agree, in which case the plot would only ever be a flat line and the declaration
 * is the more useful thing to say. The declaration alone is not enough to suppress the plot: muxers
 * routinely write the track average into `btrt`'s maximum field as well, so taking that at face
 * value would hide the plot for most ordinary variable-bitrate files. Null when there is no video
 * track, or too few frames for windows to have a shape.
 */
export function renderBitrateTimelineSection(): HTMLDivElement | null {
  if (!state.tracks?.some((t) => t.kind === "video")) return null;
  const declared = state.declaredVideoBitrate;
  const declaresConstant = declaresConstantBitrate(declared);
  const measured = computeBitrateTimeline(state.samples, state.duration ?? 0);
  const heldConstant = declaresConstant && (!measured || isEffectivelyConstant(measured));
  const timeline = heldConstant ? null : measured;
  if (!heldConstant && !timeline) return null;

  const sec = h("div", "section");
  sec.append(h("h2", null, "Video Bitrate Over Time"));
  if (!timeline) {
    // `heldConstant` implies a declaration behind it, so `declared` is non-null here.
    sec.append(teachBox(constantBitrateNote(declared?.avgBitrate ?? 0)));
    return sec;
  }

  sec.append(teachBox(BITRATE_TIMELINE_TEACH));
  if (declaresConstant && declared) sec.append(teachBox(contradictedDeclarationNote(declared.avgBitrate, timeline)));
  const g = h("div", "grid");
  g.append(
    gridItem("Average", fmtBits(timeline.averageBitrate)),
    gridItem("Peak Window", fmtBits(timeline.peakBitrate)),
    gridItem("Quietest Window", fmtBits(timeline.minBitrate)),
    gridItem("Peak ÷ Average", timeline.peakToAverage.toFixed(2) + "×", { info: PEAK_RATIO_INFO }),
  );
  sec.append(g);
  sec.append(renderBitrateChart(timeline));
  sec.append(
    h(
      "div",
      "progress-label",
      `One step per ${timeline.binSeconds.toFixed(2)} s window of playback (${timeline.bins.length} in all); ` +
        `hover a column for its rate and frame count. The dashed line is the track average.`,
    ),
  );
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
  sec.append(teachBox(METADATA_TAGS_TEACH));
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
