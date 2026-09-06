import type { InputVideoTrack } from "mediabunny";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetState, state } from "../../src/lib/state";
import type { SeekResult } from "../../src/lib/types";

/** Every timestamp the run asked the sink to decode, in order. */
const decodeRequests: number[] = [];
/** The track and options every sink was opened over. */
const sinksOpened: { track: unknown; options: unknown }[] = [];
/** What the stubbed clock reads; a decode moves it on by `decodeCost`. */
let clock = 0;
/** How long the stub says decoding the frame at `seconds` takes. */
let decodeCost: (seconds: number) => number = () => 2.5;
/** When set, the sink refuses to decode the frame at that timestamp. */
let refuseAt: number | null = null;
/** When set, mediabunny itself will not load. */
let loadError: Error | null = null;

// The run decodes with mediabunny, which is not what is under test: what it does with the decode
// times and the keyframe distances is, so the decoder is stubbed and its clock is under control.
vi.mock("../../src/lib/mediabunny", () => {
  class FakeCanvasSink {
    constructor(track: unknown, options: unknown) {
      sinksOpened.push({ track, options });
    }
    async getCanvas(seconds: number): Promise<{ canvas: HTMLCanvasElement } | null> {
      decodeRequests.push(seconds);
      if (refuseAt === seconds) throw new Error("no frame at " + seconds);
      clock += decodeCost(seconds);
      return { canvas: document.createElement("canvas") };
    }
  }
  return {
    ensureMediabunny: async () => {
      if (loadError) throw loadError;
      return { CanvasSink: FakeCanvasSink };
    },
  };
});

const { renderGopHistogram, renderSeekScatter, renderSeekTab } = await import("../../src/ui/seekTab");

/** Stands in for the loaded file's decodable track; the stub never reads it. */
const VIDEO_TRACK = { id: "video" } as unknown as InputVideoTrack;

function result(over: Partial<SeekResult> = {}): SeekResult {
  return { t: 1.5, kf: 1, dist: 0.5, distFrames: 15, decodeMs: 12.34, ...over };
}

/** A 10-second file with a keyframe every 2 seconds, loaded and decodable. */
function loadClip(): void {
  state.videoTrack = VIDEO_TRACK;
  state.duration = 10;
  state.keyframeTimestampsSec = [0, 2, 4, 6, 8];
  state.fps = 30;
}

/** The tab rendered into the page, with the error slot index.html keeps for a failed run. */
function renderTab(): HTMLElement {
  const errorMsg = document.createElement("div");
  errorMsg.id = "errorMsg";
  errorMsg.style.display = "none";
  document.body.append(errorMsg);
  const panel = document.createElement("div");
  document.body.append(panel);
  renderSeekTab(panel);
  return panel;
}

/** Lets whatever the last event queued run to completion. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** Sets the sample count and presses Run, then waits for the run to finish. */
async function run(panel: HTMLElement, samples: string): Promise<void> {
  panel.querySelector<HTMLInputElement>("#seekN")!.value = samples;
  panel.querySelector<HTMLButtonElement>("#runSeekBtn")!.click();
  await flush();
}

function gridValue(wrap: Element, label: string): string | null {
  const item = Array.from(wrap.querySelectorAll(".item")).find(
    (el) => el.querySelector("label")?.textContent === label,
  );
  return item?.querySelector(".val")?.textContent ?? null;
}

function tableRows(wrap: Element): string[][] {
  return Array.from(wrap.querySelectorAll("tbody tr")).map((tr) =>
    Array.from(tr.querySelectorAll("td")).map((td) => td.textContent ?? ""),
  );
}

