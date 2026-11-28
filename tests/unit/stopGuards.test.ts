// What a stopped run asks of the cores after its stop: nothing.
//
// The real engine, pool and run code run here over a stand-in for @ffmpeg/ffmpeg that keeps how the
// real client behaves where a stop meets work in flight (helpers/realisticCore): every call answered
// in a macrotask, terminate() failing everything pending, a call without a worker refused. Each case
// holds one await a Stop or a file load can land in, stops there, lets the held work finish, and
// asserts the stopped run asked no core for anything afterwards (no load, write, cut, encode, read or
// delete) and built no fresh core. The file-load cases also check the next file's run only ever
// encodes the next file's bytes.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetCliDefaults, VIDEO_TRACK } from "../fixtures/state";
import { ChunkedSource } from "../../src/lib/chunkedSource";
import {
  abandonEncoderRun,
  claimEncoder,
  encoderBusy,
  stopEncoderRun,
  type EncoderRun,
} from "../../src/lib/encoderRun";
import { ffmpegPool, MAX_POOL_WORKERS } from "../../src/lib/ffmpegPool";
import { cli, state } from "../../src/lib/state";
import type { SampleWindow } from "../../src/lib/types";
import { inBrowserEncodeSection } from "../../src/ui/inBrowserEncode";
import { acquireWorkers, encodeWindows, prepareRun, runControls, type RunUi } from "../../src/ui/segmentRun";
import { deferred, settle, until } from "./helpers/async";
import type { CallKind, CoreControl, CoreEvent } from "./helpers/realisticCore";

const ctl = vi.hoisted(
  () => ({ events: [], afterStop: false, phase: "", hold: null, download: null, seq: 0 }) as unknown as CoreControl,
);
const fetchHold = vi.hoisted(() => ({ promise: null as Promise<void> | null }));
const measureHold = vi.hoisted(() => ({ promise: null as Promise<void> | null }));
/** The byte every byte of a loaded file is, so what a core encoded can be traced back to its file. */
const fileByte = vi.hoisted(() => new WeakMap<object, number>());
const fetchFile = vi.hoisted(() =>
  vi.fn((file: unknown) => {
    const byte = fileByte.get(file as object) ?? 0;
    return (fetchHold.promise ?? Promise.resolve()).then(() => new Uint8Array(8).fill(byte));
  }),
);
const downloadBlob = vi.hoisted(() => vi.fn());

vi.mock("@ffmpeg/ffmpeg", async () => {
  const { makeFakeFFmpeg } = await import("./helpers/realisticCore");
  return { FFmpeg: makeFakeFFmpeg(ctl) };
});
vi.mock("@ffmpeg/util", () => ({
  toBlobURL: () => (ctl.download ?? Promise.resolve()).then(() => "blob:core"),
  fetchFile,
}));
vi.mock("../../src/lib/mediabunny", () => {
  class FakeInput {
    computeDuration(): Promise<number> {
      return (measureHold.promise ?? Promise.resolve()).then(() => 1.9);
    }
    dispose(): void {}
  }
  return { ensureMediabunny: () => Promise.resolve({ Input: FakeInput, BlobSource: class {}, ALL_FORMATS: [] }) };
});
vi.mock("../../src/lib/save", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/lib/save")>()),
  pickSaveTarget: () => Promise.resolve({ kind: "buffer" }),
  downloadBlob,
}));

const OLD = 1;
const NEW = 2;
const WINDOWS: SampleWindow[] = [
  { startSeconds: 0, seconds: 2 },
  { startSeconds: 6, seconds: 2 },
];

function loadClip(opts: { keyframes?: boolean; byte?: number } = {}): void {
  const { keyframes = true, byte = OLD } = opts;
  state.tracks = [VIDEO_TRACK];
  state.fps = 30;
  state.duration = 20;
  state.format = "MP4";
  // Same name and size for both files on purpose: a cut stretch's name is taken from them, so a
  // stale cut written into a core would be picked up by the next file's run as its own.
  state.file = new File([new Uint8Array(8)], "clip.mp4");
  fileByte.set(state.file, byte);
  state.source = ChunkedSource.fromFile(state.file);
  state.keyframeTimestampsSec = keyframes ? Array.from({ length: 10 }, (_, i) => i * 2) : [];
}

function controls(): RunUi {
  const { nodes, ui } = runControls(() => "Run");
  document.body.append(...nodes);
  return ui;
}

function claim(): EncoderRun {
  return claimEncoder("Compare Quality", true, document.createElement("div"))!;
}

