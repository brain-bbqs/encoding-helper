// Shared type definitions used across lib/ and ui/ modules.

import type { Input, InputAudioTrack, InputVideoTrack, MetadataTags } from "mediabunny";
import type { ChunkedSource } from "./chunkedSource";

/** One row in a codec's parsed detail list (e.g. "Profile: High", "Level: 4.0"). */
export interface CodecDetail {
  label: string;
  value: string | number;
}

/** Human-readable explainer for a codec, resolved from CODEC_KB + a parsed RFC 6381 codec string. */
export interface CodecInfo {
  family: string;
  fullName: string;
  year: number | null;
  description: string;
  details: CodecDetail[];
}

/** Per-track metadata as surfaced by mediabunny, flattened into a single plain object. */
export interface TrackInfo {
  kind: "video" | "audio" | "other";
  codec: string;
  codecString: string | null;
  codecInfo: CodecInfo | null;
  packetCount: number | null;
  packetRate: number | null;
  bitrate: number | null;
  // Video-only fields.
  codedWidth?: number;
  codedHeight?: number;
  displayWidth?: number;
  displayHeight?: number;
  rotation?: number;
  colorSpace?: VideoColorSpaceInit | null;
  hdr?: boolean;
  // Audio-only fields.
  sampleRate?: number;
  channels?: number;
}

/** Result of loadMediabunnyMetadata(): everything the app reads off an mediabunny Input. */
export interface MediabunnyMetadata {
  format: string;
  mimeType: string;
  duration: number;
  tags: MetadataTags | null;
  tracks: TrackInfo[];
  videoTrack: InputVideoTrack | null;
  audioTrack: InputAudioTrack | null;
  fps: number | null;
}

/** One sample (frame) in decode order, as read out of mp4box's sample table. */
export interface SampleInfo {
  offset: number;
  size: number;
  cts: number;
  dts: number;
  ctsSec: number;
  dtsSec: number;
  is_sync: boolean;
  duration: number;
}

/** GOP/keyframe/B-frame analysis derived from a track's sample table. */
export interface SampleAnalysis {
  samples: SampleInfo[];
  keyframeDecodeIndices: number[];
  gopLengths: number[];
  hasBFrames: boolean;
  presentationOrder: SampleInfo[];
  keyframeTimestampsSec: number[];
}

/** A flattened, serializable node in the MP4 box/atom tree. */
export interface BoxNode {
  type: string;
  start: number;
  size: number;
  hdrSize: number;
  children: BoxNode[];
}

/** One row of the empirical seeking test. */
export interface SeekResult {
  t: number;
  kf: number | null;
  dist: number | null;
  distFrames: number | null;
  decodeMs: number;
}

/** Quality preset keys understood by both the ffmpeg CLI builder and the mediabunny fast engine. */
export type QualityPreset = "lossless" | "high" | "medium" | "low" | "custom";

/** x264 presets offered in the FFmpeg Command Builder / Compare Quality tabs. */
export type X264Preset =
  "ultrafast" | "superfast" | "veryfast" | "faster" | "fast" | "medium" | "slow" | "slower" | "veryslow";

/** Shared CLI-command state, edited from both the Re-encode tab and the Compare Quality tab. */
export interface CliState {
  quality: QualityPreset;
  crf: number;
  preset: X264Preset;
  keyframeInterval: number;
  /** Explicit GOP override in frames; when set, takes precedence over keyframeInterval × fps. */
  gopOverride: number | null;
  noBFrames: boolean;
  pad: boolean;
  faststart: boolean;
  audioMode: "copy" | "strip";
  fps: number | null;
}

/** Basic video info needed to fill in CLI defaults (fps for GOP math, dimensions for padding). */
export interface VideoInfo {
  fps: number | null;
  width: number;
  height: number;
}

/** Mutable Compare Quality (A/B comparison) state. */
export interface EncodeTestState {
  startTime: number;
  duration: number;
  running: boolean;
  originalSink: import("mediabunny").CanvasSink | null;
  encodedSink: import("mediabunny").CanvasSink | null;
  encodedInput: Input | null;
  segDuration: number;
  encodedSize: number | null;
  zoom: ZoomPanState | null;
}

/** Shared pan/zoom transform for the Compare Quality comparison canvases. */
export interface ZoomPanState {
  scale: number;
  tx: number;
  ty: number;
}

/** Result of a completed in-browser re-encode. */
export interface ReencodeResult {
  blob: Blob;
  size: number;
}

/** The whole app's mutable, single-source-of-truth state (one loaded file's worth). */
export interface AppState {
  source: ChunkedSource | null;
  file: File | null;
  input: Input | null;
  videoTrack: InputVideoTrack | null;
  audioTrack: InputAudioTrack | null;
  format: string | null;
  mimeType: string | null;
  duration: number | null;
  tags: MetadataTags | null;
  tracks: TrackInfo[] | null;
  fps: number | null;
  frameCount: number | null;
  boxes: BoxNode[];
  faststart: boolean | null;
  samples: SampleInfo[];
  timescale: number;
  keyframeDecodeIndices: number[];
  gopLengths: number[];
  hasBFrames: boolean;
  presentationOrder: SampleInfo[];
  keyframeTimestampsSec: number[];
  seekResults: SeekResult[] | null;
  reencodeResult: ReencodeResult | null;
}

/** One section of the compiled Report tab, renderer-agnostic (HTML preview, print view, Markdown). */
export type ReportSection =
  | {
      title: string;
      kind: "kv";
      items: [string, string | number][];
      note?: string | null;
      /** Keeps label casing as-is; set for sections whose labels are container-native tag names. */
      rawLabels?: boolean;
    }
  | { title: string; kind: "code"; lang: string; content: string }
  | {
      title: string;
      kind: "table";
      summary?: [string, string][];
      headers: string[];
      rows: string[][];
    };
