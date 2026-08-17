// The A/B window: one encoded stretch against the same seconds of the original, with synchronized
// pixel-level zoom & pan, and the size figures that go with it.
//
// Both encoding tabs put their result here — a single run under Reencode with FFmpeg, a chosen
// square under Compare Quality — so the comparison reads the same whichever produced it. Only one
// of them is ever showing: the panel keeps a reference to whichever section it last drew into and
// clears it when the other takes over, since the sinks behind the panes belong to one encode at a
// time.

import { gridItem, h, infoIcon } from "../lib/dom";
import { isDownscale, scaledDimensions } from "../lib/cliCommand";
import { UPSCALE_VIEW_INFO } from "../lib/explainers";
import { fmtBytes } from "../lib/format";
import { ensureMediabunny } from "../lib/mediabunny";
import { currentSizeEstimate } from "../lib/sizeEstimate";
import { encodeTest, state } from "../lib/state";
import type { EncodeSettings, SampleWindow, TrackInfo } from "../lib/types";
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

/** Puts an encoded segment in the A/B window, against the original, and redraws the comparison. */
export async function loadEncodedIntoAB(
  blob: Blob,
  settings: EncodeSettings,
  vt: TrackInfo,
  host: HTMLElement,
  totals?: { bytes: number; windows: SampleWindow[] },
): Promise<void> {
  const mb = await ensureMediabunny();
  const encodedInput = new mb.Input({ source: new mb.BlobSource(blob), formats: mb.ALL_FORMATS });
  const encodedTrack = await encodedInput.getPrimaryVideoTrack();
  if (!encodedTrack) throw new Error("Encoded segment has no video track");
  // Asked rather than assumed: mediabunny throws out of the frame reads otherwise, which land in a
  // playback loop nothing is awaiting and surface as an unhandled rejection with no clue attached.
  if (!(await encodedTrack.canDecode())) {
    throw new Error("This browser will not decode the encode that was just made, so it cannot be shown side by side.");
  }
  const encodedDuration = await encodedInput.computeDuration();
  if (!state.videoTrack) throw new Error("No video track loaded");
  // The window is about to point at a new input; the one it was pointing at goes.
  encodeTest.encodedInput?.dispose();
  encodeTest.originalSink = new mb.CanvasSink(state.videoTrack, { poolSize: 2 });
  encodeTest.encodedSink = new mb.CanvasSink(encodedTrack, { poolSize: 2 });
  encodeTest.encodedInput = encodedInput;
  encodeTest.segDuration = encodedDuration;
  // The bytes and the stretches are the run's, not this blob's: with several sampled stretches the
  // window below shows the first while the size figures cover them all.
  encodeTest.encodedSize = totals?.bytes ?? blob.size;
  encodeTest.windows = totals?.windows ?? [{ startSeconds: encodeTest.startTime, seconds: encodedDuration }];
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

/** What a run covered: the one stretch it encoded, or how many it sampled and where the first was.
 * Shared with the Full Analysis document, so the page and the document say it the same way. */
export function describeSampledStretches(): string {
  const windows = encodeTest.windows;
  const first = windows[0] ?? { startSeconds: encodeTest.startTime, seconds: encodeTest.duration };
  const span = `${first.startSeconds.toFixed(1)}s–${(first.startSeconds + first.seconds).toFixed(1)}s`;
  if (windows.length <= 1) return span;
  const sampled = windows.reduce((sum, w) => sum + w.seconds, 0);
  return `${windows.length} × ${first.seconds.toFixed(1)}s at random (${sampled.toFixed(1)}s total), showing ${span}`;
}

/** The facts above the panes: which seconds were encoded, at what settings, and what they came to.
 * The resolution row appears only when it is not the source's, since a row reading "100%" over
 * every comparison would say nothing. */
function compareSummaryGrid(settings: EncodeSettings, srcWidth: number, srcHeight: number): HTMLDivElement {
  const g = h("div", "grid");
  g.append(
    gridItem("Segment", describeSampledStretches()),
    gridItem(
      "Quality",
      settings.quality === "custom" ? `Custom (CRF ${settings.crf})` : `${settings.quality} (CRF ${settings.crf})`,
    ),
    gridItem("Preset", settings.preset),
  );
  if (isDownscale(settings.scale)) {
    const out = scaledDimensions(srcWidth, srcHeight, settings.scale);
    g.append(
      gridItem(
        "Resolution",
        `${srcWidth}×${srcHeight} → ${out.width}×${out.height} ` +
          `(${Math.round(settings.scale * 100)}%, ${settings.scaler})`,
      ),
    );
  }
  g.append(gridItem("Encoded Segment Size", fmtBytes(encodeTest.encodedSize)));
  return g;
}

function renderAbResult(host: HTMLElement, vt: TrackInfo, settings: EncodeSettings): void {
  stopActivePlayback?.();
  // The other tab's copy, if it has one, is of an encode whose sinks have just been replaced.
  if (activeHost !== host) displaceActiveHost();
  activeHost = host;
  host.innerHTML = "";
  host.style.display = "block";
  host.append(h("h2", null, "Side-by-Side"));

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
      `Encoded at ${encSize.width}×${encSize.height} and drawn back at ${srcWidth}×${srcHeight} ` +
      (encodeTest.upscaleSmoothing
        ? `with smoothing, which is closer to how a player would show it, at the cost of interpolating in ` +
          `detail the encode does not contain.`
        : `one block per encoded pixel, so nothing is interpolated in that the encode does not contain.`);
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

  const controls = h("div", "compare-controls");
  const scrub = h("input");
  scrub.type = "range";
  scrub.min = "0";
  scrub.max = "1000";
  scrub.value = "0";
  const scrubLabel = h("span", "progress-label", "0.00s");
  const playBtn = h("button", "btn sm sec", "Play");
  playBtn.type = "button";
  const zoomBtns = h("div", "zoom-buttons");
  // Wheel zoom is the fast path, but it is unavailable on a trackpad-less mouse or a touch device,
  // so every zoom move is reachable from a button too.
  const zoomOutBtn = h("button", "btn sm sec zoom-step", "−");
  zoomOutBtn.type = "button";
  zoomOutBtn.title = "Zoom out";
  zoomOutBtn.setAttribute("aria-label", "Zoom out");
  const zoomInBtn = h("button", "btn sm sec zoom-step", "+");
  zoomInBtn.type = "button";
  zoomInBtn.title = "Zoom in";
  zoomInBtn.setAttribute("aria-label", "Zoom in");
  const fitBtn = h("button", "btn sm sec", "Fit");
  fitBtn.type = "button";
  const actualBtn = h("button", "btn sm sec", "Actual Size (100%)");
  actualBtn.type = "button";
  zoomBtns.append(zoomOutBtn, zoomInBtn, fitBtn, actualBtn);
  controls.append(playBtn, scrub, scrubLabel, zoomBtns);
  // How the downscaled side is drawn back up is a genuine choice, not a default worth hiding:
  // blocks show exactly which pixels survived, smoothing shows what a player would put on screen.
  // Only offered when something is actually being drawn back up.
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
  if (downscaled) {
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

  // `target` is the geometry to draw into when it is not the frame's own: only a downscaled encode
  // has one, and it is the source's size. Whether that redraw interpolates is the viewer's call
  // (see the Downscaled view control); it makes no difference when the frame is already the right
  // size, since then nothing is being resampled.
  const drawFrame = (
    canvas: HTMLCanvasElement,
    frame: { canvas: HTMLCanvasElement | OffscreenCanvas } | null,
    target?: { width: number; height: number } | null,
  ): void => {
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
  };
  const drawError = h("div", "error-msg");
  drawError.style.display = "none";
  host.append(drawError);

  const drawAt = async (relT: number): Promise<void> => {
    if (!encodeTest.originalSink || !encodeTest.encodedSink) return;
    const [originalFrame, encodedFrame] = await Promise.all([
      encodeTest.originalSink.getCanvas(encodeTest.startTime + relT),
      encodeTest.encodedSink.getCanvas(Math.min(relT, Math.max(0, encodeTest.segDuration - 0.001))),
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
      drawError.textContent = "Could not draw the comparison: " + (err instanceof Error ? err.message : String(err));
      drawError.style.display = "";
    });
  };

  const showTime = (relT: number): void => {
    scrub.value = String((relT / encodeTest.duration) * 1000);
    scrubLabel.textContent = relT.toFixed(2) + "s";
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
        const relT = baseT + (performance.now() - baseWall) / 1000;
        if (relT >= encodeTest.duration) {
          showTime(encodeTest.duration);
          await drawAt(encodeTest.duration);
          return;
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
  playBtn.addEventListener("click", () => {
    if (playing) {
      stopPlayback();
      return;
    }
    const at = (parseFloat(scrub.value) / 1000) * encodeTest.duration;
    // Pressing Play with the playhead parked at the end starts the segment over.
    rebase(at >= encodeTest.duration - frameStep ? 0 : at);
    playing = true;
    playBtn.textContent = "Pause";
    void runPlayback(++playRun);
  });

  viewSelect.addEventListener("change", () => {
    encodeTest.upscaleSmoothing = viewSelect.value === "smooth";
    syncEncLabel();
    // Redraw where the playhead already is, so the switch shows on the frame being looked at
    // rather than only on the next one.
    drawFrom((parseFloat(scrub.value) / 1000) * encodeTest.duration);
  });

  scrub.addEventListener("input", () => {
    const relT = (parseFloat(scrub.value) / 1000) * encodeTest.duration;
    scrubLabel.textContent = relT.toFixed(2) + "s";
    // Scrubbing mid-playback moves the playhead instead of fighting the loop for the slider.
    if (playing) rebase(relT);
    void drawAt(relT);
  });
  drawFrom(0);
}
