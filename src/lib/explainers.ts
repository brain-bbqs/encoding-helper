// Author-authored explainer copy: every word of teaching material the app shows, in one file.
//
// Nothing here is written by a tab. A renderer that wants to teach something imports the copy from
// here, so the whole of what the app says can be read, edited and kept consistent in one place
// rather than being hunted for across the tab that happens to show it — and the page and the
// exported document can never explain the same number two different ways, since they read the same
// string. What stays with its renderer is the text that is not teaching: button labels, status and
// error lines, and the per-codec, per-container and per-tag records in the knowledge bases, which
// are catalogue data rather than prose.
//
// Every string here is trusted markup rendered through innerHTML (teachBox, info popovers, the
// document's prose blocks), so nothing read out of a media file may be interpolated into one
// without going through escapeHtml first — the two builders below that take file-derived numbers
// do exactly that.

import type { BitrateTimeline } from "./bitrateTimeline";
import type { ContainerInfo } from "./containerKb";
import { escapeHtml } from "./dom";
import { fmtBits } from "./format";
import type { SizeEstimate } from "./sizeEstimate";
import type { CodecInfo } from "./types";

// --- Inspect: the container, the tracks and their bitrates ---

/** The container-vs-codec distinction, shown above every container explainer. */
export const CONTAINER_PREAMBLE =
  "A <b>video container</b> is the wrapper around the media, not the compression method itself. It stores the " +
  "encoded tracks, the index that maps timestamps to byte ranges, and the metadata tags. The <b>codec</b> is what " +
  "actually compresses the pixels and samples. The same H.264 video can sit in an MP4, a MOV (.mov), or a " +
  "Matroska (.mkv) file unchanged: moving it from one to another copies the already-compressed frames across " +
  "byte for byte, without decoding or compressing anything again, so it takes seconds and the picture that " +
  "comes out is the picture that went in. Containers differ in which codecs they accept, though, so not every " +
  "codec fits in every container.";

/** The Overview's whole-file bitrate, which is not the same as any one track's bitrate. */
export const OVERALL_BITRATE_INFO =
  "<b>Bitrate</b> is how many bits it takes to store one second of playback, so it is the main lever on both " +
  "size and quality. This one is <b>overall</b>: file size &times; 8 &divide; duration, counting video, audio " +
  "and the container's own overhead together, so it comes out above the per-track figures below. " +
  "<p>It is also an average, and the <b>Video Bitrate Over Time</b> card plots how far the rate moves around " +
  "it.</p>";

export const FASTSTART_EXPLAINER =
  "<b>Faststart</b> means the <code>moov</code> atom (the index describing every sample) sits before " +
  "<code>mdat</code> (the actual frame bytes). A browser or CDN can then start playback after downloading " +
  "just the first few KB, instead of the whole file. See the <b>Atom Map</b> for the byte-level layout.";

export const VIDEO_AVERAGE_INFO =
  "Average bitrate of the video track alone: its packets &times; 8 &divide; duration. The Overview's " +
  "<b>Overall Bitrate</b> is higher because it also counts audio and container overhead. Lowering this (a " +
  "higher CRF) is what shrinks the file, at the cost of visible artifacts.";

export const TOO_FEW_FRAMES_NOTE =
  "There are too few frames here to divide the track into windows of playback, so there is no shape to " +
  "plot. The average is the whole of what the sample table can say about this file's rate.";

export const BITRATE_TIMELINE_TEACH =
  "This is the video track's bitrate measured one window at a time instead of once across the whole track: " +
  "the bits of every frame presented in that window, divided by the window's length. No decoding is " +
  "involved, since the size and timestamp of every frame is already listed in the container's sample table. " +
  "<p>A <b>variable bitrate</b> encoder (which is what a CRF encode is, and what x264 does by default) " +
  "targets a constant <i>quality</i> and lets the rate go wherever that costs. It spends bits on keyframes, " +
  "scene cuts and fast motion and saves them on still shots, so the line moves even though the average is a " +
  "single number. A run well above the average is the part of the video that is expensive to store; a flat " +
  "line means the rate was held constant instead.</p>" +
  "<p>The peak matters separately from the average: a stream is only smooth to play over a network that can " +
  "carry its <i>peaks</i>, not its mean, which is why streaming encoders are usually given a ceiling " +
  "(<code>-maxrate</code>) as well as a target.</p>";

