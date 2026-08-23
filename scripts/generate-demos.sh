#!/usr/bin/env bash
#
# Generate the demo set: a family of short videos derived from one
# source recording, each varying exactly one thing the app surfaces —
# container and atom layout (faststart, fragmentation), codec and profile,
# GOP/keyframe structure, B-frames, bitrate behaviour, track properties
# (rotation, VFR, resolution, audio) and metadata tags. The non-MP4 containers
# and exotic profiles double as interoperability test files.
#
# Every file (except the deliberately stripped one) carries its own explanation
# in its `title`/`comment` metadata tags, so loading it in encoding-helper
# shows what to look at, in the app's Metadata Tags section.
#
# The output is a BEP047 dataset (bids-standard/bids-specification#2231, the
# convention clip-extractor writes): one subject, each variant its own session,
# media under the beh/ datatype directory with the `_video` suffix —
#   dataset_description.json
#   sub-01/ses-<label>/beh/sub-01_ses-<label>_video.<ext>
#   sub-01/ses-<label>/beh/sub-01_ses-<label>_video.json
#   sourcedata/rawbids/sub-01/beh/sub-01_video.m4v
# The source recording travels with the demos under sourcedata/rawbids/, the
# way clip-extractor keeps the raw original its output was derived from; that
# archived copy is also where this script fetches the recording from when
# there is no local one, so the repository carries no video blob.
# Each video's sidecar carries BEP047's technical keys as ffprobe extracts
# them (duration, frame rate/count, dimensions, pixel format, bit depth,
# codec, RFC 6381 codec string where one can be determined) and the
# Description of what the file demonstrates. The per-session demo detail — the
# group, whether the app can currently load it (mp4box.js parses MP4/MOV
# only), and the ffmpeg arguments that made it — lives in
# dataset_description.json, namespaced under an "encoding-helper" key.
#
# Usage: scripts/generate-demos.sh [-s source-video] [-o output-dir]
#   -s  source video (default: scripts/data/Video_S1.m4v, fetched from the
#       archive when absent)
#   -o  output directory (default: demo-out)

set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
DEFAULT_SRC="$SCRIPT_DIR/data/Video_S1.m4v"
SRC="$DEFAULT_SRC"
OUT="demo-out"

# Where the source recording lives on the archive: this dataset's own
# sourcedata/rawbids/ copy (clip-extractor's convention for the raw original a
# derived tree came from), which upload-demos.sh publishes alongside the
# demos. The recording is deliberately not in this repository — a video blob
# would sit in the git history forever — so a missing local copy is fetched
# from here.
EMBER_API="https://api-dandi.emberarchive.org/api"
EMBER_DANDISET="000527"
SOURCEDATA_PATH="sourcedata/rawbids/sub-01/beh/sub-01_video.m4v"

while getopts "s:o:h" opt; do
  case $opt in
    s) SRC=$OPTARG ;;
    o) OUT=$OPTARG ;;
    h)
      sed -n '2,35p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) exit 2 ;;
  esac
done

command -v ffmpeg >/dev/null 2>&1 || {
  echo "error: ffmpeg is required" >&2
  exit 1
}
command -v ffprobe >/dev/null 2>&1 || {
  echo "error: ffprobe is required" >&2
  exit 1
}

