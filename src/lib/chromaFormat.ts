// Works out a video track's chroma subsampling, rather than assuming it.
//
// The Inspect tab teaches what subsampling is, and used to name yuv420p while doing it — true of
// nearly every delivery file and of everything this app encodes, but an assumption all the same,
// and one the card had no business making beside a Color Space it reported as undeclared. So the
// format is read where the file states it, and left unstated where it does not.
//
// Two sources, in that order of authority:
//
//  1. The codec configuration record the container carries (`avcC`, `hvcC`, `av1C`, `vpcC`), which
//     the browser is handed as `VideoDecoderConfig.description`. Each states the format outright,
//     in a handful of bytes at a fixed place — that is what is read here, rather than the sequence
//     parameter set inside it, which would mean an exp-Golomb decoder for one field.
//  2. Failing that, the codec parameter string, which pins the format down for some codecs by
//     itself: H.264 outside the High profiles cannot be anything but 4:2:0, AV1 states its profile,
//     and VP9's long form carries the subsampling as a field.
//
// Anything else — no description, a truncated codec string, an `avcC` from a High-profile encoder
// that left the optional trailing byte off — comes back null, which the copy then reads as "this
// file does not say".

/** The chroma formats a codec configuration can name. */
export type ChromaFormat = "monochrome" | "4:2:0" | "4:2:2" | "4:4:4";

/** ISO 14496-15's chroma_format / chroma_format_idc values, shared by AVC and HEVC. */
const CHROMA_FORMAT_IDC: Record<number, ChromaFormat> = {
  0: "monochrome",
  1: "4:2:0",
  2: "4:2:2",
  3: "4:4:4",
};

/**
 * H.264 profiles whose SPS carries `chroma_format_idc` at all. For every other profile the standard
 * infers 4:2:0, which is why a Baseline or Main file needs no parsing to be certain about.
 */
const AVC_PROFILES_WITH_CHROMA = new Set([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135]);

/**
 * Reads the chroma format out of an `avcC` record (ISO 14496-15 §5.3.3.1.2). The parameter sets are
 * skipped rather than parsed: the record repeats the format after them for exactly the profiles
 * whose SPS carries one, which is the only case the profile alone cannot settle.
 */
function fromAvcC(data: Uint8Array): ChromaFormat | null {
  if (data.length < 7 || data[0] !== 1) return null;
  const profile = data[1];
  if (!AVC_PROFILES_WITH_CHROMA.has(profile)) return "4:2:0";

  let at = 5;
  const spsCount = data[at++] & 0x1f;
  for (let i = 0; i < spsCount; i++) {
    if (at + 2 > data.length) return null;
    at += 2 + ((data[at] << 8) | data[at + 1]);
  }
  if (at >= data.length) return null;
  const ppsCount = data[at++];
  for (let i = 0; i < ppsCount; i++) {
    if (at + 2 > data.length) return null;
    at += 2 + ((data[at] << 8) | data[at + 1]);
  }
  // The trailing part is optional in practice: muxers that leave it off leave the format unstated.
  return at < data.length ? (CHROMA_FORMAT_IDC[data[at] & 0x03] ?? null) : null;
}

/** `hvcC` states the format outright, at a fixed offset (ISO 14496-15 §8.3.3.1.2). */
function fromHvcC(data: Uint8Array): ChromaFormat | null {
  if (data.length < 17 || data[0] !== 1) return null;
  return CHROMA_FORMAT_IDC[data[16] & 0x03] ?? null;
}

/** `av1C`'s second byte carries the monochrome flag and the two subsampling bits (AV1-ISOBMFF §2.3). */
function fromAv1C(data: Uint8Array): ChromaFormat | null {
  if (data.length < 3 || (data[0] & 0x80) === 0) return null;
  const flags = data[2];
  if ((flags & 0x10) !== 0) return "monochrome";
  const subX = (flags & 0x08) !== 0;
  const subY = (flags & 0x04) !== 0;
  if (subX && subY) return "4:2:0";
  if (subX) return "4:2:2";
  return "4:4:4";
}

/** VP9's subsampling code, as `vpcC` and the codec string both carry it. 0 and 1 are both 4:2:0,
 * differing only in where the chroma sample sits. */
function vp9ChromaFromCode(code: number): ChromaFormat | null {
  if (code <= 1) return "4:2:0";
  if (code === 2) return "4:2:2";
  if (code === 3) return "4:4:4";
  return null;
}

/** `vpcC`'s third byte packs bit depth and the subsampling code (VP Codec ISOBMFF §2.2). */
function fromVpcC(data: Uint8Array): ChromaFormat | null {
  if (data.length < 3) return null;
  return vp9ChromaFromCode((data[2] >> 1) & 0x07);
}

/** The description as WebCodecs hands it over: a buffer, or a view onto one (shared or not). */
type Description = ArrayBufferLike | ArrayBufferView;

function toBytes(description: Description): Uint8Array {
  return ArrayBuffer.isView(description)
    ? new Uint8Array(description.buffer as ArrayBuffer, description.byteOffset, description.byteLength)
    : new Uint8Array(description as ArrayBuffer);
}

/** The format the container's codec configuration record states, or null where it states none. */
export function chromaFromDescription(codec: string | null, description: Description | null): ChromaFormat | null {
  if (!description) return null;
  const data = toBytes(description);
  switch (codec) {
    case "avc":
      return fromAvcC(data);
    case "hevc":
      return fromHvcC(data);
    case "av1":
      return fromAv1C(data);
    case "vp9":
      return fromVpcC(data);
    default:
      return null;
  }
}

/** What the codec parameter string alone settles, for the codecs where it settles anything. */
export function chromaFromCodecString(codec: string | null, codecString: string | null): ChromaFormat | null {
  if (codec === "vp8") return "4:2:0";
  if (!codecString) return null;

  // avc1.PPCCLL — the two hex digits after the dot are profile_idc.
  const avc = /^avc[13]\.([0-9a-f]{2})/i.exec(codecString);
  if (avc) return AVC_PROFILES_WITH_CHROMA.has(parseInt(avc[1], 16)) ? null : "4:2:0";

  // av01.P… — AV1's profile fixes the format: 0 is 4:2:0, 1 is 4:4:4, 2 is 4:2:2.
  const av1 = /^av01\.(\d)/.exec(codecString);
  if (av1) return ({ 0: "4:2:0", 1: "4:4:4", 2: "4:2:2" } as Record<string, ChromaFormat>)[av1[1]] ?? null;

  // vp09.PP.LL.DD.CC — the fifth field is the subsampling code, and is often left off.
  const vp9 = /^vp09(?:\.\d+){3}\.(\d+)/.exec(codecString);
  if (vp9) return vp9ChromaFromCode(parseInt(vp9[1], 10));
  return null;
}

/** The best answer either source gives, preferring what the container states outright. */
export function describeChromaFormat(
  codec: string | null,
  codecString: string | null,
  description: Description | null,
): ChromaFormat | null {
  return chromaFromDescription(codec, description) ?? chromaFromCodecString(codec, codecString);
}
