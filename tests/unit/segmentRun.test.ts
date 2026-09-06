// ffmpeg.wasm is faked at the core alone: the real engine and pool run over a class that records
// what it was asked, so what these cases pin down is what a run hands the cores, what the bar and
// console show while it does, and how a Stop lands mid-run. mediabunny is stubbed too, since jsdom
// has nothing to measure an encode's length with.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetCliDefaults, VIDEO_TRACK } from "../fixtures/state";
import { ChunkedSource } from "../../src/lib/chunkedSource";
import { defaultFfmpegWorker } from "../../src/lib/ffmpegEngine";
import { ffmpegPool, MAX_POOL_WORKERS } from "../../src/lib/ffmpegPool";
import { cli, encodeTest, state } from "../../src/lib/state";
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
  stopRequested,
  syncSampleFields,
  type RunInputs,
  type RunUi,
} from "../../src/ui/segmentRun";

/** What the faked cores were asked to do, and what a test wants the next exec to do. */
const core = vi.hoisted(() => ({
  execs: [] as string[][],
  writes: [] as string[],
  deletes: [] as string[],
  terminated: 0,
  /** Bytes every readFile hands back, whatever the name. */
  readSize: 3,
  /** Stands in for the encode itself; the default finishes at once with nothing said. */
  exec: null as ((args: string[], handle: { log(message: string): void }) => Promise<void>) | null,
}));

/** The stubbed decoder's answer for an encode's length, and how many Inputs were let go of. */
const mb = vi.hoisted(() => ({ duration: 1.9 as number | Error, disposed: 0 }));

const fetchFile = vi.hoisted(() => vi.fn());

vi.mock("@ffmpeg/util", () => ({ toBlobURL: () => Promise.resolve("blob:core"), fetchFile }));