# Only the default source is fetched on absence; a path given with -s that
# does not exist is a mistake worth stopping on.
if [ ! -f "$SRC" ] && [ "$SRC" = "$DEFAULT_SRC" ]; then
  echo "==> Fetching the source recording from EMBER dandiset $EMBER_DANDISET"
  command -v curl >/dev/null 2>&1 && command -v python3 >/dev/null 2>&1 || {
    echo "error: curl and python3 are required to fetch the source recording" >&2
    exit 1
  }
  auth=()
  if [ -n "${EMBER_DANDI_API_KEY:-}" ]; then auth=(-H "Authorization: token $EMBER_DANDI_API_KEY"); fi
  # The listing and the download are separate failures worth telling apart: an
  # unreachable archive is not the same as a dandiset that has no such asset.
  listing=$(curl -fsSL "${auth[@]}" \
    "$EMBER_API/dandisets/$EMBER_DANDISET/versions/draft/assets/?path=$SOURCEDATA_PATH&metadata=false") || {
    echo "error: could not reach the archive at $EMBER_API" >&2
    exit 1
  }
  asset_id=$(printf '%s' "$listing" |
    python3 -c 'import json, sys; r = json.load(sys.stdin).get("results") or []; print(r[0]["asset_id"] if r else "")')
  [ -n "$asset_id" ] || {
    echo "error: no source recording on dandiset $EMBER_DANDISET at $SOURCEDATA_PATH" >&2
    exit 1
  }
  mkdir -p "$(dirname "$SRC")"
  curl -fsSL "${auth[@]}" -o "$SRC" \
    "$EMBER_API/dandisets/$EMBER_DANDISET/versions/draft/assets/$asset_id/download/" || {
    rm -f "$SRC"
    echo "error: could not download the source recording (asset $asset_id)" >&2
    exit 1
  }
fi
[ -f "$SRC" ] || {
  echo "error: source video not found: $SRC" >&2
  exit 1
}
mkdir -p "$OUT"

# The raw original the demos are derived from, in the place BIDS keeps such a
# thing. Its own dataset_description.json makes the subtree independently
# valid, as clip-extractor's rawbids copy is.
SOURCEDATA_DIR="$OUT/$(dirname "$SOURCEDATA_PATH")"
SOURCEDATA_ROOT="$OUT/${SOURCEDATA_PATH%%/sub-01/*}"
mkdir -p "$SOURCEDATA_DIR"
cp "$SRC" "$OUT/$SOURCEDATA_PATH"
{
  printf '{\n'
  printf '  "Name": "encoding-helper demos (Original)",\n'
  printf '  "BIDSVersion": "1.10.0",\n'
  printf '  "DatasetType": "raw",\n'
  printf '  "License": "CC-BY-4.0",\n'
  printf '  "Description": "The unmodified source recording every demo is derived from."\n'
  printf '}\n'
} >"$SOURCEDATA_ROOT/dataset_description.json"

# Shared argument fragments. Deliberately unquoted at the call sites so they
# expand into separate words; none of them contain spaces.
X264="-c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p"
FS="-movflags +faststart"
STRIP="-map_metadata -1" # do not inherit the source's own tags

DEMO_COUNT=0
SESSION_ENTRIES=()

json_escape() {
  local s=${1//\\/\\\\}
  s=${s//\"/\\\"}
  printf '%s' "$s"
}

# The path a session's video lands at, so the rotation demo can remux the
# reference file after it exists.
session_video() {
  printf '%s/sub-01/ses-%s/beh/sub-01_ses-%s_video.%s' "$OUT" "$1" "$1" "$2"
}

# The RFC 6381 codec parameter string for a video, or empty when it cannot be
# determined. ffmpeg's DASH muxer computes proper strings for the H.264
# family, AV1 and VP9; a bare four-character code (what it gives HEVC and VP8)
# says nothing VideoCodec does not, so HEVC's is built the standard way from
# its level instead and the rest are omitted rather than guessed.
rfc6381() {
  local video=$1 codec=$2 level=$3 tmp out=""
  tmp=$(mktemp -d)
  if ffmpeg -v error -y -i "$video" -map 0:v:0 -c copy -t 1 -f dash -single_file 1 "$tmp/out.mpd" 2>/dev/null; then
    out=$(sed -n 's/.*codecs="\([^"]*\)".*/\1/p' "$tmp/out.mpd" | head -1)
  fi
  rm -rf "$tmp"
  case $out in
    *.*) printf '%s' "$out" ;;
    *) if [ "$codec" = hevc ] && [ "${level:-0}" -gt 0 ]; then printf 'hvc1.1.6.L%s.B0' "$level"; fi ;;
  esac
}

