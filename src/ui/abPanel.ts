// The A/B window: the encoded stretches against the same seconds of the original, with synchronized
// pixel-level zoom & pan, and the size figures that go with it.
//
// A run samples several stretches from across the file and measures all of them, so the window
// plays all of them: the stretches run one after another as a single reel that loops back to the
// first, and the line under the panes says which one is on screen. Judging the encode off whichever
// stretch happened to be first told you about one place in the video while the size figures beside
// it were about several.
//
// Both encoding tabs put their result here — a single run under Reencode with FFmpeg, a chosen
// square under Compare Quality — so the comparison reads the same whichever produced it. Only one
// of them is ever showing: the panel keeps a reference to whichever section it last drew into and
// clears it when the other takes over, since the sinks behind the panes belong to one encode at a
// time.

import { button, gridItem, h, infoIcon } from "../lib/dom";
import { isDownscale, scaledDimensions } from "../lib/cliCommand";
import { UPSCALE_VIEW_INFO } from "../lib/explainers";
import { errorMessage, fmtBytes } from "../lib/format";
import { describeQuality, describeResolutionChange } from "../lib/qualityMatrix";
import { fmtClock } from "../lib/sampleTimeline";
import { ensureMediabunny } from "../lib/mediabunny";
import type { Input } from "mediabunny";
import { currentSizeEstimate, windowsSeconds } from "../lib/sizeEstimate";
import { encodeTest, state } from "../lib/state";
import type { AbSegment, EncodeSettings, SampleWindow, TrackInfo } from "../lib/types";
import { renderSavingsDetail, renderSavingsStrip } from "./savingsPanel";
import { attachSyncedZoomPan, ZOOM_BUTTON_STEP, ZOOM_MAX, ZOOM_MIN } from "./zoomPan";

// Halts the previous run's playback loop, so a fresh comparison does not leave one decoding frames
// into the canvases it just replaced.
let stopActivePlayback: (() => void) | null = null;

/** The section the comparison is currently drawn in, so the one on the other tab can be cleared. */
let activeHost: HTMLElement | null = null;

/** What each tab wants done when its comparison is taken over by the other tab's. */
const displacedHandlers = new WeakMap<HTMLElement, () => void>();

/** Registers what to do when `host`'s comparison is replaced by one drawn somewhere else — the tab
 * that owned it has more to put back than the markup, such as which square was showing. */
export function onAbDisplaced(host: HTMLElement, handler: () => void): void {
  displacedHandlers.set(host, handler);
}

/**
 * Puts a run's encoded stretches in the A/B window, against the original, and redraws the
 * comparison.
 *
 * `blobs` is every stretch the run encoded, in the order it sampled them, and `totals.windows` says
 * where in the source each one came from — the two are read together, so the original side of the
 * pane at any moment is the same seconds as the encoded side.
 */