beforeEach(() => {
  document.body.innerHTML = "";
  resetState();
  decodeRequests.length = 0;
  sinksOpened.length = 0;
  clock = 0;
  decodeCost = () => 2.5;
  refuseAt = null;
  loadError = null;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the seeking test run", () => {
  it("samples the middle of each of n stretches and measures each decode against its keyframe", async () => {
    loadClip();
    const panel = renderTab();
    await run(panel, "5");

    expect(sinksOpened).toEqual([{ track: VIDEO_TRACK, options: { poolSize: 2 } }]);
    expect(decodeRequests).toEqual([1, 3, 5, 7, 9]);
    expect(state.seekResults).toEqual([
      { t: 1, kf: 0, dist: 1, distFrames: 30, decodeMs: 2.5 },
      { t: 3, kf: 2, dist: 1, distFrames: 30, decodeMs: 2.5 },
      { t: 5, kf: 4, dist: 1, distFrames: 30, decodeMs: 2.5 },
      { t: 7, kf: 6, dist: 1, distFrames: 30, decodeMs: 2.5 },
      { t: 9, kf: 8, dist: 1, distFrames: 30, decodeMs: 2.5 },
    ]);
  });

  it("summarises the run, plots it, and folds the sampled rows away under it", async () => {
    loadClip();
    decodeCost = (seconds) => seconds * 2;
    const panel = renderTab();
    await run(panel, "5");

    const wrap = panel.querySelector("#seekResultsWrap")!;
    expect(gridValue(wrap, "Avg Keyframe Distance")).toBe("1.000 s");
    expect(gridValue(wrap, "Avg Decode Time")).toBe("10.0 ms");
    expect(gridValue(wrap, "Max Decode Time")).toBe("18.0 ms");
    expect(wrap.querySelectorAll("svg.seek-scatter circle.pt")).toHaveLength(5);

    const fold = wrap.querySelector<HTMLDetailsElement>("details.fold")!;
    expect(fold.open).toBe(false);
    expect(fold.querySelector("summary")!.textContent).toContain("Sampled timestamps");
    expect(Array.from(fold.querySelectorAll("th")).map((th) => th.textContent)).toEqual([
      "Timestamp",
      "Nearest Keyframe ≤ t",
      "Distance",
      "Distance (frames)",
      "Decode Time",
    ]);
    expect(tableRows(fold)[0]).toEqual(["1.000s", "0.000s", "1.000s", "30", "2.0 ms"]);
    expect(tableRows(fold)).toHaveLength(5);
  });

  it("holds the button and shows the bar while it runs, then hands both back", async () => {
    loadClip();
    const panel = renderTab();
    const btn = panel.querySelector<HTMLButtonElement>("#runSeekBtn")!;
    const progress = panel.querySelector<HTMLDivElement>("#seekProgress")!;
    expect(progress.style.display).toBe("none");

    panel.querySelector<HTMLInputElement>("#seekN")!.value = "4";
    btn.click();
    expect(btn.disabled).toBe(true);
    expect(progress.style.display).toBe("block");

    await flush();
    expect(btn.disabled).toBe(false);
    expect(progress.style.display).toBe("none");
    expect(progress.querySelector<HTMLDivElement>(".fill")!.style.width).toBe("100%");
  });

  // The field is a number input, so an emptied one reads as no count at all rather than zero.
  it("falls back to a hundred samples when the count is emptied", async () => {
    loadClip();
    const panel = renderTab();
    await run(panel, "");
    expect(decodeRequests).toHaveLength(100);
    expect(decodeRequests[0]).toBe(0.05);
    expect(decodeRequests[99]).toBe(9.95);
  });

  // A file whose duration could not be read has nothing to spread the samples over, so every one
  // lands at the start rather than at NaN.
  it("samples the start of a file with no known duration", async () => {
    loadClip();
    state.duration = null;
    const panel = renderTab();
    await run(panel, "2");
    expect(decodeRequests).toEqual([0, 0]);
    expect(state.seekResults!.map((r) => r.dist)).toEqual([0, 0]);
  });

  // Before the first keyframe there is nothing to seek from, so those columns have no answer; and
  // an unmeasured frame rate reads as 30 for the frame count, as it does everywhere else.
  it("leaves a timestamp before the first keyframe without a distance", async () => {
    loadClip();
    state.keyframeTimestampsSec = [5];
    state.fps = null;
    const panel = renderTab();
    await run(panel, "2");

    expect(state.seekResults).toEqual([
      { t: 2.5, kf: null, dist: null, distFrames: null, decodeMs: 2.5 },
      { t: 7.5, kf: 5, dist: 2.5, distFrames: 75, decodeMs: 2.5 },
    ]);
    const wrap = panel.querySelector("#seekResultsWrap")!;
    expect(tableRows(wrap)[0]).toEqual(["2.500s", "–", "–", "–", "2.5 ms"]);
    // One point is not a distribution, so there is no scatter to draw.
    expect(wrap.querySelector("svg.seek-scatter")).toBeNull();
  });

  it("clears the last run's results before starting the next", async () => {
    loadClip();
    const panel = renderTab();
    await run(panel, "5");
    const wrap = panel.querySelector("#seekResultsWrap")!;
    expect(wrap.querySelectorAll(".grid")).toHaveLength(1);
    await run(panel, "3");
    expect(wrap.querySelectorAll(".grid")).toHaveLength(1);
    expect(tableRows(wrap)).toHaveLength(3);
  });

  it("reports a decoder that will not load in the page's error slot and lets the button go", async () => {
    loadClip();
    loadError = new Error("decoder unavailable");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const panel = renderTab();
    await run(panel, "5");

    const errorMsg = document.getElementById("errorMsg")!;
    expect(errorMsg.textContent).toBe("Seeking test failed: decoder unavailable");
    expect(errorMsg.style.display).toBe("block");
    expect(error).toHaveBeenCalledOnce();
    expect(state.seekResults).toBeNull();
    expect(panel.querySelector<HTMLButtonElement>("#runSeekBtn")!.disabled).toBe(false);
    expect(panel.querySelector<HTMLDivElement>("#seekProgress")!.style.display).toBe("none");
  });

  it("refuses to run before a file with a video track is open", async () => {
    state.duration = 10;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const panel = renderTab();
    await run(panel, "5");
    expect(document.getElementById("errorMsg")!.textContent).toBe("Seeking test failed: No video track loaded");
    expect(sinksOpened).toHaveLength(0);
  });

  // A run that dies half-way keeps nothing: a partial run would be read as the whole file's.
  it("keeps no results from a run the decoder gave up on part-way", async () => {
    loadClip();
    refuseAt = 5;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const panel = renderTab();
    await run(panel, "5");
    expect(decodeRequests).toEqual([1, 3, 5]);
    expect(state.seekResults).toBeNull();
    expect(panel.querySelector("#seekResultsWrap")!.children).toHaveLength(0);
    expect(document.getElementById("errorMsg")!.textContent).toBe("Seeking test failed: no frame at 5");
  });

  // Not every host puts the error slot in the page; a run failing without one still ends cleanly.
  it("still releases the button when there is no error slot to report into", async () => {
    loadClip();
    loadError = new Error("decoder unavailable");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const panel = document.createElement("div");
    document.body.append(panel);
    renderSeekTab(panel);
    await run(panel, "5");
    expect(panel.querySelector<HTMLButtonElement>("#runSeekBtn")!.disabled).toBe(false);
  });
});

