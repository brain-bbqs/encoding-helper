// Fast engine: mediabunny / WebCodecs (hardware-accelerated, approximate — no CRF control).

import type { Input, Output, Quality, Target } from "mediabunny";
import { ensureMediabunny } from "./mediabunny";
import type { SaveTarget } from "./save";
import type { CliState, VideoInfo } from "./types";

export interface MediabunnyEncodeOptions {
  video: {
    codec: "avc";
    quality: Quality;
    width?: number;
    height?: number;
    fit?: "contain";
    frameRate?: number;
  };
  audio: { discard: true } | undefined;
}

// WebCodecs exposes no CRF control, only bitrate/quality presets — "custom" CRF (which only means
// something to the ffmpeg.wasm exact engine) falls back to QUALITY_MEDIUM here, same as the
// original's `|| 'QUALITY_MEDIUM'` default.
const QUALITY_KEY_BY_PRESET = {
  lossless: "QUALITY_VERY_HIGH",
  high: "QUALITY_HIGH",
  medium: "QUALITY_MEDIUM",
  low: "QUALITY_LOW",
  custom: "QUALITY_MEDIUM",
} as const;

async function qualityForPreset(quality: CliState["quality"]): Promise<Quality> {
  const mb = await ensureMediabunny();
  return mb[QUALITY_KEY_BY_PRESET[quality]];
}

export async function buildMediabunnyOptions(cliState: CliState, info: VideoInfo): Promise<MediabunnyEncodeOptions> {
  const video: MediabunnyEncodeOptions["video"] = { codec: "avc", quality: await qualityForPreset(cliState.quality) };
  if (cliState.pad) {
    const w = Math.ceil(info.width / 2) * 2;
    const hgt = Math.ceil(info.height / 2) * 2;
    if (w !== info.width || hgt !== info.height) {
      video.width = w;
      video.height = hgt;
      video.fit = "contain";
    }
  }
  if (cliState.fps) video.frameRate = cliState.fps;
  const audio = cliState.audioMode === "strip" ? ({ discard: true } as const) : undefined;
  return { video, audio };
}

export interface FastEncodeSetup {
  output: Output;
  outputTarget: Target;
}

/** Builds (but does not execute) a mediabunny Conversion from `input` into a fresh MP4 Output. */
export async function prepareMediabunnyConversion(
  input: Input,
  saveTarget: SaveTarget,
  cliState: CliState,
  info: VideoInfo,
): Promise<{ output: Output; outputTarget: Target; execute: (onProgress?: (ratio: number) => void) => Promise<void> }> {
  const mb = await ensureMediabunny();
  const opts = await buildMediabunnyOptions(cliState, info);
  const outputTarget: Target =
    saveTarget.kind === "stream" ? new mb.StreamTarget(saveTarget.writable, { chunked: true }) : new mb.BufferTarget();
  const output = new mb.Output({ format: new mb.Mp4OutputFormat(), target: outputTarget });
  const conversion = await mb.Conversion.init({ input, output, video: opts.video, audio: opts.audio });
  if (!conversion.isValid) {
    const reasons = conversion.discardedTracks.map((d) => `${d.track.type}: ${d.reason}`).join("; ");
    throw new Error("Conversion not possible: " + (reasons || "no compatible tracks"));
  }
  return {
    output,
    outputTarget,
    execute: async (onProgress) => {
      conversion.onProgress = (ratio) => onProgress?.(ratio);
      await conversion.execute();
    },
  };
}