export async function loadEncodedIntoAB(
  blobs: Blob[],
  settings: EncodeSettings,
  vt: TrackInfo,
  host: HTMLElement,
  totals?: { bytes: number; windows: SampleWindow[] },
): Promise<void> {
  if (!blobs.length) throw new Error("No encoded segment to compare");
  if (!state.videoTrack) throw new Error("No video track loaded");
  const mb = await ensureMediabunny();
  const inputs: Input[] = [];
  const segments: AbSegment[] = [];
  try {
    for (let i = 0; i < blobs.length; i++) {
      const encodedInput = new mb.Input({ source: new mb.BlobSource(blobs[i]), formats: mb.ALL_FORMATS });
      // Pushed before anything can throw, so a stretch that fails half-way still leaves the ones
      // opened before it to be disposed rather than leaked.
      inputs.push(encodedInput);
      const encodedTrack = await encodedInput.getPrimaryVideoTrack();
      if (!encodedTrack) throw new Error("Encoded segment has no video track");
      // Asked rather than assumed: mediabunny throws out of the frame reads otherwise, which land in
      // a playback loop nothing is awaiting and surface as an unhandled rejection with no clue
      // attached.
      if (!(await encodedTrack.canDecode())) {
        throw new Error(
          "This browser will not decode the encode that was just made, so it cannot be shown side by side.",
        );
      }
      const seconds = await encodedInput.computeDuration();
      segments.push({
        window: totals?.windows[i] ?? { startSeconds: encodeTest.startTime, seconds },
        sink: new mb.CanvasSink(encodedTrack, { poolSize: 2 }),
        seconds,
      });
    }
  } catch (err) {
    for (const input of inputs) input.dispose();
    throw err;
  }
  // Swapped in only once every stretch has opened: a load that failed part-way used to leave the
  // window pointing at half a run, with the panes still showing the comparison before it.
  for (const input of encodeTest.encodedInputs) input.dispose();
  encodeTest.encodedInputs = inputs;
  encodeTest.originalSink = new mb.CanvasSink(state.videoTrack, { poolSize: 2 });
  encodeTest.abSegments = segments;
  encodeTest.segDuration = segments.reduce((sum, seg) => sum + seg.seconds, 0);
  // The bytes are the run's rather than these blobs' added up, so a square whose output was dropped
  // and re-encoded still reports what the sweep measured.
  encodeTest.encodedSize = totals?.bytes ?? blobs.reduce((sum, blob) => sum + blob.size, 0);
  encodeTest.windows = totals?.windows ?? segments.map((seg) => seg.window);
  encodeTest.activeCombo = settings;
  renderAbResult(host, vt, settings);
}

/** Empties whichever section last held the comparison, telling the tab that owned it. */
function displaceActiveHost(): void {
  if (!activeHost) return;
  const previous = activeHost;
  activeHost = null;
  previous.innerHTML = "";
  previous.style.display = "none";
  displacedHandlers.get(previous)?.();
}

/** Where one sampled stretch sits in the source, e.g. "12.3s–17.3s". */
function describeWindow(window: SampleWindow): string {
  return `${window.startSeconds.toFixed(1)}s–${(window.startSeconds + window.seconds).toFixed(1)}s`;
}

/** What a run covered: the one stretch it encoded, or how many it sampled and where the first was.
 * Shared with the Full Analysis document, so the page and the document say it the same way. */
export function describeSampledStretches(): string {
  const windows = encodeTest.windows;
  const first = windows[0] ?? { startSeconds: encodeTest.startTime, seconds: encodeTest.duration };
  if (windows.length <= 1) return describeWindow(first);
  const sampled = windowsSeconds(windows);
  return (
    `${windows.length} × ${first.seconds.toFixed(1)}s at random ` +
    `(${sampled.toFixed(1)}s total), first at ${describeWindow(first)}`
  );
}

/** The facts above the panes: which seconds were encoded, at what settings, and what they came to.
 * The resolution row appears only when it is not the source's, since a row reading "100%" over
 * every comparison would say nothing. */
function compareSummaryGrid(settings: EncodeSettings, srcWidth: number, srcHeight: number): HTMLDivElement {
  const g = h("div", "grid");
  g.append(
    gridItem("Segment", describeSampledStretches()),
    gridItem("Quality", describeQuality(settings)),
    gridItem("Preset", settings.preset),
  );
  if (isDownscale(settings.scale)) {
    g.append(gridItem("Resolution", describeResolutionChange(srcWidth, srcHeight, settings)));
  }
  g.append(gridItem("Encoded Segment Size", fmtBytes(encodeTest.encodedSize)));
  return g;
}

/** Kept off the very end of a stretch, which decodes to nothing: a sink asked for its own duration
 * has no frame at that timestamp to give back. */
const STRETCH_END_MARGIN = 0.001;

/** How long the loaded reel runs: every sampled stretch's encoded copy, added together. Falls back
 * to a second so the scrub bar has a range to be a fraction of before anything has loaded. */
