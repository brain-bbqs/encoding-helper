// Encoding a few sampled stretches of the loaded video with ffmpeg.wasm, shared by the two tabs that
// do it: the single run under Reencode with FFmpeg, which encodes at whatever the command builder
// currently says, and the sweep under Compare Quality, which encodes the same stretches once per
// combination.
//
// Both are the same job — cut a handful of seconds out of the file, encode them, measure what they
// came to — so both are run from here rather than from one tab that the other borrows from. What is
// left in each tab is the controls it offers and what it does with the result.

import { fetchFile } from "@ffmpeg/util";
import { buildFfmpegArgs } from "../lib/cliCommand";
import { h } from "../lib/dom";
import { parseFfmpegTimeSeconds, type FfmpegWorker } from "../lib/ffmpegEngine";
import { drainWithPool, ffmpegPool, poolSizeFor } from "../lib/ffmpegPool";
import { ensureMediabunny } from "../lib/mediabunny";
import { nearestKeyframeAtOrBefore } from "../lib/mp4boxParser";
import { extOf } from "../lib/save";
import { windowsForRun } from "../lib/sizeEstimate";
import { currentVideoInfo, encodeTest, state } from "../lib/state";
import type { CliState, SampleWindow } from "../lib/types";
import { clearLog, fieldNumber, logConsole, logLine } from "./formControls";

/** The controls a run drives: its buttons, its bar, the line under it and its console. */
export interface RunUi {
  runButton: HTMLButtonElement;
  /** Puts the run button back to what pressing it would do now, which the last run may have
   * changed: a sweep that left squares unmeasured turns it into the button that runs those. */
  syncRunAction: () => void;
  stopButton: HTMLButtonElement;
  progress: HTMLDivElement;
  note: HTMLDivElement;
  log: HTMLDivElement;
}

/**
 * The most stretches one run will encode.
 *
 * Ten of them at the ten-second maximum is a hundred seconds of encoding per setting, which on a
 * single-threaded in-browser core is already a long wait; past that the projection is barely
 * improving anyway, since the band narrows with √n.
 */
export const MAX_SEGMENTS = 10;

/** The source file's bytes, read once and passed down a sweep rather than re-read per combination. */
interface SourceBytes {
  name: string;
  data: Uint8Array;
}

/** The longest stretch worth asking for on the loaded file: ten seconds, or the file when shorter. */
export function maxSampleDuration(): number {
  return Math.max(1, Math.min(10, state.duration || 10));
}

/**
 * The two fields every run asks for: how long a stretch is, and how many of them.
 *
 * Built here rather than in each tab because both tabs edit the same numbers: a duration set on one
 * of them is the duration the other runs at, and the fields say so (see `syncSampleFields`) instead
 * of quietly disagreeing until the next run.
 */
export function sampleFields(idPrefix: string): HTMLDivElement {
  const maxDuration = maxSampleDuration();
  encodeTest.duration = Math.min(Math.max(1, encodeTest.duration || 3), maxDuration);
  const row = h("div", "row compare-grid");
  const durationField = fieldNumber(idPrefix + "Duration", "Duration (s)", encodeTest.duration, 1, maxDuration, 0.5);
  const segmentsField = fieldNumber(idPrefix + "Segments", "Segments", encodeTest.segments, 1, MAX_SEGMENTS, 1);
  const duration = durationField.querySelector("input")!;
  const segments = segmentsField.querySelector("input")!;
  duration.classList.add("sample-duration");
  segments.classList.add("sample-segments");
  duration.addEventListener("input", () => {
    encodeTest.duration = parseFloat(duration.value) || 1;
    syncSampleFields(duration);
  });
  segments.addEventListener("input", () => {
    const asked = parseInt(segments.value, 10);
    encodeTest.segments = Math.min(MAX_SEGMENTS, Math.max(1, Number.isFinite(asked) ? asked : 1));
    syncSampleFields(segments);
  });
  row.append(durationField, segmentsField);
  return row;
}

/** Puts every copy of the sample fields back to what the state says, leaving the one being typed in
 * alone so a half-typed number is not rewritten under the cursor. */
export function syncSampleFields(except?: HTMLElement | null): void {
  document.querySelectorAll<HTMLInputElement>("input.sample-duration").forEach((input) => {
    if (input !== except) input.value = String(encodeTest.duration);
  });
  document.querySelectorAll<HTMLInputElement>("input.sample-segments").forEach((input) => {
    if (input !== except) input.value = String(encodeTest.segments);
  });
}

