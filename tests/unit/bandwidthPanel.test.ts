import { beforeEach, describe, expect, it } from "vitest";
import { ChunkedSource } from "../../src/lib/chunkedSource";
import { bandwidth, resetState, state } from "../../src/lib/state";
import type { SampleInfo } from "../../src/lib/types";
import { LINK_PRESETS, fmtWait, renderBandwidthSection } from "../../src/ui/bandwidthPanel";

/** 100 frames of 1000 bytes across 10 s: 100,000 bytes of video, so exactly 80 kbps. */
function evenStream(): SampleInfo[] {
  return Array.from({ length: 100 }, (_, i) => ({
    offset: 0,
    size: 1000,
    cts: 0,
    dts: 0,
    ctsSec: i * 0.1,
    dtsSec: i * 0.1,
    is_sync: i % 10 === 0,
    duration: 1,
  }));
}

function loadFile(opts: { fileBytes?: number; faststart?: boolean | null } = {}): void {
  const file = new File([new Uint8Array(1)], "clip.mp4");
  state.source = ChunkedSource.fromFile(file);
  state.source.size = opts.fileBytes ?? 100_000;
  state.samples = evenStream();
  state.duration = 10;
  state.faststart = opts.faststart ?? true;
}

function badgeOf(sec: HTMLDivElement | null): HTMLElement | null {
  return sec?.querySelector<HTMLElement>(".badge") ?? null;
}

function gridValues(sec: HTMLDivElement | null): Record<string, string> {
  const out: Record<string, string> = {};
  sec?.querySelectorAll(".grid .item").forEach((item) => {
    const label = item.querySelector("label")?.textContent ?? "";
    out[label] = item.querySelector(".val")?.textContent ?? "";
  });
  return out;
}

describe("renderBandwidthSection", () => {
  beforeEach(() => resetState());

  it("renders nothing without frames or a duration to play them over", () => {
    expect(renderBandwidthSection()).toBeNull();
    loadFile();
    state.duration = null;
    expect(renderBandwidthSection()).toBeNull();
  });

  it("says the file plays through when the link can carry it", () => {
    loadFile();
    // Every preset is far above this file's 80 kbps, so the default one plays it comfortably.
    const sec = renderBandwidthSection();
    expect(sec?.querySelector("h2")?.textContent).toBe("Low-Bandwidth Playback");
    expect(badgeOf(sec)?.className).toContain("good");
    expect(badgeOf(sec)?.textContent).toContain("Plays through");
    expect(sec?.querySelector("svg.buffer-chart")).not.toBeNull();
  });

  it("reports the stalls, and where they land, on a link that cannot keep up", () => {
    loadFile();
    bandwidth.linkBitrateBps = 40_000;
    bandwidth.startupSec = 0;
    const sec = renderBandwidthSection();
    expect(badgeOf(sec)?.className).toContain("bad");
    expect(badgeOf(sec)?.textContent).toContain("Stalls 1 time");
    expect(gridValues(sec)["Stalls"]).toBe("1");
    // The freeze is listed in the fold under the plot, not only counted.
    expect(sec?.querySelectorAll("details.fold tbody tr").length).toBe(1);
  });

  it("recomputes as the link speed changes, without a run", () => {
    loadFile();
    const sec = renderBandwidthSection();
    expect(badgeOf(sec)?.className).toContain("good");
    const select = sec!.querySelector<HTMLSelectElement>("#bwLinkSpeed")!;
    select.value = String(LINK_PRESETS[0][1]);
    select.dispatchEvent(new Event("change"));
    expect(bandwidth.linkBitrateBps).toBe(LINK_PRESETS[0][1]);
    // Still comfortably above 80 kbps, so the verdict holds and the card simply redrew.
    expect(badgeOf(sec)?.className).toContain("good");

    const startup = sec!.querySelector<HTMLInputElement>("#bwStartup")!;
    startup.value = "0";
    startup.dispatchEvent(new Event("input"));
    expect(bandwidth.startupSec).toBe(0);
  });

  it("takes a custom speed in Mbps, and reveals its box only when chosen", () => {
    loadFile();
    const sec = renderBandwidthSection();
    const custom = sec!.querySelector<HTMLInputElement>("#bwCustomSpeed")!;
    expect(custom.closest<HTMLElement>(".field")!.style.display).toBe("none");
    const select = sec!.querySelector<HTMLSelectElement>("#bwLinkSpeed")!;
    select.value = "custom";
    select.dispatchEvent(new Event("change"));
    expect(custom.closest<HTMLElement>(".field")!.style.display).toBe("");
    custom.value = "0.05";
    custom.dispatchEvent(new Event("input"));
    expect(bandwidth.linkBitrateBps).toBe(50_000);
    expect(badgeOf(sec)?.className).toContain("bad");
  });

  it("says a file whose index is at the end plays nothing until it is all down", () => {
    loadFile({ faststart: false });
    bandwidth.linkBitrateBps = 80_000;
    const sec = renderBandwidthSection();
    expect(badgeOf(sec)?.className).toContain("info");
    expect(badgeOf(sec)?.textContent).toContain("Nothing plays for 10 s");
  });
});

describe("fmtWait", () => {
  it("writes each span at the precision it is worth reading to", () => {
    expect(fmtWait(null)).toBe("–");
    expect(fmtWait(Infinity)).toBe("–");
    expect(fmtWait(2.34)).toBe("2.3 s");
    expect(fmtWait(41.6)).toBe("42 s");
    expect(fmtWait(125)).toBe("2m 5s");
    expect(fmtWait(7_500)).toBe("2h 5m");
  });
});
