// ffmpeg.wasm is faked at the core alone: the real engine and pool run over a class that records
// what it was asked, so what these cases pin down is what a run hands the cores, what the bar and
// console show while it does, and how a Stop lands mid-run. mediabunny is stubbed too, since jsdom
// has nothing to measure an encode's length with.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cutInputs } from "../fixtures/runInputs";
import { resetCliDefaults, VIDEO_TRACK } from "../fixtures/state";
import { ChunkedSource } from "../../src/lib/chunkedSource";
import { abandonEncoderRun, claimEncoder, releaseEncoder, type EncoderRun } from "../../src/lib/encoderRun";
import { defaultFfmpegWorker } from "../../src/lib/ffmpegEngine";
import { ffmpegPool, MAX_POOL_WORKERS } from "../../src/lib/ffmpegPool";
import { cli, sampledEncode, state } from "../../src/lib/state";
import type { SampleWindow } from "../../src/lib/types";
import { logLine } from "../../src/ui/formControls";
import {
  acquireWorkers,
  dropWholeFileInput,
  encodeWindows,
  endRunUi,
  prepareRun,
  reportRunFailure,
  runControls,
  runWindows,
  sampleFields,
  startRunUi,
  syncSampleFields,
  type RunInputs,
  type RunUi,
} from "../../src/ui/segmentRun";
import { deferred } from "./helpers/async";

/** What the faked cores were asked to do, and what a test wants the next exec to do. */
const core = vi.hoisted(() => ({
  execs: [] as string[][],
  writes: [] as string[],
  deletes: [] as string[],
  terminated: 0,
  /** How many bytes a readFile hands back, read off the core's last exec, so outputs can differ. */
  sizeOf: ((): number => 3) as (args: string[]) => number,
  /** Stands in for the encode itself; the default finishes at once with nothing said. It resolves
   * the exit code, as the real core's exec does, and 0 when it resolves nothing. */
  exec: null as ((args: string[], handle: { log(message: string): void }) => Promise<number | void>) | null,
}));

/** The stubbed decoder's answer for an encode's length, and how many Inputs were let go of. */
const mb = vi.hoisted(() => ({ duration: 1.9 as number | Error, disposed: 0 }));

const fetchFile = vi.hoisted(() => vi.fn());

vi.mock("@ffmpeg/util", () => ({ toBlobURL: () => Promise.resolve("blob:core"), fetchFile }));

vi.mock("@ffmpeg/ffmpeg", () => {
  class FakeFFmpeg {
    private onLog: ((payload: { message: string }) => void) | null = null;
    /** The command whose output the next read hands back. */
    private lastExec: string[] = [];
    /** The execs still in flight, which terminate() fails the way the real core does. */
    private pending: ((err: Error) => void)[] = [];
    on(event: string, handler: (payload: { message: string }) => void): void {
      if (event === "log") this.onLog = handler;
    }
    load(): Promise<void> {
      return Promise.resolve();
    }
    terminate(): void {
      core.terminated++;
      for (const reject of this.pending) reject(new Error("called FFmpeg.terminate()"));
      this.pending = [];
    }
    writeFile(path: string, data: Uint8Array): Promise<void> {
      // The real client transfers the buffer it is handed, which detaches the caller's view.
      structuredClone(data, { transfer: [data.buffer] });
      core.writes.push(path);
      return Promise.resolve();
    }
    exec(args: string[]): Promise<number> {
      core.execs.push(args);
      this.lastExec = args;
      const log = (message: string): void => this.onLog?.({ message });
      return new Promise<number>((resolve, reject) => {
        this.pending.push(reject);
        (core.exec ? core.exec(args, { log }) : Promise.resolve()).then((code) => resolve(code ?? 0), reject);
      });
    }
    readFile(): Promise<Uint8Array> {
      return Promise.resolve(new Uint8Array(core.sizeOf(this.lastExec)));
    }
    deleteFile(path: string): Promise<void> {
      core.deletes.push(path);
      return Promise.resolve();
    }
  }
  return { FFmpeg: FakeFFmpeg };
});

vi.mock("../../src/lib/mediabunny", () => {
  class FakeInput {
    computeDuration(): Promise<number> {
      return mb.duration instanceof Error ? Promise.reject(mb.duration) : Promise.resolve(mb.duration);
    }
    dispose(): void {
      mb.disposed++;
    }
  }
  return {
    ensureMediabunny: () => Promise.resolve({ Input: FakeInput, BlobSource: class {}, ALL_FORMATS: [] }),
  };
});

/** Two two-second stretches of the clip, each starting on one of its keyframes. */
const WINDOWS: SampleWindow[] = [
  { startSeconds: 0, seconds: 2 },
  { startSeconds: 6, seconds: 2 },
];

/** A 20-second file of `bytes` bytes with a keyframe every two seconds, loaded from disk. */
function loadClip(name = "clip.mp4", bytes = 8): void {
  state.tracks = [VIDEO_TRACK];
  state.fps = 30;
  state.duration = 20;
  state.file = new File([new Uint8Array(bytes)], name);
  state.source = ChunkedSource.fromFile(state.file);
  state.keyframeTimestampsSec = Array.from({ length: 10 }, (_, i) => i * 2);
}

/** The run controls, in the page the way a tab puts them there. */
function controls(): RunUi {
  const { nodes, ui } = runControls(() => "Run Matrix");
  document.body.append(...nodes);
  return ui;
}

