import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFfmpegWorker,
  defaultFfmpegWorker,
  deleteFfmpegFile,
  ensureFfmpegInput,
  parseFfmpegTimeSeconds,
  runFfmpegArgs,
  runFfmpegEncode,
} from "../../src/lib/ffmpegEngine";
import { deferred, flush } from "./helpers/async";

type LogEvent = { message: string };
type ProgressEvent = { progress: number };

/**
 * What the fake core was asked to do, readable from the tests below, and the ways a test can make
 * it misbehave: each `*Error` is thrown (or rejected with) by the call it names while it is set.
 */
const core = vi.hoisted(() => ({
  writes: [] as string[],
  execs: [] as string[][],
  files: new Set<string>(),
  /** The callbacks the engine hung on the most recent core, for a test to fire as the core would. */
  onLog: null as ((ev: LogEvent) => void) | null,
  onProgress: null as ((ev: ProgressEvent) => void) | null,
  /** Cores built, cores started loading, and cores thrown away, in that order, and which cores
   * (numbered as built) went. */
  built: 0,
  loads: 0,
  terminated: 0,
  closed: [] as number[],
  /** Stands in for a core's load while set, so a test can hold one part-way through. */
  load: null as (() => Promise<void>) | null,
  blobUrls: 0,
  /** Stands in for the download of the core's files while set, so a test can hold it too. */
  blob: null as (() => Promise<void>) | null,
  blobError: null as unknown,
  loadError: null as unknown,
  execError: null as unknown,
  deleteError: null as unknown,
}));

vi.mock("@ffmpeg/util", () => ({
  toBlobURL: () => {
    core.blobUrls++;
    if (core.blobError) return Promise.reject(core.blobError);
    return (core.blob ? core.blob() : Promise.resolve()).then(() => "blob:core");
  },
}));

vi.mock("@ffmpeg/ffmpeg", () => {
  class FakeFFmpeg {
    readonly id = core.built++;
    /** The load still in flight, which terminate() fails with the library's words, as the real
     * client fails every call it is still waiting on. */
    private pending: ((err: Error) => void)[] = [];
    on(event: string, handler: ((ev: LogEvent) => void) | ((ev: ProgressEvent) => void)): void {
      if (event === "log") core.onLog = handler as (ev: LogEvent) => void;
      if (event === "progress") core.onProgress = handler as (ev: ProgressEvent) => void;
    }
    load(): Promise<void> {
      core.loads++;
      if (core.loadError) return Promise.reject(core.loadError);
      const outcome = core.load ? core.load() : Promise.resolve();
      return new Promise<void>((resolve, reject) => {
        this.pending.push(reject);
        outcome.then(resolve, reject);
      });
    }
    terminate(): void {
      core.terminated++;
      core.closed.push(this.id);
      for (const reject of this.pending) reject(new Error("called FFmpeg.terminate()"));
      this.pending = [];
    }
    writeFile(path: string, data: Uint8Array): Promise<void> {
      // The real client posts the array to its worker with the buffer in the transfer list, which
      // detaches the view it was handed. Reproduced here, since surviving that is the point.
      structuredClone(data, { transfer: [data.buffer] });
      core.writes.push(path);
      core.files.add(path);
      return Promise.resolve();
    }
    exec(args: string[]): Promise<void> {
      core.execs.push(args);
      if (core.execError) return Promise.reject(core.execError);
      // A finished run leaves its output, the last argument, in the filesystem, as the real core does.
      core.files.add(args[args.length - 1]);
      return Promise.resolve();
    }
    readFile(): Promise<Uint8Array> {
      // A view into a larger buffer, as the real client may hand back: only a copy owns exactly its bytes.
      return Promise.resolve(new Uint8Array([9, 1, 2, 3, 9]).subarray(1, 4));
    }
    deleteFile(path: string): Promise<void> {
      if (core.deleteError) return Promise.reject(core.deleteError);
      core.files.delete(path);
      return Promise.resolve();
    }
  }
  return { FFmpeg: FakeFFmpeg };
});

const ARGS = ["-y", "-i", "in.mp4", "out.mp4"];

