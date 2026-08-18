import { describe, expect, it } from "vitest";
import { clampWindowStart, fmtClock, rulerMarks, rulerStep, SAMPLE_SECONDS } from "../../src/lib/sampleTimeline";

describe("rulerStep", () => {
  // The same ladder brain-bbqs/clip-extractor's timeline uses: steps read at a glance, about six
  // labelled divisions across whatever the recording runs.
  it("divides a recording into about six labelled steps", () => {
    expect(rulerStep(30).major).toBe(5);
    expect(rulerStep(60).major).toBe(10);
    expect(rulerStep(600).major).toBe(120);
    expect(rulerStep(3600).major).toBe(600);
  });

  it("puts the minor ticks at a fifth of the labelled step", () => {
    expect(rulerStep(30).minor).toBe(1);
    expect(rulerStep(600).minor).toBe(24);
  });

  // A recording longer than the widest step still gets gradations rather than none.
  it("falls back to the widest step for a recording longer than the ladder covers", () => {
    expect(rulerStep(10_000_000).major).toBe(43200);
  });
});

describe("rulerMarks", () => {
  it("marks the recording end to end, labelling every fifth", () => {
    const marks = rulerMarks(30);
    expect(marks[0]).toEqual({ seconds: 0, major: true });
    expect(marks.at(-1)!.seconds).toBeCloseTo(30, 6);
    expect(marks.filter((m) => m.major).map((m) => m.seconds)).toEqual([0, 5, 10, 15, 20, 25, 30]);
  });

  it("has nothing to mark on a file with no duration", () => {
    expect(rulerMarks(0)).toEqual([]);
  });
});

describe("clampWindowStart", () => {
  it("keeps the window inside the recording, at its full length", () => {
    expect(clampWindowStart(5, 20, SAMPLE_SECONDS)).toBe(5);
    expect(clampWindowStart(-4, 20, SAMPLE_SECONDS)).toBe(0);
    // The end of the file holds the window's length rather than trimming it.
    expect(clampWindowStart(19.5, 20, SAMPLE_SECONDS)).toBe(17);
  });

  it("covers a recording shorter than the window from its start", () => {
    expect(clampWindowStart(1, 2, SAMPLE_SECONDS)).toBe(0);
  });

  it("falls back to the start of the file for a value that is not a number", () => {
    expect(clampWindowStart(NaN, 20, SAMPLE_SECONDS)).toBe(0);
  });
});

describe("fmtClock", () => {
  it("reads a short recording in minutes and seconds", () => {
    expect(fmtClock(0, 30)).toBe("0:00");
    expect(fmtClock(75, 300)).toBe("1:15");
  });

  // An hour-long recording needs the hours to tell its gradations apart.
  it("adds the hours once the recording runs to one", () => {
    expect(fmtClock(3661, 7200)).toBe("1:01:01");
  });
});