/** What comes after `-i` in an encode's arguments: the input, and the trim when there is one. */
function afterInput(args: string[], count: number): string[] {
  const at = args.indexOf("-i");
  return args.slice(at, at + count);
}

/** The run each case encodes under, holding the encoder the way a tab's run does. */
let run: EncoderRun;

/** Takes the encoder for a run, the way a tab does before its first await. */
function claim(): EncoderRun {
  return claimEncoder("Compare Quality", true, document.createElement("div"))!;
}

/** The bar's fill, which the run advances. */
function fillOf(ui: RunUi): HTMLElement {
  return ui.progress.querySelector<HTMLElement>(".fill")!;
}

beforeEach(() => {
  document.body.innerHTML = "";
  resetCliDefaults();
  vi.clearAllMocks();
  // Every core the pool may have built is emptied, so no test starts with the last one's cuts.
  for (const worker of ffmpegPool(MAX_POOL_WORKERS)) worker.reset();
  core.execs = [];
  core.writes = [];
  core.deletes = [];
  core.terminated = 0;
  core.sizeOf = () => 3;
  core.exec = null;
  mb.duration = 1.9;
  mb.disposed = 0;
  fetchFile.mockResolvedValue(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
  sampledEncode.duration = 2;
  loadClip();
  run = claim();
});

afterEach(() => {
  abandonEncoderRun();
  vi.restoreAllMocks();
});

describe("sampleFields", () => {
  it("asks for a duration and a count, with the duration held inside what the file can give", () => {
    state.duration = 4;
    sampledEncode.duration = 7;
    const row = sampleFields("et");
    const duration = row.querySelector<HTMLInputElement>("#etDuration")!;
    const segments = row.querySelector<HTMLInputElement>("#etSegments")!;
    expect(sampledEncode.duration).toBe(4);
    expect(duration.value).toBe("4");
    expect([duration.min, duration.max, duration.step]).toEqual(["1", "4", "0.5"]);
    expect(segments.value).toBe("5");
    expect([segments.min, segments.max, segments.step]).toEqual(["1", "10", "1"]);
    expect(duration.classList.contains("sample-duration")).toBe(true);
    expect(segments.classList.contains("sample-segments")).toBe(true);
  });

  it("starts the duration at three seconds when nothing has set one", () => {
    state.duration = null;
    sampledEncode.duration = 0;
    const row = sampleFields("et");
    expect(row.querySelector<HTMLInputElement>("#etDuration")!.value).toBe("3");
    expect(row.querySelector<HTMLInputElement>("#etDuration")!.max).toBe("10");
  });

  // Every copy of the fields edits the same two numbers, so each says what the others were set
  // to, except the one being typed in, which is left alone under the cursor.
  it("keeps every other copy of the fields at what was typed into one", () => {
    document.body.append(sampleFields("a"), sampleFields("b"));
    const aDuration = document.querySelector<HTMLInputElement>("#aDuration")!;
    const bDuration = document.querySelector<HTMLInputElement>("#bDuration")!;
    aDuration.value = "4.5";
    aDuration.dispatchEvent(new Event("input", { bubbles: true }));
    expect(sampledEncode.duration).toBe(4.5);
    expect(bDuration.value).toBe("4.5");

    // A half-typed duration is not a number yet, and a run needs one.
    aDuration.value = "";
    aDuration.dispatchEvent(new Event("input", { bubbles: true }));
    expect(sampledEncode.duration).toBe(1);
    expect(aDuration.value).toBe("");
    expect(bDuration.value).toBe("1");
  });

  // The field's maximum is what the file can give, at most ten seconds; typed past it, a sweep sampled
  // stretches of whatever was typed until the tab was next drawn.
  it("holds the duration inside what the file can give, on every copy", () => {
    state.duration = 8;
    document.body.append(sampleFields("a"), sampleFields("b"));
    const aDuration = document.querySelector<HTMLInputElement>("#aDuration")!;
    const bDuration = document.querySelector<HTMLInputElement>("#bDuration")!;
    aDuration.value = "50";
    aDuration.dispatchEvent(new Event("input", { bubbles: true }));
    expect(sampledEncode.duration).toBe(8);
    expect(aDuration.value).toBe("50");
    expect(bDuration.value).toBe("8");

    aDuration.value = "-3";
    aDuration.dispatchEvent(new Event("input", { bubbles: true }));
    expect(sampledEncode.duration).toBe(1);
    expect(bDuration.value).toBe("1");
  });

  it("holds the segment count inside what a run can sensibly encode, on every copy", () => {
    document.body.append(sampleFields("a"), sampleFields("b"));
    const aSegments = document.querySelector<HTMLInputElement>("#aSegments")!;
    const bSegments = document.querySelector<HTMLInputElement>("#bSegments")!;
    aSegments.value = "0";
    aSegments.dispatchEvent(new Event("input", { bubbles: true }));
    expect(sampledEncode.segments).toBe(1);
    expect(bSegments.value).toBe("1");

    aSegments.value = "99";
    aSegments.dispatchEvent(new Event("input", { bubbles: true }));
    expect(sampledEncode.segments).toBe(10);
    expect(aSegments.value).toBe("99");
    expect(bSegments.value).toBe("10");

    aSegments.value = "x";
    aSegments.dispatchEvent(new Event("input", { bubbles: true }));
    expect(sampledEncode.segments).toBe(1);
    expect(bSegments.value).toBe("1");
  });

  it("puts every copy back to the state when nothing is being typed", () => {
    document.body.append(sampleFields("a"), sampleFields("b"));
    sampledEncode.duration = 6;
    sampledEncode.segments = 2;
    syncSampleFields();
    expect(document.querySelector<HTMLInputElement>("#aDuration")!.value).toBe("6");
    expect(document.querySelector<HTMLInputElement>("#bDuration")!.value).toBe("6");
    expect(document.querySelector<HTMLInputElement>("#aSegments")!.value).toBe("2");
    expect(document.querySelector<HTMLInputElement>("#bSegments")!.value).toBe("2");
  });
});

describe("runControls", () => {
  it("offers the run button with Stop hidden beside it, then the bar, the note and the console", () => {
    const { nodes, ui } = runControls(() => "Run Comparison");
    expect(nodes).toHaveLength(4);
    expect(nodes[0].querySelectorAll("button")).toHaveLength(2);
    expect(ui.runButton.textContent).toBe("Run Comparison");
    expect(ui.stopButton.textContent).toBe("Stop");
    expect(ui.stopButton.style.display).toBe("none");
    expect(nodes[1]).toBe(ui.progress);
    expect(ui.fill).toBe(fillOf(ui));
    expect(ui.progress.style.display).toBe("none");
    expect(nodes[2]).toBe(ui.note);
    expect(nodes[3].contains(ui.log)).toBe(true);
  });

  it("puts the run button's label back after a run changed it", () => {
    const ui = controls();
    ui.runButton.textContent = "Retry 1 failed";
    ui.syncRunAction();
    expect(ui.runButton.textContent).toBe("Run Matrix");
  });

  // What the button offers can change with the run (a sweep that leaves squares unmeasured offers to
  // run those), so the label is asked for again on every sync rather than fixed when it was built.
  it("labels the run button with whatever the label says at each sync", () => {
    let offered = "Run Matrix";
    const { ui } = runControls(() => offered);
    expect(ui.runButton.textContent).toBe("Run Matrix");
    offered = "Retry 1 failed";
    expect(ui.runButton.textContent).toBe("Run Matrix");
    ui.syncRunAction();
    expect(ui.runButton.textContent).toBe("Retry 1 failed");
  });

  it("ignores Stop while nothing is running", () => {
    const ui = controls();
    releaseEncoder(run);
    ui.stopButton.click();
    expect(run.stopped).toBe(false);
    expect(ui.note.textContent).toBe("");
  });

  it("flags the stop and says so the moment Stop is pressed on a run", () => {
    const ui = controls();
    ui.stopButton.click();
    expect(run.stopped).toBe(true);
    expect(ui.stopButton.disabled).toBe(true);
    expect(ui.note.textContent).toBe("Stopping…");
  });
});

describe("runWindows", () => {
  // Two settings are compared over the same seconds, so the last run's stretches are kept while
  // the fields still describe them.
  it("keeps the last run's stretches while they still fit the fields", () => {
    const sampled = [{ startSeconds: 3, seconds: 2 }];
    sampledEncode.sampled = sampled;
    sampledEncode.segments = 1;
    expect(runWindows()).toBe(sampled);
  });

  it("snaps freshly sampled stretches back to the keyframe before them", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    sampledEncode.segments = 3;
    expect(runWindows()).toEqual([
      { startSeconds: 0, seconds: 2 },
      { startSeconds: 6, seconds: 2 },
      { startSeconds: 12, seconds: 2 },
    ]);
  });

  it("leaves the stretches where the sampler put them when there is no keyframe table", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    state.keyframeTimestampsSec = [];
    sampledEncode.segments = 3;
    const starts = runWindows().map((w) => w.startSeconds);
    expect(starts[0]).toBe(0);
    expect(starts[1]).toBeCloseTo(20 / 3, 10);
    expect(starts[2]).toBeCloseTo(40 / 3, 10);
  });

  it("has nothing to encode before a file is loaded", () => {
    state.duration = null;
    expect(runWindows()).toEqual([]);
  });
});