/** The run button, Stop beside it, the bar, the line under it and the console, as one block. */
export function runControls(runLabel: string): { nodes: HTMLElement[]; ui: RunUi } {
  const buttons = h("div", "compare-run-buttons");
  const runButton = h("button", "btn", runLabel);
  runButton.type = "button";
  const stopButton = h("button", "btn sec", "Stop");
  stopButton.type = "button";
  stopButton.style.display = "none";
  buttons.append(runButton, stopButton);
  const progress = h("div", "progress-wrap");
  progress.style.display = "none";
  progress.append(h("div", "fill"));
  const note = h("div", "progress-label");
  const { wrap: logWrap, log } = logConsole();
  const ui: RunUi = {
    runButton,
    stopButton,
    progress,
    note,
    log,
    syncRunAction: () => {
      runButton.textContent = runLabel;
    },
  };
  stopButton.addEventListener("click", () => requestStop(ui));
  return { nodes: [buttons, progress, note, logWrap], ui };
}

/** The file's bytes, as ffmpeg.wasm wants them. Read per run rather than cached: a whole video held
 * in memory between runs is a large thing to keep for a button that may never be pressed again. */
async function readSource(): Promise<SourceBytes> {
  if (!state.source) throw new Error("No video loaded");
  return { name: state.source.name, data: await fetchFile(state.file ?? state.source.url ?? undefined) };
}

/** What the source is called inside the core's filesystem, keeping its extension so ffmpeg can
 * still tell what it is being handed. */
function inputNameFor(source: SourceBytes): string {
  return "et_in" + extOf(source.name);
}

/** The stretches the next run covers: the last run's where they still fit what the fields ask for
 * (see windowsForRun), each snapped to a keyframe so it can be cut out by copy. */
export function runWindows(): SampleWindow[] {
  return windowsForRun(
    encodeTest.sampled,
    state.duration ?? 0,
    encodeTest.duration,
    encodeTest.segments,
    snapToKeyframe,
  );
}

/** The keyframe at or before `seconds`, or the time itself when the container gave us no table to
 * look in (in which case snippets cannot be cut by copy and the old whole-file trim is used). */
function snapToKeyframe(seconds: number): number {
  const at = nearestKeyframeAtOrBefore(state.keyframeTimestampsSec, seconds);
  return at == null ? seconds : at;
}

/** Whether stretches can be cut out of the source ahead of encoding them. Needs the keyframe table:
 * without it a copy-cut lands wherever ffmpeg's own seek decides, which the A/B window's original
 * side would then be misaligned against. */
function canCutSnippets(): boolean {
  return state.keyframeTimestampsSec.length > 0;
}

/**
 * What one cut stretch is called in the core's filesystem.
 *
 * Named for the loaded file and the seconds it holds, so a later run over the same stretch finds it
 * already there, and a different video can never be handed one of the last one's cuts. Read off the
 * loaded source rather than off any bytes in hand, so the name is the same whether or not the file
 * has been fetched yet — which is what lets a run decide it needs no fetch at all.
 */
function snippetName(window: SampleWindow): string {
  const source = state.source;
  const stamp = `${window.startSeconds.toFixed(3)}_${window.seconds.toFixed(3)}`;
  return `et_snip_${hashName(`${source?.name ?? ""}:${source?.size ?? 0}`)}_${stamp}.mp4`;
}

