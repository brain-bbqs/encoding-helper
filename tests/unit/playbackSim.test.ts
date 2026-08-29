import { describe, expect, it } from "vitest";
import { simulatePlayback } from "../../src/lib/playbackSim";
import type { SampleInfo } from "../../src/lib/types";

/** One frame, presented at `ctsSec` and `size` bytes long. */
function sample(ctsSec: number, size: number): SampleInfo {
  return { offset: 0, size, cts: 0, dts: 0, ctsSec, dtsSec: ctsSec, is_sync: false, duration: 1 };
}

/**
 * 100 frames of 1000 bytes across 10 s: 100,000 bytes of video, so exactly 80 kbps, with a frame
 * every 0.1 s. Every expectation below is worked out by hand against those numbers.
 */
function evenStream(): SampleInfo[] {
  return Array.from({ length: 100 }, (_, i) => sample(i * 0.1, 1000));
}

const EVEN_BITRATE = 80_000;

describe("simulatePlayback", () => {
  it("returns null when there is nothing to play", () => {
    expect(simulatePlayback([], 10, { linkBitrateBps: 1e6, startupSec: 2 })).toBeNull();
    expect(simulatePlayback(evenStream(), 0, { linkBitrateBps: 1e6, startupSec: 2 })).toBeNull();
    expect(simulatePlayback(evenStream(), 10, { linkBitrateBps: 0, startupSec: 2 })).toBeNull();
    expect(simulatePlayback([sample(0, 0)], 10, { linkBitrateBps: 1e6, startupSec: 2 })).toBeNull();
  });

  it("plays a constant stream through over a link at exactly its bitrate", () => {
    // One frame's worth of head start is all a link running at the encode's own rate ever needs.
    const sim = simulatePlayback(evenStream(), 10, { linkBitrateBps: EVEN_BITRATE, startupSec: 0.1 });
    expect(sim).not.toBeNull();
    expect(sim!.smooth).toBe(true);
    expect(sim!.stalls).toEqual([]);
    expect(sim!.stalledSec).toBe(0);
    expect(sim!.requiredStartupSec).toBeCloseTo(0.1, 6);
    expect(sim!.requiredBitrateBps).toBeCloseTo(EVEN_BITRATE, 3);
    expect(sim!.totalWallSec).toBeCloseTo(10.1, 6);
  });

  it("stalls once, for the missing head start, when the startup wait is too short", () => {
    const sim = simulatePlayback(evenStream(), 10, { linkBitrateBps: EVEN_BITRATE, startupSec: 0.05 });
    expect(sim!.smooth).toBe(false);
    expect(sim!.stalls.length).toBe(1);
    expect(sim!.stalls[0].atMediaSec).toBe(0);
    // It freezes on the first frame at 0.05 s and unfreezes at 0.2 s, when two frames are down and
    // the 0.05 s cushion it started with has been bought back.
    expect(sim!.stalls[0].seconds).toBeCloseTo(0.15, 6);
    // Waiting the 0.1 s it asks for up front is what would have avoided the freeze entirely.
    expect(sim!.requiredStartupSec).toBeCloseTo(0.1, 6);
  });

  it("refills before unfreezing, so a stuttering link reads as stops rather than as frames", () => {
    // Two thirds of the rate this stream needs, with a two-second cushion to buy back each time:
    // a viewer sees a handful of long stops, not one per late frame.
    const sim = simulatePlayback(evenStream(), 10, { linkBitrateBps: (EVEN_BITRATE * 2) / 3, startupSec: 2 });
    expect(sim!.smooth).toBe(false);
    expect(sim!.stalls.length).toBeLessThanOrEqual(Math.ceil(10 / 2));
    // Every stop leaves at least the cushion behind it, so no two land inside two seconds of media.
    const gaps = sim!.stalls.slice(1).map((st, i) => st.atMediaSec - sim!.stalls[i].atMediaSec);
    expect(gaps.every((g) => g >= 2)).toBe(true);
  });

  it("counts a run of late frames as one freeze rather than one apiece", () => {
    // Half the rate the stream needs: every frame after the first is late, and a viewer sees the
    // picture stop once, not ninety-nine times.
    const sim = simulatePlayback(evenStream(), 10, { linkBitrateBps: EVEN_BITRATE / 2, startupSec: 0 });
    expect(sim!.stalls.length).toBe(1);
    // The last frame is presented at 9.9 s and arrives at 20 s, so 10.1 s of playback was frozen.
    expect(sim!.stalledSec).toBeCloseTo(10.1, 3);
  });

  it("reports an infinite required rate when the viewer will not wait at all", () => {
    const sim = simulatePlayback(evenStream(), 10, { linkBitrateBps: EVEN_BITRATE, startupSec: 0 });
    expect(Number.isFinite(sim!.requiredBitrateBps)).toBe(false);
  });

  it("is set by the file's worst burst, not by its average", () => {
    // Exactly the same 100,000 bytes over the same 10 s, with a fat keyframe at the front instead
    // of an even spread: the average is untouched and the rate the file needs is ten times higher.
    const bursty = evenStream().map((s, i) => (i === 0 ? sample(0, 10_900) : sample(i * 0.1, 900)));
    const flat = simulatePlayback(evenStream(), 10, { linkBitrateBps: EVEN_BITRATE, startupSec: 0.1 });
    const burst = simulatePlayback(bursty, 10, { linkBitrateBps: EVEN_BITRATE, startupSec: 0.1 });
    expect(flat!.requiredBitrateBps).toBeCloseTo(EVEN_BITRATE, 3);
    // The keyframe is 87,200 bits and has 0.1 s of head start to arrive in: 872 kbps, over ten
    // times what the same file's average asks for.
    expect(burst!.requiredBitrateBps).toBeCloseTo(872_000, 3);
    expect(burst!.smooth).toBe(false);
  });

  it("makes the link pay for the audio track and the container's overhead too", () => {
    const videoOnly = simulatePlayback(evenStream(), 10, { linkBitrateBps: EVEN_BITRATE, startupSec: 2 });
    // Twice the bytes on the wire for the same frames, so twice the rate to deliver them in time.
    const wholeFile = simulatePlayback(evenStream(), 10, {
      linkBitrateBps: EVEN_BITRATE,
      startupSec: 2,
      fileBytes: 200_000,
    });
    expect(wholeFile!.requiredBitrateBps).toBeCloseTo(videoOnly!.requiredBitrateBps * 2, 3);
    expect(wholeFile!.downloadSec).toBeCloseTo(20, 6);
    expect(wholeFile!.realtimeRatio).toBeCloseTo(2, 6);
  });

  it("waits out the whole download, and then never stalls, when the index is at the end", () => {
    // preloadBytes covering the file is how a non-faststart MP4 behaves: nothing decodes until the
    // last byte is down, and by then everything is local.
    const sim = simulatePlayback(evenStream(), 10, {
      linkBitrateBps: EVEN_BITRATE,
      startupSec: 0,
      fileBytes: 100_000,
      preloadBytes: 100_000,
    });
    expect(sim!.smooth).toBe(false);
    expect(sim!.stalls.length).toBe(1);
    // The single freeze is the download itself, at the very start of playback.
    expect(sim!.stalls[0].atMediaSec).toBe(0);
    expect(sim!.stalls[0].seconds).toBeCloseTo(10, 6);
    expect(sim!.requiredStartupSec).toBeCloseTo(10, 6);
  });

  it("fills the buffer to the whole video on a link that outruns playback", () => {
    const sim = simulatePlayback(evenStream(), 10, { linkBitrateBps: 100e6, startupSec: 2 });
    expect(sim!.smooth).toBe(true);
    // Not quite zero: even here the first frame's own bits take a moment to arrive.
    expect(sim!.requiredStartupSec).toBeLessThan(0.001);
    // The last frame is presented at 9.9 s, and at this rate it is down before playback begins.
    expect(sim!.peakBufferSec).toBeCloseTo(9.9, 6);
    expect(sim!.buffer[0].bufferedSec).toBeCloseTo(9.9, 6);
    expect(sim!.buffer[sim!.buffer.length - 1].bufferedSec).toBe(0);
  });

  it("holds a frame until everything decoded before it has arrived", () => {
    // Two frames in decode order whose presentation order is the other way round, as a B-frame pair
    // is: the one shown first still cannot appear until the big one decoded ahead of it is down.
    const reordered = [sample(0.1, 100_000), sample(0, 1_000)];
    const sim = simulatePlayback(reordered, 0.2, { linkBitrateBps: 808_000, startupSec: 0 });
    // 101,000 bytes = 808,000 bits, which is one second of this link, and both frames need all of it.
    expect(sim!.requiredStartupSec).toBeCloseTo(1, 6);
  });

  it("keeps the buffer plot to a drawable number of points", () => {
    const many = Array.from({ length: 5000 }, (_, i) => sample(i * 0.01, 500));
    const sim = simulatePlayback(many, 50, { linkBitrateBps: 1e6, startupSec: 2 });
    expect(sim!.buffer.length).toBeLessThanOrEqual(241);
    expect(sim!.buffer.every((p) => p.bufferedSec >= 0)).toBe(true);
  });
});
