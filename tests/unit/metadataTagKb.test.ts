import { describe, expect, it } from "vitest";
import { describeMetadataTag, describeMetadataTagValue } from "../../src/lib/metadataTagKb";

describe("describeMetadataTag", () => {
  it("returns null for a missing or unknown key", () => {
    expect(describeMetadataTag(null)).toBeNull();
    expect(describeMetadataTag("")).toBeNull();
    expect(describeMetadataTag("nope")).toBeNull();
  });

  it("explains the QuickTime ©too atom as the encoding tool, not a typo", () => {
    const info = describeMetadataTag("©too");
    expect(info?.label).toBe("Encoding tool");
    expect(info?.origin).toBe("MP4 / QuickTime atom");
    expect(info?.description).toContain("0xA9");
  });

  it("resolves ID3v2, Vorbis and RIFF spellings of the same idea", () => {
    expect(describeMetadataTag("TSSE")?.label).toBe("Encoding settings");
    expect(describeMetadataTag("ENCODER")?.label).toBe("Encoding tool");
    expect(describeMetadataTag("ISFT")?.label).toBe("Software");
  });

  it("falls back to a case-insensitive match for containers that vary capitalization", () => {
    expect(describeMetadataTag("encoder")?.key).toBe("ENCODER");
    expect(describeMetadataTag("Title")?.key).toBe("TITLE");
  });

  it("keeps case-sensitive QuickTime atoms distinct from their exact spelling", () => {
    expect(describeMetadataTag("©ART")?.label).toBe("Artist");
    expect(describeMetadataTag("aART")?.label).toBe("Album artist");
  });

  it("covers mediabunny's normalized field names too", () => {
    expect(describeMetadataTag("albumArtist")?.label).toBe("Album artist");
    expect(describeMetadataTag("trackNumber")?.label).toBe("Track number");
  });
});

describe("describeMetadataTagValue", () => {
  it("returns null when nothing in the value is recognizable", () => {
    expect(describeMetadataTagValue(null)).toBeNull();
    expect(describeMetadataTagValue("")).toBeNull();
    expect(describeMetadataTagValue("My Home Video")).toBeNull();
  });

  it("decodes an FFmpeg libavformat signature", () => {
    const hint = describeMetadataTagValue("Lavf60.16.100");
    expect(hint).toContain("libavformat 60.16.100");
    expect(hint).toContain("FFmpeg");
  });

  it("decodes other common encoder signatures", () => {
    expect(describeMetadataTagValue("Lavc61.3.100")).toContain("libavcodec");
    expect(describeMetadataTagValue("HandBrake 1.7.3")).toContain("HandBrake");
    expect(describeMetadataTagValue("x264 core 164")).toContain("x264");
  });

  it("only interpolates the matched version digits, never the whole value", () => {
    const hint = describeMetadataTagValue("Lavf60.16.100 <img src=x onerror=alert(1)>");
    expect(hint).not.toContain("<img");
  });
});
