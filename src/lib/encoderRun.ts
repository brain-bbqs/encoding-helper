// One encode at a time, whatever kind it is.
//
// The sample run, the sweep, a square encoded again for the A/B window and the whole-file encode
// all run on the same cores (the whole-file one on the pool's first), so two at once would rebind
// each other's log handlers, encode over each other's inputs, and leave Stop reaching only the
// cores of whichever registered last. Each takes the encoder here before its first await and gives
// it back when it ends; one that finds it taken is refused, and says why.
//
// A file load or Reset stops the run holding it and takes it back on the spot (see resetState).
// What that run has left to unwind can outlast the load (a core still downloading cannot be
// interrupted, nor can a read of the source), so it carries its own hold: it is stopped, so it ends
// at its next check, and it no longer holds the encoder, so its cleanup leaves the next file's run
// alone.

import type { FfmpegWorker } from "./ffmpegEngine";

/** The tabs a run can be started from, as their labels read. */
export type RunTab = "Compare Quality" | "Reencode with FFmpeg";

/** One encode's hold on the encoder, from its start to its end. */
export interface EncoderRun {
  /** Where it was started, for the note that refuses another run meanwhile. */
  readonly tab: RunTab;
  /** Whether it shows a Stop button, so that the note can say to press it. */
  readonly stoppable: boolean;
  /** Set by Stop, and by a file load or Reset. A stopped run goes no further than its next check. */
  stopped: boolean;
  /** Every core it has encoded on, which stopping it terminates. */
  readonly workers: Set<FfmpegWorker>;
}

/** The run holding the encoder, or null while it is free. */
let holder: EncoderRun | null = null;

/** Whether some encode holds the encoder right now. */
export function encoderBusy(): boolean {
  return holder !== null;
}

/** Takes the encoder for a run starting now, or, while another run has it, says so in `note` and
 * hands back null. */
export function claimEncoder(tab: RunTab, stoppable: boolean, note: HTMLElement): EncoderRun | null {
  if (holder) {
    note.textContent =
      `An encode is already running on the ${holder.tab} tab. ` +
      `Wait for it to finish${holder.stoppable ? " or stop it" : ""}.`;
    return null;
  }
  holder = { tab, stoppable, stopped: false, workers: new Set() };
  return holder;
}

/** Whether `run` still holds the encoder: false once it has ended, or a file load or Reset took the
 * encoder from it, after which the state it would write to is the next file's. */
export function holdsEncoder(run: EncoderRun): boolean {
  return holder === run;
}

/** Gives the encoder back, and says whether `run` still had it to give (see holdsEncoder). */
export function releaseEncoder(run: EncoderRun): boolean {
  if (holder !== run) return false;
  holder = null;
  return true;
}

/** What Stop does: stops the run holding the encoder. False when nothing holds it. */
export function stopEncoderRun(): boolean {
  if (!holder) return false;
  stop(holder);
  return true;
}

/** Stops whatever run holds the encoder and takes the encoder back from it, for a file load or Reset. */
export function abandonEncoderRun(): void {
  const run = holder;
  holder = null;
  if (run) stop(run);
}

/**
 * Stops `run` now, rather than at the end of whatever is already in flight.
 *
 * The encode runs inside wasm, which offers no way to interrupt a call already in it, so waiting
 * for the encode in progress means waiting for exactly the slow combination Stop tends to be
 * pressed about. Terminating the core is the interrupt: its pending call rejects, the run unwinds
 * through the error handling it already has, and the next run builds a fresh core. What that costs
 * is the cut stretches the terminated core was holding, which the next run cuts again.
 */
function stop(run: EncoderRun): void {
  run.stopped = true;
  for (const worker of run.workers) worker.reset();
}

/** A run ended because it was stopped, which is not a failure to report as one. */
export class RunStopped extends Error {
  constructor() {
    super("Stopped");
    this.name = "RunStopped";
  }
}

/** Ends `run` here if it has been stopped. */
export function throwIfStopped(run: EncoderRun): void {
  if (run.stopped) throw new RunStopped();
}

/** Ends `run` here if a file load or Reset has taken the encoder from it, after which the state it
 * would write to is the next file's. A run stopped by Stop alone goes on past this. */
export function throwIfAbandoned(run: EncoderRun): void {
  if (holder !== run) throw new RunStopped();
}
