import { describe, expect, it } from "vitest";
import {
  buildFfmpegArgs,
  computeGop,
  CRF_MAP,
  describeScale,
  formatCliCommand,
  isDownscale,
  scaledDimensions,
  scaleFilter,
} from "../../src/lib/cliCommand";
import type { CliState, VideoInfo } from "../../src/lib/types";

function baseCli(overrides: Partial<CliState> = {}): CliState {
  return {
    quality: "medium",
    crf: 25,
    preset: "superfast",
    keyframeInterval: 1,
    gopOverride: null,
    noBFrames: true,
    pad: true,
    faststart: false,
    audioMode: "copy",
    fps: null,
    scale: 1,
    scaler: "lanczos",
    ...overrides,
  };
}

const info: VideoInfo = { fps: 30, width: 640, height: 480 };

describe("computeGop", () => {
  it("rounds keyframeInterval * fps to the nearest frame", () => {
    expect(computeGop(baseCli({ keyframeInterval: 2 }), 30)).toBe(60);
  });

  it("is never less than 1 frame", () => {
    expect(computeGop(baseCli({ keyframeInterval: 0.001 }), 1)).toBe(1);
  });

  it("prefers an explicit gopOverride over keyframeInterval math", () => {
    expect(computeGop(baseCli({ keyframeInterval: 5, gopOverride: 12 }), 30)).toBe(12);
  });

  it("ignores a non-positive gopOverride", () => {
    expect(computeGop(baseCli({ keyframeInterval: 1, gopOverride: 0 }), 30)).toBe(30);
  });
});

describe("buildFfmpegArgs", () => {
  it("maps named quality presets to their CRF value", () => {
    const args = buildFfmpegArgs(baseCli({ quality: "high" }), info);
    expect(args[args.indexOf("-crf") + 1]).toBe(String(CRF_MAP.high));
  });

  it("uses the custom CRF value when quality is 'custom'", () => {
    const args = buildFfmpegArgs(baseCli({ quality: "custom", crf: 19 }), info);
    expect(args[args.indexOf("-crf") + 1]).toBe("19");
  });

  it("omits -bf 0 when B-frames are allowed", () => {
    const args = buildFfmpegArgs(baseCli({ noBFrames: false }), info);
    expect(args).not.toContain("-bf");
  });

  it("includes the padding filter only when pad is enabled", () => {
    expect(buildFfmpegArgs(baseCli({ pad: true }), info)).toContain("-vf");
    expect(buildFfmpegArgs(baseCli({ pad: false }), info)).not.toContain("-vf");
  });

  it("scales with lanczos when a fraction of the source resolution is asked for", () => {
    const args = buildFfmpegArgs(baseCli({ scale: 0.5 }), info);
    expect(args[args.indexOf("-vf") + 1]).toBe("scale=trunc(iw*0.5/2)*2:-2:flags=lanczos");
  });

  it("resamples with the kernel the scaler field picked", () => {
    const args = buildFfmpegArgs(baseCli({ scale: 0.25, scaler: "bicubic" }), info);
    expect(args[args.indexOf("-vf") + 1]).toBe("scale=trunc(iw*0.25/2)*2:-2:flags=bicubic");
  });

  // The kernel only resamples something when there is a downscale to resample, so at full
  // resolution it must not reach the command at all.
  it("keeps the scaler out of the command at full resolution", () => {
    const args = buildFfmpegArgs(baseCli({ scale: 1, pad: true, scaler: "bicubic" }), info);
    expect(args.join(" ")).not.toContain("bicubic");
  });

  it("leaves the resolution alone at scale 1", () => {
    const args = buildFfmpegArgs(baseCli({ scale: 1, pad: false }), info);
    expect(args).not.toContain("-vf");
  });

  // scale's `-2` already lands on even dimensions, so padding after it would be a no-op — and a
  // second -vf would silently replace the first rather than adding to it.
  it("replaces the pad with the scale rather than emitting -vf twice", () => {
    const args = buildFfmpegArgs(baseCli({ scale: 0.5, pad: true }), info);
    expect(args.filter((a) => a === "-vf")).toHaveLength(1);
    expect(args[args.indexOf("-vf") + 1]).toBe("scale=trunc(iw*0.5/2)*2:-2:flags=lanczos");
  });

  it("includes +faststart only when faststart is enabled", () => {
    const args = buildFfmpegArgs(baseCli({ faststart: true }), info);
    expect(args[args.indexOf("-movflags") + 1]).toBe("+faststart");
  });

  it("strips audio with -an when audioMode is 'strip'", () => {
    const args = buildFfmpegArgs(baseCli({ audioMode: "strip" }), info);
    expect(args).toContain("-an");
    expect(args).not.toContain("-c:a");
  });

  it("copies audio with -c:a copy when audioMode is 'copy'", () => {
    const args = buildFfmpegArgs(baseCli({ audioMode: "copy" }), info);
    expect(args[args.indexOf("-c:a") + 1]).toBe("copy");
  });

  it("uses provided input/output names, falling back to defaults", () => {
    expect(buildFfmpegArgs(baseCli(), info, "custom-in.mp4", "custom-out.mp4")).toEqual(
      expect.arrayContaining(["custom-in.mp4", "custom-out.mp4"]),
    );
    const defaults = buildFfmpegArgs(baseCli(), info);
    expect(defaults).toContain("in.mp4");
    expect(defaults).toContain("out.reencoded.mp4");
  });
});