describe("prepareRun", () => {
  it("cuts each stretch out of the source once, by stream copy, and drops the source", async () => {
    const ui = controls();
    const workers = acquireWorkers(run, WINDOWS.length, ui);
    const inputs = await prepareRun(run, WINDOWS, workers, ui);

    expect(inputs.preCut).toBe(true);
    expect(inputs.windows).toBe(WINDOWS);
    expect(inputs.names[0]).toMatch(/^et_snip_[0-9a-z]+_0\.000_2\.000\.mp4$/);
    expect(inputs.names[1]).toMatch(/^et_snip_[0-9a-z]+_6\.000_2\.000\.mp4$/);
    expect(inputs.data.map((d) => d.byteLength)).toEqual([3, 3]);
    expect(fetchFile).toHaveBeenCalledWith(state.file);
    expect(core.writes).toEqual(["et_in.mp4"]);
    expect(core.execs).toEqual([
      [
        "-y",
        "-ss",
        "0",
        "-i",
        "et_in.mp4",
        "-t",
        "2",
        "-c",
        "copy",
        "-avoid_negative_ts",
        "make_zero",
        inputs.names[0],
      ],
      [
        "-y",
        "-ss",
        "6",
        "-i",
        "et_in.mp4",
        "-t",
        "2",
        "-c",
        "copy",
        "-avoid_negative_ts",
        "make_zero",
        inputs.names[1],
      ],
    ]);
    expect(core.deletes).toEqual(["et_in.mp4"]);
    expect(workers[0].has(inputs.names[0])).toBe(true);
    expect(workers[0].has("et_in.mp4")).toBe(false);
    expect(ui.note.textContent).toBe("Cutting the sampled video out of the source…");
    expect(ui.log.textContent).toContain("$ ffmpeg " + core.execs[1].join(" "));
  });

  // A second run at another setting starts encoding at once, and a remote file is not downloaded
  // for it again.
  it("runs no cut and fetches nothing for stretches the core already holds", async () => {
    const ui = controls();
    const workers = acquireWorkers(run, WINDOWS.length, ui);
    const first = await prepareRun(run, WINDOWS, workers, ui);
    const second = await prepareRun(run, WINDOWS, workers, ui);
    expect(second.names).toEqual(first.names);
    expect(fetchFile).toHaveBeenCalledTimes(1);
    expect(core.execs).toHaveLength(2);
  });

  // More segments asked for than last time: the source has to be read again, but only the new
  // stretch is cut out of it.
  it("cuts only the stretches the core does not hold yet", async () => {
    const ui = controls();
    const workers = acquireWorkers(run, WINDOWS.length, ui);
    await prepareRun(run, [WINDOWS[0]], workers, ui);
    const inputs = await prepareRun(run, WINDOWS, workers, ui);
    expect(fetchFile).toHaveBeenCalledTimes(2);
    expect(core.execs).toHaveLength(2);
    expect(core.execs[1].at(-1)).toBe(inputs.names[1]);
    expect(core.deletes).toEqual(["et_in.mp4", "et_in.mp4"]);
  });

  it("echoes what the cutter says into the console", async () => {
    const ui = controls();
    core.exec = (args, handle) => {
      if (args.includes("copy")) handle.log(`copied packets into ${args.at(-1)}`);
      return Promise.resolve();
    };
    const inputs = await prepareRun(run, WINDOWS, acquireWorkers(run, 1, ui), ui);
    const lines = Array.from(ui.log.children).map((line) => line.textContent);
    expect(lines).toContain(`copied packets into ${inputs.names[0]}`);
    expect(lines).toContain(`copied packets into ${inputs.names[1]}`);
  });

  // The cuts are named for the file the run reads them out of, taken before the read, so one video's
  // stretches are never filed under another's name, whatever is loaded by the time they are cut.
  it("names the cuts for the file it read them from, whatever is loaded by the time they are cut", async () => {
    const ui = controls();
    const workers = acquireWorkers(run, 1, ui);
    const named = await prepareRun(run, WINDOWS, workers, ui);
    // Emptied, so the next run reads the file and cuts again.
    workers[0].reset();
    const reading = deferred<Uint8Array>();
    fetchFile.mockReturnValueOnce(reading.promise);
    const preparing = prepareRun(run, WINDOWS, workers, ui);
    await vi.waitFor(() => expect(fetchFile).toHaveBeenCalledTimes(2));

    loadClip("other.mp4");
    reading.resolve(new Uint8Array(8));

    const again = await preparing;
    expect(again.names).toEqual(named.names);
    expect(core.execs.map((args) => args.at(-1))).toEqual([...named.names, ...named.names]);
  });

  it("names the cuts for the file they came from, so another video is never handed them", async () => {
    const ui = controls();
    const workers = acquireWorkers(run, WINDOWS.length, ui);
    const first = await prepareRun(run, WINDOWS, workers, ui);
    loadClip("other.mp4");
    const renamed = await prepareRun(run, WINDOWS, workers, ui);
    expect(renamed.names[0]).not.toBe(first.names[0]);
    expect(core.execs).toHaveLength(4);

    // Another video can carry the same name; its size still tells it apart.
    loadClip("clip.mp4", 16);
    const resized = await prepareRun(run, WINDOWS, workers, ui);
    expect(resized.names[0]).not.toBe(first.names[0]);
    expect(core.execs).toHaveLength(6);
  });

  it("stops before cutting anything when Stop has already been pressed", async () => {
    const ui = controls();
    run.stopped = true;
    const err = await prepareRun(run, WINDOWS, acquireWorkers(run, WINDOWS.length, ui), ui).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe("Stopped");
    expect(core.execs).toEqual([]);
    // A stop is not a failure to report as one.
    reportRunFailure(run, err, ui);
    expect(ui.note.textContent).toBe("Stopped.");
    expect(ui.progress.style.display).toBe("none");
  });

  // A run already stopped when it comes to the source reads none of it, which for a remote file
  // would be the whole download over again.
  it("reads nothing from the source once Stop has been pressed, cut or not", async () => {
    const ui = controls();
    run.stopped = true;
    await expect(prepareRun(run, WINDOWS, acquireWorkers(run, 1, ui), ui)).rejects.toThrow("Stopped");
    state.keyframeTimestampsSec = [];
    await expect(prepareRun(run, WINDOWS, acquireWorkers(run, 1, ui), ui)).rejects.toThrow("Stopped");
    expect(fetchFile).not.toHaveBeenCalled();
    expect(core.writes).toEqual([]);
  });

  // Stop terminates the core mid-cut, so the cut rejects with the library's words rather than with
  // the run's own stop; it still ends as a stop.
  it("ends as stopped, not failed, when Stop terminates the cut", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const ui = controls();
    startRunUi(ui);
    core.exec = () => new Promise(() => {});
    const cutting = prepareRun(run, WINDOWS, acquireWorkers(run, 1, ui), ui).catch((e: unknown) => e);
    await vi.waitFor(() => expect(core.execs).toHaveLength(1));

    ui.stopButton.click();
    reportRunFailure(run, await cutting, ui);

    expect(ui.note.textContent).toBe("Stopped.");
    expect(ui.log.querySelector(".l.error")).toBeNull();
    expect(error).not.toHaveBeenCalled();
    endRunUi(ui);
  });

  // ffmpeg reports a refused cut by its exit code, not by rejecting. Taken as a success, the cut was
  // recorded as held, so this run failed at the read and every later run skipped cutting it.
  it("fails a cut ffmpeg refused, and cuts it again on the next run", async () => {
    const ui = controls();
    const workers = acquireWorkers(run, 1, ui);
    core.exec = (args) => Promise.resolve(args.includes("copy") ? 1 : 0);
    await expect(prepareRun(run, WINDOWS, workers, ui)).rejects.toThrow("ffmpeg exited with code 1");
    expect(core.execs).toHaveLength(1);
    expect(workers[0].has(core.execs[0].at(-1)!)).toBe(false);

    core.exec = null;
    const inputs = await prepareRun(run, WINDOWS, workers, ui);
    expect(core.execs.map((args) => args.at(-1))).toEqual([inputs.names[0], ...inputs.names]);
  });

  it("stops between the cuts and reading them back", async () => {
    const ui = controls();
    const workers = acquireWorkers(run, WINDOWS.length, ui);
    await prepareRun(run, WINDOWS, workers, ui);
    run.stopped = true;
    await expect(prepareRun(run, WINDOWS, workers, ui)).rejects.toThrow("Stopped");
    expect(fetchFile).toHaveBeenCalledTimes(1);
  });

  // Without a keyframe table a copy-cut lands wherever ffmpeg's seek decides, which the A/B
  // window's original side would then be misaligned against.
  it("hands the first core the whole video when the container gave no keyframe table", async () => {
    loadClip("clip.mov");
    state.keyframeTimestampsSec = [];
    const ui = controls();
    const workers = acquireWorkers(run, WINDOWS.length, ui);
    const inputs = await prepareRun(run, WINDOWS, workers, ui);
    expect(inputs.preCut).toBe(false);
    expect(inputs.names).toEqual(["et_in.mov", "et_in.mov"]);
    expect(inputs.data[0]).toBe(inputs.data[1]);
    expect(Array.from(inputs.data[0])).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(inputs.wholeFileOn).toBe(workers);
    expect(core.writes).toEqual(["et_in.mov"]);
    expect(core.execs).toEqual([]);
    expect(ui.note.textContent).toBe("");
  });

  it("reads a remote source by its URL when there is no file in hand", async () => {
    state.keyframeTimestampsSec = [];
    state.file = null;
    state.source = new ChunkedSource();
    state.source.kind = "url";
    state.source.name = "clip.mp4";
    state.source.size = 10;
    state.source.url = "https://example.org/clip.mp4";
    const ui = controls();
    await prepareRun(run, WINDOWS, acquireWorkers(run, 1, ui), ui);
    expect(fetchFile).toHaveBeenCalledWith("https://example.org/clip.mp4");

    state.source.url = null;
    for (const worker of ffmpegPool(1)) worker.reset();
    await prepareRun(run, WINDOWS, acquireWorkers(run, 1, ui), ui);
    expect(fetchFile).toHaveBeenLastCalledWith(undefined);
  });

  it("refuses to run with no video loaded, cut or not", async () => {
    const ui = controls();
    state.source = null;
    await expect(prepareRun(run, WINDOWS, acquireWorkers(run, 1, ui), ui)).rejects.toThrow("No video loaded");
    state.keyframeTimestampsSec = [];
    await expect(prepareRun(run, WINDOWS, acquireWorkers(run, 1, ui), ui)).rejects.toThrow("No video loaded");
    expect(fetchFile).not.toHaveBeenCalled();
  });
});

