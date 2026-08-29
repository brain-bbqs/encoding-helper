// Whether a file would play without stalling over a link of a given speed, worked out from the
// sample table rather than measured over a real network.
//
// Progressive download and playback are a queue with a rate on each end: bytes arrive at whatever
// the link carries, frames leave at their presentation times, and the buffer between them is the
// difference. That makes the question "does this encode survive hotel wifi?" arithmetic rather than
// an experiment — every frame's size and timestamp is already in the container's sample table, so
// no decoding, no server and no throttled connection is involved.
//
// The model is a player that downloads the file from the front at a constant rate, waits a fixed
// spell before starting, freezes whenever the frame it is due to show has not arrived yet, and on
// unfreezing refills to the depth that startup wait bought before going on — which is what a real
// player does, and what keeps a starved link reading as a handful of long stops rather than as one
// stop per frame. It is deliberately a floor rather than an imitation of any one player: a real one
// has a rebuffering policy of its own, a link that varies, and a decoder that can fall behind on
// its own account. A file that stalls here stalls there; a file that plays here has headroom that a
// real player may still spend elsewhere.

import type { SampleInfo } from "./types";

/** 3 Mbps: a link busy enough to be worth asking about, and a rate most files have an answer for. */
export const DEFAULT_LINK_BITRATE_BPS = 3_000_000;

/** Two seconds of waiting before playback starts, which is about what a viewer tolerates. */
export const DEFAULT_STARTUP_SEC = 2;

/** More points than this and the plot has more steps than it has pixels to draw them in. */
const MAX_BUFFER_POINTS = 240;

/**
 * Lateness below this is floating-point noise from a link sitting exactly at the required rate,
 * not a freeze anybody would see.
 */
const STALL_EPSILON_SEC = 1e-4;

export interface PlaybackSimOptions {
  /** What the link carries, in bits per second. */
  linkBitrateBps: number;
  /** Wall-clock seconds the viewer waits, before the first frame, for the buffer to fill. */
  startupSec: number;
  /**
   * Bytes on the wire. Defaults to the video samples' own bytes; pass the file size so the audio
   * track and the container's overhead are paid for too, since they arrive over the same link.
   */
  fileBytes?: number;
  /**
   * Bytes that must land before the first frame can be shown: the header for a faststart file, or
   * the whole file for one whose `moov` index sits at the end.
   */
  preloadBytes?: number;
}

/** One freeze: where in playback the picture stopped, and for how long in wall-clock time. */
export interface PlaybackStall {
  atMediaSec: number;
  seconds: number;
}

/** How much video was downloaded beyond the playhead at one point in playback. */
export interface BufferPoint {
  mediaSec: number;
  bufferedSec: number;
}

export interface PlaybackSimulation {
  linkBitrateBps: number;
  startupSec: number;
  /** True when the buffer never ran dry, i.e. the file played end to end at this rate. */
  smooth: boolean;
  /** One entry per freeze; consecutive late frames are one freeze, not one apiece. */
  stalls: PlaybackStall[];
  /** Total wall-clock seconds spent frozen. */
  stalledSec: number;
  /** Opening the link to the last frame: the startup wait, the duration, and every freeze. */
  totalWallSec: number;
  /** The startup wait that would have made playback smooth at this link rate. */
  requiredStartupSec: number;
  /** The link rate that would have made playback smooth at this startup wait. */
  requiredBitrateBps: number;
  /** Seconds to pull the whole file down at this rate, whether or not playback waits for it. */
  downloadSec: number;
  /** That download time over the video's duration: below 1 the link outruns playback. */
  realtimeRatio: number;
  buffer: BufferPoint[];
  peakBufferSec: number;
}

/** One frame's presentation time, and the bits of file that must have arrived to show it. */
interface FrameNeed {
  cts: number;
  needBits: number;
}

/**
 * What each frame costs the link, in bits of file that have to be down before it can be shown.
 *
 * The frames carry the burstiness, so their own sizes accumulate frame by frame; whatever else is
 * in the file (an audio track, the container's index and overhead) is spread across them in
 * proportion, since a muxed file interleaves it rather than delivering it all at one point. Byte
 * offsets would say this exactly for a plain progressive MP4, but not for a fragmented one and not
 * for the containers that have no offsets to read, and the proportional split is within the model's
 * accuracy either way.
 */
function frameNeeds(
  samples: SampleInfo[],
  videoBytes: number,
  preloadBytes: number,
  payloadBytes: number,
): FrameNeed[] {
  const frames: FrameNeed[] = [];
  let cum = 0;
  for (const s of samples) {
    cum += s.size;
    frames.push({ cts: s.ctsSec, needBits: 8 * (preloadBytes + (cum / videoBytes) * payloadBytes) });
  }
  // Walked in presentation order from here on, since that is the order the player shows them in.
  frames.sort((a, b) => a.cts - b.cts);
  // A frame cannot be shown until everything decoded before it has arrived, which with B-frames is
  // not the same set as everything presented before it. Carrying the running maximum forward states
  // that requirement without needing the decode order again.
  let peak = 0;
  for (const f of frames) {
    peak = Math.max(peak, f.needBits);
    f.needBits = peak;
  }
  return frames;
}

