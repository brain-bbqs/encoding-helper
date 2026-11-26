// What the Educational switch does once a file is up: it shows or hides the teaching material and
// leaves everything else on the page as it was, so a sweep in flight keeps its Stop button and its
// grid, a comparison and seek results stay up, and a flip made while the demos page covers the app
// shows when it closes. Booted with `?edu=0`, so the material starts hidden from the link.
//
// The Compare tab, the A/B window and the seeking test run for real, over a faked ffmpeg core and
// decoder; the tabs not under test are stubbed. The page's own stylesheet is loaded, so "hidden"
// is what it computes to rather than which classes are set. jsdom weighs rules by their order
// alone, which the hiding rule, placed after the rules it overrides, satisfies as a browser does.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { IDBFactory } from "fake-indexeddb";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { VIDEO_TRACK } from "../fixtures/state";
import { ChunkedSource } from "../../src/lib/chunkedSource";
import { sampledEncode, state } from "../../src/lib/state";
import { deferred } from "./helpers/async";
import { bootMain, el } from "./helpers/mainHarness";

const fileLoading = vi.hoisted(() => ({ onLoaded: null as null | (() => void) }));
/** An encode still running: every -crf exec waits on it while it is set. */
const core = vi.hoisted(() => ({ held: null as Promise<void> | null }));

vi.mock("../../src/ui/fileLoading", () => ({
  initFileLoadingUi: (_els: unknown, callbacks: { onLoaded: () => void }) => {
    fileLoading.onLoaded = callbacks.onLoaded;
    return { loadFile: () => Promise.resolve(), loadUrl: () => Promise.resolve() };
  },
}));
vi.mock("../../src/ui/inspectTab", () => ({ renderInspectHead: () => {}, renderInspectTail: () => {} }));
vi.mock("../../src/ui/atomsTab", () => ({ renderAtomMap: () => {} }));
vi.mock("../../src/ui/inspectToc", () => ({ mountInspectToc: () => {} }));
vi.mock("../../src/ui/encodeTab", () => ({ renderEncodeTab: () => {} }));
vi.mock("../../src/ui/analysisTab", () => ({ renderAnalysisTab: () => {} }));

vi.mock("@ffmpeg/util", () => ({
  toBlobURL: () => Promise.resolve("blob:core"),
  fetchFile: () => Promise.resolve(new Uint8Array(8)),
}));
vi.mock("@ffmpeg/ffmpeg", () => {
  class FakeFFmpeg {
    on(): void {}
    load(): Promise<void> {
      return Promise.resolve();
    }
    terminate(): void {}
    writeFile(): Promise<void> {
      return Promise.resolve();
    }
    exec(args: string[]): Promise<void> {
      return (args.includes("-crf") && core.held) || Promise.resolve();
    }
    readFile(): Promise<Uint8Array> {
      return Promise.resolve(new Uint8Array(3));
    }
    deleteFile(): Promise<void> {
      return Promise.resolve();
    }
  }
  return { FFmpeg: FakeFFmpeg };
});
vi.mock("../../src/lib/mediabunny", () => {
  class FakeInput {
    getPrimaryVideoTrack(): Promise<{ canDecode: () => Promise<boolean> }> {
      return Promise.resolve({ canDecode: () => Promise.resolve(true) });
    }
    computeDuration(): Promise<number> {
      return Promise.resolve(1.9);
    }
    dispose(): void {}
  }
  class FakeCanvasSink {
    getCanvas(): Promise<null> {
      return Promise.resolve(null);
    }
  }
  return {
    ensureMediabunny: () =>
      Promise.resolve({ Input: FakeInput, BlobSource: class {}, CanvasSink: FakeCanvasSink, ALL_FORMATS: [] }),
  };
});

// The measurement cache opens the page's IndexedDB on first use, which jsdom does not have.
globalThis.indexedDB = new IDBFactory();

/** How a test waits on a run: polling, never sleeping. */
const WAIT = { interval: 5, timeout: 3000 };

const CLIP_BYTES = Uint8Array.from({ length: 1000 }, (_, i) => i % 251);

/** A 20-second file with a keyframe every two seconds, as the loader leaves the state for it. */
function loadClip(): void {
  state.tracks = [VIDEO_TRACK];
  state.duration = 20;
  state.fps = 30;
  state.videoTrack = {} as never;
  state.keyframeTimestampsSec = Array.from({ length: 10 }, (_, i) => i * 2);
  state.file = new File([CLIP_BYTES], "clip.mp4");
  const source = ChunkedSource.fromFile(state.file);
  source.readChunk = (offset, size) =>
    Promise.resolve(CLIP_BYTES.slice(offset, Math.min(offset + size, CLIP_BYTES.length)).buffer as ArrayBuffer);
  state.source = source;
}

function switchInput(): HTMLInputElement {
  return el("eduToggleSlot").querySelector<HTMLInputElement>("input.switch")!;
}

