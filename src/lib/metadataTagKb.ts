// Metadata tag knowledge base — turns the container's own tag names into readable labels. The tables
// it reads (the tag seeds and the encoder-signature hints) are prose, so they live with the rest of
// the app's copy in lib/explainers; the lookup is what is left here.
//
// mediabunny normalizes the handful of tags it recognizes (title, artist, ...) and dumps everything
// else into `raw` under whatever the container calls it, so the Inspect tab shows names like
// `©too`, `TIT2` or `ISFT` verbatim. Those are not typos: MP4/QuickTime tags are four-character
// atom names where a leading © (byte 0xA9) marks a QuickTime text atom, MP3/ADTS use ID3v2 frame
// ids, Ogg/FLAC/Matroska use Vorbis-style words, and WAVE uses RIFF INFO chunk ids.

import {
  ID3_ORIGIN,
  ID3_TAGS,
  NORMALIZED_ORIGIN,
  NORMALIZED_TAGS,
  QUICKTIME_ORIGIN,
  QUICKTIME_TAGS,
  RIFF_ORIGIN,
  RIFF_TAGS,
  VALUE_HINTS,
  VORBIS_ORIGIN,
  VORBIS_TAGS,
  type TagSeed,
} from "./explainers";

export interface MetadataTagInfo {
  /** The canonical key as this knowledge base spells it (never the untrusted key read off a file). */
  key: string;
  /** Readable label shown in place of the raw key. */
  label: string;
  /** Where the name comes from, e.g. "QuickTime/iTunes atom". */
  origin: string;
  /** Trusted, author-authored explainer markup. */
  description: string;
}

function seedGroup(origin: string, seeds: TagSeed[]): MetadataTagInfo[] {
  return seeds.map(([key, label, description]) => ({ key, label, origin, description }));
}

// Order matters for the case-insensitive fallback below: the container-native spellings are
// registered before mediabunny's normalized field names, so a stray "Title" resolves to the
// Vorbis-style entry rather than to the normalized one.
const TAG_KB: MetadataTagInfo[] = [
  ...seedGroup(QUICKTIME_ORIGIN, QUICKTIME_TAGS),
  ...seedGroup(ID3_ORIGIN, ID3_TAGS),
  ...seedGroup(VORBIS_ORIGIN, VORBIS_TAGS),
  ...seedGroup(RIFF_ORIGIN, RIFF_TAGS),
  ...seedGroup(NORMALIZED_ORIGIN, NORMALIZED_TAGS),
];

const BY_EXACT_KEY = new Map<string, MetadataTagInfo>();
const BY_UPPER_KEY = new Map<string, MetadataTagInfo>();
for (const entry of TAG_KB) {
  if (!BY_EXACT_KEY.has(entry.key)) BY_EXACT_KEY.set(entry.key, entry);
  const upper = entry.key.toUpperCase();
  if (!BY_UPPER_KEY.has(upper)) BY_UPPER_KEY.set(upper, entry);
}

/**
 * Looks up a tag name as read off a file. Exact match wins; otherwise the lookup is retried
 * case-insensitively, since Vorbis/Matroska writers vary on capitalization.
 */
export function describeMetadataTag(key: string | null | undefined): MetadataTagInfo | null {
  if (!key) return null;
  return BY_EXACT_KEY.get(key) ?? BY_UPPER_KEY.get(key.toUpperCase()) ?? null;
}

/** Explains a recognizable encoder signature in a tag value, e.g. "Lavf60.16.100". */
export function describeMetadataTagValue(value: string | null | undefined): string | null {
  if (!value) return null;
  for (const hint of VALUE_HINTS) {
    const m = hint.pattern.exec(value);
    if (m) return hint.describe(m[1]);
  }
  return null;
}