describe("isDownscale", () => {
  it("is true only for a fraction below the source's resolution", () => {
    expect(isDownscale(0.5)).toBe(true);
    expect(isDownscale(1)).toBe(false);
  });

  it("rejects values a field could produce but the filter could not use", () => {
    expect(isDownscale(0)).toBe(false);
    expect(isDownscale(-0.5)).toBe(false);
    expect(isDownscale(NaN)).toBe(false);
    expect(isDownscale(2)).toBe(false);
  });
});

describe("scaleFilter", () => {
  it("scales with lanczos and leaves the height to -2", () => {
    expect(scaleFilter(0.5)).toBe("scale=trunc(iw*0.5/2)*2:-2:flags=lanczos");
  });

  it("passes the picked kernel through as flags=", () => {
    expect(scaleFilter(0.5, "bicubic")).toBe("scale=trunc(iw*0.5/2)*2:-2:flags=bicubic");
  });
});

describe("scaledDimensions", () => {
  it("leaves the source alone at full resolution", () => {
    expect(scaledDimensions(1920, 1080, 1)).toEqual({ width: 1920, height: 1080 });
  });

  it("halves both dimensions and keeps the aspect ratio", () => {
    expect(scaledDimensions(1920, 1080, 0.5)).toEqual({ width: 960, height: 540 });
    expect(scaledDimensions(640, 480, 0.25)).toEqual({ width: 160, height: 120 });
  });

  it("lands on even dimensions from an odd source, as yuv420p needs", () => {
    const { width, height } = scaledDimensions(1919, 1081, 0.75);
    expect(width % 2).toBe(0);
    expect(height % 2).toBe(0);
  });

  it("never scales a tiny source below a 2×2 frame", () => {
    expect(scaledDimensions(4, 4, 0.25)).toEqual({ width: 2, height: 2 });
  });
});

describe("describeScale", () => {
  it("names the source and the size each fraction comes out at", () => {
    expect(describeScale(1, { width: 640, height: 480 })).toBe("Source (100%) (640×480)");
    expect(describeScale(0.5, { width: 640, height: 480 })).toBe("50% (320×240)");
  });

  it("falls back to the bare fraction with no file loaded", () => {
    expect(describeScale(0.5, null)).toBe("50%");
  });
});

describe("formatCliCommand", () => {
  it("prefixes the command with 'ffmpeg'", () => {
    expect(formatCliCommand(["-y", "-i", "in.mp4", "out.mp4"]).startsWith("ffmpeg")).toBe(true);
  });

  it("quotes tokens containing whitespace", () => {
    const formatted = formatCliCommand(["-i", "my video.mp4", "out.mp4"]);
    expect(formatted).toContain('"my video.mp4"');
  });

  it("does not append a trailing line-continuation after the last token", () => {
    const formatted = formatCliCommand(["-i", "in.mp4", "out.mp4"]);
    const lines = formatted.split("\n");
    expect(lines[lines.length - 1].endsWith("\\")).toBe(false);
  });
});
