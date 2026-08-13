// mediabunny metadata extraction: flattens an mediabunny Input's format/tracks/tags into the
// TrackInfo[] shape the Inspect tab and the Full Analysis document render.

import type { Input, InputTrack } from "mediabunny";
import { describeCodec } from "./codecKb";
import { ensureMediabunny } from "./mediabunny";
import type { MediabunnyMetadata, TrackInfo } from "./types";

async function describeTrack(t: InputTrack): Promise<TrackInfo> {
  const [codecString, stats] = await Promise.all([
    t.getCodecParameterString().catch(() => null),
    t.computePacketStats().catch(() => null),
  ]);
  const d: TrackInfo = {
    kind: t.isVideoTrack() ? "video" : t.isAudioTrack() ? "audio" : "other",
    codec: String(t.codec || "unknown"),
    codecString,
    codecInfo: describeCodec(t.codec, codecString),
    packetCount: stats ? stats.packetCount : null,
    packetRate: stats ? stats.averagePacketRate : null,
    bitrate: stats ? stats.averageBitrate : null,
  };
  if (t.isVideoTrack()) {
    const [color, hdr] = await Promise.all([
      t.getColorSpace().catch(() => null),
      t.hasHighDynamicRange().catch(() => false),
    ]);
    d.codedWidth = t.codedWidth;
    d.codedHeight = t.codedHeight;
    d.displayWidth = t.displayWidth;
    d.displayHeight = t.displayHeight;
    d.rotation = t.rotation;
    d.colorSpace = color;
    d.hdr = hdr;
  }
  if (t.isAudioTrack()) {
    d.sampleRate = t.sampleRate;
    d.channels = t.numberOfChannels;
  }
  return d;
}

export async function loadMediabunnyMetadata(input: Input): Promise<MediabunnyMetadata> {
  await ensureMediabunny();
  const [format, mimeType, duration, tracks, tags] = await Promise.all([
    input.getFormat(),
    input.getMimeType(),
    input.computeDuration(),
    input.getTracks(),
    input.getMetadataTags(),
  ]);
  const videoTrack = tracks.find((t) => t.isVideoTrack()) || null;
  const audioTrack = tracks.find((t) => t.isAudioTrack()) || null;

  const result: MediabunnyMetadata = {
    format: format.name,
    mimeType,
    duration,
    tags,
    tracks: [],
    videoTrack,
    audioTrack,
    fps: null,
  };

  for (const t of tracks) {
    const d = await describeTrack(t);
    if (d.kind === "video") result.fps = d.packetRate;
    result.tracks.push(d);
  }
  return result;
}