describe("parseFfmpegTimeSeconds", () => {
  it("reads the output timestamp out of a status line", () => {
    const line = "frame=  470 fps=9.2 q=40.0 Lsize=     650kB time=00:00:09.97 bitrate= 533.3kbits/s speed=0.195x";
    expect(parseFfmpegTimeSeconds(line)).toBeCloseTo(9.97, 10);
  });

  it("carries hours and minutes", () => {
    expect(parseFfmpegTimeSeconds("time=01:02:03.50 bitrate=1kbits/s")).toBeCloseTo(3723.5, 10);
  });

  it("treats the negative time of the first status line as no progress at all", () => {
    // ffmpeg reports this before it has written anything.
    expect(parseFfmpegTimeSeconds("frame=    0 fps=0.0 q=0.0 size=0kB time=-577014:32:22.77")).toBe(0);
  });

  it("returns null for a line carrying no timestamp", () => {
    expect(parseFfmpegTimeSeconds("[libx264 @ 0xdf4ad0] using SAR=1/1")).toBeNull();
    expect(parseFfmpegTimeSeconds("")).toBeNull();
    expect(parseFfmpegTimeSeconds("Duration: 00:00:30.00, start: 0.000000, bitrate: 569 kb/s")).toBeNull();
  });

  it("is not fooled by a duration line elsewhere in the same message", () => {
    // The input's duration is not this run's progress; only an explicit time= counts.
    const line = "Duration: 00:00:30.00, start: 0.000000 -- time=00:00:02.00";
    expect(parseFfmpegTimeSeconds(line)).toBeCloseTo(2, 10);
  });
});

describe("the core's virtual filesystem", () => {
  beforeEach(() => {
    defaultFfmpegWorker.reset();
    resetCore();
  });

  it("encodes the same input twice without its buffer being detached out from under it", async () => {
    // The failure this guards against: writeFile transfers the caller's buffer, so a second write
    // of the same array threw "an ArrayBuffer is detached and could not be cloned", which meant a
    // matrix sweep produced one encode and 23 failures.
    const data = new Uint8Array([1, 2, 3, 4]);
    await runFfmpegEncode(ARGS, "in.mp4", data, "out.mp4");
    await runFfmpegEncode(ARGS, "in.mp4", data, "out.mp4");
    expect(data.byteLength).toBe(4);
    expect(core.writes).toEqual(["in.mp4", "in.mp4"]);
  });

  it("writes an input the core already holds only once", async () => {
    const data = new Uint8Array([1, 2, 3, 4]);
    await ensureFfmpegInput("in.mp4", data);
    await ensureFfmpegInput("in.mp4", data);
    await ensureFfmpegInput("in.mp4", data);
    expect(core.writes).toEqual(["in.mp4"]);
    expect(core.files.has("in.mp4")).toBe(true);
  });

  it("writes it again once the core it was written to is gone", async () => {
    const data = new Uint8Array([1, 2, 3, 4]);
    await ensureFfmpegInput("in.mp4", data);
    // A crashed core is replaced by a fresh one, whose filesystem holds nothing.
    defaultFfmpegWorker.reset();
    await ensureFfmpegInput("in.mp4", data);
    expect(core.writes).toEqual(["in.mp4", "in.mp4"]);
  });

  it("runs against an input already in place, and tidies only the output", async () => {
    const data = new Uint8Array([1, 2, 3, 4]);
    await ensureFfmpegInput("in.mp4", data);
    const { data: out } = await runFfmpegArgs(ARGS, "out.mp4");
    expect(Array.from(out)).toEqual([1, 2, 3]);
    expect(core.execs).toEqual([ARGS]);
    expect(core.writes).toEqual(["in.mp4"]);
    expect(core.files.has("in.mp4")).toBe(true);
    expect(core.files.has("out.mp4")).toBe(false);

    await deleteFfmpegFile("in.mp4");
    expect(core.files.has("in.mp4")).toBe(false);
  });

  it("drops both files at the end of a one-shot encode", async () => {
    await runFfmpegEncode(ARGS, "in.mp4", new Uint8Array([1, 2, 3, 4]), "out.mp4");
    expect(core.files.size).toBe(0);
  });
});

/** Puts the fake core back the way a test expects to find it. */
function resetCore(): void {
  core.writes = [];
  core.execs = [];
  core.files.clear();
  core.onLog = null;
  core.onProgress = null;
  core.built = 0;
  core.loads = 0;
  core.terminated = 0;
  core.closed = [];
  core.load = null;
  core.blobUrls = 0;
  core.blob = null;
  core.blobError = null;
  core.loadError = null;
  core.execError = null;
  core.deleteError = null;
}