/** How a run's promise settled: "resolved", or the message it failed with. */
function outcome(p: Promise<unknown>): Promise<string> {
  return p.then(
    () => "resolved",
    (err: unknown) => (err instanceof Error ? err.message : String(err)),
  );
}

function seen(kind: CoreEvent["kind"], path?: string | RegExp, core?: number): boolean {
  return ctl.events.some(
    (e) =>
      e.kind === kind &&
      (core == null || e.core === core) &&
      (path == null || (typeof path === "string" ? e.path === path : path.test(e.path ?? ""))),
  );
}

/** Holds the first call matching until the function handed back is called. */
function holdFirst(match: (kind: CallKind, core: number, path: string) => boolean): () => void {
  const g = deferred<void>();
  let taken = false;
  const before = ctl.hold;
  ctl.hold = (kind, core, path) => {
    if (!taken && match(kind, core, path)) {
      taken = true;
      return g.promise;
    }
    return before?.(kind, core, path) ?? null;
  };
  return () => g.resolve();
}

/** What Stop does, marking every core call from here on as made after it. */
function stopNow(): void {
  ctl.afterStop = true;
  expect(stopEncoderRun()).toBe(true);
}

/** What a file load or Reset does to the run (resetState → abandonEncoderRun). */
function abandonNow(): void {
  ctl.afterStop = true;
  abandonEncoderRun();
}

/** Anything a core was asked for, or a core built, after the stop: terminating is all that may follow. */
function staleCalls(): CoreEvent[] {
  return ctl.events.filter((e) => e.afterStop && e.kind !== "terminate");
}

/** The core the worker currently has, read off the last one built before this call. */
function lastCore(): number {
  return ctl.seq;
}

let ui: RunUi;
let run: EncoderRun;

beforeEach(() => {
  document.body.innerHTML = "";
  resetCliDefaults();
  vi.spyOn(navigator, "hardwareConcurrency", "get").mockReturnValue(8);
  for (const worker of ffmpegPool(MAX_POOL_WORKERS)) worker.reset();
  ctl.events.length = 0;
  ctl.afterStop = false;
  ctl.phase = "A";
  ctl.hold = null;
  ctl.download = null;
  fetchHold.promise = null;
  measureHold.promise = null;
  fetchFile.mockClear();
  downloadBlob.mockClear();
  ui = controls();
  loadClip();
  run = claim();
});

afterEach(async () => {
  abandonEncoderRun();
  ctl.hold = null;
  await settle();
  vi.restoreAllMocks();
});

describe("cutSnippets: the stretches cut out of the source (keyframe table present)", () => {
  // selectMatrixCell calls prepareRun without loading the core first, so the cutter's load can be
  // the one inside ensureInput.
  it("asks nothing more of any core when Stop lands while the cutter loads inside ensureInput", async () => {
    const release = holdFirst((kind) => kind === "load");
    const workers = acquireWorkers(run, 1, ui);
    const done = outcome(prepareRun(run, WINDOWS, workers, ui));
    await until(() => seen("load"));
    expect(fetchFile).toHaveBeenCalledOnce();

    stopNow();
    release();

    expect(await done).toMatch(/terminate|Stopped/);
    expect(staleCalls()).toEqual([]);
  });

  it("asks nothing more of any core when Stop lands while the cutter is written the source", async () => {
    const workers = acquireWorkers(run, 1, ui);
    await workers[0].load();
    const release = holdFirst((kind, _core, path) => kind === "writeFile" && path === "et_in.mp4");
    const done = outcome(prepareRun(run, WINDOWS, workers, ui));
    await until(() => seen("writeFile", "et_in.mp4"));

    stopNow();
    release();

    expect(await done).toMatch(/terminate|Stopped/);
    expect(staleCalls()).toEqual([]);
  });

  it("loads, writes and cuts nothing when Stop lands while the source is read", async () => {
    const workers = acquireWorkers(run, 1, ui);
    await workers[0].load();
    const reading = deferred<void>();
    fetchHold.promise = reading.promise;
    const done = outcome(prepareRun(run, WINDOWS, workers, ui));
    await until(() => fetchFile.mock.calls.length === 1);

    stopNow();
    reading.resolve();

    expect(await done).toBe("Stopped");
    expect(staleCalls()).toEqual([]);
  });

  it("writes and cuts nothing more when Stop lands during the previous stretch's cut", async () => {
    const workers = acquireWorkers(run, 1, ui);
    await workers[0].load();
    const release = holdFirst((kind) => kind === "exec");
    const done = outcome(prepareRun(run, WINDOWS, workers, ui));
    await until(() => seen("exec"));

    stopNow();
    release();

    expect(await done).toMatch(/terminate|Stopped/);
    expect(staleCalls()).toEqual([]);
  });

  // The delete swallows the core's rejection, so cutSnippets returns normally: the check at the top
  // of ensureSnippets' read loop is what ends the run here.
  it("reads nothing back when Stop lands while the source is deleted after the cuts", async () => {
    const workers = acquireWorkers(run, 1, ui);
    await workers[0].load();
    const release = holdFirst((kind, _core, path) => kind === "deleteFile" && path === "et_in.mp4");
    const done = outcome(prepareRun(run, WINDOWS, workers, ui));
    await until(() => seen("deleteFile", "et_in.mp4"));

    stopNow();
    release();

    expect(await done).toBe("Stopped");
    expect(staleCalls()).toEqual([]);
  });

  it("reads nothing more when Stop lands while a cut is read back", async () => {
    const workers = acquireWorkers(run, 1, ui);
    await workers[0].load();
    const release = holdFirst((kind) => kind === "readFile");
    const done = outcome(prepareRun(run, WINDOWS, workers, ui));
    await until(() => seen("readFile"));

    stopNow();
    release();

    expect(await done).toMatch(/terminate|Stopped/);
    expect(staleCalls()).toEqual([]);
  });
});

