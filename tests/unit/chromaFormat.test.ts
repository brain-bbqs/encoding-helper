import { describe, expect, it } from "vitest";
import { chromaFromCodecString, chromaFromDescription, describeChromaFormat } from "../../src/lib/chromaFormat";

/**
 * An `avcC` record: version, profile, compatibility, level, length-size, then one SPS and one PPS of
 * `spsLen`/`ppsLen` bytes, and the optional trailing byte carrying chroma_format when `chroma` is
 * given — the layout fromAvcC walks to reach that byte.
 */
function avcC(profile: number, chroma: number | null, spsLen = 3, ppsLen = 2): Uint8Array {
  const head = [1, profile, 0, 0x1f, 0xff, 0xe1, 0, spsLen, ...Array<number>(spsLen).fill(0x42)];
  const pps = [1, 0, ppsLen, ...Array<number>(ppsLen).fill(0x68)];
  const tail = chroma === null ? [] : [0xfc | chroma, 0xf8, 0xf8];
  return new Uint8Array([...head, ...pps, ...tail]);
}

describe("chromaFromDescription", () => {
  // Baseline, Main and Extended carry no chroma_format_idc at all: the standard infers 4:2:0, so
  // the record settles it without the trailing byte ever being written.
  it("reads 4:2:0 off a profile whose SPS cannot say otherwise", () => {
    expect(chromaFromDescription("avc", avcC(66, null))).toBe("4:2:0");
    expect(chromaFromDescription("avc", avcC(77, null))).toBe("4:2:0");
  });

  it("reads the High-profile record's own chroma field", () => {
    expect(chromaFromDescription("avc", avcC(100, 1))).toBe("4:2:0");
    expect(chromaFromDescription("avc", avcC(122, 2))).toBe("4:2:2");
    expect(chromaFromDescription("avc", avcC(244, 3))).toBe("4:4:4");
    expect(chromaFromDescription("avc", avcC(100, 0))).toBe("monochrome");
  });

  // Muxers may leave the trailing part off, and a High-profile file is 4:2:0 or monochrome either
  // way — not something to state on the file's behalf.
  it("says nothing for a High-profile record that stops before its chroma field", () => {
    expect(chromaFromDescription("avc", avcC(100, null))).toBeNull();
  });

  it("reads hvcC's chroma field, at its fixed offset", () => {
    const hvcC = new Uint8Array(20);
    hvcC[0] = 1;
    hvcC[16] = 0xfc | 2;
    expect(chromaFromDescription("hevc", hvcC)).toBe("4:2:2");
  });

  it("reads av1C's monochrome flag and subsampling bits", () => {
    const av1C = (flags: number): Uint8Array => new Uint8Array([0x81, 0x00, flags]);
    expect(chromaFromDescription("av1", av1C(0x0c))).toBe("4:2:0");
    expect(chromaFromDescription("av1", av1C(0x08))).toBe("4:2:2");
    expect(chromaFromDescription("av1", av1C(0x00))).toBe("4:4:4");
    expect(chromaFromDescription("av1", av1C(0x10))).toBe("monochrome");
  });

  it("reads vpcC's subsampling code", () => {
    const vpcC = (code: number): Uint8Array => new Uint8Array([0, 0, code << 1, 0]);
    expect(chromaFromDescription("vp9", vpcC(1))).toBe("4:2:0");
    expect(chromaFromDescription("vp9", vpcC(2))).toBe("4:2:2");
    expect(chromaFromDescription("vp9", vpcC(3))).toBe("4:4:4");
  });

  it("has nothing to say without a description, or for a codec it cannot read", () => {
    expect(chromaFromDescription("avc", null)).toBeNull();
    expect(chromaFromDescription("prores", new Uint8Array([1, 2, 3]))).toBeNull();
  });

  // A record from a broken muxer must not be read as a statement about the file.
  it("rejects an avcC that is too short or not version 1", () => {
    expect(chromaFromDescription("avc", new Uint8Array([1, 100, 0]))).toBeNull();
    const version2 = avcC(66, null);
    version2[0] = 2;
    expect(chromaFromDescription("avc", version2)).toBeNull();
  });

  it("gives up on a High-profile avcC truncated inside its parameter sets", () => {
    // Cut before the SPS length, after the SPS, and inside the PPS length, respectively.
    const full = avcC(100, 1);
    expect(chromaFromDescription("avc", full.slice(0, 7))).toBeNull();
    expect(chromaFromDescription("avc", full.slice(0, 11))).toBeNull();
    expect(chromaFromDescription("avc", full.slice(0, 12))).toBeNull();
  });

  it("rejects an hvcC that stops before its chroma field or is not version 1", () => {
    expect(chromaFromDescription("hevc", new Uint8Array(16))).toBeNull();
    const version0 = new Uint8Array(20);
    version0[16] = 0xfc | 1;
    expect(chromaFromDescription("hevc", version0)).toBeNull();
  });

  it("rejects an av1C without its marker bit or its flags byte", () => {
    expect(chromaFromDescription("av1", new Uint8Array([0x01, 0x00, 0x0c]))).toBeNull();
    expect(chromaFromDescription("av1", new Uint8Array([0x81, 0x00]))).toBeNull();
  });

  it("says nothing for a vpcC that is too short or carries a reserved subsampling code", () => {
    expect(chromaFromDescription("vp9", new Uint8Array([0, 0]))).toBeNull();
    expect(chromaFromDescription("vp9", new Uint8Array([0, 0, 4 << 1, 0]))).toBeNull();
  });

  // WebCodecs may hand the record over as a bare buffer rather than a view onto one.
  it("reads a description given as an ArrayBuffer", () => {
    const record = avcC(122, 2);
    expect(chromaFromDescription("avc", record.buffer.slice(0, record.byteLength))).toBe("4:2:2");
  });
});