function reelSeconds(): number {
  const total = encodeTest.abSegments.reduce((sum, seg) => sum + seg.seconds, 0);
  return total > 0 ? total : 1;
}

/** Where a second of the reel lands: which sampled stretch it is in, and how far into that stretch.
 * Past the end it clamps to the last stretch rather than falling off, since the reel's length is
 * measured from the same durations and floating-point addition need not agree with itself. */
function locateInReel(relT: number): { index: number; offset: number } {
  const segments = encodeTest.abSegments;
  let left = Math.max(0, relT);
  for (let i = 0; i < segments.length; i++) {
    const seconds = segments[i].seconds;
    if (left < seconds || i === segments.length - 1) {
      return { index: i, offset: Math.min(left, Math.max(0, seconds - STRETCH_END_MARGIN)) };
    }
    left -= seconds;
  }
  return { index: 0, offset: 0 };
}

/** The second of the reel a sampled stretch starts at, which is what the segment buttons jump to. */
function reelStartOfSegment(index: number): number {
  return encodeTest.abSegments.slice(0, index).reduce((sum, seg) => sum + seg.seconds, 0);
}

/** Which stretch of the run a reel position is in, for the scrub bar's `aria-valuetext` and the
 * band's tooltip: what the ruler shows, said in words for whoever cannot see it. */
function describeReelPosition(index: number, segments: AbSegment[]): string {
  return `Segment ${index + 1} of ${segments.length} · ${describeWindow(segments[index].window)} in the source`;
}

/**
 * How many of the boundaries on the reel ruler carry a time.
 *
 * The same figure the file-wide ruler in lib/sampleTimeline aims for: past about six, the labels
 * stop being read and start being a smear, so the boundaries between are ticks alone.
 */
const LABELLED_BOUNDARIES = 6;

/**
 * The sampled stretches drawn as the scrub bar itself, in the ruler idiom the sample picker borrowed
 * from clip-extractor.
 *
 * A band per stretch, alternating and held a hairline apart, laid where the bar's own track would
 * be — the slider is stripped down to its thumb (see `.has-reel` in the stylesheet), so what the
 * playhead runs along is the run. Under it, a ticked boundary between each pair saying where in the
 * source that stretch was cut from.
 *
 * Only in the page when a run sampled more than one stretch, since a bar divided into one says
 * nothing, and a plain slider is what a single stretch wants. The bands come back either way, so the
 * caller highlights the one being played without asking which case it is in.
 */
function appendReelRuler(wrap: HTMLElement, segments: AbSegment[], reelSpan: number): HTMLElement[] {
  const track = h("div", "compare-reel-track");
  const ruler = h("div", "compare-reel");
  const at = (seconds: number): number => (reelSpan > 0 ? (seconds / reelSpan) * 100 : 0);
  const bands = segments.map((segment, i) => {
    const band = h("div", "compare-reel-seg" + (i % 2 ? " alt" : ""));
    band.style.left = at(reelStartOfSegment(i)).toFixed(3) + "%";
    // Held a hairline short of its share and nudged off its boundary, so neighbouring stretches
    // read as separate blocks rather than as one track with ticks drawn under it.
    band.style.width = `calc(${at(segment.seconds).toFixed(3)}% - 2px)`;
    band.style.marginLeft = "1px";
    track.append(band);
    return band;
  });
  // One more boundary than there are stretches: the end of the last one closes the bar off.
  const labelEvery = Math.ceil(segments.length / LABELLED_BOUNDARIES);
  for (let i = 0; i <= segments.length; i++) {
    const last = i === segments.length;
    const window = segments[last ? i - 1 : i].window;
    const left = at(last ? reelSpan : reelStartOfSegment(i));
    const tick = h("div", "compare-reel-tick");
    tick.style.left = left.toFixed(3) + "%";
    ruler.append(tick);
    if (i % labelEvery !== 0 && !last) continue;
    // The end labels would hang off the bar, so they align inwards instead of centring, the way the
    // sample picker's ruler handles its own ends.
    const align = left < 2 ? " at-start" : left > 98 ? " at-end" : "";
    const seconds = last ? window.startSeconds + window.seconds : window.startSeconds;
    const label = h("div", "compare-reel-label" + align, fmtClock(seconds, state.duration ?? seconds));
    label.style.left = left.toFixed(3) + "%";
    ruler.append(label);
  }
  if (segments.length > 1) {
    // What tells the stylesheet to take the slider's own track away and let these show through.
    wrap.classList.add("has-reel");
    wrap.append(track, ruler);
  }
  return bands;
}

