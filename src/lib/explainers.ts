// Author-authored explainer copy: every word of teaching material the app shows, in one file.
//
// Nothing here is written by a tab. A renderer that wants to teach something imports the copy from
// here, so the whole of what the app says can be read, edited and kept consistent in one place
// rather than being hunted for across the tab that happens to show it — and the page and the
// exported document can never explain the same number two different ways, since they read the same
// string. The knowledge bases' records live here too, the prose of them; what stays in lib/codecKb,
// lib/containerKb and lib/metadataTagKb is the lookup and the parsing that reads these tables.
//
// Order follows the app, not the code: tab by tab left to right (Inspect, Reencode with FFmpeg,
// Compare Quality, Full Analysis) and, within a tab, card by card down the page, so an entry is
// found by remembering where it is read. Copy shown on two tabs sits where it first appears. What
// stays with its renderer is the text that is not teaching: button labels, status and error lines.
//
// Every string here is trusted markup rendered through innerHTML (teachBox, info popovers, the
// document's prose blocks), so nothing read out of a media file may be interpolated into one
// without going through escapeHtml first — the builders below that take file-derived numbers do
// exactly that.
import type { BitrateTimeline } from "./bitrateTimeline";
import { escapeHtml } from "./dom";
import { fmtBits } from "./format";
import type { SizeEstimate } from "./sizeEstimate";
import type { ChromaFormat } from "./chromaFormat";
import type { CodecInfo, ContainerInfo } from "./types";

// --- Inspect · Video Container Overview, the first card on the first tab ---

/** The container-vs-codec distinction, shown above every container explainer. */
export const CONTAINER_PREAMBLE =
  "A <b>video container</b> is the wrapper around the media content: the compressed video bitstream, one or " +
  "more compressed audio tracks, subtitles, chapter markers, and metadata such as timestamps or sync " +
  "information. The <b>codec</b> is what actually compresses the frames. The most widespread codec (H.264) can " +
  "be found in an MP4, a MOV (.mov), or a Matroska (.mkv) file. Containers differ in which other codecs they " +
  "allow; not every codec belongs in every container.";

/**
 * What this particular container is, and which codecs it can carry.
 *
 * `atomMapHref` turns the <b>Atom Map</b> a record mentions into a link to wherever the map is on
 * the page doing the rendering — a section of the Inspect tab, a section of the Full Analysis
 * document — since the two anchor it under different headings. Left out, the mention stays plain
 * text rather than pointing somewhere that is not there.
 */
export function containerExplainer(info: ContainerInfo, atomMapHref?: string | null): string {
  const description = atomMapHref
    ? info.description.replace("<b>Atom Map</b>", `<a href="${atomMapHref}"><b>Atom Map</b></a>`)
    : info.description;
  return (
    `<b>${info.name}</b> (${info.fullName}; ${info.extensions}). ${description}` +
    `<p><b>Video codecs it can carry:</b> ${info.video}<br>` +
    `<b>Audio codecs:</b> ${info.audio}<br>` +
    `<b>Playback:</b> ${info.support}</p>`
  );
}