describe("the sampled-timestamps export", () => {
  /** Runs a three-sample test and hands back the export button and the fold that holds it. */
  async function runAndFindExport(): Promise<{ exportBtn: HTMLButtonElement; fold: HTMLDetailsElement }> {
    loadClip();
    state.keyframeTimestampsSec = [4];
    decodeCost = (seconds) => seconds;
    const panel = renderTab();
    await run(panel, "3");
    const fold = panel.querySelector<HTMLDetailsElement>("#seekResultsWrap details.fold")!;
    return { exportBtn: fold.querySelector<HTMLButtonElement>("summary .fold-note button")!, fold };
  }

  // The URL static methods are real functions in this environment, so what the stubs replace is put back.
  const urlOriginals = (["createObjectURL", "revokeObjectURL"] as const).map(
    (name) => [name, Object.getOwnPropertyDescriptor(URL, name)] as const,
  );
  afterEach(() => {
    for (const [name, desc] of urlOriginals) {
      if (desc) Object.defineProperty(URL, name, desc);
      else delete (URL as unknown as Record<string, unknown>)[name];
    }
  });

  /** Captures the blob downloadBlob hands the browser, without the link's click going anywhere. */
  function captureDownload(): { blobs: Blob[]; names: string[]; revoked: string[] } {
    const blobs: Blob[] = [];
    const names: string[] = [];
    const revoked: string[] = [];
    Object.defineProperty(URL, "createObjectURL", {
      value: (blob: Blob) => {
        blobs.push(blob);
        return "blob:fake";
      },
      configurable: true,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      value: (url: string) => {
        revoked.push(url);
      },
      configurable: true,
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download);
    });
    return { blobs, names, revoked };
  }

  /** Fires the export and drains the timer downloadBlob leaves behind to revoke the URL seconds later. */
  function exportNow(fire: () => void): void {
    vi.useFakeTimers();
    try {
      fire();
      vi.runAllTimers();
    } finally {
      vi.useRealTimers();
    }
  }

  /** jsdom's Blob has no text(); the reader it does have reads the same bytes. */
  function blobText(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(blob);
    });
  }

  it("writes the same rows as the table, tab-separated, with a blank where the table dashes", async () => {
    const { exportBtn } = await runAndFindExport();
    const download = captureDownload();
    expect(exportBtn.textContent).toBe("Export table (TSV)");

    exportNow(() => exportBtn.click());

    expect(download.names).toEqual(["seek-test.tsv"]);
    expect(download.revoked).toEqual(["blob:fake"]);
    expect(download.blobs[0].type).toBe("text/tab-separated-values");
    expect(await blobText(download.blobs[0])).toBe(
      [
        "Timestamp (s)\tNearest keyframe <= t (s)\tDistance (s)\tDistance (frames)\tDecode time (ms)",
        "1.667\t\t\t\t1.667",
        "5.000\t4.000\t1.000\t30\t5.000",
        "8.333\t4.000\t4.333\t130\t8.333",
        "",
      ].join("\n"),
    );
  });

  // The button sits on the fold's bar, where a click would otherwise also open the table under it.
  it("exports without toggling the table it sits on open", async () => {
    const { exportBtn, fold } = await runAndFindExport();
    captureDownload();
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    exportNow(() => exportBtn.dispatchEvent(click));
    expect(click.defaultPrevented).toBe(true);
    expect(fold.open).toBe(false);
  });
});

