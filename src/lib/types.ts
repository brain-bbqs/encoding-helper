// Shared type definitions used across lib/ and ui/ modules.

import type { ChromaFormat } from "./chromaFormat";

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
  /** Chroma subsampling as the file states it; null where nothing in it does (see chromaFormat). */
  chroma?: ChromaFormat | null;
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

/**
 * The rates a track's `btrt` box declares, in bits per second. This is the container stating what
 * the encoder was aiming for, as opposed to what the sample sizes turned out to be.
 */
export interface DeclaredBitrate {
  avgBitrate: number;
  maxBitrate: number;
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

/** x264 presets offered in the FFmpeg Command Builder and swept by the Compare Quality matrix. */
export type X264Preset =
  "ultrafast" | "superfast" | "veryfast" | "faster" | "fast" | "medium" | "slow" | "slower" | "veryslow";

/** swscale kernels offered for a downscale. Both are sane choices, which is why both are offered:
 * see SCALER_INFO for what each one trades. */
export type Scaler = "lanczos" | "bicubic";

/** Shared CLI-command state, edited from the Reencode with FFmpeg tab's command builder. */
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
  /** Output resolution as a fraction of the source's, 1 being the source untouched. */
  scale: number;
  /** Which kernel `scale` resamples with. Only reaches the command when `scale` is below 1. */
  scaler: Scaler;
}

/** Basic video info needed to fill in CLI defaults (fps for GOP math, dimensions for padding). */
export interface VideoInfo {
  fps: number | null;
  width: number;
  height: number;
}

/** The two axes every matrix sweep covers: a quality level and an x264 preset. */
export type MatrixQuality = Exclude<QualityPreset, "custom">;

/** The settings one encode was made with, whichever mode produced it. */
export interface EncodeSettings {
  quality: QualityPreset;
  /** The CRF actually used, i.e. the quality preset's own value unless the preset is "custom". */
  crf: number;
  preset: X264Preset;
  /** The resolution fraction the encode was made at; 1 unless it was downscaled. */
  scale: number;
  /** The kernel it was downscaled with, meaningless (but carried) at full resolution. */
  scaler: Scaler;
}

/** One square of the matrix — a pair of dropdown settings to encode the segment with. */
export interface MatrixCombo extends EncodeSettings {
  /** `quality:preset`, stable across runs. */
  key: string;
  quality: MatrixQuality;
}

/** A combination's square in the matrix, filled in as the sweep reaches it. */
export interface MatrixCell {
  combo: MatrixCombo;
  /** "skipped" is a combination the sweep never reached, because the run was stopped. */
  status: "pending" | "running" | "done" | "failed" | "skipped";
  /** Bytes ffmpeg produced for every sampled stretch, kept after the outputs have been dropped. */
  bytes: number | null;
  /** The output's measured playback length, which the projection is taken over. */
  segmentSeconds: number | null;
  elapsedMs: number | null;
  /** The encoded stretches, one per sampled window, held so the cell can be shown in the A/B window
   * without re-encoding. Dropped as a set, since the window cycles through all of them. */
  blobs: Blob[] | null;
  /** Whether the figures above were read back from an earlier run rather than encoded just now (see
   * lib/matrixCache). Such a square never holds outputs, so showing it re-encodes it. */
  fromCache?: boolean;
  error: string | null;
}

/** One stretch of the source that an encode covered. */
export interface SampleWindow {
  startSeconds: number;
  seconds: number;
}

/**
 * One sampled stretch as the A/B window plays it: where it sits in the source, and the decoder for
 * the encoded copy of it.
 *
 * A run samples several stretches and the window cycles through all of them, so the loaded
 * comparison is a list of these rather than one segment and one start time.
 */
export interface AbSegment {
  /** Where the stretch sits in the source, which is what the original side is drawn from. */
  window: SampleWindow;
  /** The encoded copy, whose own timeline starts at zero however far into the source it came from. */
  sink: import("mediabunny").CanvasSink;
  /** That copy's measured length, which is the stretch of it there is anything to draw over. */
  seconds: number;
}

/** Mutable matrix-mode state: what the next sweep will cover, and what the last one found. */
export interface MatrixState {
  /** Ticked quality levels, i.e. the rows the next sweep will run. */
  qualities: MatrixQuality[];
  /** Ticked presets, i.e. the columns the next sweep will run. */
  presets: X264Preset[];
  /** Ticked resolutions, which group the rows. One value keeps the grid two-axis. */
  scales: number[];
  /** Ticked kernels, which group the columns. Only ever more than one when a downscale is ticked
   * too, since nothing is resampled at the source's resolution. */
  scalers: Scaler[];
  /** The last sweep's squares, in canonical order; empty before one has been started. */
  cells: MatrixCell[];
  /** The segment the cells were encoded from, which the start/duration fields may have moved off. */
  segmentStart: number;
  segmentLength: number;
  /** Every stretch each square covered, which is the one above unless the run sampled several. */
  windows: SampleWindow[];
  running: boolean;
  /** The combination showing in the A/B window. */
  selectedKey: string | null;
}

