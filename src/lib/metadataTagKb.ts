// Metadata tag knowledge base — turns the container's own tag names into readable labels.
//
// mediabunny normalizes the handful of tags it recognizes (title, artist, ...) and dumps everything
// else into `raw` under whatever the container calls it, so the Inspect tab shows names like
// `©too`, `TIT2` or `ISFT` verbatim. Those are not typos: MP4/QuickTime tags are four-character
// atom names where a leading © (byte 0xA9) marks a QuickTime text atom, MP3/ADTS use ID3v2 frame
// ids, Ogg/FLAC/Matroska use Vorbis-style words, and WAVE uses RIFF INFO chunk ids.

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

type TagSeed = [key: string, label: string, description: string];

const QUICKTIME_ORIGIN = "MP4 / QuickTime atom";
const ID3_ORIGIN = "ID3v2 frame (MP3, ADTS)";
const VORBIS_ORIGIN = "Vorbis comment / Matroska tag (Ogg, FLAC, MKV)";
const RIFF_ORIGIN = "RIFF INFO chunk (WAVE)";
const NORMALIZED_ORIGIN = "Normalized by mediabunny";

const COPYRIGHT_PREFIX_NOTE =
  "The leading <code>©</code> is byte <code>0xA9</code>, QuickTime's marker for a text atom, not a copyright " +
  "statement.";

// MP4/QuickTime `ilst` atoms. Four characters each, case-sensitive.
const QUICKTIME_TAGS: TagSeed[] = [
  ["©nam", "Title", "The title of the work. " + COPYRIGHT_PREFIX_NOTE],
  ["©ART", "Artist", "The credited artist or creator. " + COPYRIGHT_PREFIX_NOTE],
  ["aART", "Album artist", "The main artist for the album or collection as a whole."],
  ["©alb", "Album", "The album or collection this file belongs to. " + COPYRIGHT_PREFIX_NOTE],
  ["©day", "Date", "Release, recording or creation date, often just a year. " + COPYRIGHT_PREFIX_NOTE],
  ["©cmt", "Comment", "Freeform notes about the file. " + COPYRIGHT_PREFIX_NOTE],
  ["©gen", "Genre", "Genre as free text (the <code>gnre</code> atom stores it as a numeric id instead)."],
  ["gnre", "Genre (numeric)", "Genre stored as an ID3v1 genre number rather than as text."],
  [
    "©too",
    "Encoding tool",
    "The software that wrote this file, stamped in by the muxer. <code>too</code> is short for " +
      '"tool", so this is the encoder signature, not a truncated word. ' +
      COPYRIGHT_PREFIX_NOTE,
  ],
  ["©enc", "Encoded by", "The person or organization credited with encoding the file."],
  ["©swr", "Software", "The application that created the file, as distinct from the muxing library."],
  ["©wrt", "Composer", "The writer or composer of the work."],
  ["©dir", "Director", "The credited director."],
  ["©des", "Description", "A short description of the content."],
  ["desc", "Description", "A short description of the content, as written by iTunes-style taggers."],
  ["ldes", "Long description", "A longer synopsis, used by Apple media apps."],
  ["©cpy", "Copyright", "The actual copyright notice. Unlike the other © atoms, this one really is about rights."],
  ["cprt", "Copyright", "The copyright notice for the work."],
  ["©lyr", "Lyrics", "Full lyrics or a transcript."],
  ["©inf", "Information", "Freeform information about the file."],
  ["©xyz", "Location", "GPS coordinates in ISO 6709 form, written by phones and action cameras."],
  ["trkn", "Track number", "Track position within its album, stored as a packed number/total pair."],
  ["disk", "Disc number", "Disc position within a multi-disc release, stored as a packed number/total pair."],
  ["covr", "Cover art", "Embedded artwork bytes (JPEG or PNG)."],
  ["stik", "Media kind", "Numeric hint at the content type, e.g. movie, TV show, music video or audiobook."],
  ["cpil", "Compilation", "Flag marking the album as a various-artists compilation."],
  ["tmpo", "Tempo (BPM)", "Beats per minute."],
  ["pgap", "Gapless playback", "Flag telling players not to insert silence between tracks."],
  ["purl", "Podcast URL", "Feed URL for podcast episodes."],
  ["keyw", "Keywords", "Searchable keywords."],
  ["rtng", "Content rating", "Numeric advisory rating, e.g. clean or explicit."],
  [
    "com.apple.quicktime.make",
    "Camera make",
    "Manufacturer of the recording device, written from a <code>keys</code> atom by Apple devices.",
  ],
  ["com.apple.quicktime.model", "Camera model", "Model of the recording device."],
  ["com.apple.quicktime.software", "Device software", "OS or app version on the recording device."],
  ["com.apple.quicktime.creationdate", "Capture date", "When the recording was made, including the time zone."],
  ["com.apple.quicktime.location.ISO6709", "Capture location", "GPS coordinates of the recording, in ISO 6709 form."],
];