/**
 * Plays `samples` back over a link of `opts.linkBitrateBps` and reports what the viewer would see.
 * Null when there is nothing to simulate: no frames, no duration, no bytes, or a rate of zero.
 */
export function simulatePlayback(
  samples: SampleInfo[],
  durationSec: number,
  opts: PlaybackSimOptions,
): PlaybackSimulation | null {
  const rate = opts.linkBitrateBps;
  if (samples.length === 0 || !(durationSec > 0) || !(rate > 0)) return null;
  const videoBytes = samples.reduce((a, s) => a + s.size, 0);
  if (!(videoBytes > 0)) return null;

  const fileBytes = Math.max(opts.fileBytes ?? videoBytes, videoBytes);
  const preloadBytes = Math.min(Math.max(opts.preloadBytes ?? 0, 0), fileBytes);
  const frames = frameNeeds(samples, videoBytes, preloadBytes, fileBytes - preloadBytes);
  const startupSec = Math.max(0, opts.startupSec);

  const stalls: PlaybackStall[] = [];
  const buffer: BufferPoint[] = [];
  const stride = Math.max(1, Math.ceil(frames.length / MAX_BUFFER_POINTS));
  const last = frames.length - 1;
  const arrivesAt = (i: number): number => frames[i].needBits / rate;
  let stalledSec = 0;
  let requiredStartupSec = 0;
  let requiredBitrateBps = 0;
  let peakBufferSec = 0;
  let wasLate = false;
  // Three pointers over the same presentation-ordered list, each of them only ever moving forward,
  // so the whole pass stays linear: `i` is the frame being shown, `refill` is how far ahead the
  // player buffers before unfreezing, and `arrived` is how much has come down by the time it shows.
  let refill = 0;
  let arrived = 0;
  let arrivedCts = 0;

  frames.forEach((f, i) => {
    const arrival = arrivesAt(i);
    requiredStartupSec = Math.max(requiredStartupSec, arrival - f.cts);
    // A frame due at cts needs its bits inside startup + cts seconds of link time; the rate that
    // just manages it for the worst such frame is the rate the whole file needs. With no startup
    // wait at all the first frame demands an infinite one, which is the honest answer.
    const budgetSec = startupSec + f.cts;
    requiredBitrateBps = budgetSec > 0 ? Math.max(requiredBitrateBps, f.needBits / budgetSec) : Infinity;

    const dueAt = startupSec + f.cts + stalledSec;
    if (arrival > dueAt + STALL_EPSILON_SEC) {
      // Unfreezing on the missing frame alone would starve again on the next one, which reports a
      // stuttering link as hundreds of separate stops. A player instead buys back the same cushion
      // it started with, so playback runs at least that far before it can starve again.
      while (refill < last && frames[refill].cts < f.cts + startupSec) refill++;
      const resumeAt = Math.max(arrival, arrivesAt(Math.max(i, refill)));
      const frozenSec = resumeAt - dueAt;
      // One freeze, however many frames in a row are late behind it: a viewer sees a single stop.
      if (wasLate && stalls.length) stalls[stalls.length - 1].seconds += frozenSec;
      else stalls.push({ atMediaSec: f.cts, seconds: frozenSec });
      stalledSec += frozenSec;
      wasLate = true;
    } else {
      wasLate = false;
    }

    // Where the buffer stands as this frame goes up: the last frame already down, minus the
    // playhead. Zero exactly where playback just waited for this one.
    const shownAt = startupSec + f.cts + stalledSec;
    while (arrived < frames.length && arrivesAt(arrived) <= shownAt) {
      arrivedCts = Math.max(arrivedCts, frames[arrived].cts);
      arrived++;
    }
    const bufferedSec = Math.max(0, arrivedCts - f.cts);
    peakBufferSec = Math.max(peakBufferSec, bufferedSec);
    if (i % stride === 0 || i === last) buffer.push({ mediaSec: f.cts, bufferedSec });
  });

  const downloadSec = (fileBytes * 8) / rate;
  return {
    linkBitrateBps: rate,
    startupSec,
    smooth: stalls.length === 0,
    stalls,
    stalledSec,
    totalWallSec: startupSec + durationSec + stalledSec,
    requiredStartupSec: Math.max(0, requiredStartupSec),
    requiredBitrateBps,
    downloadSec,
    realtimeRatio: downloadSec / durationSec,
    buffer,
    peakBufferSec,
  };
}
