import { describe, expect, it } from "vitest";
import { describeCodec } from "../../src/lib/codecKb";
import { CODEC_DESCRIPTIONS, PCM_DESCRIPTION } from "../../src/lib/explainers";

/** Each codec the knowledge base knows, with a phrase only its own description says. */
const DESCRIBED_CODECS: [codec: keyof typeof CODEC_DESCRIPTIONS, phrase: string][] = [
  ["avc", "most widely supported video codec"],
  ["hevc", "more efficient than H.264"],
  ["vp9", "free alternative to H.265"],
  ["av1", "Alliance for Open Media"],
  ["vp8", "earlier royalty-free codec from On2/Google"],
  ["prores", "professional mezzanine codec"],
  ["aac", "successor to MP3"],
  ["opus", "default for WebRTC"],
  ["mp3", "classic lossy audio format"],
  ["vorbis", "predecessor to Opus"],
  ["flac", "Lossless compression"],
  ["ac3", "up to 5.1"],
  ["eac3", "extension of AC-3"],
];

/** Each codec's long name and year, the two facts the codec card prints after the family. */
const NAMED_CODECS: [codec: keyof typeof CODEC_DESCRIPTIONS, fullName: string, year: number][] = [
  ["avc", "Advanced Video Coding", 2003],
  ["hevc", "High Efficiency Video Coding", 2013],
  ["vp9", "VP9", 2013],
  ["av1", "AOMedia Video 1", 2018],
  ["vp8", "VP8", 2008],
  ["prores", "ProRes", 2007],
  ["aac", "Advanced Audio Coding", 1997],
  ["opus", "Opus", 2012],
  ["mp3", "MPEG-1/2 Audio Layer III", 1993],
  ["vorbis", "Ogg Vorbis", 2000],
  ["flac", "Free Lossless Audio Codec", 2001],
  ["ac3", "Dolby Digital", 1991],
  ["eac3", "Enhanced AC-3", 2005],
];

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

  // The PCM branch builds its answer apart from the table, so its own fields are pinned here.
  it("names PCM in full, gives it no year and describes it in its own words", () => {
    const info = describeCodec("pcm-s16", null);
    expect(info?.fullName).toBe("Pulse-Code Modulation");
    expect(info?.year).toBeNull();
    expect(info?.description).toBe(PCM_DESCRIPTION);
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

  // The description is joined to the codec by hand, one line per codec, so a line naming the wrong
  // codec's text, or a key the description table does not have, shows up here.
  it.each(DESCRIBED_CODECS)("describes %s in its own words", (codec, phrase) => {
    const description = describeCodec(codec, null)?.description;
    expect(description).toBe(CODEC_DESCRIPTIONS[codec]);
    expect(description).toContain(phrase);
  });

  it.each(NAMED_CODECS)("names %s %s, from %i", (codec, fullName, year) => {
    const info = describeCodec(codec, null);
    expect(info?.fullName).toBe(fullName);
    expect(info?.year).toBe(year);
  });

  it("has a name test for every codec the description table holds", () => {
    expect(Object.keys(CODEC_DESCRIPTIONS).sort()).toEqual(NAMED_CODECS.map(([codec]) => codec).sort());
  });

  it("has a description test for every codec the description table holds", () => {
    expect(Object.keys(CODEC_DESCRIPTIONS).sort()).toEqual(DESCRIBED_CODECS.map(([codec]) => codec).sort());
  });
});