/** A short, stable id for a file, so two different videos cannot share a cut stretch's name. */
function hashName(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (Math.imul(hash, 31) + text.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(36);
}

/**
 * Cuts every stretch out of the source once, so the encodes that follow read a few hundred KB each
 * instead of the whole video.
 *
 * This is the difference between a sweep that decodes the file from the beginning for every square
 * and one that does not. The cut itself is `-c copy`, so no decoding happens at all, and `-ss`
 * ahead of `-i` seeks rather than reading forward. Cuts already in the filesystem are left alone,
 * which is what lets a second run at another CRF start encoding immediately — and why a remote
 * source is not fetched again for it.
 */
async function ensureSnippets(
  windows: SampleWindow[],
  workers: FfmpegWorker[],
  ui: RunUi,
): Promise<{ names: string[]; data: Uint8Array[] }> {
  const cutter = workers[0];
  const source = await sourceForWindows(windows, cutter);
  const names = windows.map(snippetName);
  if (source) await cutSnippets(windows, names, source, cutter, ui);
  // Read out of the core and kept for the run. Every core encodes from its own filesystem, so each
  // needs the cuts anyway; holding them here as well is what lets a core that crashed — and so
  // came back with an empty filesystem — be handed them again instead of failing every square it
  // is given afterwards. They are a few hundred KB apiece, which is the whole reason a pool is
  // affordable: a copy of the video per core would not be.
  const data: Uint8Array[] = [];
  for (const name of names) {
    if (stopRequested()) throw new RunStopped();
    data.push(await cutter.readFile(name));
  }
  return { names, data };
}

async function cutSnippets(
  windows: SampleWindow[],
  names: string[],
  source: SourceBytes,
  cutter: FfmpegWorker,
  ui: RunUi,
): Promise<void> {
  const inputName = inputNameFor(source);
  for (let i = 0; i < windows.length; i++) {
    const window = windows[i];
    const name = names[i];
    if (stopRequested()) throw new RunStopped();
    if (cutter.has(name)) continue;
    ui.note.textContent = "Cutting the sampled video out of the source…";
    await cutter.ensureInput(inputName, source.data);
    const args = [
      "-y",
      // Ahead of -i, so the seek is a seek: after it, ffmpeg would decode from the start of the
      // file and throw away everything before the stretch asked for.
      "-ss",
      String(window.startSeconds),
      "-i",
      inputName,
      "-t",
      String(window.seconds),
      "-c",
      "copy",
      // The cut starts on a keyframe, so the copied packets carry timestamps from part-way into the
      // source; this rebases them to zero, leaving a file that plays from its own beginning.
      "-avoid_negative_ts",
      "make_zero",
      name,
    ];
    cutter.setHandlers((msg) => logLine(ui.log, msg, "info"), null);
    logLine(ui.log, "$ ffmpeg " + args.join(" "), "success");
    await cutter.runToFile(args, name);
  }
  await cutter.deleteFile(inputName);
}

/** The cut stretches this run needs, or null when every one of them is already in the filesystem —
 * which is the case that spares a remote file from being downloaded again. */
async function sourceForWindows(windows: SampleWindow[], cutter: FfmpegWorker): Promise<SourceBytes | null> {
  if (!state.source) throw new Error("No video loaded");
  if (windows.every((w) => cutter.has(snippetName(w)))) return null;
  return await readSource();
}

/**
 * Encodes one already-cut stretch at `cliState` and hands back the result.
 *
 * Shared by both tabs, so a matrix square and a single run are the same encode over the same
 * seconds. `input` is a stretch cut out beforehand where the container allowed it, and the whole
 * video otherwise, in which case the trim is done here as it always was.
 */
async function encodeSegment(
  cliState: CliState,
  input: { name: string; data: Uint8Array; trim: SampleWindow | null },
  worker: FfmpegWorker,
  ui: RunUi,
  onFraction: (fraction: number) => void,
): Promise<Blob> {
  const info = currentVideoInfo();
  if (!info) throw new Error("No video track loaded");
  // A core that ran out of memory part-way through a sweep was thrown away and comes back empty,
  // so what it reads is checked here rather than once before the run: without this, one square
  // crashing a core failed every later square that core was handed, for a missing input rather
  // than for anything wrong with the settings. A core that still holds the file does nothing.
  await worker.ensureInput(input.name, input.data);
  // Named per core: two of them writing "et_out.mp4" would be one filesystem each, but the name is
  // also what the log shows, and a shared one would read as the same encode running twice.
  const outputName = `et_out_${worker.id}.mp4`;
  const args = buildFfmpegArgs(cliState, info, input.name, outputName);
  const length = input.trim?.seconds ?? encodeTest.duration;
  if (input.trim) {
    // Trim after -i (not before) so the cut is frame-accurate rather than snapped to the nearest
    // preceding keyframe — the two sides need to show the same content, not just start "close
    // enough". Only reached when the stretch could not be cut out beforehand.
    const iIdx = args.indexOf("-i");
    args.splice(iIdx + 2, 0, "-ss", String(input.trim.startSeconds), "-t", String(input.trim.seconds));
  }
  worker.setHandlers((msg) => {
    logLine(ui.log, prefixed(worker, msg), "info");
    // Progress is taken from the status lines rather than from the core's own progress events,
    // which are a fraction of the whole input: a 3-second segment of a 30-second file would
    // creep to 10% and stop there, looking like it gave up rather than finished.
    const at = parseFfmpegTimeSeconds(msg);
    if (at == null || !(length > 0)) return;
    onFraction(Math.min(1, Math.max(0, at / length)));
  }, null);
  logLine(ui.log, prefixed(worker, "$ ffmpeg " + args.join(" ")), "success");
  const { data } = await worker.run(args, outputName);
  return new Blob([data], { type: "video/mp4" });
}

/**
 * Readies everything a run encodes from: the stretches, and a file per stretch to read.
 *
 * Where the container gives up a keyframe table, each stretch is cut out once with a stream copy
 * and every encode reads that instead of the whole video. Where it does not, the whole video goes
 * in and each encode trims it itself, which is what the tab did before any of this.
 */
export async function prepareRun(windows: SampleWindow[], workers: FfmpegWorker[], ui: RunUi): Promise<RunInputs> {
  if (canCutSnippets()) {
    const { names, data } = await ensureSnippets(windows, workers, ui);
    return { windows, names, data, preCut: true };
  }
  // Nothing to cut, so every core needs the whole video. That is the case a pool cannot help with
  // and should not be paid for, so it runs on one core alone.
  const source = await readSource();
  await workers[0].ensureInput(inputNameFor(source), source.data);
  return {
    windows,
    names: windows.map(() => inputNameFor(source)),
    data: windows.map(() => source.data),
    preCut: false,
    wholeFileOn: workers[0],
  };
}

/** Prefixes a log line with which core it came from, once there is more than one to tell apart. */
function prefixed(worker: FfmpegWorker, message: string): string {
  return worker.id === 0 ? message : `[core ${worker.id}] ${message}`;
}

/** What one run encodes: the stretches it covers and the file in the core holding each. */
export interface RunInputs {
  windows: SampleWindow[];
  /** One filename per window: a stretch cut out beforehand, or the whole video for every one of
   * them when the container did not allow cutting. */
  names: string[];
  /** The bytes behind each name, held for the length of the run so a core that was replaced
   * mid-run can be given its inputs back. */
  data: Uint8Array[];
  /** Whether those names are cut stretches (so no trim is needed) or the source itself. */
  preCut: boolean;
  /** The core holding the whole video, when there was no cutting and only one core can be used. */
  wholeFileOn?: FfmpegWorker;
}

/**
 * Encodes every sampled stretch at `cliState` and reports what they came to together.
 *
 * All of them are kept, in the order they were sampled: the size question is answered by the bytes
 * added up, and the A/B window plays the stretches one after another, so the eye judges the same
 * spread of the file the projection was taken over rather than whichever stretch happened to be
 * first.
 *
 * Given more than one core, the stretches encode side by side on them. A sweep hands one core in,
 * since its cores are already busy with the other squares.
 */
export async function encodeWindows(
  cliState: CliState,
  inputs: RunInputs,
  workers: FfmpegWorker[],
  ui: RunUi,
  onProgress: (fraction: number) => void,
): Promise<{ blobs: Blob[]; bytes: number; measured: SampleWindow[] }> {
  const windows = inputs.windows;
  // Indexed rather than pushed, since the cores finish in whatever order they finish: the A/B
  // window plays the stretches in the order they were sampled, not the order they came back in.
  const blobs = new Array<Blob | null>(windows.length).fill(null);
  const measured = new Array<SampleWindow | null>(windows.length).fill(null);
  const fractions = new Array<number>(windows.length).fill(0);
  const report = (): void => onProgress(fractions.reduce((sum, f) => sum + f, 0) / windows.length);

  await drainWithPool(
    windows.map((w, i) => ({ window: w, index: i })),
    workers,
    async ({ window, index }, worker) => {
      const blob = await encodeSegment(
        cliState,
        { name: inputs.names[index], data: inputs.data[index], trim: inputs.preCut ? null : window },
        worker,
        ui,
        (fraction) => {
          fractions[index] = fraction;
          report();
        },
      );
      fractions[index] = 1;
      report();
      blobs[index] = blob;
      let seconds = window.seconds;
      try {
        const measuredSeconds = await segmentDuration(blob);
        if (measuredSeconds > 0) seconds = measuredSeconds;
      } catch {
        // The projection falls back to the requested length; the encode itself is still good.
      }
      measured[index] = { startSeconds: window.startSeconds, seconds };
    },
    stopRequested,
  );

  if (stopRequested()) throw new RunStopped();
  if (!blobs.length || blobs.some((b) => b == null)) throw new Error("No stretch of video to encode");
  return {
    blobs: blobs as Blob[],
    bytes: blobs.reduce((sum, b) => sum + (b?.size ?? 0), 0),
    measured: measured as SampleWindow[],
  };
}

/**
 * The encoded segment's own playback length, which the size projection is taken over.
 *
 * Disposed on the way out: a default sweep measures 120 of these, and an Input left open holds the
 * blob and whatever the browser gave it to read the blob with. Leaked by the hundred, the browser
 * eventually refuses to decode anything at all.
 */
async function segmentDuration(blob: Blob): Promise<number> {
  const mb = await ensureMediabunny();
  const input = new mb.Input({ source: new mb.BlobSource(blob), formats: mb.ALL_FORMATS });
  try {
    return await input.computeDuration();
  } finally {
    input.dispose();
  }
}

/**
 * Drops the whole-video copy a run needed, keeping any cut stretches.
 *
 * The video is the size of the file and there is no telling when another run wants it; the cut
 * stretches are a few hundred KB and are exactly what the next run over the same seconds needs, so
 * they stay. A run that cut its stretches has already dropped the source it cut them from.
 */
export async function dropWholeFileInput(inputs: RunInputs | null): Promise<void> {
  if (!inputs || inputs.preCut) return;
  await inputs.wholeFileOn?.deleteFile(inputs.names[0]);
}

/**
 * Whether Stop has been pressed, read through a call: the button flips the flag while the run is
 * awaiting an encode, which a straight field read (assigned false on the line above) cannot see.
 */
export function stopRequested(): boolean {
  return encodeTest.cancelRequested;
}

/** The cores the run in progress is encoding on, so Stop has something to stop. */
let activeWorkers: FfmpegWorker[] = [];

/** The pool this run will encode on, registered so Stop can reach it. */
export function acquireWorkers(taskCount: number): FfmpegWorker[] {
  activeWorkers = ffmpegPool(poolSizeFor(taskCount));
  return activeWorkers;
}

/** A run ended because Stop was pressed, which is not a failure to report as one. */
export class RunStopped extends Error {
  constructor() {
    super("Stopped");
    this.name = "RunStopped";
  }
}

/**
 * Stops the run now, rather than at the end of whatever is already in flight.
 *
 * The encode runs inside wasm, which offers no way to interrupt a call already in it, so waiting
 * for the encode in progress means waiting for exactly the slow combination Stop tends to be
 * pressed about — with the tab's buttons disabled and the bar still filling the whole time.
 * Terminating the core is the interrupt: its pending call rejects, the run unwinds through the
 * error handling it already has, and the next run builds a fresh core. What that costs is the cut
 * stretches the terminated core was holding, which the next run cuts again.
 */
export function requestStop(ui: RunUi): void {
  if (!encodeTest.running) return;
  encodeTest.cancelRequested = true;
  ui.stopButton.disabled = true;
  ui.note.textContent = "Stopping…";
  for (const worker of activeWorkers) worker.reset();
}

/** Readies the progress bar and console for a run, and hands back the bar's fill. */
export function startRunUi(ui: RunUi): HTMLDivElement | null {
  encodeTest.running = true;
  encodeTest.cancelRequested = false;
  ui.runButton.disabled = true;
  // Offered by both tabs: a single run is several stretches encoded one after another, which is
  // long enough to want out of.
  ui.stopButton.style.display = "";
  ui.stopButton.disabled = false;
  ui.progress.style.display = "block";
  const fill = ui.progress.querySelector<HTMLDivElement>(".fill");
  if (fill) {
    fill.style.width = "0%";
    fill.classList.remove("done");
  }
  clearLog(ui.log);
  return fill;
}

export function endRunUi(ui: RunUi): void {
  encodeTest.running = false;
  activeWorkers = [];
  ui.runButton.disabled = false;
  ui.syncRunAction();
  ui.stopButton.style.display = "none";
}

export function reportRunFailure(err: unknown, ui: RunUi): void {
  if (err instanceof RunStopped) {
    ui.note.textContent = "Stopped.";
    ui.progress.style.display = "none";
    return;
  }
  console.error("[encoding-helper] encode run failed:", err);
  ui.note.textContent = "Failed: " + (err instanceof Error ? err.message : String(err));
  logLine(ui.log, String(err instanceof Error ? err.message : err), "error");
  // Nothing to show the length of, so the bar goes rather than freezing wherever it stopped.
  ui.progress.style.display = "none";
}