/** Mutable state of the sampled-stretch encodes and the A/B comparison they feed. */
export interface EncodeTestState {
  startTime: number;
  /** Where the single run's window starts, as the Reencode tab's track has it. Its length is fixed
   * (SAMPLE_SECONDS), so this is the whole of what that tab asks for; `duration` and `segments`
   * below belong to the Compare Quality sweep. */
  sampleStart: number;
  duration: number;
  /** How many stretches of `duration` a run encodes. Above 1 they are placed at random (see
   * pickSampleWindows) and the start field stops applying. */
  segments: number;
  /** The stretches the loaded comparison actually covered, with their measured lengths. */
  windows: SampleWindow[];
  /** The stretches a run asks the encoder for: the sampler's picks, snapped to keyframes. Kept
   * across runs so two settings are compared over the same seconds (and the cut snippets are still
   * in the core's filesystem to encode from). */
  sampled: SampleWindow[];
  running: boolean;
  /** Set by the Stop button; a run checks it between (and inside) encodes. */
  cancelRequested: boolean;
  originalSink: import("mediabunny").CanvasSink | null;
  /** Every stretch the loaded comparison covers, in the order the window plays them. */
  abSegments: AbSegment[];
  /** The Inputs behind those sinks, held so they can be disposed when the next encode takes over. */
  encodedInputs: Input[];
  /** The encoded stretches' lengths added together, i.e. how long the window's reel runs. */
  segDuration: number;
  encodedSize: number | null;
  /** The settings the encode currently in the A/B window was made with — which in matrix mode is
   * the winning cell's, not whatever the dropdowns say. */
  activeCombo: EncodeSettings | null;
  /** How a downscaled encode is drawn back at the source's geometry: interpolated when true, one
   * block per encoded pixel when false. A view preference, not part of any encode. */
  upscaleSmoothing: boolean;
  matrix: MatrixState;
  zoom: ZoomPanState | null;
}

/** Shared pan/zoom transform for the A/B comparison canvases. */
export interface ZoomPanState {
  scale: number;
  tx: number;
  ty: number;
}

/** Result of a completed in-browser reencode, kept so the Full Analysis document can report it. */
export interface ReencodeResult {
  originalSize: number;
  encodedSize: number;
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
  declaredVideoBitrate: DeclaredBitrate | null;
  timescale: number;
  keyframeDecodeIndices: number[];
  gopLengths: number[];
  hasBFrames: boolean;
  presentationOrder: SampleInfo[];
  keyframeTimestampsSec: number[];
  seekResults: SeekResult[] | null;
  reencodeResult: ReencodeResult | null;
}

/**
 * One piece of content inside a Full Analysis section. A section is a list of these rather than a
 * single shape, so a section can say a thing the way the tab said it: numbers, then the explainer,
 * then the plot. Every renderer (the document, the Markdown export) handles all six kinds, so
 * adding content to the document is a matter of listing blocks, never of teaching a renderer a new
 * layout.
 */
export type AnalysisBlock =
  | {
      kind: "kv";
      items: [string, string | number][];
      /** Keeps label casing as-is; set for blocks whose labels are container-native tag names. */
      rawLabels?: boolean;
    }
  /** Trusted, author-authored explainer markup — never text read out of the file, unescaped. */
  | { kind: "prose"; html: string }
  | { kind: "badge"; text: string; tone: "good" | "bad" | "info" }
  | { kind: "code"; lang: string; content: string }
  | { kind: "table"; headers: string[]; rows: string[][] }
  /** A chart, built by whichever tab owns it. Renderers clone it, so a section can be drawn twice. */
  | { kind: "figure"; caption: string; element: Element };

/** One section of the Full Analysis document: a heading and the blocks under it. */
export interface AnalysisSection {
  title: string;
  blocks: AnalysisBlock[];
}

/** One container's entry in the knowledge base; the records themselves are in lib/explainers. */
export interface ContainerInfo {
  /** mediabunny's format name, used as the display value. */
  name: string;
  fullName: string;
  extensions: string;
  /** Trusted, author-authored explainer markup. */
  description: string;
  /** Video codecs the container commonly carries; empty for audio-only containers. */
  video: string;
  audio: string;
  /** Playback/compatibility note. */
  support: string;
}
