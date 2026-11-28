import { describe, expect, it } from "vitest";
import {
  describeColorSpace,
  describeFrameCount,
  describeFrameRate,
  fmtBits,
  fmtDur,
  fmtMs,
  fmtRate,
} from "../../src/lib/format";

describe("fmtDur", () => {
  it("returns the placeholder for null/undefined", () => {
    expect(fmtDur(null)).toBe("–");
    expect(fmtDur(undefined)).toBe("–");
  });

  it("formats sub-minute durations in seconds", () => {
    expect(fmtDur(12.3456)).toBe("12.346 s");
  });

  it("formats sub-hour durations as minutes + seconds", () => {
    expect(fmtDur(125)).toBe("2m 5.0s");
  });

  it("formats hour-plus durations as hours + minutes + seconds", () => {
    expect(fmtDur(3725)).toBe("1h 2m 5s");
  });

  // A field that rounds up to the next unit's worth carries into it rather than printing sixty.
  it("carries a field that rounds up to a whole unit into the next one", () => {
    expect(fmtDur(59.9996)).toBe("1m 0.0s");
    expect(fmtDur(119.97)).toBe("2m 0.0s");
    expect(fmtDur(3599.97)).toBe("1h 0m 0s");
    expect(fmtDur(3659.6)).toBe("1h 1m 0s");
  });
});

describe("fmtBits", () => {
  it("returns the placeholder for null/undefined/non-finite", () => {
    expect(fmtBits(null)).toBe("–");
    expect(fmtBits(undefined)).toBe("–");
    expect(fmtBits(Infinity)).toBe("–");
  });

  it("formats sub-kbps rates as bps", () => {
    expect(fmtBits(500)).toBe("500 bps");
  });

  it("formats sub-Mbps rates as kbps", () => {
    expect(fmtBits(128_000)).toBe("128 kbps");
  });

  it("formats Mbps+ rates with two decimals", () => {
    expect(fmtBits(5_500_000)).toBe("5.50 Mbps");
  });

  it("moves up a unit when the rounded figure would read a thousand", () => {
    expect(fmtBits(999.6)).toBe("1 kbps");
    expect(fmtBits(999_600)).toBe("1.00 Mbps");
  });
});

describe("fmtRate", () => {
  it("returns the placeholder for null/undefined", () => {
    expect(fmtRate(null)).toBe("–");
    expect(fmtRate(undefined)).toBe("–");
  });

  // Within 0.005 of a whole number, either side alike: a rate measured from packet times lands a
  // hair off its nominal one, as likely under it as over.
  it("rounds near-integer rates to a whole number", () => {
    expect(fmtRate(30.002)).toBe("30");
    expect(fmtRate(29.9999)).toBe("30");
    expect(fmtRate(29.996)).toBe("30");
    expect(fmtRate(29.994)).toBe("29.994");
  });

  it("keeps fractional rates to three decimals", () => {
    expect(fmtRate(23.976)).toBe("23.976");
  });
});

describe("fmtMs", () => {
  it("returns the placeholder for null/undefined", () => {
    expect(fmtMs(null)).toBe("–");
    expect(fmtMs(undefined)).toBe("–");
  });

  it("formats milliseconds with one decimal", () => {
    expect(fmtMs(12.34)).toBe("12.3 ms");
  });
});

describe("describeColorSpace", () => {
  it("joins whichever of primaries, transfer and matrix the file states", () => {
    expect(describeColorSpace({ primaries: "bt709", transfer: "bt709", matrix: "bt709" })).toBe(
      "bt709 / bt709 / bt709",
    );
    expect(describeColorSpace({ primaries: "bt470bg", matrix: null })).toBe("bt470bg");
  });

  it("shows the placeholder when the file states none of them", () => {
    expect(describeColorSpace({})).toBe("–");
  });
});

describe("describeFrameRate", () => {
  it("prints the packet rate in fps, or the placeholder without one", () => {
    expect(describeFrameRate(29.97)).toBe("29.970 fps");
    expect(describeFrameRate(null)).toBe("–");
  });
});

describe("describeFrameCount", () => {
  it("prints the count with thousands separators", () => {
    expect(describeFrameCount(12345)).toBe((12345).toLocaleString());
  });
});