describe("a pooled core", () => {
  const INPUT = new Uint8Array([1, 2, 3, 4]);

  beforeEach(() => {
    resetCore();
  });

  it("carries the number it was given", () => {
    expect(createFfmpegWorker(3).id).toBe(3);
  });

  it("forwards the core's log lines and progress to the current handlers", async () => {
    const worker = createFfmpegWorker(1);
    const log = vi.fn();
    const progress = vi.fn();
    worker.setHandlers(log, progress);
    await worker.load();
    core.onLog!({ message: "frame=  470 fps=9.2" });
    core.onProgress!({ progress: 0.25 });
    expect(log).toHaveBeenCalledWith("frame=  470 fps=9.2");
    expect(progress).toHaveBeenCalledWith(0.25);
  });

  // Emscripten reports ffmpeg's own exit() as an abort, so this line ends every run, good or bad.
  it("keeps the core's exit noise out of the log", async () => {
    const worker = createFfmpegWorker(1);
    const log = vi.fn();
    worker.setHandlers(log, null);
    await worker.load();
    core.onLog!({ message: "Aborted() " });
    expect(log).not.toHaveBeenCalled();
  });

  it("drops the log and progress once the handlers are unbound", async () => {
    const worker = createFfmpegWorker(1);
    const log = vi.fn();
    const progress = vi.fn();
    worker.setHandlers(log, progress);
    await worker.load();
    worker.setHandlers(null, null);
    core.onLog!({ message: "still running" });
    core.onProgress!({ progress: 0.5 });
    expect(log).not.toHaveBeenCalled();
    expect(progress).not.toHaveBeenCalled();
  });

  it("builds its core once and again only after a reset", async () => {
    const worker = createFfmpegWorker(1);
    await worker.load();
    await worker.load();
    expect(core.built).toBe(1);
    worker.reset();
    expect(core.terminated).toBe(1);
    await worker.load();
    expect(core.built).toBe(2);
  });

  // A run and the first core it needs can both ask before the core has loaded; one core comes of it.
  it("builds one core for every call that arrives while it loads", async () => {
    const worker = createFfmpegWorker(1);
    const loading = deferred<void>();
    core.load = () => loading.promise;
    const calls = [worker.load(), worker.ensureInput("in.mp4", INPUT)];
    loading.resolve();
    await Promise.all(calls);
    expect(core.built).toBe(1);
    expect(core.writes).toEqual(["in.mp4"]);
  });

  // A Stop or a file load resets the core while it may still be loading. The core being loaded is
  // closed on the spot, and every call waiting on it fails as a call to a terminated core does,
  // rather than waiting out a load that would only be thrown away.
  it("closes a core still loading the moment it is reset, failing every call waiting on it", async () => {
    const worker = createFfmpegWorker(1);
    core.load = () => new Promise<void>(() => {});
    const loading = worker.load().catch((err: unknown) => err);
    const writing = worker.ensureInput("in.mp4", INPUT).catch((err: unknown) => err);
    await vi.waitFor(() => expect(core.loads).toBe(1));

    worker.reset();

    expect(core.closed).toEqual([0]);
    const errors = (await Promise.all([loading, writing])) as Error[];
    expect(errors.map((err) => err.message)).toEqual(["called FFmpeg.terminate()", "called FFmpeg.terminate()"]);
    expect(core.writes).toEqual([]);

    // The next call builds a core of its own.
    core.load = null;
    await worker.ensureInput("in.mp4", INPUT);
    expect(core.built).toBe(2);
    expect(worker.has("in.mp4")).toBe(true);
  });

  // A load can also finish in the moment before a reset, which then lands before the engine has
  // taken the core up. That core is closed by the reset and not installed afterwards, where the next
  // call would find a terminated core instead of building a working one.
  it("closes a core whose load finished just as it was reset, instead of installing it", async () => {
    const worker = createFfmpegWorker(1);
    const loaded = deferred<void>();
    core.load = () => loaded.promise;
    const overtaken = worker.load().catch((err: unknown) => err);
    await vi.waitFor(() => expect(core.loads).toBe(1));
    // Queued behind the core's own answer to the load, so the reset lands after it.
    void loaded.promise.then(() => worker.reset());
    loaded.resolve();

    const err = await overtaken;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe("called FFmpeg.terminate()");
    expect(core.closed).toEqual([0]);

    core.load = null;
    await worker.ensureInput("in.mp4", INPUT);
    expect(core.built).toBe(2);
    expect(worker.has("in.mp4")).toBe(true);
    worker.reset();
    expect(core.closed).toEqual([0, 1]);
  });

  // A load can start in the same turn as the reset that overtook the one before it, before that one
  // has unwound. The new load stays the one every call shares and the next reset closes, rather than
  // being dropped by the old load on its way out and left running where nothing would close it.
  it("keeps a load started right after a reset as the one a later reset closes", async () => {
    const worker = createFfmpegWorker(1);
    core.load = () => new Promise<void>(() => {});
    const overtaken = worker.load().catch((err: unknown) => err);
    await vi.waitFor(() => expect(core.loads).toBe(1));

    worker.reset();
    const next = worker.load().catch((err: unknown) => err);
    await overtaken;
    await vi.waitFor(() => expect(core.loads).toBe(2));
    expect(core.closed).toEqual([0]);
    const joined = worker.load().catch((err: unknown) => err);
    expect(core.built).toBe(2);

    worker.reset();

    expect(core.closed).toEqual([0, 1]);
    const errors = (await Promise.all([next, joined])) as Error[];
    expect(errors.map((err) => err.message)).toEqual(["called FFmpeg.terminate()", "called FFmpeg.terminate()"]);
  });

  it("knows which names its filesystem holds", async () => {
    const worker = createFfmpegWorker(1);
    expect(worker.has("in.mp4")).toBe(false);
    await worker.ensureInput("in.mp4", INPUT);
    expect(worker.has("in.mp4")).toBe(true);
    await worker.deleteFile("in.mp4");
    expect(worker.has("in.mp4")).toBe(false);
  });

  // The matrix sweep's two-pass runs leave the first pass's output in place for the second to read.
  it("leaves the output of a run-to-file in place for a later read", async () => {
    const worker = createFfmpegWorker(1);
    await worker.ensureInput("in.mp4", INPUT);
    await worker.runToFile(ARGS, "out.mp4");
    expect(core.execs).toEqual([ARGS]);
    expect(worker.has("out.mp4")).toBe(true);
    const out = await worker.readFile("out.mp4");
    expect(Array.from(out)).toEqual([1, 2, 3]);
    expect(worker.has("out.mp4")).toBe(true);
  });

  // Blob wants a plain ArrayBuffer-backed view; a view sharing the core's buffer would drag the rest of it along.
  it("reads back a copy that owns a plain ArrayBuffer", async () => {
    const worker = createFfmpegWorker(1);
    const out = await worker.readFile("out.mp4");
    expect(out.buffer).toBeInstanceOf(ArrayBuffer);
    expect(out.buffer.byteLength).toBe(3);
    expect(Array.from(out)).toEqual([1, 2, 3]);
  });

  // A name the core has already lost is as gone as the caller wanted it to be.
  it("shrugs off a delete the core refuses", async () => {
    const worker = createFfmpegWorker(1);
    await worker.ensureInput("in.mp4", INPUT);
    core.deleteError = new Error("ENOENT");
    await worker.deleteFile("in.mp4");
    expect(worker.has("in.mp4")).toBe(false);
    expect(core.terminated).toBe(0);
  });

  it("throws the core away when a run crashes inside it, and says what to try instead", async () => {
    const worker = createFfmpegWorker(1);
    await worker.ensureInput("in.mp4", INPUT);
    core.execError = new Error("Aborted()");
    await expect(worker.run(ARGS, "out.mp4")).rejects.toThrow(
      /^ffmpeg\.wasm crashed part-way through \(Aborted\(\)\)\. .*a quicker preset or a shorter segment/,
    );
    expect(core.terminated).toBe(1);
    // The replacement core's filesystem holds nothing the old one did.
    expect(worker.has("in.mp4")).toBe(false);
    core.execError = null;
    await worker.ensureInput("in.mp4", INPUT);
    expect(core.writes).toEqual(["in.mp4", "in.mp4"]);
    expect(core.built).toBe(2);
  });

  it("names running out of memory as such", async () => {
    const worker = createFfmpegWorker(1);
    core.execError = new Error("RuntimeError: memory access out of bounds");
    await expect(worker.runToFile(ARGS, "out.mp4")).rejects.toThrow(
      /^ffmpeg\.wasm ran out of memory \(RuntimeError: memory access out of bounds\)\. .*a smaller resolution/,
    );
    expect(worker.has("out.mp4")).toBe(false);
    expect(core.terminated).toBe(1);
  });

  // ffmpeg's own words are the useful part of an ordinary failure; nothing is added to them.
  it("passes an ordinary error through untouched", async () => {
    const worker = createFfmpegWorker(1);
    core.execError = new Error("Conversion failed!");
    await expect(worker.run(ARGS, "out.mp4")).rejects.toThrow(/^Conversion failed!$/);
    expect(core.terminated).toBe(1);
  });

  it("spells out a rejection that is not an Error at all", async () => {
    const worker = createFfmpegWorker(1);
    core.execError = 42;
    await expect(worker.run(ARGS, "out.mp4")).rejects.toThrow(/^42$/);
    expect(core.terminated).toBe(1);
  });

  // Closed as well as dropped: nothing else would close a core that never became the one in use.
  it("closes a core that failed to load, and builds another on the next call", async () => {
    const worker = createFfmpegWorker(1);
    core.loadError = new Error("failed to import ffmpeg-core.js");
    await expect(worker.load()).rejects.toThrow("failed to import ffmpeg-core.js");
    expect(core.closed).toEqual([0]);
    core.loadError = null;
    await worker.load();
    expect(core.built).toBe(2);
  });
});