describe("dropWholeFileInput", () => {
  it("drops the whole video a run needed, and keeps cut stretches for the next run", async () => {
    const ui = controls();
    const workers = acquireWorkers(run, 1, ui);
    await dropWholeFileInput(null);
    await dropWholeFileInput(await prepareRun(run, WINDOWS, workers, ui));
    // The source was dropped as soon as it was cut; nothing else goes.
    expect(core.deletes).toEqual(["et_in.mp4"]);

    state.keyframeTimestampsSec = [];
    const whole = await prepareRun(run, WINDOWS, workers, ui);
    expect(workers[0].has("et_in.mp4")).toBe(true);
    await dropWholeFileInput(whole);
    expect(core.deletes).toEqual(["et_in.mp4", "et_in.mp4"]);
    expect(workers[0].has("et_in.mp4")).toBe(false);
  });

  // Each core that took a stretch was written its own copy of the video, and each drops it: the
  // name says only what type of file it is, so a core left holding one would hand it to the next.
  it("drops the whole video from every core it was written to", async () => {
    vi.spyOn(navigator, "hardwareConcurrency", "get").mockReturnValue(4);
    state.keyframeTimestampsSec = [];
    const ui = controls();
    const workers = acquireWorkers(run, WINDOWS.length, ui);
    const inputs = await prepareRun(run, WINDOWS, workers, ui);
    await encodeWindows(run, cli, inputs, workers, ui, () => {});
    expect(workers.map((w) => w.has("et_in.mp4"))).toEqual([true, true]);

    await dropWholeFileInput(inputs);

    expect(workers.map((w) => w.has("et_in.mp4"))).toEqual([false, false]);
    expect(core.deletes.filter((name) => name === "et_in.mp4")).toHaveLength(2);
  });
});

