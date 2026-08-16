import { beforeEach, describe, expect, it } from "vitest";
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
function renderTab(): HTMLElement {
  state.tracks = [VIDEO_TRACK];
  state.duration = 20;
  state.fps = 30;
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
  it("offers a run of the built command over sampled stretches", () => {
    const panel = renderTab();
    expect(panel.querySelector<HTMLInputElement>("#sampleDuration")!.value).toBe("5");
    expect(panel.querySelector<HTMLInputElement>("#sampleSegments")!.value).toBe("5");
    expect(panel.querySelector(".compare-run-buttons button")!.textContent).toBe("Run Comparison");
  });

  it("holds the segment count inside what a run can sensibly encode", () => {
    const panel = renderTab();
    const segments = panel.querySelector<HTMLInputElement>("#sampleSegments")!;
    segments.value = "99";
    segments.dispatchEvent(new Event("input"));
    expect(encodeTest.segments).toBe(10);
  });

  // Both tabs encode the same sampled stretches, so the two copies of the fields are one setting
  // rather than two that quietly disagree until the next run.
  it("keeps its sample fields in step with the Compare Quality tab's", () => {
    const panel = renderTab();
    const comparePanel = document.createElement("div");
    document.body.append(comparePanel);
    renderCompareTab(comparePanel);

    const duration = panel.querySelector<HTMLInputElement>("#sampleDuration")!;
    duration.value = "3";
    duration.dispatchEvent(new Event("input"));
    expect(encodeTest.duration).toBe(3);
    expect(comparePanel.querySelector<HTMLInputElement>("#etDuration")!.value).toBe("3");
    // The field being typed in is left alone, so a half-typed number is not rewritten mid-keystroke.
    expect(duration.value).toBe("3");
  });
});
