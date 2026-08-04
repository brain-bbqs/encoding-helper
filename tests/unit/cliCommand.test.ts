import { describe, expect, it } from "vitest";
import { buildFfmpegArgs, computeGop, CRF_MAP, formatCliCommand } from "../../src/lib/cliCommand";
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
