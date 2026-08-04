// Exact engine: ffmpeg.wasm, lazy-loaded on first use, single-thread core.
//
// The original CDN-based version of this app loaded ffmpeg.wasm's UMD build via a raw <script> tag
// and hand-rolled a `classWorkerURL`/`importScripts` polyfill to make its worker chunk (itself
// fetched from a foreign CDN origin) work as a same-origin blob: URL — see the app's git history for
// the gory details. Now that `@ffmpeg/ffmpeg` is a proper ESM package dependency, Vite bundles its
// worker as part of the app's own same-origin build output and handles worker loading itself
// (`configs/vite.config.ts` sets `worker: { format: "es" }` for exactly this), so none of that is
// needed anymore: `new FFmpeg()` + `ffmpeg.load()` just works.
//
// The ffmpeg-core.js/.wasm binaries themselves are still fetched from the jsdelivr CDN at runtime
// (via `@ffmpeg/util`'s `toBlobURL()`, the officially documented pattern) rather than bundled — they
// are ~30 MB and only needed by the minority of visits that actually run an "exact" encode.
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL } from "@ffmpeg/util";

// GitHub Pages serves no COOP/COEP headers, so only the single-threaded core can be used (no
// SharedArrayBuffer support) — same constraint the original CDN version worked under.
const FFMPEG_CORE_BASE = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd";

export type FfmpegLogHandler = (message: string) => void;
export type FfmpegProgressHandler = (ratio: number) => void;

let ffmpegInstance: FFmpeg | null = null;
let logHandler: FfmpegLogHandler | null = null;
let progressHandler: FfmpegProgressHandler | null = null;

/** Rebinds the log/progress callbacks used by the shared FFmpeg instance for its next run. */
export function setFfmpegHandlers(onLog: FfmpegLogHandler | null, onProgress: FfmpegProgressHandler | null): void {
  logHandler = onLog;
  progressHandler = onProgress;
}

export async function ensureFfmpegLoaded(): Promise<FFmpeg> {
  if (ffmpegInstance) return ffmpegInstance;
  const ffmpeg = new FFmpeg();
  ffmpeg.on("log", ({ message }) => logHandler?.(message));
  ffmpeg.on("progress", ({ progress }) => progressHandler?.(progress));
  logHandler?.("Downloading ffmpeg-core (~30 MB, first use only)…");
  const [coreURL, wasmURL] = await Promise.all([
    toBlobURL(`${FFMPEG_CORE_BASE}/ffmpeg-core.js`, "text/javascript"),
    toBlobURL(`${FFMPEG_CORE_BASE}/ffmpeg-core.wasm`, "application/wasm"),
  ]);
  await ffmpeg.load({ coreURL, wasmURL });
  ffmpegInstance = ffmpeg;
  return ffmpeg;
}

export interface FfmpegRunResult {
  data: Uint8Array<ArrayBuffer>;
}

/**
 * Writes `inputData` to ffmpeg.wasm's virtual filesystem, runs `args` (which must reference
 * `inputName`/`outputName`), reads the result back out, and cleans up both virtual files.
 */
export async function runFfmpegEncode(
  args: string[],
  inputName: string,
  inputData: Uint8Array,
  outputName: string,
): Promise<FfmpegRunResult> {
  const ffmpeg = await ensureFfmpegLoaded();
  await ffmpeg.writeFile(inputName, inputData);
  try {
    await ffmpeg.exec(args);
    const data = await ffmpeg.readFile(outputName);
    // ffmpeg.wasm's FileData type is generically `Uint8Array<ArrayBufferLike> | string`; copying into
    // a fresh Uint8Array guarantees a plain ArrayBuffer-backed view, which is what Blob/BlobPart expect.
    return { data: new Uint8Array(data as Uint8Array) };
  } finally {
    await ffmpeg.deleteFile(inputName).catch(() => {});
    await ffmpeg.deleteFile(outputName).catch(() => {});
  }
}