describe("prepareRun without a keyframe table: the whole video written to the first core", () => {
  it("loads and writes nothing when Stop lands while the source is read", async () => {
    loadClip({ keyframes: false });
    const workers = acquireWorkers(run, 1, ui);
    await workers[0].load();
    const reading = deferred<void>();
    fetchHold.promise = reading.promise;
    const done = outcome(prepareRun(run, WINDOWS, workers, ui));
    await until(() => fetchFile.mock.calls.length === 1);

    stopNow();
    reading.resolve();

    expect(await done).toBe("Stopped");
    expect(staleCalls()).toEqual([]);
  });

  it("asks nothing more of the core when Stop lands while it is written the whole video", async () => {
    loadClip({ keyframes: false });
    const workers = acquireWorkers(run, 1, ui);
    await workers[0].load();
    const release = holdFirst((kind) => kind === "writeFile");
    const done = outcome(prepareRun(run, WINDOWS, workers, ui));
    await until(() => seen("writeFile"));

    stopNow();
    release();

    expect(await done).toMatch(/terminate/);
    expect(staleCalls()).toEqual([]);
  });

  // The same, then the caller carrying on to encode as encodeTab's runSample does: nothing is encoded.
  it("encodes nothing when the caller goes on to encodeWindows after the write was stopped", async () => {
    loadClip({ keyframes: false });
    const workers = acquireWorkers(run, 1, ui);
    await workers[0].load();
    const release = holdFirst((kind) => kind === "writeFile");
    const done = outcome(
      (async () => {
        const inputs = await prepareRun(run, WINDOWS, workers, ui);
        return encodeWindows(run, cli, inputs, workers, ui, () => {});
      })(),
    );
    await until(() => seen("writeFile"));

    stopNow();
    release();

    expect(await done).not.toBe("resolved");
    expect(staleCalls()).toEqual([]);
  });
});