/** The engine as a fresh page would see it: nothing loaded yet, and the core still to be fetched. */
async function freshEngine(): Promise<typeof import("../../src/lib/ffmpegEngine")> {
  vi.resetModules();
  return await import("../../src/lib/ffmpegEngine");
}

describe("the default core", () => {
  const DOWNLOAD_NOTE = "Downloading ffmpeg-core (~30 MB, first use only)…";

  beforeEach(() => {
    resetCore();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("announces the one-time core download through the default core's log handler", async () => {
    const engine = await freshEngine();
    const log = vi.fn();
    const poolLog = vi.fn();
    engine.setFfmpegHandlers(log, null);
    // A pooled core's handlers are its own; the download speaks through the default one.
    engine.createFfmpegWorker(1).setHandlers(poolLog, null);
    await engine.ensureFfmpegLoaded();
    expect(log).toHaveBeenCalledWith(DOWNLOAD_NOTE);
    expect(poolLog).not.toHaveBeenCalled();
    expect(core.blobUrls).toBe(2);
  });

  // ~30 MB is fetched once per page, however many cores are built from it.
  it("shares the downloaded core with every instance", async () => {
    const engine = await freshEngine();
    const log = vi.fn();
    engine.setFfmpegHandlers(log, null);
    await engine.ensureFfmpegLoaded();
    await engine.createFfmpegWorker(1).load();
    engine.defaultFfmpegWorker.reset();
    await engine.ensureFfmpegLoaded();
    expect(core.built).toBe(3);
    expect(core.blobUrls).toBe(2);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("forgets a failed core download so the next attempt fetches it again", async () => {
    const engine = await freshEngine();
    core.blobError = new Error("Failed to fetch");
    await expect(engine.ensureFfmpegLoaded()).rejects.toThrow("Failed to fetch");
    core.blobError = null;
    await engine.ensureFfmpegLoaded();
    expect(core.blobUrls).toBe(4);
    // The core built for the failed attempt is not the one kept: a fresh one loads the retried download.
    expect(core.built).toBe(2);
  });

  // A Stop or a file load can reset the core while its files are still downloading. Nothing waits
  // the download out for a load the reset has made moot.
  it("gives up waiting on the core's download the moment the core is reset", async () => {
    const engine = await freshEngine();
    const download = deferred<void>();
    core.blob = () => download.promise;
    const worker = engine.createFfmpegWorker(1);
    let failed: unknown = null;
    void worker.load().catch((err: unknown) => (failed = err));

    worker.reset();
    await flush();

    expect(failed).toBeInstanceOf(Error);
    expect((failed as Error).message).toBe("called FFmpeg.terminate()");
    download.resolve();
  });

  // No core is started for that load once the download is in, whenever the reset landed; the
  // download itself is kept, since every later core is started from the same files.
  it("starts no core for a load reset before it had its download in hand", async () => {
    const engine = await freshEngine();
    const download = deferred<void>();
    core.blob = () => download.promise;
    const worker = engine.createFfmpegWorker(1);
    const overtaken = worker.load().catch((err: unknown) => err);
    worker.reset();
    download.resolve();
    expect(((await overtaken) as Error).message).toBe("called FFmpeg.terminate()");
    await flush();
    expect(core.loads).toBe(0);

    // The download is in hand now, and the reset lands in the same turn as the load asking for it.
    const again = worker.load().catch((err: unknown) => err);
    worker.reset();
    expect(((await again) as Error).message).toBe("called FFmpeg.terminate()");
    expect(core.loads).toBe(0);

    await worker.load();
    expect(core.loads).toBe(1);
    expect(core.blobUrls).toBe(2);
  });

  it("reports a core that would not load, and tries again on the next call", async () => {
    const engine = await freshEngine();
    core.loadError = new Error("failed to import ffmpeg-core.js");
    await expect(engine.ensureFfmpegLoaded()).rejects.toThrow("failed to import ffmpeg-core.js");
    core.loadError = null;
    await engine.ensureFfmpegLoaded();
    expect(core.built).toBe(2);
  });
});
