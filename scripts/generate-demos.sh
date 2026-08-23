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
# Files are laid out BEP047-style, the way clip-extractor names its output:
# one subject, a BIDS entity per variant, the `_video` suffix —
#   sub-01/video/sub-01_desc-<label>_video.<ext>
# Alongside them, sub-01/video/manifest.json describes each file: path, group,
# what it demonstrates, whether encoding-helper can currently load it
# (mp4box.js parses MP4/MOV only), and the ffmpeg arguments that made it.
#
# Usage: scripts/generate-demos.sh [-s source-video] [-o output-dir]
#   -s  source video (default: scripts/data/Video_S1.m4v)
#   -o  output directory (default: demo-out)

set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
SRC="$SCRIPT_DIR/data/Video_S1.m4v"
OUT="demo-out"

while getopts "s:o:h" opt; do
  case $opt in
    s) SRC=$OPTARG ;;
    o) OUT=$OPTARG ;;
    h)
      sed -n '2,24p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) exit 2 ;;
  esac
done

command -v ffmpeg >/dev/null 2>&1 || {
  echo "error: ffmpeg is required" >&2
  exit 1
}
[ -f "$SRC" ] || {
  echo "error: source video not found: $SRC" >&2
  exit 1
}
# The BEP047-style home of every file this script writes; $OUT is only its root.
VIDEODIR="$OUT/sub-01/video"
mkdir -p "$VIDEODIR"

# Shared argument fragments. Deliberately unquoted at the call sites so they
# expand into separate words; none of them contain spaces.
X264="-c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p"
FS="-movflags +faststart"
STRIP="-map_metadata -1" # do not inherit the source's own tags

MANIFEST_ENTRIES=()

json_escape() {
  local s=${1//\\/\\\\}
  s=${s//\"/\\\"}
  printf '%s' "$s"
}

# demo <group> <loads-in-app: yes|no> <desc-label> <extension> <title> <description> -- <ffmpeg args...>
#
# Runs ffmpeg with the given args (everything between `ffmpeg` and the output
# path, so input options like -t belong before their -i), writing
# sub-01/video/sub-01_desc-<label>_video.<ext>, stamps the title and
# description into the file's metadata tags (unless NO_META=1, for the
# stripped-metadata demo), and records a manifest entry. Labels are BIDS
# entity values: alphanumeric only.
demo() {
  local group=$1 loads=$2 label=$3 ext=$4 title=$5 desc=$6
  shift 6
  if [ "${1:-}" = "--" ]; then shift; fi
  local file="sub-01_desc-${label}_video.$ext"
  echo "==> $file"
  local meta=(-metadata "title=$title" -metadata "comment=$desc")
  if [ "${NO_META:-0}" = 1 ]; then meta=(); fi
  ffmpeg -hide_banner -loglevel error -y "$@" "${meta[@]}" "$VIDEODIR/$file"
  local bytes
  bytes=$(wc -c <"$VIDEODIR/$file")
  MANIFEST_ENTRIES+=("$(printf '{"file": "sub-01/video/%s", "group": "%s", "title": "%s", "shows": "%s", "loads_in_app": %s, "bytes": %s, "ffmpeg_args": "%s"}' \
    "$(json_escape "$file")" "$(json_escape "$group")" "$(json_escape "$title")" \
    "$(json_escape "$desc")" "$([ "$loads" = yes ] && echo true || echo false)" \
    "$bytes" "$(json_escape "$*")")")
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
  -- -display_rotation 90 -i "$VIDEODIR/sub-01_desc-reference_video.mp4" -c copy

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

# --- Manifest ----------------------------------------------------------------

{
  printf '{\n'
  printf '  "description": "Demo videos for encoding-helper, each varying one aspect from the reference file. loads_in_app reflects that the app currently parses MP4/MOV only.",\n'
  printf '  "source": "%s",\n' "$(json_escape "$(basename "$SRC")")"
  printf '  "ffmpeg": "%s",\n' "$(json_escape "$(ffmpeg -version | head -1)")"
  printf '  "files": [\n'
  for i in "${!MANIFEST_ENTRIES[@]}"; do
    sep=,
    if [ "$i" = "$((${#MANIFEST_ENTRIES[@]} - 1))" ]; then sep=; fi
    printf '    %s%s\n' "${MANIFEST_ENTRIES[$i]}" "$sep"
  done
  printf '  ]\n'
  printf '}\n'
} >"$VIDEODIR/manifest.json"

echo
echo "Wrote $((${#MANIFEST_ENTRIES[@]})) demo files and manifest.json to $VIDEODIR/:"
ls -l "$VIDEODIR" | tail -n +2 | awk '{printf "  %8.1f MB  %s\n", $5/1048576, $NF}'
