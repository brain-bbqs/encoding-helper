// The first core's ~30 MB download (loadCoreUrls) is an await inside ensureLoaded that comes before
// any core exists to terminate: the core the load is building is not yet `instance`, and on 0.12.15
// terminate() before load() is posted does nothing to stop a load() posted after it. These cases hold
// the download (cached once per page, so in a file of its own, each case on a fresh copy of the
// engine) and Stop or load a file during it.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deferred } from "./helpers/async";
import type { CoreControl, CoreEvent } from "./helpers/realisticCore";

const ctl = vi.hoisted(
  () => ({ events: [], afterStop: false, phase: "", hold: null, download: null, seq: 0 }) as unknown as CoreControl,
);
const fileByte = vi.hoisted(() => new WeakMap<object, number>());
const fetchFile = vi.hoisted(() =>
  vi.fn((file: unknown) => Promise.resolve(new Uint8Array(8).fill(fileByte.get(file as object) ?? 0))),
);

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
      return Promise.resolve(1.9);
    }
    dispose(): void {}
  }
  return { ensureMediabunny: () => Promise.resolve({ Input: FakeInput, BlobSource: class {}, ALL_FORMATS: [] }) };
});

const OLD = 1;
const NEW = 2;
const WINDOWS = [
  { startSeconds: 0, seconds: 2 },
  { startSeconds: 6, seconds: 2 },
];
const WAIT = { interval: 2, timeout: 3000 };

type Modules = {
  encoderRun: typeof import("../../src/lib/encoderRun");
  state: typeof import("../../src/lib/state");
  segmentRun: typeof import("../../src/ui/segmentRun");
  chunked: typeof import("../../src/lib/chunkedSource");
  fixtures: typeof import("../fixtures/state");
};

/** A fresh copy of the app's modules, so the engine has not downloaded its core yet. */
async function fresh(): Promise<Modules> {
  vi.resetModules();
  return {
    encoderRun: await import("../../src/lib/encoderRun"),
    state: await import("../../src/lib/state"),
    segmentRun: await import("../../src/ui/segmentRun"),
    chunked: await import("../../src/lib/chunkedSource"),
    fixtures: await import("../fixtures/state"),
  };
}

function loadClip(m: Modules, byte: number, keyframes = true): void {
  const { state } = m.state;
  state.tracks = [m.fixtures.VIDEO_TRACK];
  state.fps = 30;
  state.duration = 20;
  state.file = new File([new Uint8Array(8)], "clip.mp4");
  fileByte.set(state.file, byte);
  state.source = m.chunked.ChunkedSource.fromFile(state.file);
  state.keyframeTimestampsSec = keyframes ? Array.from({ length: 10 }, (_, i) => i * 2) : [];
}

function outcome(p: Promise<unknown>): Promise<string> {
  return p.then(
    () => "resolved",
    (err: unknown) => (err instanceof Error ? err.message : String(err)),
  );
}

async function until(pred: () => boolean): Promise<void> {
  await vi.waitFor(() => expect(pred()).toBe(true), WAIT);
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
}

/** What the stopped run asked of the cores after its stop, or a core built for it: terminating is all
 * that may follow. */
function staleCalls(): CoreEvent[] {
  return ctl.events.filter((e) => e.afterStop && e.phase === "A" && e.kind !== "terminate");
}

beforeEach(() => {
  document.body.innerHTML = "";
  vi.spyOn(navigator, "hardwareConcurrency", "get").mockReturnValue(8);
  ctl.events.length = 0;
  ctl.afterStop = false;
  ctl.phase = "A";
  ctl.hold = null;
  ctl.download = null;
  fetchFile.mockClear();
});

afterEach(async () => {
  ctl.download = null;
  await settle();
  vi.restoreAllMocks();
});

