import { beforeEach, describe, expect, it } from "vitest";
import { SAMPLE_SECONDS } from "../../src/lib/sampleTimeline";
import { cli, encodeTest, resetState, state } from "../../src/lib/state";
import type { TrackInfo } from "../../src/lib/types";
import { renderCompareTab } from "../../src/ui/compareTab";
import { renderEncodeTab } from "../../src/ui/encodeTab";

const VIDEO_TRACK: TrackInfo = {
  kind: "video",
  codec: "avc",
  codecString: "avc1.640020",
  codecInfo: null,
  packetCount: 600,
  packetRate: 30,
  bitrate: 500_000,
  codedWidth: 640,
  codedHeight: 480,
};

/** The tab, rendered over one loaded 20-second file. The panel goes into the document because the
 * tab binds its fields by id, the way the app's own panels are already in the page. */
function renderTab(format = "MP4"): HTMLElement {
  state.tracks = [VIDEO_TRACK];
  state.duration = 20;
  state.fps = 30;
  state.format = format;
  const panel = document.createElement("div");
  document.body.append(panel);
  renderEncodeTab(panel);
  return panel;
}

beforeEach(() => {
  document.body.innerHTML = "";
  resetState();
  // The CLI settings deliberately survive resetState (they are the user's, not the file's), so the
  // ones this file edits are put back by hand rather than leaking into the tests after it.
  cli.quality = "medium";
  cli.crf = 25;
  cli.preset = "superfast";
  cli.scale = 1;
  cli.scaler = "lanczos";
  encodeTest.duration = 5;
  encodeTest.segments = 5;
});

describe("renderEncodeTab", () => {
  it("renders nothing without a video track", () => {
    state.tracks = [];
    const panel = document.createElement("div");
    renderEncodeTab(panel);
    expect(panel.children).toHaveLength(0);
  });

  it("builds the command live from the fields above it", () => {
    const panel = renderTab();
    expect(panel.querySelector("#cmdPre")!.textContent).toContain("-crf 25");
    const quality = panel.querySelector<HTMLSelectElement>("#cliQuality")!;
    quality.value = "low";
    quality.dispatchEvent(new Event("change"));
    expect(panel.querySelector("#cmdPre")!.textContent).toContain("-crf 32");
  });

  // Trying one setting on a few seconds moved here from Compare Quality, where it sat beside a
  // sweep it had nothing to do with; here it is a run of the command directly above it.
  it("offers a run of the built command over one fixed stretch", () => {
    const panel = renderTab();
    // The length and the count are fixed, so they are not on the page at all: where the stretch
    // comes from is the only question, and the track below asks it.
    expect(panel.querySelector("#sampleDuration")).toBeNull();
    expect(panel.querySelector("#sampleSegments")).toBeNull();
    expect(panel.querySelector(".compare-run-buttons button")!.textContent).toBe("Run Comparison");
  });

  it("puts a track across the whole recording to pick that stretch with", () => {
    const panel = renderTab();
    const band = panel.querySelector<HTMLElement>(".sample-band")!;
    // Three seconds of a twenty-second file, drawn to scale.
    expect(band.style.width).toBe("15%");
    expect(band.style.left).toBe("0%");
    expect(panel.querySelectorAll(".sample-tick-label").length).toBeGreaterThan(1);

    band.focus();
    band.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", shiftKey: true, bubbles: true }));
    expect(encodeTest.sampleStart).toBe(10);
    expect(band.style.left).toBe("50%");

    // The window keeps its length at the end of the file rather than being trimmed to fit.
    band.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    expect(encodeTest.sampleStart).toBe(17);
  });

  // The whole-file encode is the last step of the same page: build the command, try it, run it.
  it("ends with the in-browser encode of the whole file, on ffmpeg alone", () => {
    const panel = renderTab();
    const headings = Array.from(panel.querySelectorAll("h2")).map((el) => el.textContent);
    expect(headings).toEqual(["FFmpeg Command Builder", "Try It on a Sample", "Reencode the Entire File Here"]);
    // One engine, so one button and no engine picker to choose between them.
    const buttons = Array.from(panel.querySelectorAll("button")).map((el) => el.textContent);
    expect(buttons).toContain("Reencode and Save");
    expect(panel.textContent).not.toContain("WebCodecs");
  });

  // The output is always an MP4, so what the button offers depends on what went in.
  it("offers a transcode when the source is in another container", () => {
    const panel = renderTab("QuickTime File Format");
    const buttons = Array.from(panel.querySelectorAll("button")).map((el) => el.textContent);
    expect(buttons).toContain("Transcode and Save");
    expect(buttons).not.toContain("Reencode and Save");
  });

  // The two tabs ask for different things now — one stretch here, a sampled spread there — so the
  // sweep's fields are its own rather than a second copy of these.
  it("leaves the Compare Quality tab's duration and segments alone", () => {
    const panel = renderTab();
    const comparePanel = document.createElement("div");
    document.body.append(comparePanel);
    renderCompareTab(comparePanel);

    const sweepDuration = comparePanel.querySelector<HTMLInputElement>("#etDuration")!;
    sweepDuration.value = "8";
    sweepDuration.dispatchEvent(new Event("input"));
    expect(encodeTest.duration).toBe(8);
    // This tab's run is three seconds whatever the sweep is set to, which the band's width says.
    const band = panel.querySelector<HTMLElement>(".sample-band")!;
    expect(band.style.width).toBe(`${(SAMPLE_SECONDS / 20) * 100}%`);
  });
});