export const PEAK_RATIO_INFO =
  "The busiest window's bitrate divided by the track average. The further above <b>1&times;</b>, the burstier " +
  "the encode, and the more bandwidth headroom smooth playback needs beyond the average.";

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

export const AUDIO_BITRATE_INFO =
  "Average bitrate of the audio track alone. Speech stays clean at low rates, while music needs more; for " +
  "AAC, roughly 128 kbps stereo is transparent for most listeners.";

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

export function chromaSubsamplingExplainer(width: number, height: number): string {
  const evenW = width % 2 === 0;
  const evenH = height % 2 === 0;
  const fitText =
    evenW && evenH
      ? "<b>already even</b> in both dimensions."
      : `<b>odd</b> in ${!evenW ? "width" : ""}${!evenW && !evenH ? " and " : ""}${!evenH ? "height" : ""} (${width}×${height}), so an encoder must pad or crop before it can write yuv420p.`;
  return (
    `<b>Chroma subsampling (yuv420p)</b> halves the horizontal &amp; vertical resolution of the color ` +
    `channels while keeping full-resolution luma. The human eye is far less sensitive to color detail ` +
    `than brightness, so this cuts data ~2&times; with minimal visible loss. It requires <b>even</b> width ` +
    `and height so every 2&times;2 luma block maps to one chroma sample. This file is ${fitText}`
  );
}

/**
 * What a codec is and what its parsed profile/level came out as, shown under the track it belongs
 * to. Null for a codec the knowledge base does not recognize, where there is nothing to say.
 */
export function codecExplainer(codecInfo: CodecInfo | null | undefined): string | null {
  if (!codecInfo) return null;
  const details = codecInfo.details.length
    ? "<br>" + codecInfo.details.map((d) => `<b>${d.label}:</b> ${String(d.value)}`).join(" &nbsp;&middot;&nbsp; ")
    : "";
  const year = codecInfo.year ? ` (${codecInfo.year})` : "";
  const name = codecInfo.fullName && codecInfo.fullName !== codecInfo.family ? `, ${codecInfo.fullName}` : "";
  return `<b>${codecInfo.family}</b>${year}${name}. ${codecInfo.description}${details}`;
}

/** What this particular container is, and which codecs it can carry. */
export function containerExplainer(info: ContainerInfo): string {
  return (
    `<b>${info.name}</b> (${info.fullName}; ${info.extensions}). ${info.description}` +
    `<p><b>Video codecs it can carry:</b> ${info.video}<br>` +
    `<b>Audio codecs:</b> ${info.audio}<br>` +
    `<b>Playback:</b> ${info.support}</p>`
  );
}

// --- Inspect: the atom map ---

/** What the box tree is, shown above the Atom Map and above the document's text listing of it. */
export const ATOM_STRUCTURE_TEACH =
  `An MP4 file is a tree of <b>boxes</b> (also called &ldquo;atoms&rdquo;): <code>ftyp</code> declares the ` +
  `brand/compatibility, <code>moov</code> holds all metadata &amp; the sample index (offsets, sizes, ` +
  `timestamps, keyframe flags), and <code>mdat</code> holds the raw encoded frame bytes it points to. ` +
  `Fragmented MP4s repeat <code>moof</code>+<code>mdat</code> pairs instead of one big <code>mdat</code>.`;

/** The Atom Map's own paragraph about how to read the map; the document has no map to read. */
export const ATOM_MAP_TEACH =
  `The map below is that tree on its side: left to right across the file, each row down one level of ` +
  `nesting. Siblings split their parent's width by how many boxes each subtree holds, so every box gets ` +
  `room and the whole file is on screen at once however long the video is. Width says nothing about ` +
  `size — hover a box for its offset and byte count, or click to zoom into it. The <b>Full Analysis</b> ` +
  `document draws this same map, minus the zooming.`;

/** What the map does on hover and on click, standing in the readout until one of them happens. */
export const ATOM_MAP_READOUT_HINT = "Hover a block for its offset and size; click one to zoom into it.";

/** How to read the map's colors, under its legend. */
export const ATOM_LEGEND_NOTE = "A box's color is the top-level box it belongs to; each row down is one level in.";

// --- Inspect: GOP structure and the seeking test ---