// ID3v2 frames, used by MP3 and ADTS files.
const ID3_TAGS: TagSeed[] = [
  ["TIT2", "Title", "ID3v2's title frame."],
  ["TPE1", "Artist", "Lead performer or artist."],
  ["TPE2", "Album artist", "Band, orchestra or album-level artist."],
  ["TALB", "Album", "Album or collection name."],
  ["TCON", "Genre", "Genre, either as text or as a legacy numeric code in parentheses."],
  ["TRCK", "Track number", 'Track position, often written as "5/12".'],
  ["TPOS", "Disc number", 'Disc position in a set, often written as "1/2".'],
  ["TYER", "Year", "Four-digit year (ID3v2.3; superseded by <code>TDRC</code>)."],
  ["TDRC", "Recording date", "Full recording timestamp (ID3v2.4)."],
  ["TLEN", "Length", "Declared duration in milliseconds."],
  ["TCOM", "Composer", "Composer of the work."],
  [
    "TSSE",
    "Encoding settings",
    "The software and settings used to encode the file, the ID3 equivalent of MP4's <code>©too</code>.",
  ],
  ["TENC", "Encoded by", "The person or tool credited with encoding."],
  ["TBPM", "Tempo (BPM)", "Beats per minute."],
  ["COMM", "Comment", "Freeform comment, with a language code and a short description attached."],
  ["APIC", "Attached picture", "Embedded artwork such as cover art."],
  ["TXXX", "User-defined text", "Custom key/value pairs that do not fit any standard frame."],
  ["WXXX", "User-defined URL", "A custom URL, e.g. the artist or purchase page."],
  ["TAG", "ID3v1 block", "The legacy 128-byte tag at the end of an MP3, kept for old players."],
];

// Vorbis comments (Ogg, FLAC) and Matroska SimpleTags. Conventionally uppercase.
const VORBIS_TAGS: TagSeed[] = [
  ["TITLE", "Title", "The title of the work."],
  ["ARTIST", "Artist", "The credited artist or creator."],
  ["ALBUMARTIST", "Album artist", "The artist credited for the album as a whole."],
  ["ALBUM", "Album", "Album or collection name."],
  ["DATE", "Date", "Release or recording date."],
  ["DATE_RELEASED", "Release date", "Matroska's release-date tag."],
  ["GENRE", "Genre", "Genre as free text."],
  ["TRACKNUMBER", "Track number", "Track position within the album."],
  ["DISCNUMBER", "Disc number", "Disc position within the release."],
  ["COMMENT", "Comment", "Freeform comment."],
  ["DESCRIPTION", "Description", "A short description of the content."],
  [
    "ENCODER",
    "Encoding tool",
    "The software that wrote the file, the Vorbis/Matroska equivalent of MP4's <code>©too</code>.",
  ],
  ["ENCODED_BY", "Encoded by", "The person or organization credited with encoding."],
  ["vendor", "Vendor string", "The encoder's own identification string from the comment header."],
];