/** One record per container the app recognizes, shown by containerExplainer above. */
export const CONTAINER_KB: Partial<Record<string, ContainerInfo>> = {
  MP4: {
    name: "MP4",
    fullName: "MPEG-4 Part 14, an ISO Base Media File Format layout",
    extensions: ".mp4, .m4v, .m4a",
    description:
      "The default delivery container for the web. A tree of boxes (atoms) where <code>moov</code> holds the " +
      "sample index and <code>mdat</code> holds the frame bytes. See the <b>Atom Map</b> for this file's layout.",
    video:
      "H.264/AVC (near universal), plus H.265/HEVC, AV1, VP9 and ProRes, which the format accepts but far " +
      "fewer players handle.",
    audio: "AAC (the usual pairing), MP3, AC-3/E-AC-3, plus Opus and FLAC in newer players.",
    support:
      "Plays in every browser and hardware decoder when the payload is H.264 + AAC, which is why it is the safe default.",
  },
  "QuickTime File Format": {
    name: "QuickTime File Format",
    fullName: "QTFF, Apple's original format and the ancestor of MP4",
    extensions: ".mov, .qt",
    description:
      "Structurally the same box tree as MP4 (MP4 was standardized from it), so tools read both the same way. " +
      "It is looser about what may go inside, which is why editing and camera workflows prefer it.",
    video: "H.264, H.265, ProRes and other intra-only mezzanine codecs, plus uncompressed and animation formats.",
    audio: "AAC, uncompressed PCM, and multi-channel layouts used in production.",
    support:
      "Native on Apple platforms and in most editors. Browsers only play it when the payload happens to be a " +
      "codec they support, so .mov files are usually rewrapped to MP4 for the web.",
  },
  Matroska: {
    name: "Matroska",
    fullName: "Matroska Multimedia Container",
    extensions: ".mkv, .mka",
    description:
      "An open, extensible container that deliberately puts almost no restriction on its payload, including " +
      "many tracks, chapters, attachments and subtitle formats in one file.",
    video: "Essentially anything: H.264, H.265, AV1, VP9, VP8, ProRes, FFV1 and more.",
    audio: "AAC, Opus, Vorbis, FLAC, MP3, AC-3, PCM and others.",
    support:
      "Great for archival and playback in VLC/mpv, but browsers do not play .mkv directly; only its WebM " +
      "subset is supported.",
  },
  WebM: {
    name: "WebM",
    fullName: "WebM, a deliberately restricted profile of Matroska",
    extensions: ".webm",
    description:
      "Matroska trimmed down to royalty-free codecs so browsers can guarantee playback. The file structure is " +
      "Matroska; the restriction is on which codecs may appear.",
    video: "VP8, VP9 and AV1 only.",
    audio: "Vorbis and Opus only.",
    support: "Plays in Chrome, Firefox and Edge; Safari support depends on the codec and the device.",
  },
  MP3: {
    name: "MP3",
    fullName: "MPEG-1/2 Audio Layer III elementary stream",
    extensions: ".mp3",
    description:
      "Barely a container at all: a bare sequence of audio frames, with tags bolted on at the front or back as " +
      "ID3 blocks. There is no index, so players estimate seek positions from the bitrate.",
    video: "None, this is an audio-only format.",
    audio: "MP3 only.",
    support: "Universal.",
  },
  WAVE: {
    name: "WAVE",
    fullName: "Waveform Audio File Format, a RIFF layout",
    extensions: ".wav",
    description:
      "A simple RIFF chunk list, almost always holding uncompressed samples. Metadata lives in an optional " +
      "<code>INFO</code> chunk.",
    video: "None, this is an audio-only format.",
    audio: "Uncompressed PCM in the common case; a few compressed payloads are accepted but rare.",
    support: "Universal, at the cost of very large files.",
  },
  Ogg: {
    name: "Ogg",
    fullName: "Ogg bitstream container",
    extensions: ".ogg, .oga, .ogv",
    description:
      "An open container built around interleaved pages, with tags stored as Vorbis-style comments in each " +
      "stream's header rather than in one global block.",
    video: "Theora, and VP8 in some encoders.",
    audio: "Vorbis, Opus and FLAC.",
    support: "Supported by Chrome and Firefox; the Opus-in-Ogg pairing is the common modern use.",
  },
  FLAC: {
    name: "FLAC",
    fullName: "Free Lossless Audio Codec, native stream layout",
    extensions: ".flac",
    description:
      "The FLAC codec in its own minimal container: a stream of metadata blocks followed by audio frames, with " +
      "tags in a Vorbis comment block.",
    video: "none, this is an audio-only format",
    audio: "FLAC only",
    support: "Widely supported for lossless audio; also carryable inside MP4, Matroska and Ogg.",
  },
  ADTS: {
    name: "ADTS",
    fullName: "Audio Data Transport Stream",
    extensions: ".aac, .adts",
    description:
      "Raw AAC framing meant for streaming rather than storage: every frame repeats its own header, so a " +
      "decoder can join mid-stream. No index and no real metadata beyond optional ID3 tags.",
    video: "none, this is an audio-only format",
    audio: "AAC only",
    support: "Used inside HLS and broadcast pipelines; usually rewrapped into MP4 for playback.",
  },
  "MPEG Transport Stream": {
    name: "MPEG Transport Stream",
    fullName: "MPEG-TS, ISO/IEC 13818-1",
    extensions: ".ts, .m2ts, .mts",
    description:
      "A broadcast container built from fixed 188-byte packets so a receiver can recover from data loss and " +
      "start decoding at any point. Robust on a lossy link, wasteful on disk.",
    video: "H.264, H.265, MPEG-2",
    audio: "AAC, AC-3/E-AC-3, MP2",
    support: "The segment format of older HLS streams and of camera/broadcast recordings, not of browsers directly.",
  },
  "HTTP Live Streaming (HLS)": {
    name: "HTTP Live Streaming (HLS)",
    fullName: "HLS playlist, not a single media file",
    extensions: ".m3u8",
    description:
      "A text playlist pointing at a sequence of media segments (MPEG-TS or fragmented MP4), often at several " +
      "bitrates. The codecs are whatever the segments hold.",
    video: "H.264 and H.265 in practice",
    audio: "AAC, plus AC-3/E-AC-3",
    support: "Native in Safari and on iOS; other browsers play it through a JavaScript player.",
  },
};