export const GOP_TEACH =
  `The <b>GOP (Group of Pictures)</b> is the span between keyframes (I-frames that decode with no ` +
  `reference to other frames). Shorter GOPs → more, larger keyframes → faster seeking &amp; scrubbing but ` +
  `worse compression.` +
  `<ul>` +
  `<li><b>I-frames</b> are self-contained: everything needed to draw the picture is in the frame itself.</li>` +
  `<li><b>P-frames</b> reference earlier frames, storing only what changed since then.</li>` +
  `<li><b>B-frames</b> reference both earlier <i>and later</i> frames, which compresses better but makes ` +
  `decode order ≠ presentation order, complicating random access.</li>` +
  `</ul>` +
  `<p><a href="https://io.sleap.ai/latest/cli/#sio-reencode" target="_blank" rel="noopener">sleap-io's ` +
  `<code>reencode</code></a> baseline forces a <b>fixed GOP</b> (<code>-g</code> + ` +
  `<code>-keyint_min</code> + <code>-sc_threshold 0</code>) and <b>disables B-frames</b> ` +
  `(<code>-bf 0</code>) specifically to make random-access seeking fast and predictable for ` +
  `pose-estimation pipelines that jump around a video rather than playing it linearly.</p>`;

/** Under the GOP histogram, on the page and in the document. */
export const GOP_HISTOGRAM_CAPTION = "GOP length per keyframe interval (hover a bar for its frame count)";

/** Under the seeking test's scatter, on the page and in the document. */
export const SEEK_SCATTER_CAPTION = "Keyframe distance vs. decode time; hover a point for its timestamp";

export const SEEK_TEST_INTRO =
  "Samples N evenly-spaced timestamps across the video and measures how far back the nearest keyframe is, " +
  "plus how long it takes to decode that frame.";

// --- Reencode with FFmpeg, and the encoder settings both encoding tabs offer ---

/** What reencoding is, and why the command is the thing this tab produces. Heads the Reencode tab. */
export const REENCODE_INTRO =
  `<b>Reencoding</b> means decoding a video back to raw frames and compressing them again. That is what ` +
  `lets you change quality, resolution, frame rate or keyframe spacing, and it is lossy: each pass throws ` +
  `away detail the previous pass kept, so start from the original whenever you can.` +
  `<p><b>Transcoding</b> is the same operation into a <i>different</i> codec (H.265 to H.264, say); the ` +
  `terms are often used interchangeably, but transcoding implies the codec itself changes. Neither is ` +
  `<b>remuxing</b> (<code>ffmpeg -c copy</code>), which lifts the already-compressed frames into a ` +
  `different container untouched, and so is lossless and nearly instant.</p>` +
  `<p>The command below runs <a href="https://ffmpeg.org/download.html" target="_blank" rel="noopener">` +
  `<b>ffmpeg</b></a> on your own machine, which is the way to do this for real work: it is a native ` +
  `multi-threaded build with no 30 MB download and no browser memory ceiling, so it is far faster on a ` +
  `full-length video; it scripts over a whole dataset; and the exact same command reruns later or on a ` +
  `colleague's machine and produces the same bytes. What runs in the page below is the same ffmpeg, for ` +
  `judging a setting quickly rather than for processing a corpus.</p>` +
  `<p>The settings here mirror ` +
  `<a href="https://io.sleap.ai/latest/cli/#sio-reencode" target="_blank" rel="noopener">sleap-io</a>'s ` +
  `<code>reencode</code> baseline, the shared transcoding target for the BBQS consortium's pose ` +
  `pipelines. Every knob below edits the command live; copy it to run locally, headless, or in batch.</p>`;

/** What the Reencode tab's sample run does, and where the Compare Quality tab takes over. */
export const SAMPLE_RUN_INTRO =
  `Encodes three seconds of the video with the command above — the real ffmpeg, compiled to WebAssembly, so ` +
  `the bytes are the bytes it would produce — and shows the result against the same seconds of the ` +
  `original, zoomable to the pixel. Nothing is uploaded and the file on disk is untouched.` +
  `<p>Which three seconds is the question worth asking, so the track below scans the whole recording: ` +
  `slide the band to the stretch that matters, judging it by the frame above it. A run starts at the ` +
  `keyframe at or before the band, since that is where the cut can be made without decoding the file from ` +
  `the beginning.</p>` +
  `<p>One stretch of a fixed length, judged by eye: there is nothing to set here beyond where it comes ` +
  `from. Sampling several places at once to project what a setting saves across the whole file, and ` +
  `sweeping several settings against each other, are the <b>Compare Quality</b> tab's job.</p>`;

