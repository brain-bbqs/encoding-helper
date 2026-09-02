// Shared, mutable, single-source-of-truth state objects. Every tab renderer reads and writes these
// directly (no framework/store layer) — mirrors the original monolithic script's globals, just typed.

import {
  DEFAULT_MATRIX_FPS_FRACTIONS,
  DEFAULT_MATRIX_PRESETS,
  DEFAULT_MATRIX_QUALITIES,
  DEFAULT_MATRIX_SCALERS,
  DEFAULT_MATRIX_SCALES,
} from "./qualityMatrix";
import type { AppState, CliState, EncodeTestState, TrackInfo, VideoInfo } from "./types";

function initialAppState(): AppState {
  return {
    source: null,
    file: null,
    input: null,
    videoTrack: null,
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
    keyframeDecodeIndices: [],
    gopLengths: [],
    hasBFrames: false,
    keyframeTimestampsSec: [],
    seekResults: null,
    reencodeResult: null,
  };
}

/** A new file's matrix starts empty: any earlier sweep's sizes were measured on video that is gone. */
function initialMatrix(): EncodeTestState["matrix"] {
  return {
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
  };
}

function initialEncodeTest(matrix: EncodeTestState["matrix"]): EncodeTestState {
  return {
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
    matrix,
  };
}

export const state: AppState = initialAppState();

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

export const encodeTest: EncodeTestState = initialEncodeTest(initialMatrix());

/** Back to the pre-load defaults for everything but the command builder, whose settings are the reader's. */
export function resetState(): void {
  // Disposed before the references go: an Input holds a decoder and whatever it was reading from,
  // and a page that loads one file after another would otherwise keep every one of them.
  state.input?.dispose();
  for (const input of encodeTest.encodedInputs) input.dispose();
  Object.assign(state, initialAppState());
  Object.assign(encodeTest.matrix, initialMatrix());
  Object.assign(encodeTest, initialEncodeTest(encodeTest.matrix));
}

/** The loaded file's video track, or null before a file is open or when it has none. */
export function videoTrackInfo(): TrackInfo | null {
  return state.tracks?.find((t) => t.kind === "video") ?? null;
}

/** The loaded file's audio track, or null before a file is open or when it has none. */
export function audioTrackInfo(): TrackInfo | null {
  return state.tracks?.find((t) => t.kind === "audio") ?? null;
}

/** Basic video-track info shared by the FFmpeg Command Builder and the encoding runs, or null pre-load. */
export function currentVideoInfo(): VideoInfo | null {
  const vt = videoTrackInfo();
  if (!vt || vt.codedWidth == null || vt.codedHeight == null) return null;
  return { fps: state.fps, width: vt.codedWidth, height: vt.codedHeight };
}
