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
//
// Must be the ESM core build, not the UMD one: @ffmpeg/ffmpeg's own worker (dist/esm/worker.js) is
// bundled by Vite as a module worker (`worker: { format: "es" }`), where `importScripts()` throws
// immediately, so the worker always falls into its `await import(coreURL)` branch. The UMD build
// isn't a valid ES module (no `default` export), so that import silently resolves to `undefined`
// and the worker throws "failed to import ffmpeg-core.js". The ESM build is a real module with a
// `default` export, matching what `import()` expects.
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL } from "@ffmpeg/util";

// GitHub Pages serves no COOP/COEP headers, so only the single-threaded core can be used (no
// SharedArrayBuffer support) — same constraint the original CDN version worked under.
const FFMPEG_CORE_BASE = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm";

export type FfmpegLogHandler = (message: string) => void;
export type FfmpegProgressHandler = (ratio: number) => void;

let ffmpegInstance: FFmpeg | null = null;
let logHandler: FfmpegLogHandler | null = null;
let progressHandler: FfmpegProgressHandler | null = null;

/**
 * The core's two blob: URLs, kept across instances. A crashed core has to be replaced by a fresh
 * one (see resetFfmpeg), and re-fetching ~30 MB to do it would make every crash cost a download.
 */
let coreUrls: Promise<{ coreURL: string; wasmURL: string }> | null = null;

function loadCoreUrls(): Promise<{ coreURL: string; wasmURL: string }> {
  if (coreUrls) return coreUrls;
  logHandler?.("Downloading ffmpeg-core (~30 MB, first use only)…");
  coreUrls = Promise.all([
    toBlobURL(`${FFMPEG_CORE_BASE}/ffmpeg-core.js`, "text/javascript"),
    toBlobURL(`${FFMPEG_CORE_BASE}/ffmpeg-core.wasm`, "application/wasm"),
  ])
    .then(([coreURL, wasmURL]) => ({ coreURL, wasmURL }))
    // A failed download must not be remembered as the answer for every later attempt.
    .catch((err) => {
      coreUrls = null;
      throw err;
    });
  return coreUrls;
}

/**
 * Throws away the loaded core, so the next run builds a new one.
 *
 * Emscripten's `abort()` does not fail one call, it kills the runtime: the module sets its abort
 * flag and every later call into that instance throws the same way, whatever it is asked to do. A
 * cached instance that has aborted therefore fails every subsequent encode until the page is
 * reloaded — including encodes with settings that would have worked — so a run that crashes has to
 * drop the instance rather than keep it for next time.
 */
export function resetFfmpeg(): void {
  ffmpegInstance?.terminate();
  ffmpegInstance = null;
}

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
  await ffmpeg.load(await loadCoreUrls());
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
  let data: Uint8Array<ArrayBuffer>;
  try {
    await ffmpeg.writeFile(inputName, inputData);
    await ffmpeg.exec(args);
    // ffmpeg.wasm's FileData type is generically `Uint8Array<ArrayBufferLike> | string`; copying into
    // a fresh Uint8Array guarantees a plain ArrayBuffer-backed view, which is what Blob/BlobPart expect.
    data = new Uint8Array((await ffmpeg.readFile(outputName)) as Uint8Array);
  } catch (err) {
    // Anything that rejects here reached us through the worker's catch-all, which means the call
    // into wasm threw rather than ffmpeg merely exiting non-zero. The instance is not to be trusted
    // afterwards, so it goes rather than being left to fail every later run.
    resetFfmpeg();
    throw new Error(describeFfmpegFailure(err));
  }
  // Only on the way out of a healthy run: a dead instance has no filesystem left to tidy.
  await ffmpeg.deleteFile(inputName).catch(() => {});
  await ffmpeg.deleteFile(outputName).catch(() => {});
  return { data };
}

/**
 * Turns a crash inside the core into something a reader can act on. Emscripten's `abort()` says
 * only "Aborted()" — the encode it was running is gone, and the reason for it is inside a 30 MB
 * binary we did not build, so the useful part of the message is what to try instead.
 */
function describeFfmpegFailure(err: unknown): string {
  const raw = (err instanceof Error ? err.message : String(err)).trim();
  if (!/abort/i.test(raw)) return raw;
  return (
    `ffmpeg.wasm crashed part-way through (${raw}). The in-browser core is a single-threaded build, ` +
    `and the slowest x264 presets ask far more of it than the faster ones; a quicker preset or a ` +
    `shorter segment usually gets through. The command itself is sound — run it outside the browser ` +
    `for the exact result. The encoder has been reset, so the next run starts from a fresh core.`
  );
}