describe("renderSeekScatter", () => {
  it("draws nothing for an empty run", () => {
    expect(renderSeekScatter([])).toBeNull();
  });

  // The plot needs two points with a distance to be a distribution; timestamps before the first
  // keyframe have none and are left out.
  it("draws nothing until two sampled timestamps have a keyframe distance", () => {
    expect(renderSeekScatter([result({ dist: null }), result({ dist: null }), result()])).toBeNull();
  });

  it("plots one point per timestamp with a distance, scaled a little past the largest of each", () => {
    const svg = renderSeekScatter([
      result({ t: 1, dist: 0.5, decodeMs: 10 }),
      result({ t: 2, dist: 2, decodeMs: 100 }),
      result({ t: 3, dist: null, decodeMs: 500 }),
    ])!;
    expect(svg.getAttribute("viewBox")).toBe("0 0 600 280");
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.querySelectorAll("circle.pt")).toHaveLength(2);
    // The axes run to 1.08x the largest distance and decode time among the plotted points, so the
    // undrawn 500 ms sample does not stretch the y axis.
    const ticks = Array.from(svg.querySelectorAll("text.tick")).map((el) => el.textContent);
    expect(ticks).toEqual(["0.00", "0", "0.54", "27", "1.08", "54", "1.62", "81", "2.16", "108"]);
    const titles = Array.from(svg.querySelectorAll("g > title")).map((el) => el.textContent);
    expect(titles).toEqual([
      "t=1.00s  ·  distance=0.500s  ·  decode=10.0ms",
      "t=2.00s  ·  distance=2.000s  ·  decode=100.0ms",
    ]);
    expect(Array.from(svg.querySelectorAll("text.axis-title")).map((el) => el.textContent)).toEqual([
      "Keyframe distance (s)",
      "Decode time (ms)",
    ]);
  });

  it("puts the largest point at the top right of the plot and a zero at its origin", () => {
    const svg = renderSeekScatter([result({ dist: 0, decodeMs: 0 }), result({ dist: 2, decodeMs: 100 })])!;
    const pts = Array.from(svg.querySelectorAll("circle.pt"));
    expect([pts[0].getAttribute("cx"), pts[0].getAttribute("cy")]).toEqual(["56", "240"]);
    // 1/1.08 of the way across the plot's 528 px and up its 224 px.
    expect(Number(pts[1].getAttribute("cx"))).toBeCloseTo(56 + 528 / 1.08, 6);
    expect(Number(pts[1].getAttribute("cy"))).toBeCloseTo(240 - 224 / 1.08, 6);
  });

  // Every seek landing on a keyframe and decoding instantly leaves nothing to scale by; the axes
  // then run to one rather than dividing by zero.
  it("gives an all-zero run unit axes instead of collapsing them", () => {
    const svg = renderSeekScatter([result({ dist: 0, decodeMs: 0 }), result({ dist: 0, decodeMs: 0 })])!;
    const ticks = Array.from(svg.querySelectorAll("text.tick")).map((el) => el.textContent);
    expect(ticks).toEqual(["0.00", "0", "0.25", "0", "0.50", "1", "0.75", "1", "1.00", "1"]);
    const pts = Array.from(svg.querySelectorAll("circle.pt"));
    expect(pts.map((p) => [p.getAttribute("cx"), p.getAttribute("cy")])).toEqual([
      ["56", "240"],
      ["56", "240"],
    ]);
  });
});