describe("encodeSegment: a second core handed its input when it takes its first stretch", () => {
  /** Readies two cores over `keyframes` and starts encoding both stretches, the first core's encode
   * held so the second core is the one taking its input, with `holdSecond` holding one of its calls. */
  async function twoCores(
    keyframes: boolean,
    holdSecond: (first: number) => () => void,
  ): Promise<{ first: number; release: () => void; done: Promise<string> }> {
    loadClip({ keyframes });
    const workers = acquireWorkers(run, 2, ui);
    await workers[0].load();
    const first = lastCore();
    const inputs = await prepareRun(run, WINDOWS, workers, ui);
    holdFirst((kind, core, path) => kind === "exec" && core === first && path.startsWith("et_out"));
    const release = holdSecond(first);
    return { first, release, done: outcome(encodeWindows(run, cli, inputs, workers, ui, () => {})) };
  }

  const secondLoad = (first: number): (() => void) => holdFirst((kind, core) => kind === "load" && core !== first);
  const secondWrite = (first: number): (() => void) =>
    holdFirst((kind, core) => kind === "writeFile" && core !== first);

  it("encodes nothing on a second core still loading for the whole video when Stop lands", async () => {
    const { first, release, done } = await twoCores(false, secondLoad);
    await until(() => ctl.events.some((e) => e.kind === "load" && e.core !== first));

    stopNow();
    release();

    expect(await done).toMatch(/terminate|Stopped/);
    expect(staleCalls()).toEqual([]);
  });

  it("encodes nothing on a second core being written the whole video when Stop lands", async () => {
    const { first, release, done } = await twoCores(false, secondWrite);
    await until(() => ctl.events.some((e) => e.kind === "writeFile" && e.core !== first));

    stopNow();
    release();

    expect(await done).toMatch(/terminate|Stopped/);
    expect(staleCalls()).toEqual([]);
  });

  it("encodes nothing on a second core being written its cut stretch when Stop lands", async () => {
    const { first, release, done } = await twoCores(true, secondWrite);
    await until(() => ctl.events.some((e) => e.kind === "writeFile" && e.core !== first));
    expect(ctl.events.find((e) => e.kind === "writeFile" && e.core !== first)!.path).toMatch(/^et_snip/);

    stopNow();
    release();

    expect(await done).toMatch(/terminate|Stopped/);
    expect(staleCalls()).toEqual([]);
  });

  it("encodes nothing on a second core still loading for its cut stretch when Stop lands", async () => {
    const { first, release, done } = await twoCores(true, secondLoad);
    await until(() => ctl.events.some((e) => e.kind === "load" && e.core !== first));

    stopNow();
    release();

    expect(await done).toMatch(/terminate|Stopped/);
    expect(staleCalls()).toEqual([]);
  });

  it("starts no next stretch when Stop lands while the last one's length is measured", async () => {
    loadClip({ keyframes: false });
    const workers = acquireWorkers(run, 1, ui);
    await workers[0].load();
    const inputs = await prepareRun(run, WINDOWS, workers, ui);
    const measuring = deferred<void>();
    measureHold.promise = measuring.promise;
    const done = outcome(encodeWindows(run, cli, inputs, workers, ui, () => {}));
    await until(() => seen("exec", /et_out/) && ctl.events.filter((e) => e.kind === "deleteFile").length >= 1);
    await settle();

    stopNow();
    measuring.resolve();

    expect(await done).toBe("Stopped");
    expect(staleCalls()).toEqual([]);
  });
});

describe("a file load over a run: the next file's run encodes only the next file", () => {
  it("writes nothing of the old video into a second core still loading when the file changes", async () => {
    loadClip({ keyframes: false, byte: OLD });
    const workersA = acquireWorkers(run, 2, ui);
    await workersA[0].load();
    const first = lastCore();
    const inputsA = await prepareRun(run, WINDOWS, workersA, ui);
    holdFirst((kind, core, path) => kind === "exec" && core === first && path.startsWith("et_out"));
    let secondA = -1;
    const releaseLoadA = holdFirst((kind, core) => {
      if (kind === "load" && core !== first) {
        secondA = core;
        return true;
      }
      return false;
    });
    const doneA = outcome(encodeWindows(run, cli, inputsA, workersA, ui, () => {}));
    await until(() => secondA > 0);

    abandonNow();
    // A file load parses the new file before its tabs exist to press Run on, so whatever the old
    // run does in the microtasks right after the stop (its guarded() catch resets the core again)
    // is over before the next run starts.
    await settle();
    ctl.phase = "B";
    loadClip({ keyframes: false, byte: NEW });
    const runB = claim();
    const workersB = acquireWorkers(runB, 2, ui);
    await workersB[0].load();
    const inputsB = await prepareRun(runB, WINDOWS, workersB, ui);
    const doneB = outcome(encodeWindows(runB, cli, inputsB, workersB, ui, () => {}));
    expect(await doneB).toBe("resolved");
    releaseLoadA();

    expect(await doneA).toMatch(/terminate|Stopped/);
    const encodesB = ctl.events.filter((e) => e.kind === "exec" && e.phase === "B");
    expect(encodesB.map((e) => e.byte)).toEqual([NEW, NEW]);
    expect(ctl.events.filter((e) => e.afterStop && e.kind === "writeFile" && e.byte === OLD)).toEqual([]);
    expect(encoderBusy()).toBe(true);
  });

  it("writes nothing of the old video into a second core whose load comes back after the file changes", async () => {
    loadClip({ keyframes: false, byte: OLD });
    const workersA = acquireWorkers(run, 2, ui);
    await workersA[0].load();
    const first = lastCore();
    const inputsA = await prepareRun(run, WINDOWS, workersA, ui);
    holdFirst((kind, core, path) => kind === "exec" && core === first && path.startsWith("et_out"));
    let secondA = -1;
    const releaseLoadA = holdFirst((kind, core) => {
      if (kind === "load" && core !== first) {
        secondA = core;
        return true;
      }
      return false;
    });
    const doneA = outcome(encodeWindows(run, cli, inputsA, workersA, ui, () => {}));
    await until(() => secondA > 0);

    abandonNow();
    releaseLoadA();
    expect(await doneA).toMatch(/terminate|Stopped/);

    ctl.phase = "B";
    loadClip({ keyframes: false, byte: NEW });
    const runB = claim();
    const workersB = acquireWorkers(runB, 2, ui);
    await workersB[0].load();
    const inputsB = await prepareRun(runB, WINDOWS, workersB, ui);
    expect(await outcome(encodeWindows(runB, cli, inputsB, workersB, ui, () => {}))).toBe("resolved");

    expect(ctl.events.filter((e) => e.kind === "exec" && e.phase === "B").map((e) => e.byte)).toEqual([NEW, NEW]);
    expect(ctl.events.filter((e) => e.afterStop && e.kind === "writeFile" && e.byte === OLD)).toEqual([]);
  });

  it("cuts nothing from the old video still being written into the cutter when the file changes", async () => {
    loadClip({ keyframes: true, byte: OLD });
    const workersA = acquireWorkers(run, 1, ui);
    await workersA[0].load();
    const releaseWrite = holdFirst((kind, _core, path) => kind === "writeFile" && path === "et_in.mp4");
    const doneA = outcome(prepareRun(run, WINDOWS, workersA, ui));
    await until(() => seen("writeFile", "et_in.mp4"));

    abandonNow();
    await settle();
    ctl.phase = "B";
    loadClip({ keyframes: true, byte: NEW });
    const runB = claim();
    const workersB = acquireWorkers(runB, 1, ui);
    await workersB[0].load();
    const inputsB = await prepareRun(runB, WINDOWS, workersB, ui);
    expect(await outcome(encodeWindows(runB, cli, inputsB, workersB, ui, () => {}))).toBe("resolved");
    releaseWrite();

    expect(await doneA).toMatch(/terminate|Stopped/);
    const execsB = ctl.events.filter((e) => e.kind === "exec" && e.phase === "B");
    expect(execsB).toHaveLength(4);
    expect(execsB.every((e) => e.byte === NEW)).toBe(true);
    expect(ctl.events.filter((e) => e.afterStop && e.kind === "writeFile" && e.byte === OLD)).toEqual([]);
  });
});

