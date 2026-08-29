import { describe, expect, it } from "vitest";
import { estimateSizeSavings, type SizeEstimate } from "../../src/lib/sizeEstimate";
import { renderSavingsDetail, renderSavingsStrip, savingsBar } from "../../src/ui/savingsPanel";

/** A 1 MB, 100 s file whose sampled 10 s encoded down to `encodedSegmentBytes`. */
function estimate(encodedSegmentBytes: number): SizeEstimate {
  return estimateSizeSavings({
    originalTotalBytes: 1_000_000,
    totalSeconds: 100,
    segmentStartSeconds: 0,
    segmentSeconds: 10,
    encodedSegmentBytes,
  })!;
}

/** The rendered detail block as one element, the way the tab appends it into its section. */
function detail(est: SizeEstimate): HTMLElement {
  const wrap = document.createElement("div");
  wrap.append(...renderSavingsDetail(est));
  return wrap;
}

describe("savingsBar", () => {
  it("sizes the fill by the value's share of the scale", () => {
    const row = savingsBar("Projected", 250, 1000, "projected");
    expect(row.querySelector<HTMLElement>(".savings-fill")!.style.width).toBe("25%");
    expect(row.querySelector(".savings-label")!.textContent).toBe("Projected");
    expect(row.querySelector(".savings-value")!.textContent).toBe("250 B");
    expect(row.querySelector(".savings-band")).toBeNull();
  });

  it("draws the band from its low to its high", () => {
    const row = savingsBar("Projected", 250, 1000, "projected", { low: 200, high: 400 });
    const band = row.querySelector<HTMLElement>(".savings-band")!;
    expect(band.style.left).toBe("20%");
    expect(band.style.width).toBe("20%");
    expect(band.title).toBe("Anywhere from 200 B to 400 B");
  });

  it("keeps a value past the top of the scale inside its track", () => {
    const row = savingsBar("Projected", 4000, 1000, "projected", { low: 3000, high: 5000 });
    expect(row.querySelector<HTMLElement>(".savings-fill")!.style.width).toBe("100%");
    const band = row.querySelector<HTMLElement>(".savings-band")!;
    expect(band.style.left).toBe("100%");
    expect(band.style.width).toBe("0%");
  });

  it("survives a scale of zero rather than dividing by it", () => {
    const row = savingsBar("Projected", 0, 0, "projected");
    expect(row.querySelector<HTMLElement>(".savings-fill")!.style.width).toBe("0%");
  });
});

describe("renderSavingsStrip", () => {
  it("leads with the direction and size of the change", () => {
    const strip = renderSavingsStrip(estimate(50_000));
    expect(strip.querySelector(".savings-headline")!.textContent).toBe("50% smaller");
    expect(strip.querySelector(".savings-headline")!.classList.contains("grew")).toBe(false);
    // The same change stated the other way, for the deep end where percentages crowd together.
    expect(strip.querySelector(".savings-factor")!.textContent).toBe("original 2.0× larger");
    expect(strip.querySelector(".savings-sub")!.textContent).toBe(
      "Projected across the whole 1m 40.0s: ≈ 488.3 KB saved",
    );
  });

  it("marks settings that grew the file instead of reporting a saving", () => {
    const strip = renderSavingsStrip(estimate(150_000));
    expect(strip.querySelector(".savings-headline")!.textContent).toBe("50% larger");
    expect(strip.querySelector(".savings-headline")!.classList.contains("grew")).toBe(true);
    expect(strip.querySelector(".savings-factor")!.textContent).toBe("encoded 1.5× larger");
    expect(strip.querySelector(".savings-sub")!.textContent).toContain("≈ 488.3 KB added");
  });

  it("says so plainly when the projection lands on the same size", () => {
    const strip = renderSavingsStrip(estimate(100_000));
    expect(strip.querySelector(".savings-sub")!.textContent).toBe(
      "Projected across the whole 1m 40.0s: no meaningful change",
    );
  });

  it("puts both bars on one scale, topped by the larger of the two", () => {
    const strip = renderSavingsStrip(estimate(50_000));
    const fills = strip.querySelectorAll<HTMLElement>(".savings-fill");
    expect(fills.length).toBe(2);
    // The original is the larger here, so it fills its track and the projection reads against it.
    expect(fills[0].style.width).toBe("100%");
    expect(fills[1].style.width).toBe("50%");
  });

  it("scales both bars to the projection when the encode grew the file", () => {
    const strip = renderSavingsStrip(estimate(200_000));
    const fills = strip.querySelectorAll<HTMLElement>(".savings-fill");
    expect(fills[0].style.width).toBe("50%");
    expect(fills[1].style.width).toBe("100%");
  });
});

describe("renderSavingsDetail", () => {
  it("lists the numbers behind the headline", () => {
    const text = detail(estimate(50_000)).textContent ?? "";
    expect(text).toContain("Original Segment Size");
    expect(text).toContain("Segment Change");
    expect(text).toContain("-50%");
    expect(text).toContain("Original File Size");
    expect(text).toContain("Projected Full File");
    expect(text).toContain("976.6 KB");
    expect(text).toContain("488.3 KB");
    expect(text).toContain("Sampled");
    expect(text).toContain("10.000 s of 1m 40.0s (10%)");
  });

  it("leaves the range out when the file gave nothing to derive one from", () => {
    const est = estimate(50_000);
    expect(est.projectedRange).toBeNull();
    expect(detail(est).textContent).not.toContain("Projected Range");
  });

  it("shows the range when there is one", () => {
    const samples = Array.from({ length: 300 }, (_, i) => {
      const ctsSec = (10 * i) / 300;
      return {
        offset: 0,
        size: ctsSec < 1 ? 2000 : 1000,
        cts: 0,
        dts: 0,
        ctsSec,
        dtsSec: ctsSec,
        is_sync: false,
        duration: 1,
      };
    });
    const est = estimateSizeSavings({
      originalTotalBytes: 330_000,
      totalSeconds: 10,
      segmentStartSeconds: 0,
      segmentSeconds: 1,
      encodedSegmentBytes: 30_000,
      samples,
    })!;
    expect(detail(est).textContent).toContain("Projected Range");
  });

  it("leaves the method to the ⓘ rather than writing it out under the numbers", () => {
    const block = detail(estimate(50_000));
    expect(block.querySelector(".teach")).toBeNull();
    expect(block.querySelector("details")).toBeNull();
    // The explainers are still reachable, on the figures they bear on.
    expect(block.querySelectorAll(".info-pop").length).toBe(3);
  });
});