describe("chromaFromCodecString", () => {
  it("settles H.264 outside the High profiles, and leaves the rest open", () => {
    expect(chromaFromCodecString("avc", "avc1.42e015")).toBe("4:2:0");
    expect(chromaFromCodecString("avc", "avc1.4d401f")).toBe("4:2:0");
    expect(chromaFromCodecString("avc", "avc1.640028")).toBeNull();
  });

  it("takes AV1's format from its profile", () => {
    expect(chromaFromCodecString("av1", "av01.0.08M.08")).toBe("4:2:0");
    expect(chromaFromCodecString("av1", "av01.1.08M.08")).toBe("4:4:4");
    expect(chromaFromCodecString("av1", "av01.2.08M.10")).toBe("4:2:2");
  });

  it("takes VP9's from the field its long form carries, and says nothing without it", () => {
    expect(chromaFromCodecString("vp9", "vp09.00.10.08.02")).toBe("4:2:2");
    expect(chromaFromCodecString("vp9", "vp09.00.10.08")).toBeNull();
  });

  it("knows VP8 has only ever been 4:2:0", () => {
    expect(chromaFromCodecString("vp8", null)).toBe("4:2:0");
  });

  it("says nothing for a reserved VP9 subsampling code or an AV1 profile that does not exist", () => {
    expect(chromaFromCodecString("vp9", "vp09.00.10.08.04")).toBeNull();
    expect(chromaFromCodecString("av1", "av01.3.08M.08")).toBeNull();
  });

  it("says nothing without a codec string, or for a string it has no rule for", () => {
    expect(chromaFromCodecString("avc", null)).toBeNull();
    expect(chromaFromCodecString("hevc", "hvc1.1.6.L93.B0")).toBeNull();
  });
});

describe("describeChromaFormat", () => {
  // The record is what the file states; the codec string is what its profile allows.
  it("prefers what the container states to what the profile implies", () => {
    expect(describeChromaFormat("avc", "avc1.640028", avcC(100, 2))).toBe("4:2:2");
    expect(describeChromaFormat("avc", "avc1.640028", avcC(100, null))).toBeNull();
    expect(describeChromaFormat("avc", "avc1.42e015", null)).toBe("4:2:0");
  });
});