vi.mock("@ffmpeg/ffmpeg", () => {
  class FakeFFmpeg {
    private onLog: ((payload: { message: string }) => void) | null = null;
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
    exec(args: string[]): Promise<void> {
      core.execs.push(args);
      const log = (message: string): void => this.onLog?.({ message });
      return new Promise<void>((resolve, reject) => {
        this.pending.push(reject);
        (core.exec ? core.exec(args, { log }) : Promise.resolve()).then(resolve, reject);
      });
    }
    readFile(): Promise<Uint8Array> {
      return Promise.resolve(new Uint8Array(core.readSize));
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

/** A 20-second file with a keyframe every two seconds, loaded from disk. */
function loadClip(name = "clip.mp4"): void {
  state.tracks = [VIDEO_TRACK];
  state.fps = 30;
  state.duration = 20;
  state.file = new File([new Uint8Array(8)], name);
  state.source = ChunkedSource.fromFile(state.file);
  state.keyframeTimestampsSec = Array.from({ length: 10 }, (_, i) => i * 2);
}

/** The run controls, in the page the way a tab puts them there. */
function controls(label = "Run Matrix"): RunUi {
  const { nodes, ui } = runControls(label);
  document.body.append(...nodes);
  return ui;
}

/** Inputs as prepareRun hands them over once the stretches are cut: one snippet per window. */
function cutInputs(windows = WINDOWS): RunInputs {
  return {
    windows,
    names: windows.map((_, i) => `snip${i}.mp4`),
    data: windows.map(() => new Uint8Array(4)),
    preCut: true,
  };
}

/** What comes after `-i` in an encode's arguments: the input, and the trim when there is one. */
function afterInput(args: string[], count: number): string[] {
  const at = args.indexOf("-i");
  return args.slice(at, at + count);
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
  core.readSize = 3;
  core.exec = null;
  mb.duration = 1.9;
  mb.disposed = 0;
  fetchFile.mockResolvedValue(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
  encodeTest.duration = 2;
  loadClip();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("sampleFields", () => {
  it("asks for a duration and a count, with the duration held inside what the file can give", () => {
    state.duration = 4;
    encodeTest.duration = 7;
    const row = sampleFields("et");
    const duration = row.querySelector<HTMLInputElement>("#etDuration")!;
    const segments = row.querySelector<HTMLInputElement>("#etSegments")!;
    expect(encodeTest.duration).toBe(4);
    expect(duration.value).toBe("4");
    expect([duration.min, duration.max, duration.step]).toEqual(["1", "4", "0.5"]);
    expect(segments.value).toBe("5");
    expect([segments.min, segments.max, segments.step]).toEqual(["1", "10", "1"]);
    expect(duration.classList.contains("sample-duration")).toBe(true);
    expect(segments.classList.contains("sample-segments")).toBe(true);
  });

  it("starts the duration at three seconds when nothing has set one", () => {
    state.duration = null;
    encodeTest.duration = 0;
    const row = sampleFields("et");
    expect(row.querySelector<HTMLInputElement>("#etDuration")!.value).toBe("3");
    expect(row.querySelector<HTMLInputElement>("#etDuration")!.max).toBe("10");
  });

  // Both tabs edit the same two numbers, so a copy on either says what the other was set to,
  // except the one being typed in, which is left alone under the cursor.
  it("keeps every other copy of the fields at what was typed into one", () => {
    document.body.append(sampleFields("a"), sampleFields("b"));
    const aDuration = document.querySelector<HTMLInputElement>("#aDuration")!;
    const bDuration = document.querySelector<HTMLInputElement>("#bDuration")!;
    aDuration.value = "4.5";
    aDuration.dispatchEvent(new Event("input", { bubbles: true }));
    expect(encodeTest.duration).toBe(4.5);
    expect(bDuration.value).toBe("4.5");

    // A half-typed duration is not a number yet, and a run needs one.
    aDuration.value = "";
    aDuration.dispatchEvent(new Event("input", { bubbles: true }));
    expect(encodeTest.duration).toBe(1);
    expect(aDuration.value).toBe("");
    expect(bDuration.value).toBe("1");
  });

  it("holds the segment count inside what a run can sensibly encode, on every copy", () => {
    document.body.append(sampleFields("a"), sampleFields("b"));
    const aSegments = document.querySelector<HTMLInputElement>("#aSegments")!;
    const bSegments = document.querySelector<HTMLInputElement>("#bSegments")!;
    aSegments.value = "99";
    aSegments.dispatchEvent(new Event("input", { bubbles: true }));
    expect(encodeTest.segments).toBe(10);
    expect(aSegments.value).toBe("99");
    expect(bSegments.value).toBe("10");

    aSegments.value = "x";
    aSegments.dispatchEvent(new Event("input", { bubbles: true }));
    expect(encodeTest.segments).toBe(1);
    expect(bSegments.value).toBe("1");
  });

  it("puts every copy back to the state when nothing is being typed", () => {
    document.body.append(sampleFields("a"), sampleFields("b"));
    encodeTest.duration = 6;
    encodeTest.segments = 2;
    syncSampleFields();
    expect(document.querySelector<HTMLInputElement>("#aDuration")!.value).toBe("6");
    expect(document.querySelector<HTMLInputElement>("#bDuration")!.value).toBe("6");
    expect(document.querySelector<HTMLInputElement>("#aSegments")!.value).toBe("2");
    expect(document.querySelector<HTMLInputElement>("#bSegments")!.value).toBe("2");
  });
});

describe("runControls", () => {
  it("offers the run button with Stop hidden beside it, then the bar, the note and the console", () => {
    const { nodes, ui } = runControls("Run Comparison");
    expect(nodes).toHaveLength(4);
    expect(nodes[0].querySelectorAll("button")).toHaveLength(2);
    expect(ui.runButton.textContent).toBe("Run Comparison");
    expect(ui.stopButton.textContent).toBe("Stop");
    expect(ui.stopButton.style.display).toBe("none");
    expect(nodes[1]).toBe(ui.progress);
    expect(ui.progress.style.display).toBe("none");
    expect(nodes[2]).toBe(ui.note);
    expect(nodes[3].contains(ui.log)).toBe(true);
  });

  it("puts the run button's label back after a run changed it", () => {
    const ui = controls("Run Matrix");
    ui.runButton.textContent = "Retry 1 failed";
    ui.syncRunAction();
    expect(ui.runButton.textContent).toBe("Run Matrix");
  });

  it("ignores Stop while nothing is running", () => {
    const ui = controls();
    ui.stopButton.click();
    expect(encodeTest.cancelRequested).toBe(false);
    expect(ui.note.textContent).toBe("");
  });

  it("flags the stop and says so the moment Stop is pressed on a run", () => {
    const ui = controls();
    encodeTest.running = true;
    ui.stopButton.click();
    expect(encodeTest.cancelRequested).toBe(true);
    expect(stopRequested()).toBe(true);
    expect(ui.stopButton.disabled).toBe(true);
    expect(ui.note.textContent).toBe("Stopping…");
    encodeTest.running = false;
  });
});

describe("runWindows", () => {
  // Two settings are compared over the same seconds, so the last run's stretches are kept while
  // the fields still describe them.
  it("keeps the last run's stretches while they still fit the fields", () => {
    const sampled = [{ startSeconds: 3, seconds: 2 }];
    encodeTest.sampled = sampled;
    encodeTest.segments = 1;
    expect(runWindows()).toBe(sampled);
  });

  it("snaps freshly sampled stretches back to the keyframe before them", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    encodeTest.segments = 3;
    expect(runWindows()).toEqual([
      { startSeconds: 0, seconds: 2 },
      { startSeconds: 6, seconds: 2 },
      { startSeconds: 12, seconds: 2 },
    ]);
  });

  it("leaves the stretches where the sampler put them when there is no keyframe table", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    state.keyframeTimestampsSec = [];
    encodeTest.segments = 3;
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
    const workers = acquireWorkers(WINDOWS.length);
    const inputs = await prepareRun(WINDOWS, workers, ui);

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
    const workers = acquireWorkers(WINDOWS.length);
    const first = await prepareRun(WINDOWS, workers, ui);
    const second = await prepareRun(WINDOWS, workers, ui);
    expect(second.names).toEqual(first.names);
    expect(fetchFile).toHaveBeenCalledTimes(1);
    expect(core.execs).toHaveLength(2);
  });

  // More segments asked for than last time: the source has to be read again, but only the new
  // stretch is cut out of it.
  it("cuts only the stretches the core does not hold yet", async () => {
    const ui = controls();
    const workers = acquireWorkers(WINDOWS.length);
    await prepareRun([WINDOWS[0]], workers, ui);
    const inputs = await prepareRun(WINDOWS, workers, ui);
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
    const inputs = await prepareRun(WINDOWS, acquireWorkers(1), ui);
    const lines = Array.from(ui.log.children).map((line) => line.textContent);
    expect(lines).toContain(`copied packets into ${inputs.names[0]}`);
    expect(lines).toContain(`copied packets into ${inputs.names[1]}`);
  });

  // The cuts are named off the loaded file rather than off the bytes in hand, so a file unloaded
  // while its bytes were being read still gets cuts, under a name no real file's cuts can share.
  it("still cuts the stretches when the file is unloaded while its bytes are being read", async () => {
    const ui = controls();
    const workers = acquireWorkers(1);
    const named = await prepareRun([WINDOWS[0]], workers, ui);
    fetchFile.mockImplementation(() => {
      state.source = null;
      return Promise.resolve(new Uint8Array(8));
    });
    const unnamed = await prepareRun([WINDOWS[1]], workers, ui);
    expect(unnamed.names[0]).toMatch(/^et_snip_[0-9a-z]+_6\.000_2\.000\.mp4$/);
    expect(unnamed.names[0].split("_")[2]).not.toBe(named.names[0].split("_")[2]);
    expect(core.execs).toHaveLength(2);
  });

  it("names the cuts for the file they came from, so another video is never handed them", async () => {
    const ui = controls();
    const workers = acquireWorkers(WINDOWS.length);
    const first = await prepareRun(WINDOWS, workers, ui);
    loadClip("other.mp4");
    const second = await prepareRun(WINDOWS, workers, ui);
    expect(second.names[0]).not.toBe(first.names[0]);
    expect(core.execs).toHaveLength(4);
  });

  it("stops before cutting anything when Stop has already been pressed", async () => {
    const ui = controls();
    encodeTest.cancelRequested = true;
    const err = await prepareRun(WINDOWS, acquireWorkers(WINDOWS.length), ui).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe("Stopped");
    expect(core.execs).toEqual([]);
    // A stop is not a failure to report as one.
    reportRunFailure(err, ui);
    expect(ui.note.textContent).toBe("Stopped.");
    expect(ui.progress.style.display).toBe("none");
  });

  it("stops between the cuts and reading them back", async () => {
    const ui = controls();
    const workers = acquireWorkers(WINDOWS.length);
    await prepareRun(WINDOWS, workers, ui);
    encodeTest.cancelRequested = true;
    await expect(prepareRun(WINDOWS, workers, ui)).rejects.toThrow("Stopped");
    expect(fetchFile).toHaveBeenCalledTimes(1);
  });

  // Without a keyframe table a copy-cut lands wherever ffmpeg's seek decides, which the A/B
  // window's original side would then be misaligned against.
  it("hands the first core the whole video when the container gave no keyframe table", async () => {
    loadClip("clip.mov");
    state.keyframeTimestampsSec = [];
    const ui = controls();
    const workers = acquireWorkers(WINDOWS.length);
    const inputs = await prepareRun(WINDOWS, workers, ui);
    expect(inputs.preCut).toBe(false);
    expect(inputs.names).toEqual(["et_in.mov", "et_in.mov"]);
    expect(inputs.data[0]).toBe(inputs.data[1]);
    expect(Array.from(inputs.data[0])).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(inputs.wholeFileOn).toBe(workers[0]);
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
    await prepareRun(WINDOWS, acquireWorkers(1), ui);
    expect(fetchFile).toHaveBeenCalledWith("https://example.org/clip.mp4");

    state.source.url = null;
    for (const worker of ffmpegPool(1)) worker.reset();
    await prepareRun(WINDOWS, acquireWorkers(1), ui);
    expect(fetchFile).toHaveBeenLastCalledWith(undefined);
  });

  it("refuses to run with no video loaded, cut or not", async () => {
    const ui = controls();
    state.source = null;
    await expect(prepareRun(WINDOWS, acquireWorkers(1), ui)).rejects.toThrow("No video loaded");
    state.keyframeTimestampsSec = [];
    await expect(prepareRun(WINDOWS, acquireWorkers(1), ui)).rejects.toThrow("No video loaded");
    expect(fetchFile).not.toHaveBeenCalled();
  });
});

describe("dropWholeFileInput", () => {
  it("drops the whole video a run needed, and keeps cut stretches for the next run", async () => {
    const ui = controls();
    const workers = acquireWorkers(1);
    await dropWholeFileInput(null);
    await dropWholeFileInput(await prepareRun(WINDOWS, workers, ui));
    // The source was dropped as soon as it was cut; nothing else goes.
    expect(core.deletes).toEqual(["et_in.mp4"]);

    state.keyframeTimestampsSec = [];
    const whole = await prepareRun(WINDOWS, workers, ui);
    expect(workers[0].has("et_in.mp4")).toBe(true);
    await dropWholeFileInput(whole);
    expect(core.deletes).toEqual(["et_in.mp4", "et_in.mp4"]);
    expect(workers[0].has("et_in.mp4")).toBe(false);
  });
});

describe("encodeWindows", () => {
  it("encodes every stretch from its cut, in sampled order, and adds the bytes up", async () => {
    const ui = controls();
    const workers = acquireWorkers(1);
    const progress: number[] = [];

    const result = await encodeWindows(cli, cutInputs(), workers, ui, (fraction) => progress.push(fraction));

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
    const workers = acquireWorkers(1);
    const inputs = await prepareRun(WINDOWS, workers, ui);
    const { blobs } = await encodeWindows(cli, inputs, workers, ui, () => {});
    expect(blobs).toHaveLength(2);
    expect(core.writes).toEqual(["et_in.mp4"]);
    expect(afterInput(core.execs[2], 3)).toEqual(["-i", inputs.names[0], "-c:v"]);
  });

  // Trimmed after -i so the cut is frame-accurate: the two sides of the A/B window need to show the
  // same content, not merely start close to it.
  it("trims the whole video itself when the stretches could not be cut out beforehand", async () => {
    const ui = controls();
    const workers = acquireWorkers(1);
    const data = new Uint8Array(8);
    const inputs: RunInputs = {
      windows: WINDOWS,
      names: ["et_in.mp4", "et_in.mp4"],
      data: [data, data],
      preCut: false,
      wholeFileOn: workers[0],
    };
    await encodeWindows(cli, inputs, workers, ui, () => {});
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
    await encodeWindows(cli, cutInputs(), acquireWorkers(1), ui, (fraction) => progress.push(fraction));
    expect(progress).toEqual([0.25, 0.5, 0.5, 0.75, 1, 1]);
    expect(ui.log.textContent).toContain("[libx264 @ 0x1] using SAR=1/1");
  });

  it("reports nothing off status lines when there is no length to measure against", async () => {
    encodeTest.duration = 0;
    const ui = controls();
    const progress: number[] = [];
    core.exec = (_args, handle) => {
      handle.log("frame=   30 fps=30 q=20.0 size=10kB time=00:00:01.00 bitrate=80kbits/s");
      return Promise.resolve();
    };
    await encodeWindows(cli, cutInputs(), acquireWorkers(1), ui, (fraction) => progress.push(fraction));
    expect(progress).toEqual([0.5, 1]);
  });

  it("spreads the stretches over the cores, and says in the console which one each line came from", async () => {
    vi.spyOn(navigator, "hardwareConcurrency", "get").mockReturnValue(4);
    const ui = controls();
    const workers = acquireWorkers(WINDOWS.length);
    expect(workers.map((w) => w.id)).toEqual([0, 1]);
    core.exec = (_args, handle) => {
      handle.log("x264 says hello");
      return Promise.resolve();
    };

    const { blobs } = await encodeWindows(cli, cutInputs(), workers, ui, () => {});

    expect(blobs).toHaveLength(2);
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
    let { measured } = await encodeWindows(cli, cutInputs(), acquireWorkers(1), ui, () => {});
    expect(measured.map((w) => w.seconds)).toEqual([2, 2]);
    // The Input is let go of either way: leaked by the hundred, the browser stops decoding at all.
    expect(mb.disposed).toBe(2);

    mb.duration = 0;
    ({ measured } = await encodeWindows(cli, cutInputs(), acquireWorkers(1), ui, () => {}));
    expect(measured.map((w) => w.seconds)).toEqual([2, 2]);
  });

  it("refuses with nothing to encode", async () => {
    const ui = controls();
    const run = encodeWindows(cli, cutInputs([]), acquireWorkers(1), ui, () => {});
    await expect(run).rejects.toThrow("No stretch of video to encode");
    expect(core.execs).toEqual([]);
  });

  it("refuses without a video track to build the command for", async () => {
    state.tracks = [];
    const ui = controls();
    const run = encodeWindows(cli, cutInputs(), acquireWorkers(1), ui, () => {});
    await expect(run).rejects.toThrow("No video track loaded");
  });

  it("ends as stopped, not failed, when Stop lands between two stretches", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const ui = controls();
    core.exec = () => {
      encodeTest.cancelRequested = true;
      return Promise.resolve();
    };
    const err = await encodeWindows(cli, cutInputs(), acquireWorkers(1), ui, () => {}).catch((e: unknown) => e);
    expect((err as Error).message).toBe("Stopped");
    // The second stretch was never handed out.
    expect(core.execs).toHaveLength(1);

    reportRunFailure(err, ui);
    expect(ui.note.textContent).toBe("Stopped.");
    expect(ui.progress.style.display).toBe("none");
    expect(error).not.toHaveBeenCalled();
  });

  // Nothing interrupts a call already inside wasm, so the core is terminated: its pending call
  // rejects, and the run unwinds through the error handling it already has.
  it("terminates the core mid-encode when Stop is pressed, and the run unwinds", async () => {
    const ui = controls();
    const workers = acquireWorkers(1);
    startRunUi(ui);
    core.exec = () => new Promise(() => {});
    const run = encodeWindows(cli, cutInputs(), workers, ui, () => {});
    await vi.waitFor(() => expect(core.execs).toHaveLength(1));

    ui.stopButton.click();

    expect(ui.note.textContent).toBe("Stopping…");
    expect(ui.stopButton.disabled).toBe(true);
    await expect(run).rejects.toThrow("called FFmpeg.terminate()");
    expect(stopRequested()).toBe(true);
    expect(core.terminated).toBe(1);
    // The terminated core's filesystem went with it; the next run writes its cuts again.
    expect(workers[0].has("snip0.mp4")).toBe(false);
    endRunUi(ui);
  });
});

describe("acquireWorkers", () => {
  it("sizes the pool for the work, leaving a CPU to the page", () => {
    vi.spyOn(navigator, "hardwareConcurrency", "get").mockReturnValue(8);
    expect(acquireWorkers(10).map((w) => w.id)).toEqual([0, 1, 2, 3]);
    expect(acquireWorkers(2).map((w) => w.id)).toEqual([0, 1]);
    const [only] = acquireWorkers(1);
    expect(only).toBe(defaultFfmpegWorker);
  });

  it("runs on the one core alone where the machine will not say how many it has", () => {
    vi.spyOn(navigator, "hardwareConcurrency", "get").mockReturnValue(NaN);
    expect(acquireWorkers(10)).toEqual([defaultFfmpegWorker]);
  });
});

describe("the run's user interface", () => {
  it("readies the buttons, the bar and the console for a run", () => {
    const ui = controls();
    logLine(ui.log, "left over from last time");
    encodeTest.cancelRequested = true;

    const fill = startRunUi(ui);

    expect(encodeTest.running).toBe(true);
    expect(encodeTest.cancelRequested).toBe(false);
    expect(ui.runButton.disabled).toBe(true);
    expect(ui.stopButton.style.display).toBe("");
    expect(ui.stopButton.disabled).toBe(false);
    expect(ui.progress.style.display).toBe("block");
    expect(fill).toBe(fillOf(ui));
    expect(fill!.style.width).toBe("0%");
    expect(ui.log.textContent).toBe("");
    endRunUi(ui);
  });

  it("hands the buttons back at the end, and forgets the cores Stop would have reached", async () => {
    const ui = controls();
    const workers = acquireWorkers(1);
    await workers[0].load();
    startRunUi(ui);
    ui.runButton.textContent = "Retry 1 failed";

    endRunUi(ui);

    expect(encodeTest.running).toBe(false);
    expect(ui.runButton.disabled).toBe(false);
    expect(ui.runButton.textContent).toBe("Run Matrix");
    expect(ui.stopButton.style.display).toBe("none");
    // A Stop pressed on a later run reaches that run's cores, not this one's.
    encodeTest.running = true;
    ui.stopButton.click();
    expect(core.terminated).toBe(0);
    encodeTest.running = false;
  });

  // A sweep encodes on several cores at once, so the one already inside wasm is not the only one
  // that has to be interrupted: every core the run acquired goes.
  it("terminates every core the run acquired when Stop is pressed", async () => {
    vi.spyOn(navigator, "hardwareConcurrency", "get").mockReturnValue(4);
    const ui = controls();
    const workers = acquireWorkers(WINDOWS.length);
    await Promise.all(workers.map((worker) => worker.load()));
    startRunUi(ui);

    ui.stopButton.click();

    expect(workers).toHaveLength(2);
    expect(core.terminated).toBe(2);
    expect(stopRequested()).toBe(true);
    endRunUi(ui);
  });

  it("says what failed in the note and the console, and takes the bar away", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const ui = controls();
    startRunUi(ui);
    reportRunFailure(new Error("ffmpeg exited 1"), ui);
    expect(ui.note.textContent).toBe("Failed: ffmpeg exited 1");
    expect(ui.log.querySelector(".l.error")!.textContent).toBe("ffmpeg exited 1");
    expect(ui.progress.style.display).toBe("none");
    expect(error).toHaveBeenCalledOnce();
    endRunUi(ui);
  });
});