describe("Stop or a file load during the core download", () => {
  it("starts, writes and cuts nothing, and closes the core it was building, when Stop lands mid-download", async () => {
    const m = await fresh();
    m.fixtures.resetCliDefaults();
    loadClip(m, OLD);
    const { nodes, ui } = m.segmentRun.runControls(() => "Run");
    document.body.append(...nodes);
    const run = m.encoderRun.claimEncoder("Compare Quality", true, document.createElement("div"))!;
    const downloading = deferred<void>();
    ctl.download = downloading.promise;
    const workers = m.segmentRun.acquireWorkers(run, 1);
    // As selectMatrixCell does: no load before prepareRun, so the cutter's ensureInput is what loads.
    const done = outcome(m.segmentRun.prepareRun(run, WINDOWS, workers, ui));
    await until(() => ctl.events.some((e) => e.kind === "new"));
    const building = ctl.seq;

    ctl.afterStop = true;
    m.encoderRun.stopEncoderRun();
    downloading.resolve();

    expect(await done).toMatch(/terminate|Stopped/);
    expect(staleCalls()).toEqual([]);
    const after = ctl.events.filter((e) => e.afterStop).map((e) => `${e.kind}#${e.core === building ? "old" : "new"}`);
    // The core it was building is closed, its load never posted once the download is in hand, so no
    // worker is started for the stopped run; nor is it left as the worker's core holding the source.
    expect(after).toEqual(["terminate#old"]);
    expect(workers[0].has("et_in.mp4")).toBe(false);
    m.encoderRun.abandonEncoderRun();
  });

  it("encodes only the next file in the next file's run, which shares the download", async () => {
    const m = await fresh();
    m.fixtures.resetCliDefaults();
    loadClip(m, OLD, false);
    const { nodes, ui } = m.segmentRun.runControls(() => "Run");
    document.body.append(...nodes);
    const runA = m.encoderRun.claimEncoder("Compare Quality", true, document.createElement("div"))!;
    const downloading = deferred<void>();
    ctl.download = downloading.promise;
    const workersA = m.segmentRun.acquireWorkers(runA, 2);
    const doneA = outcome(
      (async () => {
        await workersA[0].load();
        const inputs = await m.segmentRun.prepareRun(runA, WINDOWS, workersA, ui);
        return m.segmentRun.encodeWindows(runA, m.state.cli, inputs, workersA, ui, () => {});
      })(),
    );
    await until(() => ctl.events.some((e) => e.kind === "new"));

    ctl.afterStop = true;
    m.encoderRun.abandonEncoderRun();
    await settle();
    ctl.phase = "B";
    loadClip(m, NEW, false);
    const runB = m.encoderRun.claimEncoder("Compare Quality", true, document.createElement("div"))!;
    const workersB = m.segmentRun.acquireWorkers(runB, 2);
    const doneB = outcome(
      (async () => {
        await workersB[0].load();
        const inputs = await m.segmentRun.prepareRun(runB, WINDOWS, workersB, ui);
        return m.segmentRun.encodeWindows(runB, m.state.cli, inputs, workersB, ui, () => {});
      })(),
    );
    downloading.resolve();

    expect(await doneA).toMatch(/terminate|Stopped/);
    expect(await doneB).toBe("resolved");
    expect(ctl.events.filter((e) => e.kind === "exec" && e.phase === "B").map((e) => e.byte)).toEqual([NEW, NEW]);
    expect(ctl.events.filter((e) => e.afterStop && e.kind === "writeFile" && e.byte === OLD)).toEqual([]);
    m.encoderRun.abandonEncoderRun();
  });

  // The old run is inside the cutter's ensureInput (selectMatrixCell's path: no load beforehand)
  // when the file changes mid-download; the next file's sweep then cuts and encodes on the same core.
  // Cut stretches are named for the file's name and size, which the two files share here, so a cut
  // or a source the old run left in the core would be taken up by the next run as its own.
  it("leaves nothing the next run takes up when the file changes while a cutter loads for the old video", async () => {
    const m = await fresh();
    m.fixtures.resetCliDefaults();
    loadClip(m, OLD, true);
    const { nodes, ui } = m.segmentRun.runControls(() => "Run");
    document.body.append(...nodes);
    const runA = m.encoderRun.claimEncoder("Compare Quality", true, document.createElement("div"))!;
    const downloading = deferred<void>();
    ctl.download = downloading.promise;
    const workersA = m.segmentRun.acquireWorkers(runA, 1);
    const doneA = outcome(m.segmentRun.prepareRun(runA, WINDOWS, workersA, ui));
    await until(() => ctl.events.some((e) => e.kind === "new"));

    ctl.afterStop = true;
    m.encoderRun.abandonEncoderRun();
    await settle();
    ctl.phase = "B";
    loadClip(m, NEW, true);
    const runB = m.encoderRun.claimEncoder("Compare Quality", true, document.createElement("div"))!;
    const workersB = m.segmentRun.acquireWorkers(runB, 1);
    const doneB = outcome(
      (async () => {
        await workersB[0].load();
        const inputs = await m.segmentRun.prepareRun(runB, WINDOWS, workersB, ui);
        return m.segmentRun.encodeWindows(runB, m.state.cli, inputs, workersB, ui, () => {});
      })(),
    );
    downloading.resolve();

    expect(await doneA).toMatch(/terminate|Stopped/);
    expect(await doneB).toBe("resolved");
    const execsB = ctl.events.filter((e) => e.kind === "exec" && e.phase === "B");
    expect(execsB.map((e) => e.byte)).toEqual([NEW, NEW, NEW, NEW]);
    expect(ctl.events.filter((e) => e.afterStop && e.byte === OLD)).toEqual([]);
    m.encoderRun.abandonEncoderRun();
  });
});
