// CLI command builder — single source of truth, shared by the displayed command AND the args fed to
// ffmpeg.wasm.

import type { CliState, Scaler, VideoInfo } from "./types";

export const CRF_MAP: Record<Exclude<CliState["quality"], "custom">, number> = {
  lossless: 0,
  high: 18,
  medium: 25,
  low: 32,
};

/**
 * Output resolutions offered, as a fraction of the source's.
 *
 * Resolution is the largest lever on file size in the whole tool and the only one that is not
 * CRF's job: CRF quantizes more coarsely within the sampling grid it is given, and still pays the
 * per-macroblock cost of every block in the frame however hard it quantizes. Halving each dimension
 * deletes three quarters of those blocks outright.
 *
 * It is also the only lever here that changes what was measured rather than how faithfully it is
 * stored. A keypoint stays localizable to sub-pixel precision through a brutal CRF, because the
 * artifacts are texture-level; half resolution puts a hard floor under that precision which nothing
 * downstream recovers. Hence a short ladder of round fractions rather than a free-form field: this
 * is a decision made once for a dataset, not a number to tune.
 */
export const SCALE_OPTIONS = [1, 0.75, 0.5, 0.25] as const;

/** The kernels offered for a downscale, sharpest first. `lanczos` leads because downscaling is
 * where a sharper kernel shows and its cost is trivial beside the encode; `bicubic` is swscale's
 * own default and the softer, more forgiving of the two. */
export const SCALER_OPTIONS: Scaler[] = ["lanczos", "bicubic"];

export const DEFAULT_SCALER: Scaler = "lanczos";

/** Whether a scale factor asks for anything at all. Guards against a 0 or a NaN out of a field as
 * much as against the 1 that means "leave it alone". */
export function isDownscale(scale: number): boolean {
  return Number.isFinite(scale) && scale > 0 && scale < 1;
}

/**
 * The `scale` filter for a fraction of the source.
 *
 * Width is truncated to an even number and height left to `-2`, which keeps the aspect ratio and
 * rounds to an even number itself. yuv420p needs both dimensions even, so this is what makes the
 * separate pad unnecessary once any scaling is in play.
 */
export function scaleFilter(scale: number, scaler: Scaler = DEFAULT_SCALER): string {
  return `scale=trunc(iw*${scale}/2)*2:-2:flags=${scaler}`;
}

/** What `scaleFilter` will come out at for a known source size, for labelling the control and for
 * drawing the A/B comparison back at the source's geometry. */
export function scaledDimensions(width: number, height: number, scale: number): { width: number; height: number } {
  if (!isDownscale(scale)) return { width, height };
  const w = Math.max(2, Math.trunc((width * scale) / 2) * 2);
  const h = Math.max(2, Math.round((height * w) / width / 2) * 2);
  return { width: w, height: h };
}

/** e.g. "50% (320×240)", the label the resolution dropdown carries once a file is loaded. */
export function describeScale(scale: number, info?: { width: number; height: number } | null): string {
  const pct = `${Math.round(scale * 100)}%`;
  if (!info || !(info.width > 0) || !(info.height > 0)) return scale === 1 ? "Source (100%)" : pct;
  const { width, height } = scaledDimensions(info.width, info.height, scale);
  return `${scale === 1 ? "Source (100%)" : pct} (${width}×${height})`;
}

export function computeGop(cliState: CliState, fps: number): number {
  if (cliState.gopOverride != null && cliState.gopOverride > 0) return cliState.gopOverride;
  return Math.max(1, Math.round(cliState.keyframeInterval * fps));
}

/**
 * What a run's output is called. The operation names it: an MP4 in and an MP4 out is a reencode,
 * while any other source is moved into a different container as well as compressed again, which is
 * what "transcode" names. `base` is the source's own name where there is one to take it from; the
 * command shown on the page has no particular file in it, so it reads `video`.
 */
export function encodedFileName(sourceFormat: string | null | undefined, base = "video"): string {
  return `${base}-${sourceFormat === "MP4" ? "reencoded" : "transcoded"}.mp4`;
}

export function buildFfmpegArgs(cliState: CliState, info: VideoInfo, inName?: string, outName?: string): string[] {
  const fps = cliState.fps || info.fps || 30;
  const gop = computeGop(cliState, fps);
  const crf = cliState.quality === "custom" ? cliState.crf : CRF_MAP[cliState.quality];
  const args = [
    "-y",
    "-i",
    inName || "in.mp4",
    "-c:v",
    "libx264",
    "-crf",
    String(crf),
    "-preset",
    cliState.preset,
    "-g",
    String(gop),
    "-keyint_min",
    String(gop),
    "-sc_threshold",
    "0",
  ];
  if (cliState.noBFrames) args.push("-bf", "0");
  args.push("-pix_fmt", "yuv420p");
  // One -vf, however many filters: a second one silently replaces the first rather than adding to
  // it. The pad is only reached at full resolution, since scale's `-2` already lands on even
  // dimensions and padding an already-even frame is a no-op that only makes the command longer.
  const filters: string[] = [];
  if (isDownscale(cliState.scale)) filters.push(scaleFilter(cliState.scale, cliState.scaler));
  else if (cliState.pad) filters.push("pad=ceil(iw/2)*2:ceil(ih/2)*2");
  if (filters.length) args.push("-vf", filters.join(","));
  if (cliState.faststart) args.push("-movflags", "+faststart");
  if (cliState.fps) args.push("-r", String(cliState.fps));
  if (cliState.audioMode === "copy") args.push("-c:a", "copy");
  else args.push("-an");
  args.push(outName || encodedFileName("MP4"));
  return args;
}

export function formatCliCommand(args: string[]): string {
  const quote = (a: string): string => (/[\s"']/.test(a) ? `"${a.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"` : a);
  const BREAK_AFTER = new Set(["-i", "-c:v", "-vf", "-c:a", "-movflags"]);
  const lines: string[] = [];
  let line = "ffmpeg";
  for (let i = 0; i < args.length; i++) {
    const tok = quote(args[i]);
    if (BREAK_AFTER.has(args[i]) || i === args.length - 1) {
      line += " " + tok;
      lines.push(line + (i === args.length - 1 ? "" : " \\"));
      line = " ";
    } else {
      line += " " + tok;
    }
  }
  if (line.trim()) lines.push(line);
  return lines.join("\n");
}