describe("encodeWindows", () => {
  it("encodes every stretch from its cut, in sampled order, and adds the bytes up", async () => {
    const ui = controls();
    const workers = acquireWorkers(run, 1, ui);
    const progress: number[] = [];

    const result = await encodeWindows(run, cli, cutInputs(WINDOWS), workers, ui, (fraction) =>
      progress.push(fraction),
    );

    expect(result.blobs.map((b) => b.size)).toEqual([3, 3]);
    expect(result.bytes).toBe(6);
    expect(result.measured).toEqual([
      { startSeconds: 0, seconds: 1.9 },
      { startSeconds: 6, seconds: 1.9 },
    ]);
    expect(progress).toEqual([0.5, 1]);
    expect(core.writes).toEqual(["snip0.mp4", "snip1.mp4"]);
    expect(afterInput(core.execs[0], 2)).toEqual(["-i", "snip0.mp4"]);
    expect(afterInput(core.execs[1], 2)).toEqual(["-i", "snip1.mp4"]);
    expect(core.execs[0]).toContain("-crf");
    expect(core.execs[0].at(-1)).toBe("et_out_0.mp4");
    // Only the output is tidied away; the cut stays for the next run.
    expect(core.deletes).toEqual(["et_out_0.mp4", "et_out_0.mp4"]);
    expect(ui.log.textContent).toContain("$ ffmpeg " + core.execs[0].join(" "));
    expect(mb.disposed).toBe(2);
  });

  it("encodes the cut stretches straight from the core that cut them, writing nothing again", async () => {
    const ui = controls();
    const workers = acquireWorkers(run, 1, ui);
    const inputs = await prepareRun(run, WINDOWS, workers, ui);
    const { blobs } = await encodeWindows(run, cli, inputs, workers, ui, () => {});
    expect(blobs).toHaveLength(2);
    expect(core.writes).toEqual(["et_in.mp4"]);
    expect(afterInput(core.execs[2], 3)).toEqual(["-i", inputs.names[0], "-c:v"]);
  });

  // Trimmed after -i so the cut is frame-accurate: the two sides of the A/B window need to show the
  // same content, not merely start close to it.
  it("trims the whole video itself when the stretches could not be cut out beforehand", async () => {
    const ui = controls();
    const workers = acquireWorkers(run, 1, ui);
    const data = new Uint8Array(8);
    const inputs: RunInputs = {
      windows: WINDOWS,
      names: ["et_in.mp4", "et_in.mp4"],
      data: [data, data],
      preCut: false,
      wholeFileOn: workers,
    };
    await encodeWindows(run, cli, inputs, workers, ui, () => {});
    expect(afterInput(core.execs[0], 6)).toEqual(["-i", "et_in.mp4", "-ss", "0", "-t", "2"]);
    expect(afterInput(core.execs[1], 6)).toEqual(["-i", "et_in.mp4", "-ss", "6", "-t", "2"]);
    expect(core.writes).toEqual(["et_in.mp4"]);
  });

  // The core's own progress events are a fraction of the whole input, so a stretch of a long file
  // would creep to a few percent and stop there; the status lines carry the output time itself.
  it("reads its progress off the core's status lines against the stretch's length", async () => {
    const ui = controls();
    const progress: number[] = [];
    core.exec = (_args, handle) => {
      handle.log("[libx264 @ 0x1] using SAR=1/1");
      handle.log("frame=   30 fps=30 q=20.0 size=10kB time=00:00:01.00 bitrate=80kbits/s");
      // Past the end, which a misread duration can produce: pinned at done rather than beyond it.
      handle.log("frame=   90 fps=30 q=20.0 size=30kB time=00:00:03.00 bitrate=80kbits/s");
      return Promise.resolve();
    };
    await encodeWindows(run, cli, cutInputs(WINDOWS), acquireWorkers(run, 1, ui), ui, (fraction) =>
      progress.push(fraction),
    );
    expect(progress).toEqual([0.25, 0.5, 0.5, 0.75, 1, 1]);
    expect(ui.log.textContent).toContain("[libx264 @ 0x1] using SAR=1/1");
  });

  // The Reencode tab's stretch is a fixed three seconds whatever the Compare tab's Duration says, and
  // a sweep's stretches can be shorter than it at the end of a file: measured against the field, the
  // bar stopped part-way and jumped to full.
  it("measures a cut stretch's progress against its own length, not the Duration field", async () => {
    sampledEncode.duration = 5;
    const ui = controls();
    const progress: number[] = [];
    core.exec = (_args, handle) => {
      handle.log("frame=   30 fps=30 q=20.0 size=10kB time=00:00:01.00 bitrate=80kbits/s");
      return Promise.resolve();
    };
    await encodeWindows(run, cli, cutInputs(WINDOWS), acquireWorkers(run, 1, ui), ui, (fraction) =>
      progress.push(fraction),
    );
    expect(progress).toEqual([0.25, 0.5, 0.75, 1]);
  });

  it("reports nothing off status lines for a stretch with no length to measure against", async () => {
    const ui = controls();
    const progress: number[] = [];
    core.exec = (_args, handle) => {
      handle.log("frame=   30 fps=30 q=20.0 size=10kB time=00:00:01.00 bitrate=80kbits/s");
      return Promise.resolve();
    };
    const empty = WINDOWS.map((w) => ({ startSeconds: w.startSeconds, seconds: 0 }));
    await encodeWindows(run, cli, cutInputs(empty), acquireWorkers(run, 1, ui), ui, (fraction) =>
      progress.push(fraction),
    );
    expect(progress).toEqual([0.5, 1]);
  });

  it("spreads the stretches over the cores, hands the results back in sampled order whichever finishes first, and says in the console which core each line came from", async () => {
    vi.spyOn(navigator, "hardwareConcurrency", "get").mockReturnValue(4);
    const ui = controls();
    const workers = acquireWorkers(run, WINDOWS.length, ui);
    expect(workers.map((w) => w.id)).toEqual([0, 1]);
    // The first stretch's encode is held until the second has been encoded and measured, so the
    // second finishes first; each stretch's output has its own size, so the blobs can be told apart.
    const firstHeld = deferred<void>();
    core.exec = (args, handle) => {
      handle.log("x264 says hello");
      return args.includes("snip0.mp4") ? firstHeld.promise : Promise.resolve();
    };
    core.sizeOf = (args) => (args.includes("snip0.mp4") ? 5 : 7);

    const encoding = encodeWindows(run, cli, cutInputs(WINDOWS), workers, ui, () => {});
    await vi.waitFor(() => expect(mb.disposed).toBe(1));
    firstHeld.resolve();
    const { blobs, measured } = await encoding;

    expect(blobs.map((b) => b.size)).toEqual([5, 7]);
    expect(measured.map((w) => w.startSeconds)).toEqual([0, 6]);
    expect(core.execs.map((args) => args.at(-1))).toEqual(["et_out_0.mp4", "et_out_1.mp4"]);
    const lines = Array.from(ui.log.children).map((line) => line.textContent);
    expect(lines).toContain("x264 says hello");
    expect(lines).toContain("[core 1] x264 says hello");
    expect(lines).toContain("[core 1] $ ffmpeg " + core.execs[1].join(" "));
    expect(lines).toContain("$ ffmpeg " + core.execs[0].join(" "));
  });

  it("falls back to the requested length when the encode's own cannot be measured", async () => {
    const ui = controls();
    mb.duration = new Error("undecodable");
    let { measured } = await encodeWindows(run, cli, cutInputs(WINDOWS), acquireWorkers(run, 1, ui), ui, () => {});
    expect(measured.map((w) => w.seconds)).toEqual([2, 2]);
    // The Input is let go of either way: leaked by the hundred, the browser stops decoding at all.
    expect(mb.disposed).toBe(2);

    mb.duration = 0;
    ({ measured } = await encodeWindows(run, cli, cutInputs(WINDOWS), acquireWorkers(run, 1, ui), ui, () => {}));
    expect(measured.map((w) => w.seconds)).toEqual([2, 2]);
  });

  it("refuses with nothing to encode", async () => {
    const ui = controls();
    const encoding = encodeWindows(run, cli, cutInputs([]), acquireWorkers(run, 1, ui), ui, () => {});
    await expect(encoding).rejects.toThrow("No stretch of video to encode");
    expect(core.execs).toEqual([]);
  });

  it("refuses without a video track to build the command for", async () => {
    state.tracks = [];
    const ui = controls();
    const encoding = encodeWindows(run, cli, cutInputs(WINDOWS), acquireWorkers(run, 1, ui), ui, () => {});
    await expect(encoding).rejects.toThrow("No video track loaded");
  });

  it("ends as stopped, not failed, when Stop lands between two stretches", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const ui = controls();
    core.exec = () => {
      run.stopped = true;
      return Promise.resolve();
    };
    const err = await encodeWindows(run, cli, cutInputs(WINDOWS), acquireWorkers(run, 1, ui), ui, () => {}).catch(
      (e: unknown) => e,
    );
    expect((err as Error).message).toBe("Stopped");
    // The second stretch was never handed out.
    expect(core.execs).toHaveLength(1);

    reportRunFailure(run, err, ui);
    expect(ui.note.textContent).toBe("Stopped.");
    expect(ui.progress.style.display).toBe("none");
    expect(error).not.toHaveBeenCalled();
  });

  // Nothing interrupts a call already inside wasm, so the core is terminated: its pending call
  // rejects, and the run unwinds through the error handling it already has, ending as a stop.
  it("terminates the core mid-encode when Stop is pressed, and the run unwinds as stopped", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const ui = controls();
    const workers = acquireWorkers(run, 1, ui);
    startRunUi(ui);
    core.exec = () => new Promise(() => {});
    const encoding = encodeWindows(run, cli, cutInputs(WINDOWS), workers, ui, () => {});
    await vi.waitFor(() => expect(core.execs).toHaveLength(1));

    ui.stopButton.click();

    expect(ui.note.textContent).toBe("Stopping…");
    expect(ui.stopButton.disabled).toBe(true);
    const err = await encoding.catch((e: unknown) => e);
    expect((err as Error).message).toBe("called FFmpeg.terminate()");
    expect(run.stopped).toBe(true);
    expect(core.terminated).toBe(1);
    // The terminated core's filesystem went with it; the next run writes its cuts again.
    expect(workers[0].has("snip0.mp4")).toBe(false);

    reportRunFailure(run, err, ui);
    expect(ui.note.textContent).toBe("Stopped.");
    expect(ui.log.querySelector(".l.error")).toBeNull();
    expect(error).not.toHaveBeenCalled();
    endRunUi(ui);
  });
});

