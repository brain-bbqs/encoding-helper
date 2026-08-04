import { describe, expect, it } from "vitest";
import { nearestKeyframeAtOrBefore } from "../../src/lib/mp4boxParser";

describe("nearestKeyframeAtOrBefore", () => {
  const keyframes = [0, 2, 4.5, 10];

  it("returns null when t is before the first keyframe", () => {
    expect(nearestKeyframeAtOrBefore(keyframes, -1)).toBeNull();
  });

  it("returns the exact match when t lands on a keyframe", () => {
    expect(nearestKeyframeAtOrBefore(keyframes, 4.5)).toBe(4.5);
  });

  it("returns the largest keyframe <= t for values in between", () => {
    expect(nearestKeyframeAtOrBefore(keyframes, 3.9)).toBe(2);
  });

  it("returns the last keyframe when t is after all of them", () => {
    expect(nearestKeyframeAtOrBefore(keyframes, 1000)).toBe(10);
  });

  it("returns null for an empty keyframe list", () => {
    expect(nearestKeyframeAtOrBefore([], 5)).toBeNull();
  });

  it("handles a single-keyframe list", () => {
    expect(nearestKeyframeAtOrBefore([3], 3)).toBe(3);
    expect(nearestKeyframeAtOrBefore([3], 2.9)).toBeNull();
    expect(nearestKeyframeAtOrBefore([3], 3.1)).toBe(3);
  });
});
