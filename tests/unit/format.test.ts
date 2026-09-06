import { describe, expect, it } from "vitest";
import {
  describeColorSpace,
  describeFrameCount,
  describeFrameRate,
  errorMessage,
  fmtBits,
  fmtBytes,
  fmtDur,
  fmtMs,
  fmtRate,
  fmtSizeChangePct,
} from "../../src/lib/format";

describe("fmtBytes", () => {
  it("returns the placeholder for null/undefined", () => {
    expect(fmtBytes(null)).toBe("–");
    expect(fmtBytes(undefined)).toBe("–");
  });

  it("formats bytes below 1 KB as bytes", () => {
    expect(fmtBytes(512)).toBe("512 B");
  });

  it("formats kilobytes with one decimal", () => {
    expect(fmtBytes(2048)).toBe("2.0 KB");
  });

  it("formats megabytes with one decimal", () => {
    expect(fmtBytes(5 * 1048576)).toBe("5.0 MB");
  });

  it("formats gigabytes with two decimals", () => {
    expect(fmtBytes(2.5 * 1073741824)).toBe("2.50 GB");
  });
});

describe("fmtDur", () => {
  it("returns the placeholder for null/undefined", () => {
    expect(fmtDur(null)).toBe("–");
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
});

describe("fmtBits", () => {
  it("returns the placeholder for null/undefined/non-finite", () => {
    expect(fmtBits(null)).toBe("–");
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
});

describe("fmtRate", () => {
  it("returns the placeholder for null/undefined", () => {
    expect(fmtRate(null)).toBe("–");
  });

  it("rounds near-integer rates to a whole number", () => {
    expect(fmtRate(30.002)).toBe("30");
  });

  it("keeps fractional rates to three decimals", () => {
    expect(fmtRate(23.976)).toBe("23.976");
  });
});

describe("fmtMs", () => {
  it("returns the placeholder for null/undefined", () => {
    expect(fmtMs(null)).toBe("–");
  });

  it("formats milliseconds with one decimal", () => {
    expect(fmtMs(12.34)).toBe("12.3 ms");
  });
});

describe("errorMessage", () => {
  it("takes an Error's own message and stringifies anything else", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
    expect(errorMessage("plain")).toBe("plain");
    expect(errorMessage(42)).toBe("42");
  });
});

describe("fmtSizeChangePct", () => {
  it("reads a saving as a minus and growth as a plus, to one decimal", () => {
    expect(fmtSizeChangePct(1000, 580)).toBe("-42.0%");
    expect(fmtSizeChangePct(1000, 1250)).toBe("+25.0%");
    expect(fmtSizeChangePct(1000, 1000)).toBe("-0.0%");
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
  it("prints the count with thousands separators, or the placeholder without one", () => {
    expect(describeFrameCount(12345)).toBe((12345).toLocaleString());
    expect(describeFrameCount(null)).toBe("–");
  });
});