# Writes the BEP047 JSON sidecar next to one finished video: the technical
# keys as ffprobe reads them back out of the file, and the Description of what
# the demo shows.
write_sidecar() {
  local video=$1 desc=$2
  local codec width height pixfmt level rate frames duration depth codecstring
  IFS=, read -r codec width height pixfmt level rate frames < <(
    ffprobe -v error -select_streams v:0 -count_packets \
      -show_entries stream=codec_name,width,height,pix_fmt,level,avg_frame_rate,nb_read_packets \
      -of csv=p=0 "$video"
  )
  duration=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$video")
  rate=$(awk -F/ '{ if ($2 > 0) printf "%.3f", $1 / $2; else printf "%s", $1 }' <<<"$rate")
  # Bits per channel, read off the pixel format name (yuv420p10le and friends
  # name it; the unadorned formats are 8-bit).
  case $pixfmt in
    *16*) depth=16 ;;
    *12*) depth=12 ;;
    *10*) depth=10 ;;
    *) depth=8 ;;
  esac
  codecstring=$(rfc6381 "$video" "$codec" "$level")
  {
    printf '{\n'
    printf '  "Description": "%s",\n' "$(json_escape "$desc")"
    printf '  "RecordingDuration": %s,\n' "$duration"
    printf '  "VideoFrameRate": %s,\n' "$rate"
    printf '  "VideoFrameCount": %s,\n' "$frames"
    printf '  "ImageWidth": %s,\n' "$width"
    printf '  "ImageHeight": %s,\n' "$height"
    printf '  "ImagePixelFormat": "%s",\n' "$(json_escape "$pixfmt")"
    printf '  "ImageBitDepth": %s,\n' "$depth"
    if [ -n "$codecstring" ]; then
      printf '  "VideoCodec": "%s",\n' "$(json_escape "$codec")"
      printf '  "VideoCodecRFC6381": "%s"\n' "$(json_escape "$codecstring")"
    else
      printf '  "VideoCodec": "%s"\n' "$(json_escape "$codec")"
    fi
    printf '}\n'
  } >"${video%.*}.json"
}

