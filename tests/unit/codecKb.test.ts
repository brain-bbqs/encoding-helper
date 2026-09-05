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

  it("parses VP9 profile, level and bit depth", () => {
    const info = describeCodec("vp9", "vp09.02.10.10");
    expect(info?.family).toBe("VP9");
    expect(info?.details).toEqual([
      { label: "Profile", value: 2 },
      { label: "Level", value: "1.0" },
      { label: "Bit depth", value: "10-bit" },
    ]);
  });

  it("returns empty details for HEVC, VP9 and AV1 strings that do not fit their patterns", () => {
    expect(describeCodec("hevc", "hvc1")?.details).toEqual([]);
    expect(describeCodec("vp9", "vp09")?.details).toEqual([]);
    expect(describeCodec("av1", "av01")?.details).toEqual([]);
  });

  it("returns empty details with no codec string at all", () => {
    for (const codec of ["avc", "hevc", "vp9", "av1", "aac"]) {
      expect(describeCodec(codec, null)?.details).toEqual([]);
    }
  });

  // A profile number the table does not know is still a fact worth printing, as a number.
  it("labels an unknown HEVC profile by number and reads the High tier", () => {
    const info = describeCodec("hevc", "hev1.9.6.H150");
    expect(info?.details).toEqual([
      { label: "Profile", value: "Profile 9" },
      { label: "Tier", value: "High" },
      { label: "Level", value: "5.0" },
    ]);
  });

  it("falls back to the raw AV1 profile and level fields when they are out of the tables", () => {
    const info = describeCodec("av1", "av01.3.31H.12");
    expect(info?.details).toEqual([
      { label: "Profile", value: "3" },
      { label: "Level", value: "31" },
      { label: "Tier", value: "High" },
      { label: "Bit depth", value: "12-bit" },
    ]);
  });

  it("labels an unknown AAC object type by its number", () => {
    expect(describeCodec("aac", "mp4a.40.99")?.details).toEqual([{ label: "Profile", value: "Object type 99" }]);
  });

  it("treats the telephony companding codecs as PCM too", () => {
    expect(describeCodec("ulaw", null)?.family).toBe("PCM (uncompressed)");
    expect(describeCodec("alaw", null)?.family).toBe("PCM (uncompressed)");
  });
});
