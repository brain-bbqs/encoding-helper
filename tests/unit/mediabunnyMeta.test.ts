// The mediabunny Input is stubbed rather than a real one: this module is the flattening between
// mediabunny's API and the TrackInfo[] the tabs render, so what it has to get right is which
// fields come from where and what happens when one of them is unreadable.

import type { Input, InputTrack } from "mediabunny";
import { describe, expect, it } from "vitest";
import { loadMediabunnyMetadata } from "../../src/lib/mediabunnyMeta";

const AVC_DESCRIPTION = new Uint8Array([1, 100, 0, 32, 255, 225, 0, 0, 1, 0, 0, 253, 248, 248, 0]);

interface TrackOptions {
  kind: "video" | "audio" | "other";
  codec?: string | null;
  codecString?: string | null | Error;
  stats?: { averagePacketRate: number; averageBitrate: number } | Error;
  colorSpace?: unknown;
  hdr?: boolean | Error;
  description?: Uint8Array | Error;
}

/** Resolves to `value`, or rejects when the test wants that read to fail. */
function reads<T>(value: T | Error): Promise<T> {
  return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
}

function track(o: TrackOptions): InputTrack {
  return {
    codec: o.codec === undefined ? (o.kind === "audio" ? "aac" : "avc") : o.codec,
    codedWidth: 640,
    codedHeight: 480,
    displayWidth: 640,
    displayHeight: 360,
    rotation: 90,
    sampleRate: 48_000,
    numberOfChannels: 2,
    isVideoTrack: () => o.kind === "video",
    isAudioTrack: () => o.kind === "audio",
    getCodecParameterString: () => reads(o.codecString === undefined ? "avc1.640020" : o.codecString),
    computePacketStats: () => reads(o.stats ?? { averagePacketRate: 30, averageBitrate: 500_000 }),
    getColorSpace: () => reads(o.colorSpace ?? { primaries: "bt709" }),
    hasHighDynamicRange: () => reads(o.hdr ?? false),
    getDecoderConfig: () =>
      o.description instanceof Error
        ? reads(o.description)
        : Promise.resolve({ description: o.description ?? AVC_DESCRIPTION }),
  } as unknown as InputTrack;
}

function input(tracks: InputTrack[], over: Partial<Record<"format" | "mimeType", string>> = {}): Input {
  return {
    getFormat: () => Promise.resolve({ name: over.format ?? "MP4" }),
    getMimeType: () => Promise.resolve(over.mimeType ?? 'video/mp4; codecs="avc1.640020"'),
    computeDuration: () => Promise.resolve(12.5),
    getTracks: () => Promise.resolve(tracks),
    getMetadataTags: () => Promise.resolve({ title: "Session 1" }),
  } as unknown as Input;
}

describe("loadMediabunnyMetadata", () => {
  it("reports the container alongside the tracks in it", async () => {
    const meta = await loadMediabunnyMetadata(input([track({ kind: "video" })]));
    expect(meta.format).toBe("MP4");
    expect(meta.mimeType).toBe('video/mp4; codecs="avc1.640020"');
    expect(meta.duration).toBe(12.5);
    expect(meta.tags).toEqual({ title: "Session 1" });
  });

  it("describes a video track down to its chroma format and colour", async () => {
    const [video] = (await loadMediabunnyMetadata(input([track({ kind: "video" })]))).tracks;
    expect(video).toMatchObject({
      kind: "video",
      codec: "avc",
      codecString: "avc1.640020",
      packetRate: 30,
      bitrate: 500_000,
      codedWidth: 640,
      codedHeight: 480,
      displayWidth: 640,
      displayHeight: 360,
      rotation: 90,
      hdr: false,
      colorSpace: { primaries: "bt709" },
    });
    expect(video.codecInfo).not.toBeNull();
    expect(video.chroma).not.toBeNull();
    // Audio-only fields stay off a video track rather than being carried as nulls.
    expect(video.sampleRate).toBeUndefined();
    expect(video.channels).toBeUndefined();
  });

  it("describes an audio track with its rate and channel count and nothing visual", async () => {
    const [audio] = (await loadMediabunnyMetadata(input([track({ kind: "audio", codecString: "mp4a.40.2" })]))).tracks;
    expect(audio).toMatchObject({ kind: "audio", codec: "aac", sampleRate: 48_000, channels: 2 });
    expect(audio.codedWidth).toBeUndefined();
    expect(audio.chroma).toBeUndefined();
  });

  it("calls a track that is neither video nor audio what it is", async () => {
    const [other] = (await loadMediabunnyMetadata(input([track({ kind: "other", codec: "tx3g" })]))).tracks;
    expect(other.kind).toBe("other");
  });

  it("takes the frame rate from the video track, and the video track itself for the tabs", async () => {
    const video = track({ kind: "video" });
    const meta = await loadMediabunnyMetadata(input([track({ kind: "audio" }), video]));
    expect(meta.fps).toBe(30);
    expect(meta.videoTrack).toBe(video);
    expect(meta.tracks.map((t) => t.kind)).toEqual(["audio", "video"]);
  });

  it("has no frame rate and no video track for an audio-only file", async () => {
    const meta = await loadMediabunnyMetadata(input([track({ kind: "audio" })]));
    expect(meta.fps).toBeNull();
    expect(meta.videoTrack).toBeNull();
  });

  it("calls a codec the file does not name 'unknown'", async () => {
    const [t] = (await loadMediabunnyMetadata(input([track({ kind: "video", codec: null })]))).tracks;
    expect(t.codec).toBe("unknown");
  });

  it("still describes a track whose per-field reads fail", async () => {
    const meta = await loadMediabunnyMetadata(
      input([
        track({
          kind: "video",
          codecString: new Error("no config"),
          stats: new Error("unreadable"),
          colorSpace: new Error("unreadable"),
          hdr: new Error("unreadable"),
          description: new Error("unreadable"),
        }),
      ]),
    );
    expect(meta.tracks[0]).toMatchObject({
      kind: "video",
      codecString: null,
      packetRate: null,
      bitrate: null,
      colorSpace: null,
      hdr: false,
    });
    expect(meta.fps).toBeNull();
  });

  it("reports a file with no tracks at all as empty rather than failing", async () => {
    const meta = await loadMediabunnyMetadata(input([]));
    expect(meta.tracks).toEqual([]);
    expect(meta.videoTrack).toBeNull();
  });
});