// RIFF INFO chunks, used by WAVE files. Values are ISO 8859-1 text.
const RIFF_TAGS: TagSeed[] = [
  ["INAM", "Title", "The name of the work."],
  ["IART", "Artist", "The credited artist."],
  ["IPRD", "Product / album", "The product or album the file belongs to."],
  ["ICMT", "Comment", "Freeform comment."],
  ["ICRD", "Creation date", "When the file was created."],
  ["ISFT", "Software", "The software that wrote the file."],
  ["IGNR", "Genre", "Genre as free text."],
  ["ICOP", "Copyright", "The copyright notice."],
  ["IENG", "Engineer", "The engineer credited with the recording."],
];

// mediabunny's own normalized field names, which appear alongside the raw ones.
const NORMALIZED_TAGS: TagSeed[] = [
  ["title", "Title", "Normalized from whichever title tag the container uses."],
  ["description", "Description", "Normalized short description or subtitle."],
  ["artist", "Artist", "Normalized primary artist or creator."],
  ["album", "Album", "Normalized album or collection name."],
  ["albumArtist", "Album artist", "Normalized album-level artist."],
  ["trackNumber", "Track number", "Normalized 1-based track position."],
  ["tracksTotal", "Total tracks", "Normalized count of tracks in the album."],
  ["discNumber", "Disc number", "Normalized 1-based disc position."],
  ["discsTotal", "Total discs", "Normalized count of discs in the release."],
  ["genre", "Genre", "Normalized genre."],
  ["lyrics", "Lyrics", "Normalized lyrics or transcript."],
  ["comment", "Comment", "Normalized freeform comment."],
];

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

// Encoder signatures common enough to be worth decoding on sight. Each pattern captures only a
// version number, so nothing from the file itself is ever interpolated into the returned markup
// beyond digits and dots.
const VALUE_HINTS: { pattern: RegExp; describe: (version: string) => string }[] = [
  {
    pattern: /\bLavf([\d.]+)/,
    describe: (v) =>
      `<code>Lavf${v}</code> is <b>libavformat ${v}</b>, the muxing library from FFmpeg, so this file was ` +
      "written by FFmpeg or by a tool built on it.",
  },
  {
    pattern: /\bLavc([\d.]+)/,
    describe: (v) => `<code>Lavc${v}</code> is <b>libavcodec ${v}</b>, FFmpeg's encoding library.`,
  },
  {
    pattern: /\bHandBrake\s*([\d.]*)/i,
    describe: (v) => `Written by <b>HandBrake</b>${v ? " " + v : ""}, a GUI front end over FFmpeg's libraries.`,
  },
  {
    // Every version group is written so it always participates in the match, even when the value
    // carries no version at all: that keeps the capture a string rather than undefined.
    pattern: /\bx264(?:\s+core)?\s*([\d.]*)/i,
    describe: (v) =>
      `Encoded with <b>x264</b>${v ? " core " + v : ""}, the open source H.264 encoder; the rest of the string is ` +
      "its full parameter list.",
  },
  {
    pattern: /\bx265\s*([\d.]*)/i,
    describe: (v) => `Encoded with <b>x265</b>${v ? " " + v : ""}, the open source H.265/HEVC encoder.`,
  },
  {
    pattern: /\bmediabunny\s*([\d.]*)/i,
    describe: (v) =>
      `Written by <b>mediabunny</b>${v ? " " + v : ""}, the in-browser media library this app uses, so the file ` +
      "was probably produced by a WebCodecs tool.",
  },
];

/** Explains a recognizable encoder signature in a tag value, e.g. "Lavf60.16.100". */
export function describeMetadataTagValue(value: string | null | undefined): string | null {
  if (!value) return null;
  for (const hint of VALUE_HINTS) {
    const m = hint.pattern.exec(value);
    if (m) return hint.describe(m[1]);
  }
  return null;
}
