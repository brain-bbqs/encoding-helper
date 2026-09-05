import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFfmpegWorker,
  deleteFfmpegFile,
  ensureFfmpegInput,
  parseFfmpegTimeSeconds,
  resetFfmpeg,
  runFfmpegArgs,
  runFfmpegEncode,
} from "../../src/lib/ffmpegEngine";

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
  /** Cores built and cores thrown away, in that order. */
  built: 0,
  terminated: 0,
  blobUrls: 0,
  blobError: null as unknown,
  loadError: null as unknown,
  execError: null as unknown,
  deleteError: null as unknown,
}));

vi.mock("@ffmpeg/util", () => ({
  toBlobURL: () => {
    core.blobUrls++;
    return core.blobError ? Promise.reject(core.blobError) : Promise.resolve("blob:core");
  },
}));

vi.mock("@ffmpeg/ffmpeg", () => {
  class FakeFFmpeg {
    constructor() {
      core.built++;
    }
    on(event: string, handler: ((ev: LogEvent) => void) | ((ev: ProgressEvent) => void)): void {
      if (event === "log") core.onLog = handler as (ev: LogEvent) => void;
      if (event === "progress") core.onProgress = handler as (ev: ProgressEvent) => void;
    }
    load(): Promise<void> {
      return core.loadError ? Promise.reject(core.loadError) : Promise.resolve();
    }
    terminate(): void {
      core.terminated++;
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
      return core.execError ? Promise.reject(core.execError) : Promise.resolve();
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
    resetFfmpeg();
    core.writes = [];
    core.execs = [];
    core.files.clear();
  });

  it("encodes the same input twice without its buffer being detached out from under it", async () => {
    // The failure this guards against: writeFile transfers the caller's buffer, so a second write
    // of the same array threw "an ArrayBuffer is detached and could not be cloned" — which meant a
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
    resetFfmpeg();
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
  core.terminated = 0;
  core.blobUrls = 0;
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

  it("does not keep a core that failed to load", async () => {
    const worker = createFfmpegWorker(1);
    core.loadError = new Error("failed to import ffmpeg-core.js");
    await expect(worker.load()).rejects.toThrow("failed to import ffmpeg-core.js");
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
    engine.resetFfmpeg();
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

  it("reports a core that would not load, and tries again on the next call", async () => {
    const engine = await freshEngine();
    core.loadError = new Error("failed to import ffmpeg-core.js");
    await expect(engine.ensureFfmpegLoaded()).rejects.toThrow("failed to import ffmpeg-core.js");
    core.loadError = null;
    await engine.ensureFfmpegLoaded();
    expect(core.built).toBe(2);
  });
});
