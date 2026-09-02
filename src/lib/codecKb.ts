// Codec knowledge base — infers codec family from mediabunny's short codec id (the same identifiers
// it accepts in Conversion's `codec:` option) and parses profile/level/tier out of the RFC 6381 codec
// parameter string (e.g. "avc1.640028") when the format is known. What each codec *is* reads out of
// CODEC_DESCRIPTIONS in lib/explainers, with the rest of the app's copy.

import { CODEC_DESCRIPTIONS, PCM_DESCRIPTION } from "./explainers";
import type { CodecDetail, CodecInfo } from "./types";

interface CodecKbEntry {
  family: string;
  fullName: string;
  year: number | null;
  description: string;
  parse: (codecString: string | null) => CodecDetail[];
}

const AVC_PROFILES: Record<number, string> = {
  66: "Baseline",
  77: "Main",
  88: "Extended",
  100: "High",
  110: "High 10",
  122: "High 4:2:2",
  244: "High 4:4:4 Predictive",
};

const HEVC_PROFILES: Record<number, string> = {
  1: "Main",
  2: "Main 10",
  3: "Main Still Picture",
  4: "Range Extensions",
};

const AAC_OTI: Record<number, string> = {
  2: "AAC-LC (Low Complexity)",
  5: "HE-AAC (SBR)",
  29: "HE-AAC v2 (SBR + PS)",
  4: "AAC LTP",
  42: "xHE-AAC",
};

// AV1's level field is an index into a fixed table, not level×10 like VP9 — levels 2.0-2.3, 3.0-3.3,
// ... 7.0-7.3 map to consecutive indices 0-23.
const AV1_LEVELS = [
  "2.0",
  "2.1",
  "2.2",
  "2.3",
  "3.0",
  "3.1",
  "3.2",
  "3.3",
  "4.0",
  "4.1",
  "4.2",
  "4.3",
  "5.0",
  "5.1",
  "5.2",
  "5.3",
  "6.0",
  "6.1",
  "6.2",
  "6.3",
  "7.0",
  "7.1",
  "7.2",
  "7.3",
];

const AV1_PROFILES = ["Main", "High", "Professional"];

const CODEC_KB: Partial<Record<string, CodecKbEntry>> = {
  avc: {
    family: "H.264 / AVC",
    fullName: "Advanced Video Coding",
    year: 2003,
    description: CODEC_DESCRIPTIONS.avc,
    parse: (cs) => {
      const m = /^avc[13]\.([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(cs || "");
      if (!m) return [];
      const profileIdc = parseInt(m[1], 16);
      const levelIdc = parseInt(m[3], 16);
      return [
        { label: "Profile", value: AVC_PROFILES[profileIdc] || `0x${m[1]}` },
        { label: "Level", value: (levelIdc / 10).toFixed(1) },
      ];
    },
  },
  hevc: {
    family: "H.265 / HEVC",
    fullName: "High Efficiency Video Coding",
    year: 2013,
    description: CODEC_DESCRIPTIONS.hevc,
    parse: (cs) => {
      const m = /^(?:hev1|hvc1)\.[ABC]?(\d+)\.[0-9A-Fa-f]+\.([LH])(\d+)/.exec(cs || "");
      if (!m) return [];
      return [
        { label: "Profile", value: HEVC_PROFILES[+m[1]] || `Profile ${m[1]}` },
        { label: "Tier", value: m[2] === "H" ? "High" : "Main" },
        { label: "Level", value: (parseInt(m[3], 10) / 30).toFixed(1) },
      ];
    },
  },
  vp9: {
    family: "VP9",
    fullName: "VP9",
    year: 2013,
    description: CODEC_DESCRIPTIONS.vp9,
    parse: (cs) => {
      const m = /^vp0?9\.(\d{2})\.(\d{2})\.(\d{2})/.exec(cs || "");
      if (!m) return [];
      return [
        { label: "Profile", value: parseInt(m[1], 10) },
        { label: "Level", value: (parseInt(m[2], 10) / 10).toFixed(1) },
        { label: "Bit depth", value: parseInt(m[3], 10) + "-bit" },
      ];
    },
  },
  av1: {
    family: "AV1",
    fullName: "AOMedia Video 1",
    year: 2018,
    description: CODEC_DESCRIPTIONS.av1,
    parse: (cs) => {
      const m = /^av01\.(\d)\.(\d{2})([MH])\.(\d{2})/.exec(cs || "");
      if (!m) return [];
      return [
        { label: "Profile", value: AV1_PROFILES[+m[1]] || m[1] },
        { label: "Level", value: AV1_LEVELS[parseInt(m[2], 10)] || m[2] },
        { label: "Tier", value: m[3] === "M" ? "Main" : "High" },
        { label: "Bit depth", value: parseInt(m[4], 10) + "-bit" },
      ];
    },
  },
  vp8: {
    family: "VP8",
    fullName: "VP8",
    year: 2008,
    description: CODEC_DESCRIPTIONS.vp8,
    parse: () => [],
  },
  prores: {
    family: "Apple ProRes",
    fullName: "ProRes",
    year: 2007,
    description: CODEC_DESCRIPTIONS.prores,
    parse: () => [],
  },
  aac: {
    family: "AAC",
    fullName: "Advanced Audio Coding",
    year: 1997,
    description: CODEC_DESCRIPTIONS.aac,
    parse: (cs) => {
      const m = /^mp4a\.40\.(\d+)/.exec(cs || "");
      if (!m) return [];
      return [{ label: "Profile", value: AAC_OTI[+m[1]] || `Object type ${m[1]}` }];
    },
  },
  opus: {
    family: "Opus",
    fullName: "Opus",
    year: 2012,
    description: CODEC_DESCRIPTIONS.opus,
    parse: () => [],
  },
  mp3: {
    family: "MP3",
    fullName: "MPEG-1/2 Audio Layer III",
    year: 1993,
    description: CODEC_DESCRIPTIONS.mp3,
    parse: () => [],
  },
  vorbis: {
    family: "Vorbis",
    fullName: "Ogg Vorbis",
    year: 2000,
    description: CODEC_DESCRIPTIONS.vorbis,
    parse: () => [],
  },
  flac: {
    family: "FLAC",
    fullName: "Free Lossless Audio Codec",
    year: 2001,
    description: CODEC_DESCRIPTIONS.flac,
    parse: () => [],
  },
  ac3: {
    family: "Dolby Digital (AC-3)",
    fullName: "Dolby Digital",
    year: 1991,
    description: CODEC_DESCRIPTIONS.ac3,
    parse: () => [],
  },
  eac3: {
    family: "Dolby Digital Plus (E-AC-3)",
    fullName: "Enhanced AC-3",
    year: 2005,
    description: CODEC_DESCRIPTIONS.eac3,
    parse: () => [],
  },
};

export function describeCodec(shortCodec: string | null | undefined, codecString: string | null): CodecInfo | null {
  if (!shortCodec) return null;
  if (shortCodec.startsWith("pcm-") || shortCodec === "ulaw" || shortCodec === "alaw") {
    return {
      family: "PCM (uncompressed)",
      fullName: "Pulse-Code Modulation",
      year: null,
      description: PCM_DESCRIPTION,
      details: [],
    };
  }
  const info = CODEC_KB[shortCodec];
  if (!info) return null;
  return {
    family: info.family,
    fullName: info.fullName,
    year: info.year,
    description: info.description,
    details: info.parse(codecString),
  };
}