/** What running the whole file in the page costs, under the section that offers to. */
export const WHOLE_FILE_ENCODE_INTRO =
  `Runs the command above over the <b>whole video</b>, here in the page, and saves the result to a file you ` +
  `choose. Nothing is uploaded: the frames are decoded and reencoded locally. Pick where to save when ` +
  `prompted, or the file lands in your downloads folder.` +
  `<p>The engine is ffmpeg itself, compiled to WebAssembly, so the output is byte-for-byte what the command ` +
  `gives you on your own machine. It is fetched on first use (~30 MB) and runs single-threaded (no ` +
  `COOP/COEP headers needed on static hosting), so it is slower than realtime: for a full-length recording ` +
  `or a whole dataset, copy the command and run ffmpeg natively instead. What runs here is bounded by what ` +
  `the browser tab can hold in memory.</p>`;

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

/** Why the A/B window offers two ways of drawing a downscaled encode back up. */
export const UPSCALE_VIEW_INFO =
  "A downscaled encode is drawn back at the source's size so both panes share one coordinate system. " +
  "<b>Blocks</b> repeats each encoded pixel, so you see exactly what survived the downscale, which is the " +
  "better view for judging what a tracking pipeline has left to work with. <b>Smooth</b> interpolates " +
  "between them, closer to what a player would put up. Neither changes the encode or its size.";

// --- Compare Quality: the run, the sweep and its grid ---

/** Why a run would encode the same settings in several places at once. */
export const SEGMENTS_INFO =
  "<b>Segments</b> is how many stretches of the length above a run encodes. Where they land is the sampler's " +
  "to decide, never yours: one lands anywhere in the file, several are drawn one per equal band of it, so the " +
  "projection is not taken over whichever flattering moment was picked by hand." +
  "<p>Each is a real encode, so a run costs that many times as long. The stretches are cut out of the source " +
  "once and reused, which is what makes two runs comparable, and the A/B window plays all of them in turn.</p>";

/** Why "best" is a size ranking and nothing more. */
export const MATRIX_BEST_INFO =
  "<b>Best</b> here means the smallest encode, and only that: no picture-quality metric is computed, so the " +
  "highest CRF wins nearly every sweep, and the lowest resolution wins outright when one is ticked. Read the " +
  "grid, not the star, which has no idea what your tracking needs.";

/** What the sweep remembers between runs, and when a square is encoded again anyway. */
export const MATRIX_CACHE_INFO =
  "A combination this file has already been swept at is read back rather than encoded again, including after " +
  "a reload, so widening a sweep only encodes the new squares." +
  "<p>Only the numbers are kept, never the video: choosing a square still encodes that one combination for " +
  "the A/B window. Untick to measure everything again, for fresh encoding times or a file changed under the " +
  "same name.</p>";

/**
 * Heads the ffmpeg command for the square in the A/B window. `settings` is the app's own description
 * of the combination (see describeSettings), never text read out of a file.
 */
export function selectedCommandTeach(settings: string): string {
  return (
    `What the square in the A/B window above — <b>${settings}</b> — comes to as an ffmpeg command, over the ` +
    `whole file rather than the sampled seconds. Everything the sweep does not vary (keyframe interval, ` +
    `B-frames, audio, faststart) is taken from the <b>Reencode with FFmpeg</b> tab as it is set there now.`
  );
}

// --- The size a setting projects, under both tabs that measure one ---

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

export const ORIGINAL_SEGMENT_INFO =
  "What the <i>source</i> spends on the same seconds the encode covered, counted on the same terms: video " +
  "frames, plus the stretch's share of the audio track and the container's overhead. This is what the " +
  "encoded segment is compared against.";

export const PROJECTED_SIZE_INFO =
  "The source's size times the ratio the snippet came to, i.e. what the whole file would come to at these " +
  "settings if the rest of it compresses like the sampled part. An extrapolation, not a measurement.";

export const SAMPLED_WINDOW_INFO =
  "How much of the file this estimate actually saw. The smaller it is, the more the projection leans on those " +
  "seconds being typical of the rest; a longer segment narrows the range.";

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