describe("renderGopHistogram", () => {
  it("scales each interval against the longest and calls out the ones well over the average", () => {
    const hist = renderGopHistogram([30, 30, 90]);
    const bars = Array.from(hist.querySelectorAll<HTMLDivElement>(".bar"));
    expect(bars.map((b) => b.style.height)).toEqual(["30px", "30px", "90px"]);
    expect(bars.map((b) => b.classList.contains("tall"))).toEqual([false, false, true]);
    expect(bars[2].title).toBe("90 frames");
  });
});

describe("renderSeekTab", () => {
  it("prints the keyframe structure of the loaded file above the test", () => {
    state.samples = Array.from({ length: 90 }, () => ({ size: 1, cts: 0, dts: 0, ctsSec: 0, is_sync: false }));
    state.keyframeDecodeIndices = [0, 30, 60];
    state.gopLengths = [30, 30, 30];
    state.fps = 30;
    state.hasBFrames = true;
    const panel = renderTab();
    expect(gridValue(panel, "Total Frames")).toBe("90");
    expect(gridValue(panel, "Keyframes")).toBe("3");
    expect(gridValue(panel, "Avg GOP")).toBe("30.0 frames (1.00 s)");
    expect(gridValue(panel, "Min / Max GOP")).toBe("30 / 30 frames");
    expect(panel.querySelector(".badge")!.textContent).toBe("Uses B-frames (cts ≠ dts)");
    expect(panel.querySelector(".hist")).not.toBeNull();
  });

  it("reads an empty file as no GOPs, no histogram and no B-frames", () => {
    const panel = renderTab();
    expect(gridValue(panel, "Min / Max GOP")).toBe("0 / 0 frames");
    expect(panel.querySelector(".badge")!.textContent).toBe("No B-frames");
    expect(panel.querySelector(".hist")).toBeNull();
  });
});