/** The Overview's whole-file bitrate, which is not the same as any one track's bitrate. */
export const OVERALL_BITRATE_INFO =
  "<b>Overall bitrate</b> is the file size in bytes &times; 8 &divide; duration, where duration is in seconds, " +
  "averaged across the entire file. It counts the video, audio, and the container's own overhead, " +
  "so it always exceeds the sum of the individual stream bitrates.";

/** What the MIME type is, from the ⓘ beside the readout in the overview. */
export const MIME_TYPE_INFO =
  "The MIME type (formally the media type, registered with IANA) is the standardized machine-readable " +
  "<code>type/subtype</code> identifier a file uses to declare itself over a network. ";

export const METADATA_TAGS_TEACH =
  "<b>Metadata tags</b> are descriptive labels stored beside the media data. They never affect playback or " +
  "quality, and most are written automatically by whatever tool produced the file. The names below are the " +
  "container's own, which is why some look cryptic: MP4 and QuickTime use four-character atom names where a " +
  "leading <code>©</code> (byte <code>0xA9</code>) marks a text atom, so <code>©too</code> is the encoding " +
  "<i>tool</i> and <code>©nam</code> is the title. MP3 uses ID3v2 frame ids such as <code>TIT2</code>, WAVE " +
  "uses RIFF <code>INFO</code> chunk ids such as <code>ISFT</code>, and Ogg, FLAC and Matroska use plain " +
  "words such as <code>ENCODER</code>.";

/** Only true where the tags are rendered with their ⓘ affordances, so the document leaves it off. */
export const METADATA_TAGS_HOVER_HINT = "Hover the ⓘ on any tag for what it means.";

export type TagSeed = [key: string, label: string, description: string];

export const QUICKTIME_ORIGIN = "MP4 / QuickTime atom";
export const QUICKTIME_KEY_ORIGIN = "QuickTime metadata key (mdta)";
export const ID3_ORIGIN = "ID3v2 frame (MP3, ADTS)";
export const VORBIS_ORIGIN = "Vorbis comment / Matroska tag (Ogg, FLAC, MKV)";
export const RIFF_ORIGIN = "RIFF INFO chunk (WAVE)";
export const NORMALIZED_ORIGIN = "Normalized by mediabunny";

// MP4/QuickTime `ilst` atoms. Four characters each, case-sensitive. The leading `©` on many of
// them is byte 0xA9, QuickTime's text-atom marker — explained once in METADATA_TAGS_TEACH rather
// than repeated on every entry below.
export const QUICKTIME_TAGS: TagSeed[] = [
  // Work and release
  ["©nam", "Title", "The title of the work."],
  ["©alb", "Album", "The album or collection this file belongs to."],
  ["©day", "Date", "Release, recording or creation date, often just a year."],
  ["©gen", "Genre", "Genre as free text (the <code>gnre</code> atom stores it as a numeric id instead)."],
  ["gnre", "Genre (numeric)", "Genre stored as an ID3v1 genre number rather than as text."],
  ["trkn", "Track number", "Track position within its album, stored as a packed number/total pair."],
  ["disk", "Disc number", "Disc position within a multi-disc release, stored as a packed number/total pair."],
  ["cpil", "Compilation", "Flag marking the album as a various-artists compilation."],
  ["tmpo", "Tempo (BPM)", "Beats per minute."],

  // Credits
  ["©ART", "Artist", "The credited artist or creator."],
  ["aART", "Album artist", "The main artist for the album or collection as a whole."],
  ["©wrt", "Composer", "The writer or composer of the work."],
  ["©dir", "Director", "The credited director."],

  // Description and text
  ["©des", "Description", "A short description of the content."],
  ["desc", "Description", "A short description, as written by iTunes-style taggers."],
  ["ldes", "Long description", "A longer synopsis, used by Apple media apps."],
  ["©cmt", "Comment", "Freeform notes about the file."],
  ["©inf", "Information", "Freeform information about the file."],
  ["keyw", "Keywords", "Searchable keywords."],
  ["©lyr", "Lyrics", "Full lyrics or a transcript."],

  // Rights
  [
    "©cpy",
    "Copyright (QuickTime)",
    "QuickTime's copyright notice. Unlike the other <code>©</code> atoms, this one really is about rights.",
  ],
  ["cprt", "Copyright", "The copyright notice for the work, as MP4 standardized it."],

  // How the file was made
  [
    "©too",
    "Encoding tool",
    "The software that wrote this file, stamped in by the muxer. <code>too</code> is short for " +
      '"tool", so this is the encoder signature, not a truncated word.',
  ],
  ["©swr", "Software", "The application that created the file, as distinct from the muxing library."],
  ["©enc", "Encoded by", "The person or organization credited with encoding the file."],

  // Playback and presentation
  ["covr", "Cover art", "Embedded artwork bytes (JPEG or PNG)."],
  ["stik", "Media kind", "Numeric hint at the content type, e.g. movie, TV show, music video or audiobook."],
  ["rtng", "Content rating", "Numeric advisory rating, e.g. clean or explicit."],
  ["pgap", "Gapless playback", "Flag telling players not to insert silence between tracks."],
  ["purl", "Podcast URL", "Feed URL for podcast episodes."],

  // Capture
  ["©xyz", "Location", "GPS coordinates in ISO 6709 form, written by phones and action cameras."],
];

