// Container knowledge base — maps mediabunny's input format name (what `Input.getFormat().name`
// returns) to a plain-language explainer of what that container is and which codecs it can carry.
// One record per container, as catalogue data; the prose that introduces them all (the
// container-vs-codec distinction) is CONTAINER_PREAMBLE, with the rest of the teaching copy in
// lib/explainers.

export interface ContainerInfo {
  /** mediabunny's format name, used as the display value. */
  name: string;
  fullName: string;
  extensions: string;
  /** Trusted, author-authored explainer markup. */
  description: string;
  /** Video codecs the container commonly carries; empty for audio-only containers. */
  video: string;
  audio: string;
  /** Playback/compatibility note. */
  support: string;
}

export const CONTAINER_KB: Partial<Record<string, ContainerInfo>> = {
  MP4: {
    name: "MP4",
    fullName: "MPEG-4 Part 14, an ISO Base Media File Format (ISOBMFF) layout",
    extensions: ".mp4, .m4v, .m4a",
    description:
      "The default delivery container for the web: a tree of boxes (atoms) where <code>moov</code> holds the " +
      "sample index and <code>mdat</code> holds the frame bytes. See the <b>Atom Map</b> tab for this file's layout.",
    video:
      "H.264/AVC (near universal), plus H.265/HEVC, AV1, VP9 and ProRes, which the format accepts but far " +
      "fewer players handle",
    audio: "AAC (the usual pairing), MP3, AC-3/E-AC-3, plus Opus and FLAC in newer players",
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
    video: "H.264, H.265, ProRes and other intra-only mezzanine codecs, plus uncompressed and animation formats",
    audio: "AAC, uncompressed PCM, and multi-channel layouts used in production",
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
    video: "essentially anything: H.264, H.265, AV1, VP9, VP8, ProRes, FFV1 and more",
    audio: "AAC, Opus, Vorbis, FLAC, MP3, AC-3, PCM and others",
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
    video: "VP8, VP9 and AV1 only",
    audio: "Vorbis and Opus only",
    support: "Plays in Chrome, Firefox and Edge; Safari support depends on the codec and the device.",
  },
  MP3: {
    name: "MP3",
    fullName: "MPEG-1/2 Audio Layer III elementary stream",
    extensions: ".mp3",
    description:
      "Barely a container at all: a bare sequence of audio frames, with tags bolted on at the front or back as " +
      "ID3 blocks. There is no index, so players estimate seek positions from the bitrate.",
    video: "none, this is an audio-only format",
    audio: "MP3 only",
    support: "Universal.",
  },
  WAVE: {
    name: "WAVE",
    fullName: "Waveform Audio File Format, a RIFF layout",
    extensions: ".wav",
    description:
      "A simple RIFF chunk list, almost always holding uncompressed samples. Metadata lives in an optional " +
      "<code>INFO</code> chunk.",
    video: "none, this is an audio-only format",
    audio: "uncompressed PCM in the common case; a few compressed payloads are accepted but rare",
    support: "Universal, at the cost of very large files.",
  },
  Ogg: {
    name: "Ogg",
    fullName: "Ogg bitstream container",
    extensions: ".ogg, .oga, .ogv",
    description:
      "An open container built around interleaved pages, with tags stored as Vorbis-style comments in each " +
      "stream's header rather than in one global block.",
    video: "Theora, and VP8 in some encoders",
    audio: "Vorbis, Opus and FLAC",
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

export function describeContainer(formatName: string | null | undefined): ContainerInfo | null {
  if (!formatName) return null;
  return CONTAINER_KB[formatName] ?? null;
}
