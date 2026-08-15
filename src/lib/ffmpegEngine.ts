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

/**
 * What the core prints on its way out. ffmpeg finishes by calling `exit()`, which Emscripten
 * reports by calling `abort()`, so this line ends a perfectly successful run as often as a failed
 * one and says nothing about which it was. It is kept out of the console rather than left sitting
 * under a completed encode looking like a crash; a run that really did fail rejects, and the
 * message it throws says so in words.
 */
const CORE_EXIT_NOISE = /^Aborted\(\)$/;

/**
 * Seconds at the `time=HH:MM:SS.mm` of an ffmpeg status line, or null for a line without one.
 *
 * Needed because the core's own progress events are a fraction of the *input's* duration: ask it
 * for 3 seconds out of a 30-second file and it reports 10% at the moment it finishes. Its status
 * lines carry the output timestamp itself, which divided by the length actually asked for is the
 * fraction of the work done.
 */
export function parseFfmpegTimeSeconds(line: string): number | null {
  const m = /time=\s*(-?)(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(line);
  if (!m) return null;
  // The first status line of a run reports a huge negative time, before anything has been written.
  if (m[1] === "-") return 0;
  return Number(m[2]) * 3600 + Number(m[3]) * 60 + Number(m[4]);
}

let logHandler: FfmpegLogHandler | null = null;

/**
 * The core's two blob: URLs, shared by every instance. A crashed core has to be replaced by a fresh
 * one (see resetFfmpeg) and a pool runs several at once, and re-fetching ~30 MB for each would make
 * both prohibitive. The download happens once per page.
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

export interface FfmpegRunResult {
  data: Uint8Array<ArrayBuffer>;
}

/**
 * One loaded ffmpeg.wasm core, with its own virtual filesystem and its own log/progress callbacks.
 *
 * The core is single-threaded WebAssembly, so one of these can only ever encode one thing at a
 * time — but a machine has more than one CPU, and several instances encode side by side on them.
 * Everything an instance needs is per-instance for that reason: two encodes running at once cannot
 * share a filesystem they both write outputs into, nor a progress callback that would report each
 * other's frames.
 */
export interface FfmpegWorker {
  /** 0 for the app's default core; a pool numbers the rest from 1, for the log's benefit. */
  readonly id: number;
  /** Rebinds the log/progress callbacks for this core's next run. */
  setHandlers(onLog: FfmpegLogHandler | null, onProgress: FfmpegProgressHandler | null): void;
  load(): Promise<void>;
  /** Puts `data` in this core's filesystem as `name`, unless it already holds it. */
  ensureInput(name: string, data: Uint8Array): Promise<void>;
  has(name: string): boolean;
  run(args: string[], outputName: string): Promise<FfmpegRunResult>;
  /** Runs `args` and leaves the output in this core's filesystem for a later run to read. */
  runToFile(args: string[], outputName: string): Promise<void>;
  readFile(name: string): Promise<Uint8Array<ArrayBuffer>>;
  deleteFile(name: string): Promise<void>;
  /** Throws the core away, so the next run builds a new one. */
  reset(): void;
}

export function createFfmpegWorker(id = 0): FfmpegWorker {
  let instance: FFmpeg | null = null;
  let onLog: FfmpegLogHandler | null = null;
  let onProgress: FfmpegProgressHandler | null = null;
  /**
   * The names this core's filesystem is known to hold, so an input written once can be reused by
   * later runs instead of being sent over again. Cleared with the instance itself: a replaced core
   * starts with an empty filesystem, whatever the one before it held.
   */
  const files = new Set<string>();

  const ensureLoaded = async (): Promise<FFmpeg> => {
    if (instance) return instance;
    const ffmpeg = new FFmpeg();
    ffmpeg.on("log", ({ message }) => {
      if (!CORE_EXIT_NOISE.test(message.trim())) onLog?.(message);
    });
    ffmpeg.on("progress", ({ progress }) => onProgress?.(progress));
    await ffmpeg.load(await loadCoreUrls());
    instance = ffmpeg;
    return ffmpeg;
  };

  const reset = (): void => {
    instance?.terminate();
    instance = null;
    files.clear();
  };

  return {
    id,
    setHandlers(log, progress) {
      onLog = log;
      onProgress = progress;
      // The core download announces itself through whichever handler is current.
      if (id === 0) logHandler = log;
    },
    async load() {
      await ensureLoaded();
    },
    /**
     * A *copy* goes over, because `writeFile` posts the array to the worker with its buffer in the
     * transfer list, which detaches the caller's own array: without the copy, a second write of the
     * same input fails with "an ArrayBuffer is detached and could not be cloned" — and a second
     * write is exactly what a crashed core (replaced, with an empty filesystem), a fresh run, or a
     * second core in the pool asks for.
     */
    async ensureInput(name, data) {
      if (files.has(name)) return;
      const ffmpeg = await ensureLoaded();
      await ffmpeg.writeFile(name, new Uint8Array(data));
      files.add(name);
    },
    has(name) {
      return files.has(name);
    },
    async run(args, outputName) {
      const ffmpeg = await ensureLoaded();
      let data: Uint8Array<ArrayBuffer>;
      try {
        await ffmpeg.exec(args);
        // ffmpeg.wasm's FileData type is generically `Uint8Array<ArrayBufferLike> | string`; copying
        // into a fresh Uint8Array guarantees a plain ArrayBuffer-backed view, which is what
        // Blob/BlobPart expect.
        data = new Uint8Array((await ffmpeg.readFile(outputName)) as Uint8Array);
      } catch (err) {
        // Anything that rejects here reached us through the worker's catch-all, which means the call
        // into wasm threw rather than ffmpeg merely exiting non-zero. The instance is not to be
        // trusted afterwards, so it goes rather than being left to fail every later run.
        reset();
        throw new Error(describeFfmpegFailure(err));
      }
      // Only on the way out of a healthy run: a dead instance has no filesystem left to tidy.
      await this.deleteFile(outputName);
      return { data };
    },
    async runToFile(args, outputName) {
      const ffmpeg = await ensureLoaded();
      try {
        await ffmpeg.exec(args);
      } catch (err) {
        reset();
        throw new Error(describeFfmpegFailure(err));
      }
      files.add(outputName);
    },
    async readFile(name) {
      const ffmpeg = await ensureLoaded();
      return new Uint8Array((await ffmpeg.readFile(name)) as Uint8Array);
    },
    async deleteFile(name) {
      files.delete(name);
      await instance?.deleteFile(name).catch(() => {});
    },
    reset,
  };
}

/**
 * The core every part of the app reaches for by default, and the one a pool's extra cores are extra
 * to. The module-level functions below are its methods, kept as free functions because most of the
 * app has only ever needed the one core.
 */
export const defaultFfmpegWorker = createFfmpegWorker(0);

export function resetFfmpeg(): void {
  defaultFfmpegWorker.reset();
}

export function setFfmpegHandlers(onLog: FfmpegLogHandler | null, onProgress: FfmpegProgressHandler | null): void {
  defaultFfmpegWorker.setHandlers(onLog, onProgress);
}

export async function ensureFfmpegLoaded(): Promise<void> {
  await defaultFfmpegWorker.load();
}

export async function ensureFfmpegInput(name: string, data: Uint8Array): Promise<void> {
  await defaultFfmpegWorker.ensureInput(name, data);
}

export function hasFfmpegFile(name: string): boolean {
  return defaultFfmpegWorker.has(name);
}

export async function runFfmpegToFile(args: string[], outputName: string): Promise<void> {
  await defaultFfmpegWorker.runToFile(args, outputName);
}

export async function deleteFfmpegFile(name: string): Promise<void> {
  await defaultFfmpegWorker.deleteFile(name);
}

/**
 * Runs `args` against files already in the core's filesystem, and reads `outputName` back out.
 *
 * Split out from `runFfmpegEncode` for runs that encode one input many times (the Compare Quality
 * matrix sweep): the input is the same every time, so it is written once and left in place rather
 * than sent across to the worker again for each set of settings.
 */
export async function runFfmpegArgs(args: string[], outputName: string): Promise<FfmpegRunResult> {
  return await defaultFfmpegWorker.run(args, outputName);
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
  await ensureFfmpegInput(inputName, inputData);
  try {
    return await runFfmpegArgs(args, outputName);
  } finally {
    await deleteFfmpegFile(inputName);
  }
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