# demo <group> <loads-in-app: yes|no> <session-label> <extension> <title> <description> -- <ffmpeg args...>
#
# Runs ffmpeg with the given args (everything between `ffmpeg` and the output
# path, so input options like -t belong before their -i), writing
# sub-01/ses-<label>/beh/sub-01_ses-<label>_video.<ext>, stamps the title and
# description into the file's metadata tags (unless NO_META=1, for the
# stripped-metadata demo), writes the file's sidecar beside it, and records
# the session for dataset_description.json's index. Labels are BIDS entity
# values: alphanumeric only.
demo() {
  local group=$1 loads=$2 label=$3 ext=$4 title=$5 desc=$6
  shift 6
  if [ "${1:-}" = "--" ]; then shift; fi
  local video
  video=$(session_video "$label" "$ext")
  echo "==> ${video#"$OUT"/}"
  mkdir -p "$(dirname "$video")"
  local meta=(-metadata "title=$title" -metadata "comment=$desc")
  if [ "${NO_META:-0}" = 1 ]; then meta=(); fi
  ffmpeg -hide_banner -loglevel error -y "$@" "${meta[@]}" "$video"
  write_sidecar "$video" "$desc"
  # Recorded args name files relative to the dataset, not this machine's paths.
  local args=$*
  args=${args//"$SRC"/"$(basename "$SRC")"}
  args=${args//"$OUT"\//}
  SESSION_ENTRIES+=("$(printf '"%s": {"title": "%s", "group": "%s", "loads_in_app": %s, "ffmpeg_args": "%s"}' \
    "$(json_escape "$label")" "$(json_escape "$title")" "$(json_escape "$group")" \
    "$([ "$loads" = yes ] && echo true || echo false)" "$(json_escape "$args")")")
  DEMO_COUNT=$((DEMO_COUNT + 1))
}

# --- Reference ---------------------------------------------------------------
# The baseline every other file varies one thing from.

demo reference yes reference mp4 \
  "Reference: H.264 High in MP4, faststart" \
  "The baseline of the demo set: H.264 High profile, CRF 23, 3-second GOP, AAC audio, moov before mdat. Every other demo file changes one thing from this." \
  -- -i "$SRC" $STRIP $X264 -g 90 -c:a aac -b:a 96k $FS

# --- Atom layout -------------------------------------------------------------

demo layout yes nofaststart mp4 \
  "Not faststart: moov after mdat" \
  "Identical encode to the reference, but without +faststart the moov atom lands after mdat, so streaming playback cannot start until the whole file arrives. Compare the atom map and the faststart badge." \
  -- -i "$SRC" $STRIP $X264 -g 90 -c:a aac -b:a 96k

demo layout yes fragmented mp4 \
  "Fragmented MP4: moof/mdat pairs" \
  "The same stream written as a fragmented MP4: an empty moov up front, then a moof/mdat pair per keyframe. The atom map shows many small fragments instead of one big mdat." \
  -- -i "$SRC" $STRIP $X264 -g 90 -c:a aac -b:a 96k -movflags frag_keyframe+empty_moov

# --- Containers --------------------------------------------------------------
# Same H.264 stream in different boxes; the non-ISO ones double as
# interoperability tests (mp4box.js parses MP4/MOV only).

demo container yes quicktime mov \
  "QuickTime container (.mov)" \
  "The reference encode muxed into a QuickTime .mov: the same atom grammar MP4 inherited, with QuickTime-flavoured metadata atoms. Compare the container card and atom map against the MP4 reference." \
  -- -i "$SRC" $STRIP $X264 -g 90 -c:a aac -b:a 96k $FS

demo container no matroska mkv \
  "Matroska container (.mkv)" \
  "The reference H.264 stream in Matroska: EBML elements instead of MP4 atoms, so there is no moov/mdat and no faststart question. Currently fails the MP4 parse step, exercising the error path." \
  -- -i "$SRC" $STRIP $X264 -g 90 -c:a aac -b:a 96k

demo container no webmvp9 webm \
  "WebM container: VP9 + Opus" \
  "The web-native pairing: VP9 video and Opus audio in WebM (a Matroska subset). A codec/container combination MP4 tooling cannot open, for interoperability testing." \
  -- -i "$SRC" $STRIP -c:v libvpx-vp9 -crf 34 -b:v 0 -row-mt 1 -cpu-used 4 -pix_fmt yuv420p -c:a libopus -b:a 96k

demo container no avimpeg4 avi \
  "Legacy AVI: MPEG-4 Part 2 + MP3" \
  "A 1990s-era combination still common in lab archives: MPEG-4 Part 2 (DivX/Xvid family) video with MP3 audio in AVI. No atoms, no faststart, index at the end." \
  -- -i "$SRC" $STRIP -c:v mpeg4 -q:v 5 -pix_fmt yuv420p -c:a libmp3lame -b:a 128k

# --- Codecs and profiles -----------------------------------------------------

demo codec yes h264baseline mp4 \
  "H.264 Constrained Baseline profile" \
  "The compatibility-first H.264 profile: no B-frames, CAVLC entropy coding. Larger than the High-profile reference at the same quality; compare the profile in the Video Track card and the frame types in the GOP view." \
  -- -i "$SRC" $STRIP -c:v libx264 -preset veryfast -crf 23 -profile:v baseline -pix_fmt yuv420p -g 90 -c:a aac -b:a 96k $FS

demo codec yes h264high10 mp4 \
  "H.264 High 10: 10-bit 4:2:0" \
  "Ten bits per sample instead of eight (yuv420p10le, High 10 profile). Many hardware decoders and browsers refuse it, which is exactly what makes it an interoperability test." \
  -- -i "$SRC" $STRIP -c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p10le -g 90 -c:a aac -b:a 96k $FS

demo codec yes h264high444 mp4 \
  "H.264 High 4:4:4: no chroma subsampling" \
  "Full-resolution colour (yuv444p, High 4:4:4 Predictive profile) instead of the usual 4:2:0. Compare the chroma subsampling explainer; expect most browsers to fail to decode it." \
  -- -i "$SRC" $STRIP -c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv444p -g 90 -c:a aac -b:a 96k $FS

demo codec yes hevc mp4 \
  "H.265/HEVC in MP4" \
  "The successor codec at similar quality in fewer bits, tagged hvc1 for Apple compatibility. Decode support varies by browser and platform: Safari yes, others it depends." \
  -- -i "$SRC" $STRIP -c:v libx265 -preset fast -crf 26 -pix_fmt yuv420p -tag:v hvc1 -c:a aac -b:a 96k $FS

demo codec yes av1 mp4 \
  "AV1 in MP4" \
  "The royalty-free state of the art (SVT-AV1). Same MP4 atoms around a very different bitstream; modern browsers decode it, older hardware does not." \
  -- -i "$SRC" $STRIP -c:v libsvtav1 -preset 8 -crf 35 -pix_fmt yuv420p -c:a aac -b:a 96k $FS

demo codec no vp8 webm \
  "VP8 in WebM" \
  "The first-generation web codec, universally decodable but least efficient of the modern set. Pairs with the VP9 file to show a codec generation gap inside the same container." \
  -- -i "$SRC" $STRIP -c:v libvpx -crf 12 -b:v 1M -cpu-used 4 -pix_fmt yuv420p -c:a libopus -b:a 96k

demo codec yes mjpeg mov \
  "Motion JPEG: every frame independent" \
  "Each frame is its own JPEG, so seeking is instant everywhere and file size is enormous. The scientific-camera default that GOP compression exists to replace; with PCM audio, as cameras write it." \
  -- -i "$SRC" $STRIP -c:v mjpeg -q:v 6 -pix_fmt yuvj420p -c:a pcm_s16le

demo codec no ffv1lossless mkv \
  "FFV1: mathematically lossless (first 10 s)" \
  "The archival codec: every pixel preserved exactly, at a file size that shows why lossless is not the default. Trimmed to ten seconds to keep the demo set small." \
  -- -t 10 -i "$SRC" $STRIP -c:v ffv1 -level 3 -c:a flac

# --- GOP / keyframe structure ------------------------------------------------
# Scenecut detection is disabled so the keyframe cadence is exactly the number
# in the filename; audio is dropped so the video structure is all there is.

demo gop yes gopshort mp4 \
  "Short GOP: keyframe every half second" \
  "A keyframe every 15 frames. Seeking lands close to everywhere (see the seeking test scatter), paid for in file size. Compare against the 300-frame GOP file." \
  -- -i "$SRC" $STRIP -c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p -x264-params keyint=15:min-keyint=15:scenecut=0 -an $FS

demo gop yes goplong mp4 \
  "Long GOP: keyframe every ten seconds" \
  "A keyframe only every 300 frames. Small file, but seeking must decode up to ten seconds of frames to reach a target; the seeking test makes the cost measurable." \
  -- -i "$SRC" $STRIP -c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p -x264-params keyint=300:min-keyint=300:scenecut=0 -an $FS

demo gop yes allintra mp4 \
  "All-intra: every frame a keyframe" \
  "GOP of one: every frame is an I-frame, like MJPEG but in H.264 syntax. Perfect seeking, maximum size; the far end of the keyframe-interval axis." \
  -- -i "$SRC" $STRIP -c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p -g 1 -an $FS

demo gop yes nobframes mp4 \
  "No B-frames: I and P only" \
  "B-frames disabled (-bf 0): decode order equals presentation order and every frame references only the past. Compare the frame-type pattern against the reference and the 8-B-frame file." \
  -- -i "$SRC" $STRIP -c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p -g 90 -bf 0 -an $FS

demo gop yes bframes8 mp4 \
  "Eight consecutive B-frames" \
  "Runs of eight B-frames between anchors (-bf 8, adaptive placement off), the compression-over-latency extreme. The GOP view shows long B runs; decode order diverges far from presentation order." \
  -- -i "$SRC" $STRIP -c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p -g 90 -bf 8 -x264-params b-adapt=0 -an $FS

# --- Bitrate behaviour -------------------------------------------------------

demo bitrate yes cbr800k mp4 \
  "Constant bitrate: 800 kb/s CBR" \
  "True CBR with HRD signalling: the encoder spends 800 kb/s whether the scene needs it or not. The bitrate-over-time plot flattens; compare its declared rate against the CRF-driven reference." \
  -- -i "$SRC" $STRIP -c:v libx264 -preset veryfast -b:v 800k -minrate 800k -maxrate 800k -bufsize 1600k -x264-params nal-hrd=cbr:force-cfr=1 -pix_fmt yuv420p -g 90 -c:a aac -b:a 96k $FS

demo bitrate yes starved150k mp4 \
  "Starved bitrate: 150 kb/s cap" \
  "A hard 150 kb/s cap far below what the content needs: blocking and smearing wherever there is motion. Load it in the A/B window against the reference to see what a bitrate ceiling costs." \
  -- -i "$SRC" $STRIP -c:v libx264 -preset veryfast -b:v 150k -maxrate 150k -bufsize 300k -pix_fmt yuv420p -g 90 -c:a aac -b:a 96k $FS

# --- Track properties --------------------------------------------------------

# Rotation is a remux of the reference, not a re-encode: -display_rotation
# rewrites the display matrix and the bitstream is untouched, which is itself
# the point — rotation lives in the container, not the codec.
demo track yes rotated90 mp4 \
  "Rotated 90 degrees in the display matrix" \
  "Byte-identical video bitstream to the reference, remuxed with a 90-degree display matrix. Players rotate at display time; the Video Track card shows the rotation the pixels do not have." \
  -- -display_rotation 90 -i "$(session_video reference mp4)" -c copy

demo track yes videoonly mp4 \
  "Video only: no audio track" \
  "The reference without its audio track. The Audio Track card disappears entirely; the overall bitrate is video alone." \
  -- -i "$SRC" $STRIP $X264 -g 90 -an $FS

demo track yes vfr mp4 \
  "Variable frame rate" \
  "Frames dropped irregularly and timestamps kept (variable frame rate), the way phone cameras and screen recorders write video. Frame-rate figures become averages, not a clock." \
  -- -i "$SRC" $STRIP -vf "select='gt(random(1)\,0.3)'" -fps_mode vfr -c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p -an $FS

demo track yes halfres mp4 \
  "Half resolution" \
  "The reference downscaled to half its width and height, a quarter of the pixels. Resolution is the largest file-size lever there is, and the one CRF cannot pull." \
  -- -i "$SRC" $STRIP -vf "scale=trunc(iw/4)*2:-2" $X264 -g 90 -c:a aac -b:a 96k $FS

# --- Metadata tags -----------------------------------------------------------

demo metadata yes richtags mp4 \
  "Rich metadata tags" \
  "The reference carrying a full set of container tags. Every one of them shows up in the Metadata Tags section with its own explainer popover." \
  -- -i "$SRC" $STRIP $X264 -g 90 -c:a aac -b:a 96k $FS \
  -metadata artist="Encoding Helper demo set" \
  -metadata album="encoding-helper demos" \
  -metadata date="2026" \
  -metadata genre="Documentation" \
  -metadata copyright="MIT" \
  -metadata description="A file whose only job is to carry metadata tags." \
  -metadata synopsis="Container-level tags ride in the moov/udta atoms, separate from the streams."

NO_META=1 demo metadata yes notags mp4 \
  "No metadata tags at all" \
  "The same encode with every tag stripped and the muxer's own fingerprints suppressed. The Metadata Tags section has nothing to show; compare against the rich-metadata file." \
  -- -i "$SRC" $STRIP -fflags +bitexact $X264 -g 90 -c:a aac -b:a 96k $FS

# --- dataset_description.json ------------------------------------------------
# The BIDS dataset root file, in the shape clip-extractor writes its own:
# BIDSVersion 1.10.0, a GeneratedBy entry naming this tool, version and run
# date, and SourceDatasets naming the publication the source video is
# supplementary material of (whose CC-BY license the dataset inherits). The
# per-session demo detail sits under an "encoding-helper" key, so one fetch of
# this file indexes the whole set.

VERSION=$(sed -n 's/.*"version": "\([^"]*\)".*/\1/p' "$SCRIPT_DIR/../package.json" | head -1)
{
  printf '{\n'
  printf '  "Name": "encoding-helper demos",\n'
  printf '  "BIDSVersion": "1.10.0",\n'
  printf '  "DatasetType": "raw",\n'
  printf '  "License": "CC-BY-4.0",\n'
  printf '  "Description": "Demo videos for encoding-helper, one session per variant, each varying one aspect of encoding or container structure from the original video.",\n'
  printf '  "SourceDatasets": [\n'
  printf '    {\n'
  printf '      "Name": "Multi-Modal Courtship in the Peacock Spider, Maratus volans (O.P.-Cambridge, 1874)",\n'
  printf '      "Description": "PLOS ONE 6(9): e25390, 2011. The source recording is the article'\''s Supporting Information Video S1.",\n'
  printf '      "Authors": ["Madeline B. Girard", "Michael M. Kasumovic", "Damian O. Elias"],\n'
  printf '      "DOI": "doi:10.1371/journal.pone.0025390",\n'
  printf '      "URL": "https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0025390",\n'
  printf '      "License": "CC-BY"\n'
  printf '    }\n'
  printf '  ],\n'
  printf '  "GeneratedBy": [\n'
  printf '    {\n'
  printf '      "Name": "encoding-helper",\n'
  printf '      "Version": "%s",\n' "$(json_escape "${VERSION:-unknown}")"
  printf '      "Description": "scripts/generate-demos.sh on %s, using %s",\n' "$(date -u +%Y-%m-%d)" "$(json_escape "$(ffmpeg -version | head -1 | cut -d' ' -f1-3)")"
  printf '      "CodeURL": "https://github.com/brain-bbqs/encoding-helper"\n'
  printf '    }\n'
  printf '  ],\n'
  printf '  "encoding-helper": {\n'
  printf '    "source": "%s",\n' "$(json_escape "$(basename "$SRC")")"
  printf '    "sessions": {\n'
  for i in "${!SESSION_ENTRIES[@]}"; do
    sep=,
    if [ "$i" = "$((${#SESSION_ENTRIES[@]} - 1))" ]; then sep=; fi
    printf '      %s%s\n' "${SESSION_ENTRIES[$i]}" "$sep"
  done
  printf '    }\n'
  printf '  }\n'
  printf '}\n'
} >"$OUT/dataset_description.json"

echo
echo "Wrote $DEMO_COUNT demo sessions (video + sidecar each) and dataset_description.json to $OUT/:"
find "$OUT/sub-01" -name '*_video.*' ! -name '*_video.json' | sort | while read -r f; do
  printf '  %8.1f MB  %s\n' "$(awk -v b="$(wc -c <"$f")" 'BEGIN{printf "%.1f", b/1048576}')" "${f#"$OUT"/}"
done
