// CLI command builder — single source of truth, shared by the displayed command AND the args fed to
// ffmpeg.wasm.

import type { CliState, VideoInfo } from "./types";

export const CRF_MAP: Record<Exclude<CliState["quality"], "custom">, number> = {
  lossless: 0,
  high: 18,
  medium: 25,
  low: 32,
};

export function computeGop(cliState: CliState, fps: number): number {
  if (cliState.gopOverride != null && cliState.gopOverride > 0) return cliState.gopOverride;
  return Math.max(1, Math.round(cliState.keyframeInterval * fps));
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
  if (cliState.pad) args.push("-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2");
  if (cliState.faststart) args.push("-movflags", "+faststart");
  if (cliState.fps) args.push("-r", String(cliState.fps));
  if (cliState.audioMode === "copy") args.push("-c:a", "copy");
  else args.push("-an");
  args.push(outName || "out.reencoded.mp4");
  return args;
}

export function formatCliCommand(args: string[]): string {
  const quote = (a: string): string =>
    /[\s"']/.test(a) ? `"${a.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"` : a;
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
