import { describe, expect, it } from "vitest";
import { describeContainer } from "../../src/lib/containerKb";
import { CONTAINER_KB } from "../../src/lib/explainers";

describe("describeContainer", () => {
  it("returns null for a missing format name", () => {
    expect(describeContainer(null)).toBeNull();
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

  it("gives every entry a name matching its key", () => {
    for (const [key, info] of Object.entries(CONTAINER_KB)) {
      expect(info?.name).toBe(key);
    }
  });
});
