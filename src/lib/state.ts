// Shared, mutable, single-source-of-truth state objects. Every tab renderer reads and writes these
// directly (no framework/store layer) — mirrors the original monolithic script's globals, just typed.

import {
  DEFAULT_MATRIX_PRESETS,
  DEFAULT_MATRIX_SCALERS,
  DEFAULT_MATRIX_SCALES,
  MATRIX_QUALITIES,
} from "./qualityMatrix";
import type { AppState, CliState, EncodeTestState } from "./types";

export const state: AppState = {
  source: null,
  file: null,
  input: null,
  videoTrack: null,
  audioTrack: null,
  format: null,
  mimeType: null,
  duration: null,
  tags: null,
  tracks: null,
  fps: null,
  frameCount: null,
  boxes: [],
  faststart: null,
  samples: [],
  declaredVideoBitrate: null,
  timescale: 1,
  keyframeDecodeIndices: [],
  gopLengths: [],
  hasBFrames: false,
  presentationOrder: [],
  keyframeTimestampsSec: [],
  seekResults: null,
  reencodeResult: null,
};

export const cli: CliState = {
  quality: "medium",
  crf: 25,
  preset: "superfast",
  keyframeInterval: 1.0,
  gopOverride: null,
  noBFrames: true,
  pad: true,
  faststart: false,
  audioMode: "copy",
  fps: null,
  scale: 1,
  scaler: "lanczos",
};

export const encodeTest: EncodeTestState = {
  startTime: 0,
  duration: 3,
  segments: 1,
  windows: [],
  sampled: [],
  running: false,
  mode: "single",
  originalSink: null,
  encodedSink: null,
  encodedInput: null,
  segDuration: 0,
  encodedSize: null,
  activeCombo: null,
  upscaleSmoothing: false,
  matrix: {
    qualities: [...MATRIX_QUALITIES],
    presets: [...DEFAULT_MATRIX_PRESETS],
    scales: [...DEFAULT_MATRIX_SCALES],
    scalers: [...DEFAULT_MATRIX_SCALERS],
    cells: [],
    segmentStart: 0,
    segmentLength: 3,
    windows: [],
    running: false,
    cancelRequested: false,
    selectedKey: null,
  },
  zoom: null,
};

export function resetState(): void {
  state.source = null;
  state.file = null;
  state.input = null;
  state.videoTrack = null;
  state.audioTrack = null;
  state.format = null;
  state.mimeType = null;
  state.duration = null;
  state.tags = null;
  state.tracks = null;
  state.fps = null;
  state.frameCount = null;
  state.boxes = [];
  state.faststart = null;
  state.samples = [];
  state.declaredVideoBitrate = null;
  state.timescale = 1;
  state.keyframeDecodeIndices = [];
  state.gopLengths = [];
  state.hasBFrames = false;
  state.presentationOrder = [];
  state.keyframeTimestampsSec = [];
  state.seekResults = null;
  state.reencodeResult = null;
  encodeTest.startTime = 0;
  encodeTest.duration = 3;
  encodeTest.segments = 1;
  encodeTest.windows = [];
  encodeTest.sampled = [];
  encodeTest.running = false;
  encodeTest.mode = "single";
  encodeTest.originalSink = null;
  encodeTest.encodedSink = null;
  encodeTest.encodedInput = null;
  encodeTest.segDuration = 0;
  encodeTest.encodedSize = null;
  encodeTest.activeCombo = null;
  encodeTest.upscaleSmoothing = false;
  // A new file's matrix starts empty: the old sweep's sizes were measured on video that is gone.
  encodeTest.matrix.qualities = [...MATRIX_QUALITIES];
  encodeTest.matrix.presets = [...DEFAULT_MATRIX_PRESETS];
  encodeTest.matrix.scales = [...DEFAULT_MATRIX_SCALES];
  encodeTest.matrix.scalers = [...DEFAULT_MATRIX_SCALERS];
  encodeTest.matrix.cells = [];
  encodeTest.matrix.segmentStart = 0;
  encodeTest.matrix.segmentLength = 3;
  encodeTest.matrix.windows = [];
  encodeTest.matrix.running = false;
  encodeTest.matrix.cancelRequested = false;
  encodeTest.matrix.selectedKey = null;
  encodeTest.zoom = null;
}

/** Basic video-track info shared by the FFmpeg Command Builder and Compare Quality tabs, or null pre-load. */
export function currentVideoInfo(): { fps: number | null; width: number; height: number } | null {
  const vt = state.tracks && state.tracks.find((t) => t.kind === "video");
  if (!vt || vt.codedWidth == null || vt.codedHeight == null) return null;
  return { fps: state.fps, width: vt.codedWidth, height: vt.codedHeight };
}
