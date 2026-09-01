// Shared, mutable, single-source-of-truth state objects. Every tab renderer reads and writes these
// directly (no framework/store layer) — mirrors the original monolithic script's globals, just typed.

import {
  DEFAULT_MATRIX_FPS_FRACTIONS,
  DEFAULT_MATRIX_PRESETS,
  DEFAULT_MATRIX_QUALITIES,
  DEFAULT_MATRIX_SCALERS,
  DEFAULT_MATRIX_SCALES,
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
  customScale: 60,
};

export const encodeTest: EncodeTestState = {
  startTime: 0,
  sampleStart: 0,
  // Five stretches of five seconds: 25 seconds spread across the file, which is enough of it for
  // the projection to mean something on a recording whose content varies. It is also 5x the encoding
  // one stretch would cost, which the cut stretches and the core pool are what make affordable.
  duration: 5,
  segments: 5,
  windows: [],
  sampled: [],
  running: false,
  cancelRequested: false,
  originalSink: null,
  abSegments: [],
  encodedInputs: [],
  segDuration: 0,
  encodedSize: null,
  activeCombo: null,
  upscaleSmoothing: false,
  matrix: {
    qualities: [...DEFAULT_MATRIX_QUALITIES],
    presets: [...DEFAULT_MATRIX_PRESETS],
    scales: [...DEFAULT_MATRIX_SCALES],
    scalers: [...DEFAULT_MATRIX_SCALERS],
    fpsFractions: [...DEFAULT_MATRIX_FPS_FRACTIONS],
    cells: [],
    segmentStart: 0,
    segmentLength: 5,
    windows: [],
    running: false,
    selectedKey: null,
  },
  zoom: null,
};

export function resetState(): void {
  // Disposed before the references go: an Input holds a decoder and whatever it was reading from,
  // and a page that loads one file after another would otherwise keep every one of them.
  state.input?.dispose();
  for (const input of encodeTest.encodedInputs) input.dispose();
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
  encodeTest.sampleStart = 0;
  encodeTest.duration = 5;
  encodeTest.segments = 5;
  encodeTest.windows = [];
  encodeTest.sampled = [];
  encodeTest.running = false;
  encodeTest.cancelRequested = false;
  encodeTest.originalSink = null;
  encodeTest.abSegments = [];
  encodeTest.encodedInputs = [];
  encodeTest.segDuration = 0;
  encodeTest.encodedSize = null;
  encodeTest.activeCombo = null;
  encodeTest.upscaleSmoothing = false;
  // A new file's matrix starts empty: the old sweep's sizes were measured on video that is gone.
  encodeTest.matrix.qualities = [...DEFAULT_MATRIX_QUALITIES];
  encodeTest.matrix.presets = [...DEFAULT_MATRIX_PRESETS];
  encodeTest.matrix.scales = [...DEFAULT_MATRIX_SCALES];
  encodeTest.matrix.scalers = [...DEFAULT_MATRIX_SCALERS];
  encodeTest.matrix.fpsFractions = [...DEFAULT_MATRIX_FPS_FRACTIONS];
  encodeTest.matrix.cells = [];
  encodeTest.matrix.segmentStart = 0;
  encodeTest.matrix.segmentLength = 5;
  encodeTest.matrix.windows = [];
  encodeTest.matrix.running = false;
  encodeTest.matrix.selectedKey = null;
  encodeTest.zoom = null;
}

/** Basic video-track info shared by the FFmpeg Command Builder and the encoding runs, or null pre-load. */
export function currentVideoInfo(): { fps: number | null; width: number; height: number } | null {
  const vt = state.tracks && state.tracks.find((t) => t.kind === "video");
  if (!vt || vt.codedWidth == null || vt.codedHeight == null) return null;
  return { fps: state.fps, width: vt.codedWidth, height: vt.codedHeight };
}