/** The buttons that step between sampled stretches, put in the control row. Only there when a run
 * sampled more than one: buttons that cycle a cycle of one say nothing. */
function appendSegmentNav(controls: HTMLElement, count: number): { prev: HTMLButtonElement; next: HTMLButtonElement } {
  const prev = iconButton("btn sm sec seg-step", "◀", "Jump to the previous sampled stretch");
  const next = iconButton("btn sm sec seg-step", "▶", "Jump to the next sampled stretch");
  const buttons = h("div", "compare-segment-buttons");
  buttons.append(prev, next);
  if (count > 1) controls.append(buttons);
  return { prev, next };
}

/** A glyph-only button, whose tooltip doubles as its accessible name. */
function iconButton(cls: string, glyph: string, label: string): HTMLButtonElement {
  const b = button(cls, glyph);
  b.title = label;
  b.setAttribute("aria-label", label);
  return b;
}

/**
 * Draws a decoded frame onto a pane. `target` is the geometry to draw into when it is not the frame's
 * own: only a downscaled encode has one, and it is the source's size. Whether that redraw
 * interpolates is the viewer's call (see the Downscaled view control); it makes no difference when
 * the frame is already the right size, since then nothing is being resampled.
 */
function drawFrame(
  canvas: HTMLCanvasElement,
  frame: { canvas: HTMLCanvasElement | OffscreenCanvas } | null,
  target?: { width: number; height: number } | null,
): void {
  if (!frame) return;
  const width = target?.width || frame.canvas.width;
  const height = target?.height || frame.canvas.height;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.imageSmoothingEnabled = encodeTest.upscaleSmoothing;
  ctx.drawImage(frame.canvas, 0, 0, width, height);
}

/**
 * The comparison's own heading, at the rank its host asks for: a host marked `ab-inline` is a block
 * inside the card that ran the encode rather than a card of its own (see encodeTab), so it reads as
 * that card's result, alongside the other headings inside it.
 */
function abHeading(host: HTMLElement): HTMLElement {
  return h(host.classList.contains("ab-inline") ? "h3" : "h2", null, "Side-by-Side");
}

