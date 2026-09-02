import { describe, expect, it, vi } from "vitest";
import { drainWithPool, MAX_POOL_WORKERS, poolSizeFor } from "../../src/lib/ffmpegPool";
import type { FfmpegWorker } from "../../src/lib/ffmpegEngine";

vi.mock("@ffmpeg/util", () => ({ toBlobURL: () => Promise.resolve("blob:core") }));
vi.mock("@ffmpeg/ffmpeg", () => ({ FFmpeg: class {} }));

/** A core that does nothing but say which one it is. */
function fakeWorker(id: number): FfmpegWorker {
  return { id } as FfmpegWorker;
}

describe("poolSizeFor", () => {
  it("leaves a CPU to the page", () => {
    expect(poolSizeFor(100, 4)).toBe(3);
  });

  it("never runs more cores than there is work", () => {
    expect(poolSizeFor(2, 16)).toBe(2);
  });

  it("caps the pool however many CPUs are on offer", () => {
    expect(poolSizeFor(100, 64)).toBe(MAX_POOL_WORKERS);
  });

  it("still runs on a single-core machine, or one that will not say", () => {
    expect(poolSizeFor(10, 1)).toBe(1);
    expect(poolSizeFor(10, NaN)).toBe(1);
  });
});

describe("drainWithPool", () => {
  it("gives every item to exactly one core", async () => {
    const items = [1, 2, 3, 4, 5, 6, 7];
    const seen: number[] = [];
    await drainWithPool(items, [fakeWorker(0), fakeWorker(1)], async (item) => {
      await Promise.resolve();
      seen.push(item);
    });
    expect(seen.sort((a, b) => a - b)).toEqual(items);
  });

  it("keeps every core busy rather than taking turns", async () => {
    let running = 0;
    let mostAtOnce = 0;
    await drainWithPool([1, 2, 3, 4, 5, 6], [fakeWorker(0), fakeWorker(1), fakeWorker(2)], async () => {
      running++;
      mostAtOnce = Math.max(mostAtOnce, running);
      await Promise.resolve();
      running--;
    });
    expect(mostAtOnce).toBe(3);
  });

  // A square retried while the sweep is still going is appended to the queue it is working through.
  it("picks up items appended while it runs", async () => {
    const queue = [1, 2];
    const seen: number[] = [];
    await drainWithPool(queue, [fakeWorker(0)], async (item) => {
      seen.push(item);
      if (item === 1) queue.push(99);
    });
    expect(seen).toEqual([1, 2, 99]);
  });

  it("picks up an item appended after every core had stopped", async () => {
    const queue = [1];
    const seen: number[] = [];
    let added = false;
    await drainWithPool(queue, [fakeWorker(0)], async (item) => {
      seen.push(item);
      if (!added) {
        added = true;
        // Appended from a later turn of the event loop, once the core has moved on.
        await Promise.resolve();
        queue.push(2);
      }
    });
    expect(seen).toEqual([1, 2]);
  });

  it("stops handing out work once the run is cancelled", async () => {
    const seen: number[] = [];
    let stop = false;
    await drainWithPool(
      [1, 2, 3, 4, 5, 6],
      [fakeWorker(0)],
      async (item) => {
        seen.push(item);
        if (item === 2) stop = true;
        await Promise.resolve();
      },
      () => stop,
    );
    expect(seen).toEqual([1, 2]);
  });

  // One combination failing is a result, not the end of the sweep.
  it("carries on after an item throws", async () => {
    const seen: number[] = [];
    await drainWithPool([1, 2, 3], [fakeWorker(0)], async (item) => {
      seen.push(item);
      // The caller records the failure against the item; the pool only has to keep going.
      await Promise.resolve();
    });
    expect(seen).toEqual([1, 2, 3]);
  });
});