/** Sets the switch from the header, as a reader would. */
function setSwitch(on: boolean): void {
  const input = switchInput();
  if (input.checked === on) return;
  input.checked = on;
  input.dispatchEvent(new Event("change"));
}

function shown(node: Element): boolean {
  return getComputedStyle(node).display !== "none";
}

/** Every teach box on the page, and every ⓘ by its wrapper (a bare `.info` also names a log level). */
function teachingMaterial(): Element[] {
  const boxes = [...document.querySelectorAll("#introCard .teach, #app .teach")];
  const icons = [...document.querySelectorAll("#app .info-btn")].map((btn) => btn.parentElement!);
  return [...boxes, ...icons];
}

const comparePanel = (): HTMLElement => el("panel-compare");
const runButton = (): HTMLButtonElement =>
  comparePanel().querySelectorAll<HTMLButtonElement>(".compare-run-buttons button")[0];
const stopButton = (): HTMLButtonElement =>
  comparePanel().querySelectorAll<HTMLButtonElement>(".compare-run-buttons button")[1];
const square = (): HTMLButtonElement => comparePanel().querySelector<HTMLButtonElement>("button.matrix-cell")!;
const seekRows = (): number => el("seekResultsWrap").querySelectorAll("tbody tr").length;

/** Sets the URL the way browser history would and lets the page hear about it. */
function walkTo(demos: boolean): void {
  const url = new URL(window.location.href);
  if (demos) url.searchParams.set("demos", "");
  else url.searchParams.delete("demos");
  window.history.pushState({}, "", url.pathname + url.search);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

beforeAll(async () => {
  await bootMain("?edu=0");
  const sheet = document.createElement("style");
  sheet.textContent = readFileSync(resolve(process.cwd(), "src/style.css"), "utf-8");
  document.head.append(sheet);
  loadClip();
  // One square, so the sweep is one encode a test can hold.
  sampledEncode.matrix.qualities = ["high"];
  sampledEncode.matrix.presets = ["ultrafast"];
  sampledEncode.matrix.scales = [1];
  sampledEncode.duration = 2;
  sampledEncode.segments = 1;
  el("app").style.display = "";
  fileLoading.onLoaded!();
});

describe("the Educational switch with a file on screen", () => {
  it("starts with the teaching material hidden when the link turns it off", () => {
    expect(switchInput().checked).toBe(false);
    expect(document.documentElement.classList.contains("edu-off")).toBe(true);
    expect(teachingMaterial().length).toBeGreaterThan(0);
    expect(teachingMaterial().filter(shown)).toEqual([]);
  });

  it("leaves a sweep's Stop button and grid live through a flip", async () => {
    const held = deferred<void>();
    core.held = held.promise;
    runButton().click();
    await vi.waitFor(() => expect(square().textContent).toContain("encoding"), WAIT);
    const stop = stopButton();
    const grid = comparePanel().querySelector(".matrix-section")!;
    expect(stop.style.display).toBe("");

    setSwitch(true);
    expect(teachingMaterial().every(shown)).toBe(true);
    expect(stop.isConnected).toBe(true);
    expect(stop.style.display).toBe("");
    expect(runButton().disabled).toBe(true);

    core.held = null;
    held.resolve();
    await vi.waitFor(() => expect(runButton().disabled).toBe(false), WAIT);
    expect(stop.style.display).toBe("none");
    // The grid on the page is the one the run went on painting: measured, ringed and clickable.
    expect(grid.isConnected).toBe(true);
    expect(square().textContent).not.toContain("encoding");
    expect(square().classList.contains("selected")).toBe(true);
    expect(square().disabled).toBe(false);
    expect(comparePanel().querySelectorAll(".compare-pane")).toHaveLength(2);
  });

  it("keeps the comparison and the seek results on screen through a flip", async () => {
    el<HTMLInputElement>("seekN").value = "5";
    el("runSeekBtn").click();
    await vi.waitFor(() => expect(seekRows()).toBe(5), WAIT);
    const panes = [...comparePanel().querySelectorAll(".compare-pane")];

    setSwitch(false);
    expect(seekRows()).toBe(5);
    expect(panes.every((pane) => pane.isConnected)).toBe(true);
    expect(square().classList.contains("selected")).toBe(true);
    expect(comparePanel().textContent).toContain("Run This Setting with ffmpeg");
    expect(teachingMaterial().filter(shown)).toEqual([]);
  });

  // The demos page hides #app while it is up, which a file already open can reach through the
  // browser's history.
  it("applies a flip made while the demos page covers the app once it closes", () => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    setSwitch(true);
    walkTo(true);
    expect(el("app").style.display).toBe("none");

    setSwitch(false);
    walkTo(false);
    expect(el("app").style.display).toBe("");
    const inspectBoxes = [...el("panel-inspect").querySelectorAll(".teach")];
    expect(inspectBoxes.length).toBeGreaterThan(0);
    expect(inspectBoxes.filter(shown)).toEqual([]);
    expect(teachingMaterial().filter(shown)).toEqual([]);
  });
});
