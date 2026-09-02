// Picking which few seconds of the loaded file a single run encodes.
//
// A track across the whole recording with the run's window drawn on it, modelled on
// brain-bbqs/clip-extractor's trim timeline: the same 12px track, the same accent-filled band with
// its two edges, the same ruler gradated into about six labelled divisions (see lib/sampleTimeline).
// What is different is that the band cannot be resized — the run's length is fixed — so there is one
// thing to do here, which is to say *where*.
//
// The frame under the band's start is decoded and shown above it, because scanning a recording means
// looking at it: a time in seconds says nothing about whether the animal is in shot.

import { h } from "../lib/dom";
import { ensureMediabunny } from "../lib/mediabunny";
import { nearestKeyframeAtOrBefore } from "../lib/mp4boxParser";
import { clampWindowStart, fmtClock, rulerMarks, SAMPLE_SECONDS } from "../lib/sampleTimeline";
import { encodeTest, state } from "../lib/state";
import type { SampleWindow } from "../lib/types";

/** How far the arrow keys move the window, and the coarser step Shift gives them. */
const STEP_SECONDS = 1;
const BIG_STEP_SECONDS = 10;

interface SamplePicker {
  el: HTMLElement;
  /** The stretch the next run should encode, as the track currently has it. */
  window: () => SampleWindow;
}

/**
 * The picker, or null when the file gives nothing to pick across.
 *
 * The start is kept in shared state rather than in the closure, so re-rendering the tab (a new file,
 * say) does not lose where the last one was pointed — and a run started from anywhere reads the same
 * seconds the track is showing.
 */
