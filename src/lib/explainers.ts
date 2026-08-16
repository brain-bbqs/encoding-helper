// Author-authored explainer copy, shared by the tab renderers and the Full Analysis document.
//
// Every string here is trusted markup rendered through innerHTML (teachBox, info popovers, the
// document's prose blocks), so nothing read out of a media file may be interpolated into one
// without going through escapeHtml first — the two builders below that take file-derived numbers
// do exactly that. The copy lives here rather than in the tab that first showed it because the
// document repeats it: one source of words, so the page and the exported document can never
// explain the same number two different ways.

import type { BitrateTimeline } from "./bitrateTimeline";
import type { ContainerInfo } from "./containerKb";
import { escapeHtml } from "./dom";
import { fmtBits } from "./format";
import type { SizeEstimate } from "./sizeEstimate";
import type { CodecInfo } from "./types";

/** The Overview's whole-file bitrate, which is not the same as any one track's bitrate. */
export const OVERALL_BITRATE_INFO =
  "<b>Bitrate</b> is how many bits of file it takes to store one second of playback, so it is the main lever " +
  "on both file size and quality. This one is <b>overall</b> because it is measured across the entire file: " +
  "file size &times; 8 &divide; duration, counting the video track, the audio track, and the container's own " +
  "overhead (headers, the sample index, metadata) together. The per-track figures below cover only their own " +
  "packets, so they add up to slightly less than this number: the video track's heads the <b>Video Bitrate " +
  "Over Time</b> card, and the audio track's is in the Audio Track section. " +
  "<p>It is also an average. Unless the encoder was told to hold a constant bitrate, the instantaneous rate " +
  "rises on keyframes and busy scenes and falls on still ones, which is what the <b>Video Bitrate Over " +
  "Time</b> card plots.</p>";

export const FASTSTART_EXPLAINER =
  "<b>Faststart</b> means the <code>moov</code> atom (the index describing every sample) sits before " +
  "<code>mdat</code> (the actual frame bytes). A browser or CDN can then start playback after downloading " +
  "just the first few KB, instead of the whole file. See the <b>Atom Map</b> for the byte-level layout.";

export const VIDEO_AVERAGE_INFO =
  "Average bitrate of the video track alone: the total size of its packets &times; 8 &divide; duration. " +
  "Compare it with <b>Overall Bitrate</b> in the Overview, which also counts the audio track and the " +
  "container overhead. Lowering it (a higher CRF, in the Reencode with ffmpeg tab) is what shrinks the file, at the " +
  "cost of visible compression artifacts.";

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
  "The busiest window's bitrate divided by the track average. <b>1&times;</b> would mean every window " +
  "carried exactly the same bits; the further above 1, the burstier the encode, and the more bandwidth " +
  "headroom playback needs beyond the average.";

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
    `<b>variable bitrate</b> encode (any CRF encode, including the Reencode with ffmpeg tab's) inverts that: it holds ` +
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
  "AAC, roughly 128 kbps stereo is transparent for most listeners. This is separate from the video bitrate, " +
  "and both are included in the Overview's <b>Overall Bitrate</b>.";

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

/** What the preset actually trades, shown from the ⓘ beside the field in both tabs that offer it. */
export const X264_PRESET_INFO =
  "<b>Preset</b> sets how hard x264 works to compress, not how good the picture looks: that is CRF's job. At " +
  "the same CRF every preset aims at the same quality, and what changes is how long the encode takes and how " +
  "many bytes it needs to get there. Slower searches harder and reaches that quality in a smaller file." +
  "<p>The returns fall off sharply, the slow end taking many times longer for a few more percent off the " +
  "size, which is why <code>superfast</code> is the default here as in sleap-io's <code>reencode</code>. In " +
  "the browser the gap is wider still, the in-browser ffmpeg being a single-threaded WebAssembly build: the " +
  "slowest presets can take minutes over a few seconds of video, or exhaust the encoder outright. Run the " +
  "command natively to use them.</p>";

/** Why resolution is its own knob rather than something CRF already covers, from the ⓘ beside the
 * field in both tabs that offer it. */
export const RESOLUTION_INFO =
  "<b>Resolution</b> is the biggest lever on file size here, and it is not CRF's job. CRF quantizes more " +
  "coarsely within the grid of pixels it is given, and however hard it quantizes it still pays the " +
  "per-block cost of every block in the frame. Halving each dimension deletes three quarters of those " +
  "blocks outright, which is why the two trade against each other: below some bitrate, half resolution at a " +
  "moderate CRF looks better than full resolution at a punishing one." +
  "<p>Downscaling uses <code>flags=lanczos</code>, and <code>-2</code> for the height, which keeps the " +
  "aspect ratio and lands on the even dimensions <code>yuv420p</code> requires (so the pad is not needed).</p>" +
  "<p><b>It is not the same kind of loss as CRF.</b> A keypoint stays localizable to sub-pixel precision " +
  "through a brutal CRF, because those artifacts are texture-level. Resolution puts a hard floor under that " +
  "precision, and no downstream step recovers it. Judge it against what the tracking needs, not only by how " +
  "the A/B window looks.</p>";

