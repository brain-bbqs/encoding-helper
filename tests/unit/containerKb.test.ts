import { describe, expect, it } from "vitest";
import { describeContainer } from "../../src/lib/containerKb";

describe("describeContainer", () => {
  it("returns null for a missing format name", () => {
    expect(describeContainer(null)).toBeNull();
    // @ts-expect-error: undefined is outside the type, but the falsy guard turns it away all the same.
    expect(describeContainer(undefined)).toBeNull();
    expect(describeContainer("")).toBeNull();
  });

  it("returns null for a format the knowledge base doesn't cover", () => {
    expect(describeContainer("Not A Container")).toBeNull();
  });

  it("describes MP4, including which codecs it carries", () => {
    const info = describeContainer("MP4");
    expect(info?.name).toBe("MP4");
    expect(info?.extensions).toContain(".mp4");
    expect(info?.video).toContain("H.264");
    expect(info?.audio).toContain("AAC");
  });

  it("keys entries by mediabunny's own format names", () => {
    expect(describeContainer("QuickTime File Format")?.extensions).toContain(".mov");
    expect(describeContainer("WebM")?.video).toContain("VP9");
    expect(describeContainer("MPEG Transport Stream")?.name).toBe("MPEG Transport Stream");
  });

  // The wording is the copy's to set, sentence case and all; what this asks is that an audio-only
  // container says it carries no video.
  it("marks audio-only containers as carrying no video", () => {
    for (const name of ["MP3", "WAVE", "FLAC", "ADTS"]) {
      expect(describeContainer(name)?.video).toMatch(/none/i);
    }
  });
});