export function samplePicker(): SamplePicker | null {
  const total = state.duration ?? 0;
  if (!(total > 0)) return null;
  const windowSeconds = Math.min(SAMPLE_SECONDS, total);

  const wrap = h("div", "sample-picker");
  const preview = h("canvas", "sample-preview");
  const previewWrap = h("div", "sample-preview-wrap");
  previewWrap.append(preview);
  const previewNote = h("div", "sample-preview-note");
  previewWrap.append(previewNote);
  wrap.append(previewWrap);

  const trackPad = h("div", "sample-track-pad");
  const track = h("div", "sample-track");
  const band = h("div", "sample-band");
  band.tabIndex = 0;
  band.setAttribute("role", "slider");
  band.setAttribute("aria-label", "Which seconds of the video to encode");
  band.setAttribute("aria-valuemin", "0");
  band.setAttribute("aria-valuemax", (total - windowSeconds).toFixed(1));
  track.append(band);
  const ruler = h("div", "sample-ruler");
  ruler.setAttribute("aria-hidden", "true");
  for (const mark of rulerMarks(total)) {
    const left = (mark.seconds / total) * 100;
    const tick = h("div", "sample-tick" + (mark.major ? " major" : ""));
    tick.style.left = left.toFixed(3) + "%";
    ruler.append(tick);
    if (!mark.major) continue;
    // The end labels would hang off the track, so they align inwards instead of centring — the way
    // clip-extractor's ruler handles its own ends.
    const atStart = left < 2 ? " at-start" : "";
    const atEnd = left > 98 ? " at-end" : "";
    const label = h("div", "sample-tick-label" + atStart + atEnd, fmtClock(mark.seconds, total));
    label.style.left = left.toFixed(3) + "%";
    ruler.append(label);
  }
  trackPad.append(track, ruler);
  wrap.append(trackPad);

  const start = (): number => clampWindowStart(encodeTest.sampleStart, total, windowSeconds);
  /** Where the encode actually begins: the cut is made at a keyframe, so the track says so rather
   * than showing a start the run would quietly move. */
  const snapped = (): number => {
    const from = start();
    return nearestKeyframeAtOrBefore(state.keyframeTimestampsSec, from) ?? from;
  };

  // Bumped per requested frame, so a drag that outruns the decoder draws the frame it ended on
  // rather than whichever request happens to come back last.
  let drawToken = 0;
  const drawPreview = (): void => {
    const token = ++drawToken;
    const at = snapped();
    // Nothing to decode from until a file is open; the track still picks seconds off the clock.
    if (!state.videoTrack) {
      previewNote.textContent = "No decoded frame to show for this file.";
      return;
    }
    void (async () => {
      try {
        const mb = await ensureMediabunny();
        sink ??= new mb.CanvasSink(state.videoTrack!, { poolSize: 2 });
        const frame = await sink.getCanvas(at);
        if (token !== drawToken || !frame) return;
        const ctx = preview.getContext("2d");
        if (!ctx) return;
        preview.width = frame.canvas.width;
        preview.height = frame.canvas.height;
        ctx.drawImage(frame.canvas, 0, 0);
        previewWrap.classList.add("has-frame");
        previewNote.textContent = "";
      } catch (err) {
        if (token !== drawToken) return;
        // A browser that will not decode this file can still pick a stretch by the clock; only the
        // picture is missing, so the note says that rather than the whole control failing.
        console.warn("[encoding-helper] could not draw the sample preview:", err);
        previewNote.textContent = "This browser will not decode the video, so there is no preview to scan.";
      }
    })();
  };
  let sink: import("mediabunny").CanvasSink | null = null;

  const sync = (): void => {
    const from = start();
    const left = (from / total) * 100;
    band.style.left = left.toFixed(3) + "%";
    band.style.width = Math.min(100 - left, (windowSeconds / total) * 100).toFixed(3) + "%";
    band.setAttribute("aria-valuenow", from.toFixed(1));
    band.setAttribute("aria-valuetext", `${fmtClock(from, total)} to ${fmtClock(from + windowSeconds, total)}`);
  };

  const moveTo = (seconds: number): void => {
    const next = clampWindowStart(seconds, total, windowSeconds);
    if (next === encodeTest.sampleStart) return;
    encodeTest.sampleStart = next;
    sync();
    drawPreview();
  };

  /** The time a pointer landed on, as a fraction of the track. */
  const timeAt = (clientX: number): number => {
    const box = track.getBoundingClientRect();
    if (!(box.width > 0)) return 0;
    return ((clientX - box.left) / box.width) * total;
  };

  // Pressing the bare track centres the window there, the way clip-extractor's track sends the
  // playhead to where it was pressed; dragging the band slides it from wherever it was grabbed.
  track.addEventListener("pointerdown", (e) => {
    const onBand = e.target === band || band.contains(e.target as Node);
    const grabOffset = onBand ? timeAt(e.clientX) - start() : windowSeconds / 2;
    if (!onBand) moveTo(timeAt(e.clientX) - grabOffset);
    track.setPointerCapture(e.pointerId);
    band.classList.add("dragging");
    const onMove = (move: PointerEvent): void => moveTo(timeAt(move.clientX) - grabOffset);
    const onUp = (): void => {
      band.classList.remove("dragging");
      track.removeEventListener("pointermove", onMove);
      track.removeEventListener("pointerup", onUp);
      track.removeEventListener("pointercancel", onUp);
    };
    track.addEventListener("pointermove", onMove);
    track.addEventListener("pointerup", onUp);
    track.addEventListener("pointercancel", onUp);
    e.preventDefault();
  });

  band.addEventListener("keydown", (e) => {
    const step = e.shiftKey ? BIG_STEP_SECONDS : STEP_SECONDS;
    if (e.key === "ArrowLeft") moveTo(start() - step);
    else if (e.key === "ArrowRight") moveTo(start() + step);
    else if (e.key === "Home") moveTo(0);
    else if (e.key === "End") moveTo(total);
    else return;
    e.preventDefault();
  });

  sync();
  drawPreview();
  return { el: wrap, window: () => ({ startSeconds: snapped(), seconds: windowSeconds }) };
}