// QuickTime metadata keys, written by Apple devices through the `mdta` handler: a `keys` atom
// declares reverse-DNS names and the parallel `ilst` holds their values. Not four-character atoms,
// and not interchangeable with the table above.
export const QUICKTIME_KEY_TAGS: TagSeed[] = [
  ["com.apple.quicktime.make", "Camera make", "Manufacturer of the recording device."],
  ["com.apple.quicktime.model", "Camera model", "Model of the recording device."],
  ["com.apple.quicktime.software", "Device software", "OS or app version on the recording device."],
  ["com.apple.quicktime.creationdate", "Capture date", "When the recording was made, including the time zone."],
  ["com.apple.quicktime.location.ISO6709", "Capture location", "GPS coordinates of the recording, in ISO 6709 form."],
];

// ID3v2 frames, used by MP3 and ADTS files.
export const ID3_TAGS: TagSeed[] = [
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
export const VORBIS_TAGS: TagSeed[] = [
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
export const RIFF_TAGS: TagSeed[] = [
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
export const NORMALIZED_TAGS: TagSeed[] = [
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

// Encoder signatures common enough to be worth decoding on sight. Each pattern captures only a
// version number, so nothing from the file itself is ever interpolated into the returned markup
// beyond digits and dots.
export const VALUE_HINTS: { pattern: RegExp; describe: (version: string) => string }[] = [
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

// --- Inspect · Video Track ---

/**
 * What a codec is, shown under the track it belongs to. Null for a codec the knowledge base does
 * not recognize, where there is nothing to say.
 */
export function codecExplainer(codecInfo: CodecInfo | null | undefined): string | null {
  if (!codecInfo) return null;
  const year = codecInfo.year ? ` (${codecInfo.year})` : "";
  const name = codecInfo.fullName && codecInfo.fullName !== codecInfo.family ? `, ${codecInfo.fullName}` : "";
  // The parsed profile and level are not repeated here: the card lists them as figures of their own.
  return `<b>${codecInfo.family}</b>${year}${name}. ${codecInfo.description}`;
}

/**
 * What each codec is, keyed by mediabunny's short codec id, shown under the track that uses it.
 * The profile/level parsing that goes beside it stays in lib/codecKb, which reads these.
 */
export const CODEC_DESCRIPTIONS: Record<string, string> = {
  avc: "The most widely supported video codec in existence; nearly every browser, phone, and hardware decoder handles it natively. It works by splitting each frame into blocks, predicting them from earlier frames, and smoothing the block edges before the result is reused as a reference.",
  hevc: "Roughly 2&times; more efficient than H.264 at equal visual quality, using larger coding-tree blocks and richer intra/inter prediction, at the cost of much slower encoding and patchier hardware decode support (older devices and some browsers can't play it back at all, which is a poor fit for a shared QC/annotation pipeline).",
  vp9: "An open, royalty-free codec from Google built as a free alternative to H.265, with broadly similar compression efficiency. Well supported in Chrome/Firefox and common in WebM, but not universal on iOS/Safari or older hardware decoders.",
  av1: "The newest royalty-free, open codec, developed by the Alliance for Open Media (Google, Netflix, Amazon, Mozilla, and others). Roughly 30% more efficient than HEVC/VP9 at equal quality and historically very slow to encode, with hardware decode support still spreading, so it is increasingly used for high-volume streaming where the bitrate savings outweigh the encoding cost.",
  vp8: "An earlier royalty-free codec from On2/Google, roughly comparable in efficiency to H.264. Mostly superseded by VP9 today, but still seen in WebRTC and some legacy WebM files.",
  prores:
    "A high-bitrate, intraframe-only professional mezzanine codec in which every frame is a keyframe, so it's trivially and instantly seekable, at the cost of much larger files. Meant for editing workflows, not final delivery.",
  aac: "The default audio codec paired with H.264/MP4 video; a more efficient successor to MP3 at the same bitrate, with near-universal hardware and browser support.",
  opus: "A modern, royalty-free, low-latency codec tuned for both speech and music; it is the default for WebRTC and increasingly used for general-purpose streaming audio.",
  mp3: "The classic lossy audio format. Universally compatible, but less efficient than AAC or Opus at the same bitrate.",
  vorbis: "A royalty-free codec and the predecessor to Opus, commonly paired with VP8/VP9 in WebM and OGG containers.",
  flac: "Lossless compression, meaning bit-exact reconstruction of the original samples, at roughly 50&ndash;60% the size of raw PCM. Not used for lossy delivery, but common for archival audio.",
  ac3: "A perceptual multichannel (up to 5.1) audio codec common in broadcast, DVD, and streaming.",
  eac3: "An extension of AC-3 with higher efficiency and up to 7.1 channels; common in modern streaming and broadcast.",
};

/** Shown for uncompressed audio, which has no knowledge-base entry of its own. */
export const PCM_DESCRIPTION =
  "Raw, uncompressed audio samples, with no encoding at all. Simple and lossless, but large; mostly seen in short clips or intermediate/editing files rather than delivery formats.";

/**
 * What chroma subsampling is, and what this file's own format asks of its dimensions. The format is
 * not named here — the card lists it as a figure — except where the file states none at all, which
 * is the one case worth saying out loud. `chroma` is read out of the container's codec
 * configuration (see lib/chromaFormat), and is null for a file that states nothing.
 */
export function chromaSubsamplingExplainer(width: number, height: number, chroma: ChromaFormat | null): string {
  const evenW = width % 2 === 0;
  const evenH = height % 2 === 0;
  const oddIn = `<b>odd</b> in ${!evenW ? "width" : ""}${!evenW && !evenH ? " and " : ""}${!evenH ? "height" : ""} (${width}×${height})`;
  const intro =
    `<b>Chroma subsampling</b> stores the color channels at a lower resolution than the brightness, ` +
    `which the eye barely registers: <b>4:2:0</b> (<code>yuv420p</code>) halves both dimensions of the ` +
    `color and so cuts the data roughly in half, <b>4:2:2</b> halves only the horizontal, and <b>4:4:4</b> ` +
    `subsamples nothing.`;
  // 4:2:0's even-dimension requirement is worth stating wherever it is the format in play, read off
  // the file or merely the likely one. The format itself is not: the card lists it as a figure above.
  const even420 =
    `<p>4:2:0 needs <b>even</b> width and height so every 2&times;2 block of brightness maps to one ` +
    `color sample, and this file is ${evenW && evenH ? "already even in both" : `${oddIn}, which an encoder must pad or crop before it can write yuv420p`}.</p>`;
  if (chroma === null) {
    return (
      `${intro} <p>This file does not state which it uses — the codec configuration carries no chroma ` +
      `field, and its profile allows more than one — but 4:2:0 is what nearly every delivery file is, ` +
      `and what this app's own encodes write.</p>${even420}`
    );
  }
  if (chroma === "monochrome") {
    return `${intro} <p>Monochrome carries brightness only: there are no color channels to subsample.</p>`;
  }
  if (chroma === "4:2:0") return `${intro}${even420}`;
  if (chroma === "4:2:2") {
    return `${intro} <p>4:2:2 needs an <b>even width</b>, which this file ${evenW ? "has" : `does not (${width}px)`}.</p>`;
  }
  return intro;
}

// --- Inspect · Atom Map ---

/** What the box tree is, shown above the Full Analysis document's listing of it. */
export const ATOM_STRUCTURE_TEACH =
  `An MP4 file is a tree of <b>boxes</b> (also called &ldquo;atoms&rdquo;): <code>ftyp</code> declares the ` +
  `brand/compatibility, <code>moov</code> holds all metadata &amp; the sample index (offsets, sizes, ` +
  `timestamps, keyframe flags), and <code>mdat</code> holds the raw encoded frame bytes it points to. ` +
  `Fragmented MP4s repeat <code>moof</code>+<code>mdat</code> pairs instead of one big <code>mdat</code>.`;

/** Why the order of two boxes decides whether the file streams, read against the map that draws them. */
export const FASTSTART_EXPLAINER =
  "<b>Faststart</b> means the <code>moov</code> atom (the index describing every sample) sits before " +
  "<code>mdat</code> (the actual frame bytes). A video player can then begin playback immediately after downloading " +
  "only the first few kilobytes, instead of the entire file. " +
  "This is especially important when handling very long videos or when streaming over the web.";

/** Under the atom map in the Full Analysis document, which has no hover or zoom to explain. */
export const ATOM_MAP_DOC_CAPTION =
  "The box tree on its side: left to right across the file, each row one level further in. Width is how many " +
  "boxes a subtree holds, not how many bytes it takes.";

/** Hover and click, in the readout under the map, until one of them says something else. */
export const ATOM_MAP_READOUT_HINT = "Hover a block for its offset and size; click one to zoom into it.";

// --- Inspect · Video Bitrate Over Time ---

/** Explains why the plot is absent: the container says the rate is constant, and it turned out to be. */
export function constantBitrateNote(avgBitrate: number): string {
  return (
    `The container declares this track <b>constant bitrate</b>: its <code>btrt</code> box gives the same ` +
    `number, ${escapeHtml(fmtBits(avgBitrate))}, as both the track's average and its maximum rate. Its sample ` +
    `sizes bear that out, every window of playback carrying the same bits as every other, so there is no ` +
    `variation over time for a plot to show. ` +
    `<p>That is the trade a constant bitrate makes: the rate is predictable, which is what fixed-bandwidth ` +
    `delivery and older broadcast pipelines need, but quality is not. A hard scene gets no more bits than ` +
    `its share and visibly degrades, while an easy one cannot give its unused share back. A ` +
    `<b>variable bitrate</b> encode (any CRF encode, including the Reencode with FFmpeg tab's) inverts that: it holds ` +
    `quality steady and lets the rate move, which is what this card plots for such a file.</p>`
  );
}

export const TOO_FEW_FRAMES_NOTE =
  "There are too few frames here to divide the track into windows of playback, so there is no shape to " +
  "plot. The average is the whole of what the sample table can say about this file's rate.";

export const BITRATE_TIMELINE_TEACH =
  "<b>Bitrate</b> is how many bits it takes to store one second of playback, so it is a major factor determining " +
  "both file size and video quality. " +
  "<p>A <b>variable bitrate</b> encoder (which is what a CRF encode is, and what x264 does by default) " +
  "targets a constant <i>quality</i> and lets the rate adapt. It spends bits on keyframes, " +
  "scene cuts, and fast motion, but saves them on still shots. " +
  "<p>The peak is an important metric to track since a stream is only smooth to play over a network if it can " +
  "handle the densest portions, which is why streaming encoders are usually given a ceiling " +
  "(<code>maxrate</code>) as well as a target.</p>";

/**
 * Shown when the container declares a constant rate but the sample sizes disagree. Worth saying
 * rather than quietly ignoring, because the declaration is wrong here for a reason worth knowing.
 */
export function contradictedDeclarationNote(avgBitrate: number, timeline: BitrateTimeline): string {
  return (
    `<b>Note:</b> this file's <code>btrt</code> box gives ${escapeHtml(fmtBits(avgBitrate))} as both the ` +
    `track's average and its maximum rate, which read literally would mean a constant bitrate. The sample ` +
    `sizes say otherwise: the windows below run from ${escapeHtml(fmtBits(timeline.minBitrate))} to ` +
    `${escapeHtml(fmtBits(timeline.peakBitrate))}. Muxers commonly write the computed average into both ` +
    `fields whatever the encoder was doing (ffmpeg does), so that declaration is not evidence of a constant ` +
    `rate on its own, and the sample table is the measurement that settles it.`
  );
}

export const VIDEO_AVERAGE_INFO =
  "<b>Average bitrate</b> of the video track alone: its packets &times; 8 &divide; duration. Lowering this (a " +
  "higher CRF) is what shrinks the file, at the cost of degraded quality.";

export const PEAK_RATIO_INFO =
  "The busiest window's bitrate divided by the track average. The further it is above <b>1&times;</b>, the burstier " +
  "the encode and the more bandwidth headroom a smooth playback requires.";

// --- Inspect · Audio Track ---

export const AUDIO_BITRATE_INFO =
  "Average bitrate of the audio track alone. Speech stays clean at low rates, while music needs more; for " +
  "AAC, roughly 128 kbps stereo is transparent for most listeners.";

// --- Inspect · GOP / Keyframe Structure, and the seeking test under it ---

export const GOP_TEACH =
  `The <b>GOP (Group of Pictures)</b> is the span between keyframes (an IDR frame, which also bars later frames ` +
  `from referencing across it). Shorter GOPs lead to more keyframes, which means faster seeking but ` +
  `worse compression.` +
  `<ul>` +
  `<li><b>I-frames</b> self-contain everything needed to draw the picture within the frame itself.</li>` +
  `<li><b>IDR-frames</b> are a stronger form of an I-frame, which also bars every later frame from referencing ` +
  `anything before it so that a player can start decoding from that point.</li>` +
  `<li><b>P-frames</b> reference earlier frames, storing only what changed since then.</li>` +
  `<li><b>B-frames</b> reference both earlier <i>and later</i> frames, which compresses better but makes ` +
  `decode order ≠ presentation order, complicating random access.</li>` +
  `</ul>` +
  `<p>For behavioral annotations (ethograms, pose estimation, etc.) we encourage the use of a <b>fixed GOP</b> and <b>disabling B-frames</b> entirely ` +
  `to make random-access seeking fast and predictable.</p>`;

/**
 * Under the GOP histogram in the Full Analysis document. The page draws no caption of its own: the
 * bars sit under a heading that already names them, and hovering one reports its own frame count.
 */
export const GOP_HISTOGRAM_CAPTION = "GOP length per keyframe interval";

/** What the seeking test measures, above its controls on the page and in the document. */
export const SEEK_TEST_INTRO =
  "Samples N evenly-spaced timestamps across the video and measures how far back the nearest keyframe is, " +
  "plus how long it takes to decode that frame.";

/**
 * Under the seeking test's scatter in the Full Analysis document. The page draws no caption of its
 * own: the plot's own axes name both quantities, and hovering a point reports its timestamp.
 */
export const SEEK_SCATTER_CAPTION = "Keyframe distance vs. decode time";

// --- Reencode with FFmpeg · the command builder, whose settings Compare Quality sweeps ---

/** What reencoding is, and why the command is the thing this tab produces. Heads the Reencode tab. */
export const REENCODE_INTRO =
  `<b>Reencoding</b> means decoding a video back to raw frames and compressing them again. That is what ` +
  `lets you change quality, resolution, frame rate or keyframe spacing, and it is lossy: each pass throws ` +
  `away detail the previous pass kept, so start from the original whenever you can.` +
  `<p><b>Transcoding</b> is the same operation into a <i>different</i> codec (H.264 to H.265, for instance); the ` +
  `terms are often used interchangeably, but transcoding implies the codec itself changes. Neither is ` +
  `<b>remuxing</b>, which lifts the already-compressed frames into a ` +
  `different container untouched, and so is lossless and nearly instant.</p>` +
  `<p>The command below runs <a href="https://ffmpeg.org/download.html" target="_blank" rel="noopener">` +
  `<b>ffmpeg</b></a> on your own machine, which is the way to do this for real work.</p>`;

/** What the preset actually trades, shown from the ⓘ beside the field in both tabs that offer it. */
export const X264_PRESET_INFO =
  "<b>Preset</b> sets how hard x264 works to compress, not how good the picture looks: that is CRF's job. At " +
  "the same CRF a slower preset reaches the same quality in a smaller file, and takes far longer to do it." +
  "<p>The returns fall off sharply, and the in-browser encoder is single-threaded, so the slowest presets can " +
  "take minutes over a few seconds of video. Hence <code>superfast</code> as the default; run the command " +
  "natively to use the slow end.</p>";

/** Why resolution is its own knob rather than something CRF already covers, from the ⓘ beside the
 * field in both tabs that offer it. */
export const RESOLUTION_INFO =
  "<b>Resolution</b> is the biggest lever on file size, and not one CRF pulls: however hard CRF quantizes, it " +
  "still pays for every block in the frame, and halving each dimension deletes three quarters of them. Below " +
  "some bitrate, half resolution at a moderate CRF beats full resolution at a punishing one." +
  "<p><b>It is not the same kind of loss as CRF.</b> A keypoint stays localizable to sub-pixel precision " +
  "through a brutal CRF; resolution puts a hard floor under that precision, and nothing downstream recovers " +
  "it. Judge it against what the tracking needs, not only by how the A/B window looks.</p>";

/** What the two offered kernels trade, from the ⓘ beside the field that picks between them. */
export const SCALER_INFO =
  "<b>Scaler</b> is the kernel <code>scale</code> resamples with, and it only matters below 100% resolution. " +
  "<code>lanczos</code> is the sharper: it keeps fine detail (whiskers, tail tips, grid lines) a softer " +
  "kernel averages away. <code>bicubic</code> is softer, and less prone to the faint ringing lanczos can " +
  "leave along hard edges." +
  "<p>Sharper is not automatically better downstream, and the detail lanczos keeps costs a few more bits at " +
  "the same CRF. Compare them in the A/B window at 100% zoom rather than assuming.</p>";

// --- The A/B window and the size it projects, under both encoding tabs ---

/** Why the A/B window offers two ways of drawing a downscaled encode back up. */
export const UPSCALE_VIEW_INFO =
  "A downscaled encode is drawn back at the source's size so both panes share one coordinate system. " +
  "<b>Blocks</b> repeats each encoded pixel, so you see exactly what survived the downscale, which is the " +
  "better view for judging what a tracking pipeline has left to work with. <b>Smooth</b> interpolates " +
  "between them, closer to what a player would put up. Neither changes the encode or its size.";

/** Why a segment's size is the comparable number, beside the size the encode came to. */
export const ENCODED_SEGMENT_NOTE =
  "Only the segment above was encoded, so its size is not the whole file's — it is what that stretch of " +
  "video costs at these settings, which is what makes two settings comparable without encoding twice.";

/** Why the Compare Quality tab reports a size at all, and on what terms it projects one. */
export const SIZE_SAVINGS_INTRO =
  "Quality is only ever traded against bytes, so the other half of this comparison is what the settings cost. " +
  "Only a few seconds were encoded, but that is enough to estimate the whole file: the snippet is compared " +
  "against what the <i>same</i> seconds cost in the source, and that ratio is applied to the source's real size.";

/** How the sampled stretch's cost in the source was arrived at, which depends on the file. */
export function sizeEstimateTeach(estimate: SizeEstimate): string {
  const basis =
    estimate.basis === "sample-table"
      ? `The original side of that ratio is measured, not assumed: the container's sample table lists every ` +
        `frame's size, so the bytes this exact stretch costs in the source were summed out of it, plus the ` +
        `stretch's share of the audio track and the container's own overhead.`
      : `The original side of that ratio had to be approximated: no sample table was available for this file, ` +
        `so the source's cost for the stretch is its total size spread evenly across its running time. That is ` +
        `exact only for a constant-bitrate file, and this estimate is the rougher for it.`;
  const difficulty = windowDifficultySentence(estimate);
  const band = estimate.projectedRange
    ? `<p>The range is not a confidence interval in any formal sense: it is how far the file's own ` +
      `equal-length windows sit from one another, narrowed by how much of the file was sampled. A file whose ` +
      `windows all cost about the same is one where any window predicts the rest; a file that swings between ` +
      `still shots and fast motion is one where a single snippet cannot.</p>`
    : "";
  return (
    `${basis} ${difficulty}` +
    band +
    `<p><b>Why it is still only an estimate.</b> A CRF encode spends bits per content, so a stretch this ` +
    `snippet never saw may compress on quite different terms. Ratios also hold better than totals: expect the ` +
    `percentage to survive better than the megabytes. The settings that apply file-wide (the keyframe ` +
    `interval, whether audio is copied or dropped) are already reflected here, since the snippet was encoded ` +
    `with them, but per-file one-offs such as the <code>moov</code> index and faststart are assumed to scale ` +
    `with length. For an exact number, encode the whole file in the <b>Reencode with FFmpeg</b> tab.</p>`
  );
}

/** How representative the sampled stretch is, when the sample table lets that be measured. */
function windowDifficultySentence(estimate: SizeEstimate): string {
  const d = estimate.windowDifficulty;
  if (d == null || !isFinite(d) || d <= 0) return "";
  if (d >= 1.15) {
    return (
      `The stretch picked here is a <b>busy</b> one, costing ${escapeHtml(d.toFixed(1))}&times; the source's ` +
      `average rate. Dividing by the source's cost for those same seconds is what keeps the projection from ` +
      `pricing the entire file at this stretch's rate.`
    );
  }
  if (d <= 0.85) {
    return (
      `The stretch picked here is a <b>calm</b> one, costing ${escapeHtml(d.toFixed(2))}&times; the source's ` +
      `average rate. Dividing by the source's cost for those same seconds is what keeps the projection from ` +
      `pricing the entire file at this stretch's rate.`
    );
  }
  return `The stretch picked here costs about what the source averages, so it is a fair sample to project from.`;
}

// --- Compare Quality · the run, the sweep and the command under its grid ---

/** Why a run would encode the same settings in several places at once. */
export const SEGMENTS_INFO =
  "<b>Segments</b> is how many stretches of the length above a run encodes. Where they land is the sampler's " +
  "to decide, never yours: one lands anywhere in the file, several are drawn one per equal band of it, so the " +
  "projection is not taken over whichever flattering moment was picked by hand." +
  "<p>Each is a real encode, so a run costs that many times as long. The stretches are cut out of the source " +
  "once and reused, which is what makes two runs comparable, and the A/B window plays all of them in turn.</p>";

/** What the sweep remembers between runs, and when a square is encoded again anyway. */
export const MATRIX_CACHE_INFO =
  "A combination this file has already been swept at is read back rather than encoded again, including after " +
  "a reload, so widening a sweep only encodes the new squares." +
  "<p>Only the numbers are kept, never the video: choosing a square still encodes that one combination for " +
  "the A/B window. Untick to measure everything again, for fresh encoding times or a file changed under the " +
  "same name.</p>";

// --- Full Analysis ---

/** What the Full Analysis tab gathers, and what the two buttons under it write. */
export const ANALYSIS_PANEL_INTRO =
  "Everything on the other tabs, gathered into one document: the container and track metadata, the bitrate " +
  "plot, the atom map, the GOP structure, and the <code>ffmpeg</code> command these settings produce — results " +
  "and plots only, with the teaching explainers left out. Runs that have to be started by hand — the seeking " +
  "test, Compare Quality, an in-browser reencode — are added to it once you have run them, so run those " +
  "first if you want them in the document. " +
  "<p>Below is the document itself, not a preview of one: <b>Download HTML</b> writes exactly this, in a " +
  "single self-contained file with no external assets, and <b>Save as PDF</b> hands the same thing to the " +
  "browser's print dialog.</p>";