describe("the whole-file encode (inBrowserEncode)", () => {
  function wholeFileBox(): { button: HTMLButtonElement; note: HTMLElement } {
    abandonEncoderRun();
    const el = inBrowserEncodeSection({ fps: 30, width: 640, height: 480 });
    document.body.append(el);
    return {
      button: el.querySelector<HTMLButtonElement>("button.btn")!,
      note: el.querySelector<HTMLElement>(".progress-label")!,
    };
  }

  // A file load lands during the core load, which the reset fails on the spot, so the run ends in its
  // catch before it reads the file.
  it("reads, writes and encodes nothing when a file load lands while its core loads", async () => {
    const release = holdFirst((kind) => kind === "load");
    const { button, note } = wholeFileBox();
    button.click();
    await until(() => seen("load"));

    abandonNow();
    release();
    await until(() => !button.disabled);

    expect(note.textContent).toBe("Stopped.");
    expect(fetchFile).not.toHaveBeenCalled();
    expect(staleCalls()).toEqual([]);
    expect(downloadBlob).not.toHaveBeenCalled();
  });

  it("encodes nothing when a file load lands while it reads the file", async () => {
    const { button, note } = wholeFileBox();
    await ffmpegPool(1)[0].load();
    const reading = deferred<void>();
    fetchHold.promise = reading.promise;
    button.click();
    await until(() => fetchFile.mock.calls.length === 1);

    abandonNow();
    reading.resolve();
    await until(() => !button.disabled);

    expect(note.textContent).toBe("Stopped.");
    expect(staleCalls()).toEqual([]);
  });

  // The input's delete swallows the core's rejection, so runFfmpegEncode resolves with the encode the
  // file load caught: the check after it is what keeps that encode from being saved.
  it("saves nothing when a file load lands while the input is deleted after the encode", async () => {
    const { button, note } = wholeFileBox();
    const release = holdFirst((kind, _core, path) => kind === "deleteFile" && path === "in.mp4");
    button.click();
    await until(() => seen("deleteFile", "in.mp4"));

    abandonNow();
    release();
    await until(() => !button.disabled);

    expect(note.textContent).toBe("Stopped.");
    expect(downloadBlob).not.toHaveBeenCalled();
    expect(staleCalls()).toEqual([]);
  });
});
