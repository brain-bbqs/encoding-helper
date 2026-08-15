import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteFfmpegFile,
  ensureFfmpegInput,
  parseFfmpegTimeSeconds,
  resetFfmpeg,
  runFfmpegArgs,
  runFfmpegEncode,
} from "../../src/lib/ffmpegEngine";

/** What the fake core was asked to do, readable from the tests below. */
const core = vi.hoisted(() => ({ writes: [] as string[], execs: [] as string[][], files: new Set<string>() }));

vi.mock("@ffmpeg/util", () => ({ toBlobURL: () => Promise.resolve("blob:core") }));

vi.mock("@ffmpeg/ffmpeg", () => {
  class FakeFFmpeg {
    on(): void {}
    load(): Promise<void> {
      return Promise.resolve();
    }
    terminate(): void {}
    writeFile(path: string, data: Uint8Array): Promise<void> {
      // The real client posts the array to its worker with the buffer in the transfer list, which
      // detaches the view it was handed. Reproduced here, since surviving that is the point.
      structuredClone(data, { transfer: [data.buffer] });
      core.writes.push(path);
      core.files.add(path);
      return Promise.resolve();
    }
    exec(args: string[]): Promise<void> {
      core.execs.push(args);
      return Promise.resolve();
    }
    readFile(): Promise<Uint8Array> {
      return Promise.resolve(new Uint8Array([1, 2, 3]));
    }
    deleteFile(path: string): Promise<void> {
      core.files.delete(path);
      return Promise.resolve();
    }
  }
  return { FFmpeg: FakeFFmpeg };
});

const ARGS = ["-y", "-i", "in.mp4", "out.mp4"];

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

describe("the core's virtual filesystem", () => {
  beforeEach(() => {
    resetFfmpeg();
    core.writes = [];
    core.execs = [];
    core.files.clear();
  });

  it("encodes the same input twice without its buffer being detached out from under it", async () => {
    // The failure this guards against: writeFile transfers the caller's buffer, so a second write
    // of the same array threw "an ArrayBuffer is detached and could not be cloned" — which meant a
    // matrix sweep produced one encode and 23 failures.
    const data = new Uint8Array([1, 2, 3, 4]);
    await runFfmpegEncode(ARGS, "in.mp4", data, "out.mp4");
    await runFfmpegEncode(ARGS, "in.mp4", data, "out.mp4");
    expect(data.byteLength).toBe(4);
    expect(core.writes).toEqual(["in.mp4", "in.mp4"]);
  });

  it("writes an input the core already holds only once", async () => {
    const data = new Uint8Array([1, 2, 3, 4]);
    await ensureFfmpegInput("in.mp4", data);
    await ensureFfmpegInput("in.mp4", data);
    await ensureFfmpegInput("in.mp4", data);
    expect(core.writes).toEqual(["in.mp4"]);
    expect(core.files.has("in.mp4")).toBe(true);
  });

  it("writes it again once the core it was written to is gone", async () => {
    const data = new Uint8Array([1, 2, 3, 4]);
    await ensureFfmpegInput("in.mp4", data);
    // A crashed core is replaced by a fresh one, whose filesystem holds nothing.
    resetFfmpeg();
    await ensureFfmpegInput("in.mp4", data);
    expect(core.writes).toEqual(["in.mp4", "in.mp4"]);
  });

  it("runs against an input already in place, and tidies only the output", async () => {
    const data = new Uint8Array([1, 2, 3, 4]);
    await ensureFfmpegInput("in.mp4", data);
    const { data: out } = await runFfmpegArgs(ARGS, "out.mp4");
    expect(Array.from(out)).toEqual([1, 2, 3]);
    expect(core.execs).toEqual([ARGS]);
    expect(core.writes).toEqual(["in.mp4"]);
    expect(core.files.has("in.mp4")).toBe(true);
    expect(core.files.has("out.mp4")).toBe(false);

    await deleteFfmpegFile("in.mp4");
    expect(core.files.has("in.mp4")).toBe(false);
  });

  it("drops both files at the end of a one-shot encode", async () => {
    await runFfmpegEncode(ARGS, "in.mp4", new Uint8Array([1, 2, 3, 4]), "out.mp4");
    expect(core.files.size).toBe(0);
  });
});
