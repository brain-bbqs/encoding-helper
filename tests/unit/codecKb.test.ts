import { describe, expect, it } from "vitest";
import { describeCodec } from "../../src/lib/codecKb";

describe("describeCodec", () => {
  it("returns null for a falsy short codec", () => {
    expect(describeCodec(null, null)).toBeNull();
    expect(describeCodec(undefined, null)).toBeNull();
  });

  it("returns null for an unknown codec id", () => {
    expect(describeCodec("not-a-real-codec", null)).toBeNull();
  });

  it("parses H.264/AVC profile and level from the RFC 6381 codec string", () => {
    const info = describeCodec("avc", "avc1.640028");
    expect(info?.family).toBe("H.264 / AVC");
    expect(info?.details).toContainEqual({ label: "Profile", value: "High" });
    expect(info?.details).toContainEqual({ label: "Level", value: "4.0" });
  });

  it("falls back to a hex profile label for an unrecognized AVC profile byte", () => {
    const info = describeCodec("avc", "avc1.aa0028");
    expect(info?.details).toContainEqual({ label: "Profile", value: "0xaa" });
  });

  it("returns an empty details list when the codec string doesn't match the expected pattern", () => {
    const info = describeCodec("avc", "not-a-codec-string");
    expect(info?.details).toEqual([]);
  });

  it("parses H.265/HEVC profile, tier, and level", () => {
    const info = describeCodec("hevc", "hvc1.1.6.L93.B0");
    expect(info?.family).toBe("H.265 / HEVC");
    expect(info?.details).toContainEqual({ label: "Profile", value: "Main" });
    expect(info?.details).toContainEqual({ label: "Tier", value: "Main" });
  });

  it("parses AV1 profile/level/tier/bit-depth", () => {
    const info = describeCodec("av1", "av01.0.04M.08");
    expect(info?.details).toContainEqual({ label: "Profile", value: "Main" });
    expect(info?.details).toContainEqual({ label: "Level", value: "3.0" });
    expect(info?.details).toContainEqual({ label: "Bit depth", value: "8-bit" });
  });

  it("parses AAC object type", () => {
    const info = describeCodec("aac", "mp4a.40.2");
    expect(info?.details).toContainEqual({ label: "Profile", value: "AAC-LC (Low Complexity)" });
  });

  it("special-cases PCM codec ids without hitting the knowledge base lookup", () => {
    const info = describeCodec("pcm-s16", null);
    expect(info?.family).toBe("PCM (uncompressed)");
    expect(info?.details).toEqual([]);
  });

  it("returns codec family info even with no parseable details (e.g. VP8)", () => {
    const info = describeCodec("vp8", null);
    expect(info?.family).toBe("VP8");
    expect(info?.details).toEqual([]);
  });
});