describe("acquireWorkers", () => {
  it("sizes the pool for the work, leaving a CPU to the page", () => {
    vi.spyOn(navigator, "hardwareConcurrency", "get").mockReturnValue(4);
    const ui = controls();
    expect(acquireWorkers(run, 10, ui).map((w) => w.id)).toEqual([0, 1, 2]);
    expect(acquireWorkers(run, 2, ui).map((w) => w.id)).toEqual([0, 1]);
    const [only] = acquireWorkers(run, 1, ui);
    expect(only).toBe(defaultFfmpegWorker);
  });

  it("runs on the one core alone where the machine will not say how many it has", () => {
    vi.spyOn(navigator, "hardwareConcurrency", "get").mockReturnValue(NaN);
    expect(acquireWorkers(run, 10, controls())).toEqual([defaultFfmpegWorker]);
  });

  it("points every core it hands out at the run's console, naming the cores after the first", async () => {
    vi.spyOn(navigator, "hardwareConcurrency", "get").mockReturnValue(4);
    const ui = controls();
    core.exec = (_args, handle) => {
      handle.log("x264 says hello");
      return Promise.resolve();
    };
    const workers = acquireWorkers(run, 2, ui);
    await Promise.all(workers.map((worker) => worker.runToFile(["-i", "in.mp4", "out.mp4"], "out.mp4")));
    const lines = Array.from(ui.log.children).map((line) => line.textContent);
    expect(lines).toEqual(["x264 says hello", "[core 1] x264 says hello"]);
  });
});

