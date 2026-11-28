import { describe, expect, it } from "vitest";
import { METADATA_TAGS_TEACH } from "../../src/lib/explainers";
import { describeMetadataTag, describeMetadataTagValue } from "../../src/lib/metadataTagKb";

describe("describeMetadataTag", () => {
  it("returns null for a missing or unknown key", () => {
    // @ts-expect-error: null is outside the type, but the falsy guard turns it away all the same.
    expect(describeMetadataTag(null)).toBeNull();
    expect(describeMetadataTag("")).toBeNull();
    expect(describeMetadataTag("nope")).toBeNull();
  });

  it("explains the QuickTime ©too atom as the encoding tool, not a typo", () => {
    const info = describeMetadataTag("©too");
    expect(info?.label).toBe("Encoding tool");
    expect(info?.origin).toBe("MP4 / QuickTime atom");
    expect(info?.description).toContain("tool");
  });

  // What the leading © is belongs to the teach box above the table, said once, rather than to the
  // entries that happen to carry one.
  it("leaves the 0xA9 marker to the copy above the table", () => {
    expect(METADATA_TAGS_TEACH).toContain("0xA9");
    expect(describeMetadataTag("©nam")?.description).not.toContain("0xA9");
  });

  // Reverse-DNS keys reach the same lookup from a group of their own, so an Apple recording still
  // resolves to a label and an explanation rather than showing its raw key.
  it("resolves the QuickTime metadata keys Apple devices write", () => {
    const info = describeMetadataTag("com.apple.quicktime.model");
    expect(info?.label).toBe("Camera model");
    expect(info?.origin).toBe("QuickTime metadata key (mdta)");
    expect(describeMetadataTag("com.apple.quicktime.location.ISO6709")?.label).toBe("Capture location");
  });

  // Both spell the same idea; the labels have to say which atom the reader is looking at.
  it("tells the two copyright atoms apart by label", () => {
    expect(describeMetadataTag("©cpy")?.label).toBe("Copyright (QuickTime)");
    expect(describeMetadataTag("cprt")?.label).toBe("Copyright");
  });

  it("resolves ID3v2, Vorbis and RIFF spellings of the same idea", () => {
    expect(describeMetadataTag("TSSE")?.label).toBe("Encoding settings");
    expect(describeMetadataTag("ENCODER")?.label).toBe("Encoding tool");
    expect(describeMetadataTag("ISFT")?.label).toBe("Software");
  });

  it("names the ID3v2, Vorbis and RIFF families as the origins of TIT2, ENCODER and ISFT", () => {
    expect(describeMetadataTag("TIT2")?.origin).toBe("ID3v2 frame (MP3, ADTS)");
    expect(describeMetadataTag("ENCODER")?.origin).toBe("Vorbis comment / Matroska tag (Ogg, FLAC, MKV)");
    expect(describeMetadataTag("ISFT")?.origin).toBe("RIFF INFO chunk (WAVE)");
  });

  // The first and last name of every family, so a name that slips across the boundary into the
  // family beside it shows up as the wrong origin.
  it.each([
    ["©nam", "MP4 / QuickTime atom"],
    ["©xyz", "MP4 / QuickTime atom"],
    ["com.apple.quicktime.make", "QuickTime metadata key (mdta)"],
    ["com.apple.quicktime.location.ISO6709", "QuickTime metadata key (mdta)"],
    ["TIT2", "ID3v2 frame (MP3, ADTS)"],
    ["TAG", "ID3v2 frame (MP3, ADTS)"],
    ["TITLE", "Vorbis comment / Matroska tag (Ogg, FLAC, MKV)"],
    ["vendor", "Vorbis comment / Matroska tag (Ogg, FLAC, MKV)"],
    ["INAM", "RIFF INFO chunk (WAVE)"],
    ["IENG", "RIFF INFO chunk (WAVE)"],
    ["title", "Normalized by mediabunny"],
    ["comment", "Normalized by mediabunny"],
  ])("files %s, at the edge of its family, under %s", (key, origin) => {
    expect(describeMetadataTag(key)?.origin).toBe(origin);
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
    // @ts-expect-error: null is outside the type, but the falsy guard turns it away all the same.
    expect(describeMetadataTagValue(null)).toBeNull();
    expect(describeMetadataTagValue("")).toBeNull();
    expect(describeMetadataTagValue("My Home Video")).toBeNull();
  });

  it("only interpolates the matched version digits, never the whole value", () => {
    const hint = describeMetadataTagValue("Lavf60.16.100 <img src=x onerror=alert(1)>");
    expect(hint).not.toContain("<img");
  });
});