/** What the two offered kernels trade, from the ⓘ beside the field that picks between them. */
export const SCALER_INFO =
  "<b>Scaler</b> is the kernel <code>scale</code> resamples with, and it only matters when the resolution is " +
  "below 100%. <code>lanczos</code> is the sharper of the two: it weighs a wider neighbourhood of source " +
  "pixels and keeps fine detail (whiskers, tail tips, grid lines) that a softer kernel averages away. " +
  "<code>bicubic</code> is swscale's own default, softer, and less prone to the faint ringing lanczos can " +
  "leave along hard edges." +
  "<p>Sharper is not automatically better downstream. Lanczos preserves more detail for the encoder to " +
  "spend bits on, so the same CRF costs slightly more; bicubic's smoothing throws some of that away before " +
  "x264 ever sees it. Compare them in the A/B window at 100% zoom rather than assuming.</p>";

/** Why the A/B window offers two ways of drawing a downscaled encode back up. */
export const UPSCALE_VIEW_INFO =
  "A downscaled encode is drawn back at the source's size so both panes share one coordinate system, and " +
  "there are two honest ways to do that. <b>Blocks</b> repeats each encoded pixel, so what you see is " +
  "exactly what survived the downscale and nothing else. <b>Smooth</b> interpolates between them, which is " +
  "closer to what a player or a viewer's screen would actually put up." +
  "<p>Blocks is the better view for judging what a tracking pipeline has left to work with; smooth is the " +
  "better view for judging how it looks. Neither changes the encode or its size.</p>";

/** Why a run would encode the same settings in several places at once. */
export const SEGMENTS_INFO =
  "<b>Segments</b> is how many stretches of the length above a run encodes. Where they land is the sampler's " +
  "to decide, never yours: a stretch picked by hand is picked for a reason, and a size measured over a " +
  "flattering moment is the one number this tab must not produce. One stretch lands anywhere in the file; " +
  "several are drawn one per equal band of it, so they cover it end to end instead of clumping." +
  "<p>The projection is taken over all of them together and its range narrows accordingly, which is the whole " +
  "point: three seconds of a calm scene predicts a talking-heads file well and a wildlife file badly, and the " +
  "only fix is to look in more than one place.</p>" +
  "<p>Each one is a real encode, so the run costs that many times as long, and in matrix mode it multiplies " +
  "the sweep. The A/B window below still shows the first stretch: the eye wants one continuous piece of " +
  "video to judge, while the byte count wants a fair sample of the file.</p>" +
  "<p>The stretches are cut out of the source once and kept, so every setting after the first encodes them " +
  "without touching the video again — and a re-run at another CRF measures the same seconds, which is what " +
  "makes two runs comparable at all.</p>";

/** Why "best" is a size ranking and nothing more. */
export const MATRIX_BEST_INFO =
  "<b>Best</b> here means the smallest encode, and only that: no picture-quality metric is computed, so the " +
  "highest CRF offered wins nearly every sweep." +
  "<p>Tick a second resolution and it stops being close: resolution deletes bits faster than anything on the " +
  "other axes, so the smallest one takes the ★ outright. Read the grid, not the star, when the sweep spans " +
  "resolutions, and remember the star has no idea what your tracking needs.</p>";

export const SEEK_TEST_INTRO =
  "Samples N evenly-spaced timestamps across the video and measures how far back the nearest keyframe is, " +
  "plus how long it takes to decode that frame.";

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
    `with length. For an exact number, encode the whole file in the <b>Reencode with ffmpeg</b> tab.</p>`
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
  "frames, plus the stretch's share of the audio track and the container's overhead. This is the number the " +
  "encoded segment is compared against, since comparing it with the whole file's size would only be " +
  "comparing three seconds with an hour.";

export const PROJECTED_SIZE_INFO =
  "The source's size times the ratio the snippet came to (encoded segment &divide; the same stretch of the " +
  "source), i.e. what the whole file would come to at these settings if the rest of it compresses like the " +
  "part that was sampled. It is an extrapolation from a few seconds, not a measurement.";

export const SAMPLED_WINDOW_INFO =
  "How much of the file this estimate actually saw. The smaller this is, the more the projection is leaning " +
  "on the sampled seconds being typical of the rest; lengthening the segment above narrows the range.";
