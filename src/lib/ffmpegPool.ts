// Several ffmpeg.wasm cores at once, for work that is many independent encodes.
//
// The core is single-threaded WebAssembly, so one of them uses one CPU however many the machine
// has. A matrix sweep is dozens of encodes that do not depend on each other, which is the shape of
// work a pool exists for: N cores on N CPUs finish it in roughly a fraction N of the time.
//
// What it costs is memory. Each core compiles its own ~30 MB module and keeps its own heap and
// filesystem, so the pool is small and deliberately leaves a CPU for the page itself. It is only
// affordable at all because the stretches being encoded are cut out of the video beforehand (see
// Compare Quality's snippet cutting): handing every core its own copy of a whole video would not be.
//
// Cores are kept between runs rather than built per run. Loading one is not free, and each carries
// the cut stretches it has already been given, which is exactly what the next run over the same
// seconds wants.

import { createFfmpegWorker, defaultFfmpegWorker, type FfmpegWorker } from "./ffmpegEngine";

/**
 * The most cores to run at once.
 *
 * Four is well past the point where a browser tab's memory is the binding constraint rather than
 * the CPU count, and a sweep long enough to want more is one to run natively from the copied
 * command anyway.
 */
export const MAX_POOL_WORKERS = 4;

/** Cores beyond the default one, created on demand and kept for later runs. */
const extraWorkers: FfmpegWorker[] = [];

/**
 * How many cores to run for `items` pieces of work.
 *
 * One CPU is left to the page, which has a progress bar to paint and a grid to redraw while the
 * encoding runs; a tab that hands every core to ffmpeg reports its own progress in lurches. There
 * is also no point in more cores than there is work.
 */
export function poolSizeFor(items: number, hardwareConcurrency = navigator.hardwareConcurrency): number {
  const cpus = Number.isFinite(hardwareConcurrency) && hardwareConcurrency > 0 ? hardwareConcurrency : 2;
  return Math.max(1, Math.min(MAX_POOL_WORKERS, cpus - 1, items));
}

/** `count` cores, the app's default one first, the rest created once and reused after that. */
export function ffmpegPool(count: number): FfmpegWorker[] {
  const wanted = Math.max(1, count);
  while (extraWorkers.length < wanted - 1) extraWorkers.push(createFfmpegWorker(extraWorkers.length + 1));
  return [defaultFfmpegWorker, ...extraWorkers.slice(0, wanted - 1)];
}

/**
 * Runs `work` over `queue` on every core at once, each taking the next item as it frees up.
 *
 * The queue is read live rather than sliced up front, so an item appended while the run is going
 * (a square retried mid-sweep) is picked up by whichever core reaches it — and the outer loop
 * catches the case where every core had already stopped when it arrived.
 *
 * An item that throws is that item's problem: `work` is expected to record the failure against it,
 * and one failure does not end the run, since finding out what this file and this browser can do is
 * usually the point.
 */
export async function drainWithPool<T>(
  queue: T[],
  workers: FfmpegWorker[],
  work: (item: T, worker: FfmpegWorker, index: number) => Promise<void>,
  shouldStop: () => boolean = () => false,
): Promise<void> {
  let next = 0;
  while (next < queue.length) {
    await Promise.all(
      workers.map(async (worker) => {
        for (;;) {
          if (shouldStop()) return;
          // Read and claim in one step: JavaScript runs this to completion before any other core's
          // turn, so two of them cannot take the same item.
          const index = next++;
          if (index >= queue.length) return;
          await work(queue[index], worker, index);
        }
      }),
    );
    if (shouldStop()) return;
  }
}