function renderAbResult(host: HTMLElement, vt: TrackInfo, settings: EncodeSettings): void {
  stopActivePlayback?.();
  // The other tab's copy, if it has one, is of an encode whose sinks have just been replaced.
  if (activeHost !== host) displaceActiveHost();
  activeHost = host;
  host.innerHTML = "";
  host.style.display = "block";
  host.append(abHeading(host));

  // `settings` is what the loaded encode was made with, which after a sweep is the winning square's
  // rather than whatever the command builder happens to say.
  const srcWidth = vt.codedWidth ?? 0;
  const srcHeight = vt.codedHeight ?? 0;
  // A downscaled encode is drawn back at the source's geometry, so the two panes stay one
  // coordinate system: the same zoom shows the same part of the frame on each side, and the pixel
  // grid keeps measuring source pixels rather than two different things per pane.
  const downscaled = isDownscale(settings.scale);
  const encSize = scaledDimensions(srcWidth, srcHeight, settings.scale);
  host.append(compareSummaryGrid(settings, srcWidth, srcHeight));

  // The size question is half of what a run is for, so its headline goes above the panes rather
  // than below the controls, where the detail and the caveats follow it.
  const estimate = currentSizeEstimate();
  if (estimate) host.append(h("h3", null, "Estimated Data Savings"), renderSavingsStrip(estimate));

  const shownSeconds = reelSeconds();

  const stage = h("div", "compare-stage");
  const origPane = h("div", "compare-pane");
  origPane.append(h("span", "pane-label", "Original"));
  const origCanvas = h("canvas");
  origCanvas.width = vt.codedWidth ?? 0;
  origCanvas.height = vt.codedHeight ?? 0;
  origPane.append(origCanvas);
  const origGrid = h("div", "pixel-grid");
  origPane.append(origGrid);
  const encPane = h("div", "compare-pane");
  const encLabel = h(
    "span",
    "pane-label",
    `Encoded (${settings.quality === "custom" ? "CRF " + settings.crf : settings.quality}, ${settings.preset}` +
      (downscaled ? `, ${encSize.width}×${encSize.height}` : "") +
      ")",
  );
  // Restated whenever the view switches, since which of the two is on screen changes what the pane
  // is actually showing you.
  const syncEncLabel = (): void => {
    if (!downscaled) return;
    encLabel.title =
      `Encoded at ${encSize.width}×${encSize.height}, drawn back at ${srcWidth}×${srcHeight} ` +
      (encodeTest.upscaleSmoothing
        ? `with smoothing, closer to how a player would show it.`
        : `one block per encoded pixel, so nothing is interpolated in.`);
  };
  syncEncLabel();
  encPane.append(encLabel);
  const encCanvas = h("canvas");
  encCanvas.width = vt.codedWidth ?? 0;
  encCanvas.height = vt.codedHeight ?? 0;
  encPane.append(encCanvas);
  const encGrid = h("div", "pixel-grid");
  encPane.append(encGrid);
  const ar = `${vt.codedWidth ?? 0} / ${vt.codedHeight ?? 0}`;
  origPane.style.aspectRatio = ar;
  encPane.style.aspectRatio = ar;
  stage.append(origPane, encPane);
  host.append(stage);

  const segments = encodeTest.abSegments;

  const controls = h("div", "compare-controls");
  // The bar gets a row of its own above the buttons. The ruler under it has to line up with the bar
  // it divides, which means sharing a wrapper, and a wrapper two elements tall in among the buttons
  // would leave the bar itself sitting off the row's centre line — besides which the labels want
  // the width.
  const scrubWrap = h("div", "compare-scrub");
  const scrub = h("input");
  scrub.type = "range";
  scrub.min = "0";
  scrub.max = "1000";
  scrub.value = "0";
  scrub.setAttribute("aria-label", "Playback position across the sampled stretches");
  scrubWrap.append(scrub);
  const segmentBands = appendReelRuler(scrubWrap, segments, shownSeconds);
  host.append(scrubWrap);
  const scrubLabel = h("span", "progress-label", "0.00s");
  const playBtn = button("btn sm sec", "Play");
  const zoomBtns = h("div", "zoom-buttons");
  // Wheel zoom is the fast path, but it is unavailable on a trackpad-less mouse or a touch device,
  // so every zoom move is reachable from a button too.
  const zoomOutBtn = iconButton("btn sm sec zoom-step", "−", "Zoom out");
  const zoomInBtn = iconButton("btn sm sec zoom-step", "+", "Zoom in");
  const fitBtn = button("btn sm sec", "Fit");
  const actualBtn = button("btn sm sec", "Actual Size (100%)");
  zoomBtns.append(zoomOutBtn, zoomInBtn, fitBtn, actualBtn);
  controls.append(playBtn);
  const { prev: prevSegBtn, next: nextSegBtn } = appendSegmentNav(controls, segments.length);
  controls.append(scrubLabel, zoomBtns);
  // How the downscaled side is drawn back up is a genuine choice, not a default worth hiding:
  // blocks show exactly which pixels survived, smoothing shows what a player would put on screen.
  // Only offered when something is actually being drawn back up.
  if (downscaled) {
    const viewSelect = h("select", "compare-view-select");
    viewSelect.id = "etUpscaleView";
    viewSelect.setAttribute("aria-label", "How the downscaled encode is drawn");
    for (const [value, label] of [
      ["blocks", "Blocks (nearest)"],
      ["smooth", "Smooth"],
    ]) {
      const opt = h("option", null, label);
      opt.value = value;
      if ((value === "smooth") === encodeTest.upscaleSmoothing) opt.selected = true;
      viewSelect.append(opt);
    }
    viewSelect.addEventListener("change", () => {
      encodeTest.upscaleSmoothing = viewSelect.value === "smooth";
      syncEncLabel();
      // Redraw where the playhead already is, so the switch shows on the frame being looked at
      // rather than only on the next one.
      drawFrom(scrubSeconds());
    });
    const viewWrap = h("div", "compare-view");
    viewWrap.append(h("span", "compare-view-label", "Downscaled view"), viewSelect, infoIcon(UPSCALE_VIEW_INFO));
    controls.append(viewWrap);
  }
  host.append(controls);

  if (estimate) host.append(...renderSavingsDetail(estimate));

  const syncZoomButtons = (scale: number): void => {
    zoomOutBtn.disabled = scale <= ZOOM_MIN;
    zoomInBtn.disabled = scale >= ZOOM_MAX;
  };
  const zoomPan = attachSyncedZoomPan(stage, [origCanvas, encCanvas], [origGrid, encGrid], syncZoomButtons);
  zoomOutBtn.addEventListener("click", () => zoomPan.zoomBy(1 / ZOOM_BUTTON_STEP));
  zoomInBtn.addEventListener("click", () => zoomPan.zoomBy(ZOOM_BUTTON_STEP));
  fitBtn.addEventListener("click", () => zoomPan.fit());
  actualBtn.addEventListener("click", () => zoomPan.actualSize());
  syncZoomButtons(zoomPan.state.scale);

  const drawError = h("div", "error-msg");
  drawError.style.display = "none";
  host.append(drawError);

  // `relT` is a second of the reel, not of the source: it is turned into a stretch and an offset
  // into it, and the original is read at that offset from where that stretch was cut. That is what
  // keeps the two panes on the same content once the reel has run past the first stretch.
  const drawAt = async (relT: number): Promise<void> => {
    if (!encodeTest.originalSink) return;
    // Never out of range: nothing is drawn until a load has put at least one stretch in the window.
    const { index, offset } = locateInReel(relT);
    const segment = segments[index];
    const [originalFrame, encodedFrame] = await Promise.all([
      encodeTest.originalSink.getCanvas(segment.window.startSeconds + offset),
      segment.sink.getCanvas(offset),
    ]);
    drawFrame(origCanvas, originalFrame);
    drawFrame(encCanvas, encodedFrame, downscaled ? { width: srcWidth, height: srcHeight } : null);
  };
  /**
   * Draws a frame from a handler that cannot await it.
   *
   * A rejected draw used to leave the page with an unhandled rejection and the panes with whatever
   * they last held, which reads as the comparison silently freezing. It says so under the panes
   * instead, since a comparison that will not draw is the one thing this section is for.
   */
  const drawFrom = (relT: number): void => {
    void drawAt(relT).catch((err: unknown) => {
      console.error("[encoding-helper] could not draw the comparison:", err);
      drawError.textContent = "Could not draw the comparison: " + errorMessage(err);
      drawError.style.display = "";
    });
  };

  /** Puts every readout on the same second of the reel: the slider (unless it is the thing being
   * dragged), the time beside it, and the band under it that the second falls in. */
  const showTime = (relT: number, moveScrub = true): void => {
    if (moveScrub) scrub.value = String((relT / shownSeconds) * 1000);
    scrubLabel.textContent = relT.toFixed(2) + "s";
    const { index } = locateInReel(relT);
    // The lit band on the bar is what says which stretch is on screen. Said in words on the slider
    // too, since a screen reader gets nothing from the drawing, the bands themselves sit under it
    // and so can carry no tooltip of their own, and its raw value is a thousandth of a reel.
    const where = `${relT.toFixed(2)}s · ${describeReelPosition(index, segments)}`;
    scrub.setAttribute("aria-valuetext", where);
    scrub.title = where;
    segmentBands.forEach((band, i) => band.classList.toggle("current", i === index));
  };

  // Playback decodes both panes per frame, so it is paced off the wall clock and asks for whichever
  // frame the elapsed time lands on: when decoding cannot keep up it drops frames rather than
  // drifting into slow motion, keeping the two sides on the same timeline.
  const frameStep = 1 / (vt.packetRate && vt.packetRate > 0 ? vt.packetRate : 30);
  let playing = false;
  let baseT = 0;
  let baseWall = 0;
  // Bumped on every press of Play, so a loop still awaiting a frame from the run before it neither
  // keeps drawing nor stops the run that replaced it.
  let playRun = 0;
  const rebase = (relT: number): void => {
    baseT = relT;
    baseWall = performance.now();
  };
  const stopPlayback = (): void => {
    playing = false;
    playBtn.textContent = "Play";
  };
  stopActivePlayback = stopPlayback;
  const runPlayback = async (run: number): Promise<void> => {
    try {
      while (playing && run === playRun) {
        let relT = baseT + (performance.now() - baseWall) / 1000;
        // The reel is every sampled stretch end to end, so this runs through all of them and then
        // back to the first, the way a player set to repeat would: rebasing to 0 keeps the same
        // wall-clock pacing loop running instead of restarting it from Play.
        if (relT >= shownSeconds) {
          rebase(0);
          relT = 0;
        }
        showTime(relT);
        await drawAt(relT);
        const nextWall = baseWall + (Math.floor((relT - baseT) / frameStep) + 1) * frameStep * 1000;
        const wait = nextWall - performance.now();
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      }
    } catch (err) {
      // A frame that will not decode ends playback rather than leaving the button stuck on "Pause".
      console.error("[encoding-helper] playback stopped:", err);
    } finally {
      if (run === playRun) stopPlayback();
    }
  };
  /** Where the slider stands, as a second of the reel. */
  const scrubSeconds = (): number => (parseFloat(scrub.value) / 1000) * shownSeconds;
  playBtn.addEventListener("click", () => {
    if (playing) {
      stopPlayback();
      return;
    }
    const at = scrubSeconds();
    // Pressing Play with the playhead parked at the end starts the reel over.
    rebase(at >= shownSeconds - frameStep ? 0 : at);
    playing = true;
    playBtn.textContent = "Pause";
    void runPlayback(++playRun);
  });

  /** Moves the playhead to the start of a sampled stretch, wrapping either way so the buttons walk
   * the same cycle playback does. Mid-playback it moves the playhead rather than stopping. */
  const jumpToSegment = (index: number): void => {
    const wrapped = ((index % segments.length) + segments.length) % segments.length;
    const at = reelStartOfSegment(wrapped);
    if (playing) rebase(at);
    showTime(at);
    drawFrom(at);
  };
  const currentSegment = (): number => locateInReel(scrubSeconds()).index;
  prevSegBtn.addEventListener("click", () => jumpToSegment(currentSegment() - 1));
  nextSegBtn.addEventListener("click", () => jumpToSegment(currentSegment() + 1));

  scrub.addEventListener("input", () => {
    const relT = scrubSeconds();
    // Everything but the slider, which is the thing being dragged.
    showTime(relT, false);
    // Scrubbing mid-playback moves the playhead instead of fighting the loop for the slider.
    if (playing) rebase(relT);
    void drawAt(relT);
  });
  showTime(0);
  drawFrom(0);
}
