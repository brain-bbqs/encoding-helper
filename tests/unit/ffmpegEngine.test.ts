import { describe, expect, it } from "vitest";
import { parseFfmpegTimeSeconds } from "../../src/lib/ffmpegEngine";

describe("parseFfmpegTimeSeconds", () => {
  it("reads the output timestamp out of a status line", () => {
    const line = "frame=  470 fps=9.2 q=40.0 Lsize=     650kB time=00:00:09.97 bitrate= 533.3kbits/s speed=0.195x";
    expect(parseFfmpegTimeSeconds(line)).toBeCloseTo(9.97, 10);
  });

  it("carries hours and minutes", () => {
    expect(parseFfmpegTimeSeconds("time=01:02:03.50 bitrate=1kbits/s")).toBeCloseTo(3723.5, 10);
  });

  it("treats the negative time of the first status line as no progress at all", () => {
    // ffmpeg reports this before it has written anything.
    expect(parseFfmpegTimeSeconds("frame=    0 fps=0.0 q=0.0 size=0kB time=-577014:32:22.77")).toBe(0);
  });

  it("returns null for a line carrying no timestamp", () => {
    expect(parseFfmpegTimeSeconds("[libx264 @ 0xdf4ad0] using SAR=1/1")).toBeNull();
    expect(parseFfmpegTimeSeconds("")).toBeNull();
    expect(parseFfmpegTimeSeconds("Duration: 00:00:30.00, start: 0.000000, bitrate: 569 kb/s")).toBeNull();
  });

  it("is not fooled by a duration line elsewhere in the same message", () => {
    // The input's duration is not this run's progress; only an explicit time= counts.
    const line = "Duration: 00:00:30.00, start: 0.000000 -- time=00:00:02.00";
    expect(parseFfmpegTimeSeconds(line)).toBeCloseTo(2, 10);
  });
});
