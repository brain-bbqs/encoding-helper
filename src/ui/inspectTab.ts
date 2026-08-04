// Tab: Inspect — file overview, video/audio track details, codec explainers, metadata tags.

import { gridItem, h, teachBox } from "../lib/dom";
import { fmtBits, fmtBytes, fmtDur, fmtRate } from "../lib/format";
import { state } from "../lib/state";
import type { CodecInfo } from "../lib/types";

export function codecTeachBox(codecInfo: CodecInfo | null | undefined): HTMLDivElement | null {
  if (!codecInfo) return null;
  const detailsStr = codecInfo.details.length
    ? "<br>" + codecInfo.details.map((d) => `<b>${d.label}:</b> ${String(d.value)}`).join(" &nbsp;&middot;&nbsp; ")
    : "";
  const yearStr = codecInfo.year ? ` (${codecInfo.year})` : "";
  const nameStr = codecInfo.fullName && codecInfo.fullName !== codecInfo.family ? ` &mdash; ${codecInfo.fullName}` : "";
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
  overview.append(h("h2", null, "Overview"));
  const fileBitrate = state.duration && state.source ? (state.source.size * 8) / state.duration : null;
  const og = h("div", "grid");
  og.append(
    gridItem("Format", state.format || "–"),
    gridItem("File Size", fmtBytes(state.source?.size)),
    gridItem("Duration", fmtDur(state.duration)),
    gridItem("Overall Bitrate", fmtBits(fileBitrate)),
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
  const fitText = evenW && evenH
    ? "<b>already even</b> in both dimensions."
    : `<b>odd</b> in ${!evenW ? "width" : ""}${!evenW && !evenH ? " and " : ""}${!evenH ? "height" : ""} (${width}×${height}) — an encoder must pad or crop before it can write yuv420p.`;
  return (
    `<b>Chroma subsampling (yuv420p)</b> halves the horizontal &amp; vertical resolution of the color ` +
    `channels while keeping full-resolution luma &mdash; the human eye is far less sensitive to color detail ` +
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
  g.append(gridItem("Codec", vt.codecString || vt.codec, { sm: true }), gridItem("Resolution", `${vt.codedWidth}×${vt.codedHeight}`));
  if (vt.displayWidth !== vt.codedWidth || vt.displayHeight !== vt.codedHeight) {
    g.append(gridItem("Display Size", `${vt.displayWidth}×${vt.displayHeight}`));
  }
  g.append(
    gridItem("Frame Rate", vt.packetRate != null ? fmtRate(vt.packetRate) + " fps" : "–"),
    gridItem("Frames", state.frameCount != null ? state.frameCount.toLocaleString() : "–"),
    gridItem("Bitrate", fmtBits(vt.bitrate)),
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
    gridItem("Bitrate", fmtBits(at.bitrate)),
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
  const g = h("div", "grid");
  for (const [k, v] of Object.entries(flatTags)) {
    g.append(gridItem(k, String(v), { sm: true }));
  }
  sec.append(g);
  return sec;
}

export function renderInspect(panel: HTMLElement): void {
  panel.innerHTML = "";
  if (!state.source) return;

  panel.append(renderOverviewSection());
  const videoSec = renderVideoTrackSection();
  if (videoSec) panel.append(videoSec);
  const audioSec = renderAudioTrackSection();
  if (audioSec) panel.append(audioSec);
  const tagsSec = renderMetadataTagsSection();
  if (tagsSec) panel.append(tagsSec);
}