// A fresh page's first run downloads the core, and says so through the first core's log handler as it
// starts loading. Bound only once a stretch was handed out, that handler was unset (or still another
// run's) while the download ran, so the run's console stayed empty through it.
describe("the one-time core download", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("is announced in the console of the run whose first core loads it", async () => {
    vi.resetModules();
    const fresh = await import("../../src/ui/segmentRun");
    const encoder = await import("../../src/lib/encoderRun");
    const engine = await import("../../src/lib/ffmpegEngine");
    // A handler left over from another run, which the download must not be announced through.
    const stale = vi.fn();
    engine.setFfmpegHandlers(stale, null);
    const { ui } = fresh.runControls(() => "Run Comparison");
    const freshRun = encoder.claimEncoder("Reencode with FFmpeg", true, ui.note)!;

    const [first] = fresh.acquireWorkers(freshRun, 1, ui);
    await first.load();

    expect(ui.log.textContent).toContain("Downloading ffmpeg-core (~30 MB, first use only)…");
    expect(stale).not.toHaveBeenCalled();
    encoder.releaseEncoder(freshRun);
  });
});

describe("the run's user interface", () => {
  it("readies the buttons, the bar and the console for a run", () => {
    const ui = controls();
    logLine(ui.log, "left over from last time");

    const fill = startRunUi(ui);

    expect(ui.runButton.disabled).toBe(true);
    expect(ui.stopButton.style.display).toBe("");
    expect(ui.stopButton.disabled).toBe(false);
    expect(ui.progress.style.display).toBe("block");
    expect(fill).toBe(fillOf(ui));
    expect(fill.style.width).toBe("0%");
    expect(ui.log.textContent).toBe("");
    endRunUi(ui);
  });

  it("hands the buttons back at the end, and leaves Stop the cores of the run it is pressed on", async () => {
    const ui = controls();
    const workers = acquireWorkers(run, 1, ui);
    await workers[0].load();
    startRunUi(ui);
    ui.runButton.textContent = "Retry 1 failed";

    endRunUi(ui);
    releaseEncoder(run);

    expect(ui.runButton.disabled).toBe(false);
    expect(ui.runButton.textContent).toBe("Run Matrix");
    expect(ui.stopButton.style.display).toBe("none");
    // A Stop pressed on a later run reaches that run's cores, not this one's.
    const next = claim();
    ui.stopButton.click();
    expect(next.stopped).toBe(true);
    expect(core.terminated).toBe(0);
  });

  // A Stop belongs to the run it was pressed on: carried over, the next square clicked would be
  // read in full and then answer "Stopped." without encoding anything.
  it("leaves the next run unstopped once the run Stop was pressed on has ended", () => {
    const ui = controls();
    startRunUi(ui);
    ui.stopButton.click();
    expect(run.stopped).toBe(true);

    endRunUi(ui);
    releaseEncoder(run);

    expect(claim().stopped).toBe(false);
  });

  // A sweep encodes on several cores at once, so the one already inside wasm is not the only one
  // that has to be interrupted: every core the run acquired goes.
  it("terminates every core the run acquired when Stop is pressed", async () => {
    vi.spyOn(navigator, "hardwareConcurrency", "get").mockReturnValue(4);
    const ui = controls();
    const workers = acquireWorkers(run, WINDOWS.length, ui);
    await Promise.all(workers.map((worker) => worker.load()));
    startRunUi(ui);

    ui.stopButton.click();

    expect(workers).toHaveLength(2);
    expect(core.terminated).toBe(2);
    expect(run.stopped).toBe(true);
    endRunUi(ui);
  });

  it("says what failed in the note and the console, and takes the bar away", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const ui = controls();
    startRunUi(ui);
    reportRunFailure(run, new Error("ffmpeg exited 1"), ui);
    expect(ui.note.textContent).toBe("Failed: ffmpeg exited 1");
    expect(ui.log.querySelector(".l.error")!.textContent).toBe("ffmpeg exited 1");
    expect(ui.progress.style.display).toBe("none");
    expect(error).toHaveBeenCalledOnce();
    endRunUi(ui);
  });
});
